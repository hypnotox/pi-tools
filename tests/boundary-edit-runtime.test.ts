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
const selectors = { start: { text: "START", side: "before" }, end: { text: "END", side: "after" } };
const entry = { ...selectors, replacement: "new" };

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
      expect.arrayContaining(["boundary_edit", "boundary_read", "read", "edit", "write"]),
    );
    expect(configured.some((tool) => tool.name === "boundary_select")).toBe(false);
    expect(session.systemPrompt).toContain(
      "Use boundary_read when known start/end content identifies the region you want to inspect.",
    );
    expect(session.systemPrompt).toContain(
      "Prefer boundary editing with boundary_edit for replacing or deleting substantial regions",
    );
    expect(session.systemPrompt).not.toContain("boundary_select");
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
          edits: [
            entry,
            {
              start: { text: "suffix", side: "before" },
              end: { text: "suffix", side: "after" },
              replacement: "last",
            },
          ],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    await session.prompt("Exercise boundary_edit.");
    expect(await fs.readFile(join(cwd, "target.txt"), "utf8")).toBe("prefix\nnew\nlast\n");
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

  it("executes batched reading and reports its failures through Pi", async () => {
    const { cwd, session, faux } = await load();
    const path = join(cwd, "target.txt");
    const original = Buffer.from("prefix\nSTART\nold\nEND\nsuffix\n");
    await fs.writeFile(path, original);
    const input = {
      path: "target.txt",
      ranges: [
        selectors,
        { start: { text: "old", side: "before" }, end: { text: "old", side: "after" } },
      ],
      maxLines: "all",
    };
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("boundary_read", input), { stopReason: "toolUse" }),
      fauxAssistantMessage(
        [
          fauxToolCall("boundary_read", {
            ...input,
            ranges: [
              selectors,
              { ...selectors, end: { text: "missing", side: "before" } },
              { ...selectors, start: { text: "absent", side: "after" } },
            ],
          }),
          fauxToolCall("boundary_read", { ...input, replacement: "not allowed" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    await session.prompt("Inspect the range and exercise failures.");
    expect(await fs.readFile(path)).toEqual(original);
    const results = session.messages.filter((message) => message.role === "toolResult");
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      toolName: "boundary_read",
      isError: false,
      details: {
        ranges: [
          { span: "[2:1, 4:4)", selected: { lines: 3, bytes: 13 } },
          { span: "[3:1, 3:4)", selected: { lines: 1, bytes: 3 } },
        ],
      },
    });
    for (const result of results.slice(1))
      expect(result).toMatchObject({ toolName: "boundary_read", isError: true });
    expect(results[1]?.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(
          /START\nold\nEND[\s\S]*Range 2 \| ERROR[\s\S]*Range 3 \| ERROR/,
        ),
      },
    ]);
  });

  it("reports schema and selection failures to Pi as errors, not successful text", async () => {
    const { cwd, session, faux } = await load();
    const path = join(cwd, "target.txt");
    const bytes = Buffer.from("START\nold\nEND\n");
    await fs.writeFile(path, bytes);
    const input = { path: "target.txt", edits: [entry] };
    const invalid = [
      { ...input, edits: [{ ...entry, start: { text: "missing", side: "before" } }] },
      { ...input, edits: [{ ...entry, start: { text: "", side: "before" } }] },
      { ...input, path: "" },
      { ...input, edits: [{ ...entry, end: { text: "END", side: "invalid" } }] },
      { ...input, edits: [{ ...entry, replacement: ["new"] }] },
      { ...input, extra: true },
      { ...input, edits: [] },
      { ...input, edits: [{ ...entry, start: "START" }] },
      { ...input, edits: [{ ...entry, end: { text: "END", side: "after", line: 3 } }] },
      { ...input, edits: [entry, entry] },
      { path: "target.txt", start: "START", end: "END", replacement: "new" },
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

  it.each([
    { alias: false, toolName: "boundary_edit" },
    { alias: true, toolName: "boundary_edit" },
    { alias: false, toolName: "boundary_read" },
    { alias: true, toolName: "boundary_read" },
  ])(
    "$toolName reads only after native edit settles (symlink=$alias)",
    async ({ alias, toolName }) => {
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
      const boundary = session.agent.state.tools.find((tool) => tool.name === toolName);
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
        ...(toolName === "boundary_edit" ? { edits: [entry] } : { ranges: [selectors] }),
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
      expect(await fs.readFile(path, "utf8")).toBe(
        toolName === "boundary_edit"
          ? "native prefix\nnew\nsuffix\n"
          : "native prefix\nSTART\nold\nEND\nsuffix\n",
      );
      if (toolName === "boundary_read")
        expect((await boundaryEdit).details).toMatchObject({ ranges: [{ span: "[2:1, 4:4)" }] });
    },
  );
});
