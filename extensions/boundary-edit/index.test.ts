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

const beforeText = (text: string) => ({ text, side: "before" as const });
const afterText = (text: string) => ({ text, side: "after" as const });
const selectors = { start: beforeText("START"), end: afterText("END") };
const entry = { ...selectors, replacement: "new" };
const original = "prefix\nSTART\nold\nEND\nsuffix\n";
type RenderableTool = NonNullable<ConstructorParameters<typeof ToolExecutionComponent>[4]> & {
  name: string;
};
type RenderResult = Parameters<ToolExecutionComponent["updateResult"]>[0];
function resultText(result: Record<string, unknown>) {
  return (result.content as Array<{ text: string }>).map((part) => part.text).join("\n");
}

describe("boundary tools against real files", () => {
  let cwd: string;
  let path: string;
  let harness: ReturnType<typeof createExtensionHarness>;
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
      { path: "target.txt", edits: [entry], ...params },
      { cwd, hasUI: false },
      signal,
    );
  const replace = (replacement: string) => execute({ edits: [{ ...selectors, replacement }] });
  const read = (params: Record<string, unknown> = {}, signal?: AbortSignal) =>
    harness.execute(
      "boundary_read",
      { path: "target.txt", ranges: [selectors], ...params },
      { cwd, hasUI: false },
      signal,
    );

  it("registers only the new tools and reports exact per-entry statistics without UI", async () => {
    expect(harness.tools.map((tool) => tool.name)).toEqual(["boundary_edit", "boundary_read"]);
    expect(harness.handlers.size).toBe(0);
    const writes = vi.spyOn(fs, "writeFile");
    const result = await execute();
    expect(await fs.readFile(path, "utf8")).toBe("prefix\nnew\nsuffix\n");
    expect(writes).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      path,
      changed: true,
      truncated: false,
      firstChangedLine: 2,
      diff: expect.stringContaining("+2 new"),
      patch: expect.stringContaining("+new"),
      entries: [
        {
          index: 0,
          start: { line: 2, column: 1 },
          end: { line: 4, column: 4 },
          outcome: "replaced",
          selected: { lines: 3, bytes: 13 },
          replacement: { lines: 1, bytes: 3 },
        },
      ],
    });
    expect(resultText(result)).toContain("Edit 1: replaced");
    expect(resultText(result)).toContain("3 lines, 13 bytes → 1 lines, 3 bytes");
    expect(resultText(result)).toContain("+2 new");
  });

  it("reads the same exact span without writing or numbered-content decoration", async () => {
    const writes = vi.spyOn(fs, "writeFile");
    const result = await read();
    expect(result.details).toMatchObject({
      path,
      ranges: [
        { index: 0, span: "[2:1, 4:4)", selected: { lines: 3, bytes: 13 }, truncated: false },
      ],
    });
    expect(resultText(result)).toContain("| complete\nSTART\nold\nEND\n");
    expect(resultText(result)).not.toContain("prefix");
    expect(resultText(result)).not.toContain("suffix");
    expect(writes).not.toHaveBeenCalled();
    expect(await fs.readFile(path, "utf8")).toBe(original);
    const edited = await execute();
    expect(edited.details).toMatchObject({ entries: [{ selected: { lines: 3, bytes: 13 } }] });
  });

  it("writes one validated original-file batch and reports each outcome", async () => {
    const writes = vi.spyOn(fs, "writeFile");
    const result = await execute({
      edits: [
        { start: beforeText("suffix"), end: afterText("suffix"), replacement: "prefix" },
        { ...entry, replacement: "" },
        { start: beforeText("prefix"), end: afterText("prefix"), replacement: "prefix" },
      ],
    });
    expect(await fs.readFile(path, "utf8")).toBe("prefix\n\nprefix\n");
    expect(writes).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      entries: [{ outcome: "replaced" }, { outcome: "deleted" }, { outcome: "unchanged" }],
    });
    for (const [index, outcome] of ["replaced", "deleted", "unchanged"].entries())
      expect(resultText(result)).toContain(`Edit ${index + 1}: ${outcome}`);
  });

  it.each([
    [{ ...entry, start: beforeText("absent") }],
    [entry, { ...entry, end: afterText("absent") }],
    [entry, { ...entry, start: beforeText("old") }],
    [entry, { ...entry, replacement: "\uD800" }],
    [entry, { ...entry, start: beforeText("\n") }],
    [{ ...entry, start: afterText("END"), end: beforeText("START") }],
  ])("validates before any write: %j", async (...edits) => {
    const writes = vi.spyOn(fs, "writeFile");
    await expect(execute({ edits })).rejects.toThrow(/Edit \d/);
    expect(writes).not.toHaveBeenCalled();
    expect(await fs.readFile(path, "utf8")).toBe(original);
  });

  it("reports multiple read diagnostics alongside successful content in one failure", async () => {
    const ranges = [
      { ...selectors, start: beforeText("missing") },
      selectors,
      { ...selectors, end: afterText("absent") },
    ];
    const writes = vi.spyOn(fs, "writeFile");
    const error = await read({ ranges }).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("Range 1 | ERROR");
    expect(message).toContain("Range 2 | [2:1, 4:4)");
    expect(message).toContain("START\nold\nEND");
    expect(message).toContain("Range 3 | ERROR");
    expect(message).toContain("read-only");
    expect(writes).not.toHaveBeenCalled();
    for (const selectors of ranges.filter((_, index) => index !== 1)) {
      const editError = await execute({ edits: [{ ...selectors, replacement: "x" }] }).catch(
        (error: Error) => error,
      );
      expect(message).toContain((editError as Error).message.split("Edit 1: ")[1]);
    }
  });

  it("never reserves a read range; edits re-resolve changed interiors and boundaries", async () => {
    await read();
    await fs.writeFile(path, `earlier\n${original.replace("old", "changed interior")}`);
    const result = await execute();
    expect(result.details).toMatchObject({ entries: [{ start: { line: 3 }, end: { line: 5 } }] });
    expect(await fs.readFile(path, "utf8")).toBe("earlier\nprefix\nnew\nsuffix\n");
    await fs.writeFile(path, original);
    await read();
    await fs.writeFile(path, original.replace("START", "removed"));
    await expect(execute()).rejects.toThrow(/start/i);
    expect(await fs.readFile(path, "utf8")).toContain("removed");
  });

  it.each(["absolute", "at-prefix", "home"])("resolves %s paths for both tools", async (kind) => {
    const inputPath =
      kind === "absolute"
        ? path
        : kind === "home"
          ? `~/${relative(homedir(), path)}`
          : "@target.txt";
    expect((await read({ path: inputPath })).details).toMatchObject({ path });
    await execute({ path: inputPath });
    expect(await fs.readFile(path, "utf8")).toBe("prefix\nnew\nsuffix\n");
  });

  it.each(["", "新", "新\n", "新\r", "START\r\nEND"])(
    "preserves BOM and literal replacement %j",
    async (replacement) => {
      await fs.writeFile(path, "\uFEFFSTART\r\nEND\r\n後\n");
      const writes = vi.spyOn(fs, "writeFile");
      const result = await replace(replacement);
      const unchanged = replacement === "START\r\nEND";
      expect(result.details).toMatchObject({
        changed: !unchanged,
        entries: [
          {
            selected: { lines: 2, bytes: 10 },
            replacement: { bytes: Buffer.byteLength(replacement) },
          },
        ],
      });
      expect(writes).toHaveBeenCalledTimes(unchanged ? 0 : 1);
      expect(await fs.readFile(path)).toEqual(Buffer.from(`\uFEFF${replacement}\r\n後\n`));
      if (unchanged) expect(result.details).toMatchObject({ diff: "", patch: "" });
    },
  );

  it("preserves one initial BOM separately when deleting all editable content", async () => {
    await fs.writeFile(path, "\uFEFF\uFEFFSTART\nEND\n");
    await execute({
      edits: [{ start: beforeText("\uFEFFSTART"), end: afterText("END\n"), replacement: "" }],
    });
    expect(await fs.readFile(path)).toEqual(Buffer.from("\uFEFF"));
  });

  it.each([
    Buffer.from([0xff]),
    Buffer.from([0xc0, 0xaf]),
    Buffer.from([0xed, 0xa0, 0x80]),
    Buffer.from([0xe2, 0x82]),
  ])("rejects malformed UTF-8 for both tools: %j", async (invalid) => {
    const bytes = Buffer.concat([Buffer.from(original), invalid]);
    await fs.writeFile(path, bytes);
    const writes = vi.spyOn(fs, "writeFile");
    await expect(execute()).rejects.toThrow();
    await expect(read()).rejects.toThrow();
    expect(await fs.readFile(path)).toEqual(bytes);
    expect(writes).not.toHaveBeenCalled();
  });

  it("rejects missing files and invalid paths, with bounded host errors", async () => {
    for (const tool of [execute, read]) {
      await expect(tool({ path: "missing" })).rejects.toMatchObject({ code: "ENOENT" });
      await expect(tool({ path: "@" })).rejects.toThrow(/nonempty/);
      const error = await tool({ path: "x".repeat(20_000) }).catch((error: Error) => error);
      expect((error as Error).message).toContain("ENAMETOOLONG");
      expect(Buffer.byteLength((error as Error).message)).toBeLessThanOrEqual(8192);
    }
    await expect(fs.stat(join(cwd, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancels before I/O and after reading without writing", async () => {
    const reads = vi.spyOn(fs, "readFile");
    const writes = vi.spyOn(fs, "writeFile");
    for (const tool of [execute, read])
      await expect(tool({}, AbortSignal.abort())).rejects.toThrow();
    expect(reads).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    const controller = new AbortController();
    const readFile = fs.readFile.bind(fs);
    reads.mockRestore();
    vi.spyOn(fs, "readFile").mockImplementationOnce(async () => {
      const bytes = await readFile(path);
      controller.abort();
      return bytes;
    });
    await expect(execute({}, controller.signal)).rejects.toThrow();
    expect(writes).not.toHaveBeenCalled();
  });

  it("honors cancellation while waiting for Pi's queue", async () => {
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
    const pending = [execute({}, controller.signal), read({}, controller.signal)];
    const rejected = pending.map((promise) => expect(promise).rejects.toThrow());
    controller.abort();
    release();
    await Promise.all([held, ...rejected]);
    expect(writes).not.toHaveBeenCalled();
  });

  it("warns after partial write failure and does not claim cancellation after successful I/O", async () => {
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementationOnce(async () => {
      await writeFile(path, "partial");
      throw new Error("fixture partial write");
    });
    const error = await execute().catch((error: Error) => error);
    expect((error as Error).message).toContain("partially modified");
    expect((error as Error).message).toContain("fixture partial write");
    expect((error as Error).message).not.toContain("No changes");
    expect(await fs.readFile(path, "utf8")).toBe("partial");
    await writeFile(path, original);
    const controller = new AbortController();
    vi.spyOn(fs, "writeFile").mockImplementationOnce(async (...args) => {
      await writeFile(...args);
      controller.abort();
    });
    expect((await execute({}, controller.signal)).details).toMatchObject({ changed: true });
    expect(await fs.readFile(path, "utf8")).toBe("prefix\nnew\nsuffix\n");
  });

  it.each(["line\n".repeat(3000), "🙂".repeat(20_000)])(
    "bounds feedback without truncating writes (%#)",
    async (replacement) => {
      const result = await replace(replacement);
      expect(await fs.readFile(path, "utf8")).toBe(`prefix\n${replacement}\nsuffix\n`);
      expect(result.details).toMatchObject({ changed: true, truncated: true });
      const details = result.details as { diff: string; patch: string };
      for (const text of [resultText(result), details.diff, details.patch]) {
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8192);
        expect(text.split("\n").length).toBeLessThanOrEqual(200);
        expect(text).toContain("truncated");
      }
    },
  );

  it("maxLines controls output only, including all, and keeps reads bounded", async () => {
    const content = `START\n${"x\n".repeat(500)}END`;
    await fs.writeFile(path, content);
    const preview = await read({ maxLines: 2 });
    const complete = await read({ maxLines: "all" });
    expect(preview.details).toMatchObject({
      truncated: true,
      ranges: [{ selected: { lines: 502 } }],
    });
    expect(complete.details).toMatchObject({
      truncated: false,
      ranges: [{ selected: { lines: 502 } }],
    });
    expect(resultText(complete)).toContain(`| complete\n${content}\n`);
    const large = await read({
      ranges: Array.from({ length: 100 }, () => selectors),
      maxLines: "all",
    });
    expect(Buffer.byteLength(resultText(large))).toBeLessThanOrEqual(8192);
    expect(large.details).toMatchObject({ truncated: true });
  });

  function row(
    definition: RenderableTool,
    args: Record<string, unknown> = { path: "target.txt", edits: [entry] },
  ) {
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
  function expectNativeDiff(
    rendered: ToolExecutionComponent,
    native: ToolExecutionComponent,
    width = 100,
  ) {
    const expected = native.render(width).slice(4);
    expect(rendered.render(width).slice(-expected.length)).toEqual(expected);
  }
  it.each(["\n", "\r\n"])(
    "matches native diff details and rendering for %j endings",
    async (ending) => {
      const oldLine = "const count = 1;";
      const newLine = "const count = 2;";
      await fs.writeFile(path, oldLine + ending);
      const result = await execute({
        edits: [{ start: beforeText(oldLine), end: afterText(oldLine), replacement: newLine }],
      });
      expect(await fs.readFile(path, "utf8")).toBe(newLine + ending);
      await fs.writeFile(path, oldLine + ending);
      const nativeResult = await createEditTool(cwd).execute("native", {
        path: "target.txt",
        edits: [{ oldText: oldLine, newText: newLine }],
      });
      // Native edit normalizes CRLF before diffing; boundary editing intentionally
      // feeds literal text to Pi's diff generator. Rendering strips CR in both cases.
      const details = result.details as { diff: string; patch: string; firstChangedLine: number };
      expect({
        ...details,
        diff: details.diff.replace(/\r/g, ""),
        patch: details.patch.replace(/\r/g, ""),
      }).toMatchObject(nativeResult.details);
      const rendered = row(harness.tools[0] as unknown as RenderableTool);
      const native = row(createEditToolDefinition(cwd));
      rendered.updateResult({ ...result, isError: false } as RenderResult);
      native.updateResult({ ...nativeResult, isError: false });
      for (const expanded of [false, true]) {
        rendered.setExpanded(expanded);
        native.setExpanded(expanded);
        for (const width of [30, 100]) {
          expect(stripVTControlCharacters(rendered.render(width).join("\n"))).toContain("replaced");
          expectNativeDiff(rendered, native, width);
        }
      }
      initTheme("light", false);
      rendered.invalidate();
      native.invalidate();
      expectNativeDiff(rendered, native);
    },
  );

  it("renders pending, errors, no-ops, read content, text-only history and truncation", async () => {
    const rendered = row(harness.tools[0] as unknown as RenderableTool, {});
    const output = () => stripVTControlCharacters(rendered.render(100).join("\n"));
    expect(output()).toContain("boundary_edit ...");
    rendered.updateArgs({ path, edits: [entry] });
    rendered.updateResult({ content: [{ type: "text", text: "Boundary failure" }], isError: true });
    expect(output()).toContain("Boundary failure");
    rendered.updateResult({
      ...(await replace("START\nold\nEND")),
      isError: false,
    } as RenderResult);
    expect(output()).toContain("unchanged");
    rendered.updateResult({
      content: [{ type: "text", text: "Historical result" }],
      isError: false,
    });
    expect(output()).toContain("Historical result");
    const reader = row(harness.tools[1] as unknown as RenderableTool);
    reader.updateResult({ ...(await read()), isError: false } as RenderResult);
    expect(stripVTControlCharacters(reader.render(100).join("\n"))).toContain("old");
    rendered.updateResult({
      ...(await replace("line\n".repeat(3000))),
      isError: false,
    } as RenderResult);
    expect(output()).toContain("truncated");
  });
});
