import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  createEditTool,
  createEditToolDefinition,
  initTheme,
  ToolExecutionComponent,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionHarness } from "../../tests/extension-harness.js";
import boundaryEdit from "./index.js";

type RenderableTool = NonNullable<ConstructorParameters<typeof ToolExecutionComponent>[4]> & {
  name: string;
};
type RenderResult = Parameters<ToolExecutionComponent["updateResult"]>[0];

describe("boundary_edit against real files", () => {
  let cwd: string;
  let path: string;
  let harness: ReturnType<typeof createExtensionHarness>;
  const selectors = { start: "START", end: "END", replacement: "new" };
  const original = "prefix\nSTART\nold\nEND\nsuffix\n";

  beforeEach(async () => {
    cwd = await fs.mkdtemp(join(tmpdir(), "pi-tools-boundary-"));
    path = join(cwd, "target.txt");
    await fs.writeFile(path, original);
    harness = createExtensionHarness();
    boundaryEdit(harness.api);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  const execute = (params: Record<string, unknown> = {}, signal?: AbortSignal) =>
    harness.execute(
      "boundary_edit",
      { path: "target.txt", ...selectors, ...params },
      { cwd, hasUI: false },
      signal,
    );

  it("registers only the additional tool and executes without a UI", async () => {
    expect(harness.tools.map((tool) => tool.name)).toEqual(["boundary_edit"]);
    expect(harness.handlers.size).toBe(0);
    const writes = vi.spyOn(fs, "writeFile");
    const result = await execute();
    expect(await fs.readFile(path, "utf8")).toBe("prefix\nnew\nsuffix\n");
    expect(writes).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      changed: true,
      startLine: 2,
      endLine: 4,
      truncated: false,
      diff: expect.stringContaining("+2 new"),
      patch: expect.stringContaining("+new"),
      firstChangedLine: 2,
    });
    expect(result.content).toEqual([
      { type: "text", text: "Successfully replaced 1 block(s) in target.txt." },
    ]);
  });

  it("matches native edit's confirmation and diff details for the same change", async () => {
    const result = await execute();
    await fs.writeFile(path, original);
    const native = await createEditTool(cwd).execute("native", {
      path: "target.txt",
      edits: [{ oldText: "START\nold\nEND\n", newText: "new\n" }],
    });
    expect(result.content).toEqual(native.content);
    expect(result.details).toMatchObject(native.details);
  });

  function row(definition: RenderableTool, args: Record<string, unknown>) {
    initTheme("dark", false);
    return new ToolExecutionComponent(
      definition.name,
      "call",
      args,
      {},
      definition,
      { requestRender: vi.fn() } as unknown as TUI,
      cwd,
    );
  }

  function boundaryRow(args: Record<string, unknown> = { path: "target.txt", ...selectors }) {
    return row(harness.tools[0] as unknown as RenderableTool, args);
  }

  it("renders the completed numbered diff like native edit, not raw JSON or a patch", async () => {
    const result = await execute();
    const rendered = boundaryRow();
    const native = row(createEditToolDefinition(cwd), { path: "target.txt" });
    const feedback = { ...result, isError: false } as RenderResult;
    rendered.updateResult(feedback);
    native.updateResult(feedback);
    for (const expanded of [false, true]) {
      rendered.setExpanded(expanded);
      native.setExpanded(expanded);
      for (const width of [30, 100]) {
        const normalize = (lines: string[]) =>
          lines.map((line) =>
            stripVTControlCharacters(line).replace("boundary_edit", "edit").trimEnd(),
          );
        expect(normalize(rendered.render(width))).toEqual(normalize(native.render(width)));
        // Diff rows also retain Pi's actual colors and intra-line styling.
        expect(rendered.render(width).slice(4)).toEqual(native.render(width).slice(4));
      }
    }
    initTheme("light", false);
    rendered.invalidate();
    native.invalidate();
    expect(rendered.render(100).slice(4)).toEqual(native.render(100).slice(4));
  });

  it.each(["\n", "\r\n"])(
    "matches native intra-line highlighting with %j endings",
    async (ending) => {
      const before = "const count = 1;";
      const after = "const count = 2;";
      await fs.writeFile(path, before + ending);
      const result = await execute({ start: before, end: before, replacement: after });
      expect(await fs.readFile(path, "utf8")).toBe(after + ending);
      await fs.writeFile(path, before + ending);
      const nativeResult = await createEditTool(cwd).execute("native", {
        path: "target.txt",
        edits: [{ oldText: before, newText: after }],
      });
      const rendered = boundaryRow();
      const native = row(createEditToolDefinition(cwd), { path: "target.txt" });
      rendered.updateResult({ ...result, isError: false } as RenderResult);
      native.updateResult({ ...nativeResult, isError: false });
      expect(rendered.render(100).slice(4)).toEqual(native.render(100).slice(4));
    },
  );

  it("renders pending arguments, errors, no-ops, and legacy text-only results", async () => {
    const rendered = boundaryRow({});
    const output = () => stripVTControlCharacters(rendered.render(80).join("\n"));
    expect(output()).toContain("boundary_edit ...");
    rendered.updateArgs({ path: "target.txt", ...selectors });
    rendered.updateResult({
      content: [{ type: "text", text: "Start selector was not found exactly." }],
      isError: true,
    });
    expect(output()).toContain("Start selector was not found exactly.");
    const result = await execute({ replacement: "START\nold\nEND" });
    rendered.updateResult({ ...result, isError: false } as RenderResult);
    expect(output()).toContain('No change to "target.txt".');
    rendered.updateResult({ content: [{ type: "text", text: "Legacy result" }], isError: false });
    expect(output()).toContain("Legacy result");
  });

  it("keeps the truncation notice visible in the TUI", async () => {
    const result = await execute({ replacement: "line\n".repeat(3000) });
    const rendered = boundaryRow();
    rendered.updateResult({ ...result, isError: false } as RenderResult);
    expect(stripVTControlCharacters(rendered.render(100).join("\n"))).toContain("Output truncated");
  });

  it.each(["absolute", "at-prefix", "home"])("resolves %s paths", async (kind) => {
    const inputPath =
      kind === "absolute"
        ? path
        : kind === "home"
          ? `~/${relative(homedir(), path)}`
          : "@target.txt";
    await execute({ path: inputPath });
    expect(await fs.readFile(path, "utf8")).toBe("prefix\nnew\nsuffix\n");
  });

  it.each([
    { start: "absent" },
    { start: "\n" },
    { start: "" },
    { end: "" },
    { end: "absent" },
    { end: "\n" },
    { end: "EN" },
    { start: "START\nold", end: "START" },
    { path: "@" },
    { replacement: "\uD800" },
  ])("rejects invalid selection/input without changing bytes: %j", async (params) => {
    const before = await fs.readFile(path);
    const writes = vi.spyOn(fs, "writeFile");
    await expect(execute(params)).rejects.toThrow();
    expect(await fs.readFile(path)).toEqual(before);
    expect(writes).not.toHaveBeenCalled();
  });

  it("bounds filesystem errors that echo a long input path", async () => {
    const error = await execute({ path: "x".repeat(20_000) }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("ENAMETOOLONG");
    expect(Buffer.byteLength((error as Error).message)).toBeLessThanOrEqual(8192);
    expect(await fs.readFile(path, "utf8")).toBe(original);
  });

  it("resolves the latest file contents rather than a previous read", async () => {
    await fs.writeFile(path, `earlier edit\n${original.replace("old", "changed interior")}`);
    await execute();
    expect(await fs.readFile(path, "utf8")).toBe("earlier edit\nprefix\nnew\nsuffix\n");
  });

  it("does not create missing files", async () => {
    const missing = join(cwd, "missing.txt");
    await expect(execute({ path: missing })).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["", "\uFEFF"])("preserves bytes outside the range with BOM %j", async (bom) => {
    await fs.writeFile(path, `${bom}前\r\nSTART\nold\r\nEND\r\n後\n`);
    await execute({ replacement: "新\nline" });
    expect(await fs.readFile(path)).toEqual(Buffer.from(`${bom}前\r\n新\nline\r\n後\n`));
  });

  it("preserves exactly one initial BOM separately even when deleting all editable text", async () => {
    await fs.writeFile(path, "\uFEFF\uFEFFSTART\nEND\n");
    await execute({ replacement: "" });
    expect(await fs.readFile(path)).toEqual(Buffer.from("\uFEFF"));
  });

  it.each([
    Buffer.from([0xff]),
    Buffer.from([0xc0, 0xaf]),
    Buffer.from([0xed, 0xa0, 0x80]),
    Buffer.from([0xe2, 0x82]),
  ])("rejects malformed UTF-8 without lossy rewriting: %j", async (invalid) => {
    const bytes = Buffer.concat([Buffer.from(original), invalid]);
    await fs.writeFile(path, bytes);
    const writes = vi.spyOn(fs, "writeFile");
    await expect(execute()).rejects.toThrow();
    expect(await fs.readFile(path)).toEqual(bytes);
    expect(writes).not.toHaveBeenCalled();
  });

  it("does not rewrite a byte-identical result, including BOM and inherited termination", async () => {
    await fs.writeFile(path, "\uFEFFSTART\r\nEND\r\n");
    const writes = vi.spyOn(fs, "writeFile");
    const result = await execute({ replacement: "START\r\nEND" });
    expect(result.details).toMatchObject({ changed: false });
    expect(writes).not.toHaveBeenCalled();
    expect(await fs.readFile(path)).toEqual(Buffer.from("\uFEFFSTART\r\nEND\r\n"));
  });

  it("cancels before any I/O", async () => {
    const reads = vi.spyOn(fs, "readFile");
    const writes = vi.spyOn(fs, "writeFile");
    await expect(execute({}, AbortSignal.abort())).rejects.toThrow();
    expect(reads).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it("cancels after reading but before mutation", async () => {
    const controller = new AbortController();
    const readFile = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementationOnce(async () => {
      const bytes = await readFile(path);
      controller.abort();
      return bytes;
    });
    const writes = vi.spyOn(fs, "writeFile");
    await expect(execute({}, controller.signal)).rejects.toThrow();
    expect(writes).not.toHaveBeenCalled();
    expect(await fs.readFile(path, "utf8")).toBe(original);
  });

  it("honors cancellation while waiting for the shared queue", async () => {
    let release = () => {};
    let entered = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = withFileMutationQueue(path, async () => {
      entered();
      await gate;
    });
    await ready;
    const controller = new AbortController();
    const writes = vi.spyOn(fs, "writeFile");
    const pending = execute({}, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    release();
    await held;
    await rejected;
    expect(writes).not.toHaveBeenCalled();
    expect(await fs.readFile(path, "utf8")).toBe(original);
  });

  it("propagates write failures as failures", async () => {
    const error = new Error("fixture write failure");
    vi.spyOn(fs, "writeFile").mockRejectedValueOnce(error);
    await expect(execute()).rejects.toBe(error);
    expect(await fs.readFile(path, "utf8")).toBe(original);
  });

  it("does not report an unchanged-file cancellation after a completed write", async () => {
    const controller = new AbortController();
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementationOnce(async (...args) => {
      await writeFile(...args);
      controller.abort();
    });
    const result = await execute({}, controller.signal);
    expect(result.details).toMatchObject({ changed: true });
    expect(await fs.readFile(path, "utf8")).toBe("prefix\nnew\nsuffix\n");
  });

  it.each(["line\n".repeat(3000), "🙂".repeat(20_000)])(
    "bounds large output without truncating the write (%#)",
    async (replacement) => {
      const result = await execute({ replacement });
      expect(await fs.readFile(path, "utf8")).toBe(
        `prefix\n${replacement}${replacement.endsWith("\n") ? "" : "\n"}suffix\n`,
      );
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content.map((part) => part.text).join("\n");
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8192);
      expect(text.split("\n").length).toBeLessThanOrEqual(200);
      expect(result.details).toMatchObject({ changed: true, truncated: true });
      expect(text).toContain("Diff preview truncated");
      const details = result.details as { diff: string; patch: string };
      for (const preview of [details.diff, details.patch]) {
        expect(Buffer.byteLength(preview)).toBeLessThanOrEqual(8192);
        expect(preview.split("\n").length).toBeLessThanOrEqual(200);
        expect(preview).toContain("Output truncated");
      }
    },
  );
});
