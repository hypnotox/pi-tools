import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createProvider } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createEditTool,
  createReadTool,
  createWriteTool,
  SessionManager,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("boundary_edit through Pi's real package loader and runtime", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanups.length) await cleanups.pop()?.();
  });

  async function load() {
    const cwd = await fs.mkdtemp(join(tmpdir(), "pi-tools-boundary-runtime-"));
    cleanups.push(() => fs.rm(cwd, { recursive: true, force: true }));
    const agentDir = join(cwd, "config");
    await fs.mkdir(agentDir);
    await fs.writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [root] }));
    const faux = createFauxCore({ provider: "pi-tools-boundary-faux", models: [{ id: "test" }] });
    const model = faux.getModel("test");
    if (!model) throw new Error("Missing faux model");
    const provider = createProvider({
      id: faux.provider,
      auth: {
        apiKey: {
          name: "test",
          resolve: async ({ credential }) =>
            credential?.key ? { auth: { apiKey: credential.key }, source: "fixture" } : undefined,
        },
      },
      models: faux.models,
      api: { stream: faux.stream, streamSimple: faux.streamSimple },
    });
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ sessionManager }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        resourceLoaderOptions: {
          extensionFactories: [
            (pi) => {
              pi.registerProvider(provider);
            },
          ],
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        },
      });
      await services.modelRuntime.setRuntimeApiKey(faux.provider, "faux-key");
      return {
        ...(await createAgentSessionFromServices({ services, sessionManager, model })),
        services,
        diagnostics: services.diagnostics,
      };
    };
    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd,
      agentDir,
      sessionManager: SessionManager.inMemory(cwd),
    });
    cleanups.push(() => runtime.dispose());
    await runtime.session.bindExtensions({ mode: "print" });
    const extensions = runtime.services.resourceLoader.getExtensions();
    expect(extensions.errors).toEqual([]);
    expect(extensions.extensions.map((extension) => extension.resolvedPath)).toContain(
      resolve(root, "extensions/boundary-edit/index.ts"),
    );
    return { cwd, runtime, session: runtime.session, faux };
  }

  it("discovers the manifest tool, leaves native tools intact, and executes without UI", async () => {
    const { cwd, session, faux } = await load();
    const configured = session.getAllTools();
    expect(session.getActiveToolNames()).toEqual(
      expect.arrayContaining(["boundary_edit", "read", "edit", "write"]),
    );
    for (const native of [createReadTool(cwd), createEditTool(cwd), createWriteTool(cwd)]) {
      expect(configured.find((tool) => tool.name === native.name)).toMatchObject({
        description: native.description,
        parameters: native.parameters,
        sourceInfo: { source: "builtin" },
      });
    }
    await fs.writeFile(join(cwd, "target.txt"), "prefix\nSTART\nold\nEND\nsuffix\n");
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("boundary_edit", {
          path: "target.txt",
          start: "START",
          end: "END",
          replacement: "new",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    await session.prompt("Exercise boundary_edit.");
    expect(await fs.readFile(join(cwd, "target.txt"), "utf8")).toBe("prefix\nnew\nsuffix\n");
    expect(session.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "toolResult",
          toolName: "boundary_edit",
          isError: false,
          details: expect.objectContaining({ changed: true }),
        }),
      ]),
    );
  });

  it("reports schema and selection failures to Pi as errors, not successful text", async () => {
    const { cwd, session, faux } = await load();
    const path = join(cwd, "target.txt");
    const bytes = Buffer.from("START\nold\nEND\n");
    await fs.writeFile(path, bytes);
    const input = { path: "target.txt", start: "START", end: "END", replacement: "new" };
    const invalid = [
      { ...input, start: "missing" },
      { ...input, start: "" },
      { ...input, path: "" },
      { ...input, end: "" },
      { ...input, replacement: ["new"] },
      { ...input, extra: true },
      { path: "target.txt", start: "START", end: "END" },
    ];
    faux.setResponses([
      fauxAssistantMessage(
        invalid.map((params) => fauxToolCall("boundary_edit", params)),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    await session.prompt("Exercise failures.");
    const results = session.messages.filter((message) => message.role === "toolResult");
    expect(results).toHaveLength(invalid.length);
    for (const result of results)
      expect(result).toMatchObject({ toolName: "boundary_edit", isError: true });
    expect(await fs.readFile(path)).toEqual(bytes);
  });

  it.each([false, true])(
    "shares the complete read-modify-write queue with native edit (symlink=%s)",
    async (alias) => {
      const { cwd, session } = await load();
      const path = join(cwd, "target.txt");
      const aliasPath = join(cwd, "alias.txt");
      await fs.writeFile(path, "prefix\nSTART\nold\nEND\nsuffix\n");
      if (alias) await fs.symlink(path, aliasPath);
      let release = () => {};
      let entered = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const readFile = fs.readFile.bind(fs);
      // Only pause native I/O; selection and mutation still use Pi's native edit.
      const native = createEditTool(cwd, {
        operations: {
          access: (file) => fs.access(file),
          readFile: async (file) => {
            const bytes = await readFile(file);
            entered();
            await gate;
            return bytes;
          },
          writeFile: (file, text) => fs.writeFile(file, text, "utf8"),
        },
      });
      const boundary = session.agent.state.tools.find((tool) => tool.name === "boundary_edit");
      if (!boundary) throw new Error("Missing loaded tool");
      const nativeEdit = native.execute("native", {
        path,
        edits: [{ oldText: "prefix", newText: "native prefix" }],
      });
      cleanups.push(async () => {
        release();
        await nativeEdit;
      });
      await ready;
      const reads = vi.spyOn(fs, "readFile");
      const boundaryEdit = boundary.execute("boundary", {
        path: alias ? aliasPath : path,
        start: "START",
        end: "END",
        replacement: "new",
      });
      try {
        // A different-file queue entry drains earlier registrations without waiting
        // for this file's held native mutation. No sleeps or race-probability oracle.
        await withFileMutationQueue(join(cwd, "queue-barrier"), async () => {});
        expect(reads).not.toHaveBeenCalled();
      } finally {
        release();
        await Promise.all([nativeEdit, boundaryEdit]);
      }
      expect(await fs.readFile(path, "utf8")).toBe("native prefix\nnew\nsuffix\n");
    },
  );
});
