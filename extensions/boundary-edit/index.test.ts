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

  const select = (params: Record<string, unknown> = {}, signal?: AbortSignal) =>
    harness.execute(
      "boundary_select",
      { path: "target.txt", start: "START", end: "END", ...params },
      { cwd, hasUI: false },
      signal,
    );

  function resultText(result: Record<string, unknown>) {
    return (result.content as Array<{ text: string }>).map((part) => part.text).join("\n");
  }

  it("registers both additional tools and executes without a UI", async () => {
    expect(harness.tools.map((tool) => tool.name)).toEqual(["boundary_edit", "boundary_select"]);
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
    expect(result.details).toMatchObject({
      path,
      outcome: "replaced",
      selected: { lines: 3, bytes: 14 },
      replacement: { lines: 1, bytes: 4 },
    });
    expect(resultText(result)).toContain("replaced");
    expect(resultText(result)).toContain("3 lines, 14 bytes → 1 lines, 4 bytes");
    expect(resultText(result)).toContain("+2 new");
  });

  it("matches native edit's diff details for the same change", async () => {
    const result = await execute();
    await fs.writeFile(path, original);
    const native = await createEditTool(cwd).execute("native", {
      path: "target.txt",
      edits: [{ oldText: "START\nold\nEND\n", newText: "new\n" }],
    });
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

  function expectNativeDiff(
    rendered: ToolExecutionComponent,
    native: ToolExecutionComponent,
    width = 100,
  ) {
    const expected = native.render(width).slice(4);
    expect(rendered.render(width).slice(-expected.length)).toEqual(expected);
  }

  it("keeps the summary alongside Pi's numbered colored diff", async () => {
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
        const output = stripVTControlCharacters(rendered.render(width).join("\n"));
        expect(output).toContain("replaced");
        expect(output).toContain("14 bytes");
        // Only the summary differs; Pi still owns diff colors and intra-line styling.
        expectNativeDiff(rendered, native, width);
      }
    }
    initTheme("light", false);
    rendered.invalidate();
    native.invalidate();
    expectNativeDiff(rendered, native);
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
      expectNativeDiff(rendered, native);
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
    expect(output()).toContain("unchanged");
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

  it("selects the same inclusive range without writing, with complete small previews", async () => {
    const before = await fs.readFile(path);
    const writes = vi.spyOn(fs, "writeFile");
    const selection = await select();
    expect(selection.details).toMatchObject({
      path,
      startLine: 2,
      endLine: 4,
      selected: { lines: 3, bytes: 14 },
      truncated: false,
    });
    expect(resultText(selection)).toContain("2 | START\n3 | old\n4 | END");
    expect(resultText(selection)).not.toContain("prefix");
    expect(resultText(selection)).not.toContain("suffix");
    expect(writes).not.toHaveBeenCalled();
    expect(await fs.readFile(path)).toEqual(before);
    const selectionRow = row(harness.tools[1] as unknown as RenderableTool, { path: "target.txt" });
    selectionRow.updateResult({ ...selection, isError: false } as RenderResult);
    expect(stripVTControlCharacters(selectionRow.render(100).join("\n"))).toContain("3 | old");
    const edit = await execute();
    expect(edit.details).toMatchObject(selection.details as object);
  });

  it("does not reserve a selected range or require a previous selection", async () => {
    await select();
    await fs.writeFile(path, `earlier\n${original.replace("old", "changed interior")}`);
    const result = await execute();
    expect(result.details).toMatchObject({ startLine: 3, endLine: 5 });
    expect(await fs.readFile(path, "utf8")).toBe("earlier\nprefix\nnew\nsuffix\n");
    await fs.writeFile(path, original);
    await select();
    await fs.writeFile(path, original.replace("START", "removed"));
    await expect(execute()).rejects.toThrow(/start/i);
    expect(await fs.readFile(path, "utf8")).toContain("removed");
  });

  it.each([
    { replacement: "新", expected: "新\r\n", outcome: "replaced", lines: 1 },
    { replacement: "新\n", expected: "新\n", outcome: "replaced", lines: 1 },
    { replacement: "新\r", expected: "新\r\r\n", outcome: "replaced", lines: 1 },
    { replacement: "", expected: "", outcome: "deleted", lines: 0 },
    { replacement: "\n", expected: "\n", outcome: "replaced", lines: 1 },
    { replacement: "START\r\nEND", expected: "START\r\nEND\r\n", outcome: "unchanged", lines: 2 },
  ])(
    "reports effective UTF-8 block statistics: $outcome ($replacement)",
    async ({ replacement, expected, outcome, lines }) => {
      const before = "START\r\nEND\r\n";
      await fs.writeFile(path, `\uFEFF${before}`);
      const selection = await select();
      expect(selection.details).toMatchObject({
        selected: { lines: 2, bytes: Buffer.byteLength(before) },
      });
      const writes = vi.spyOn(fs, "writeFile");
      const result = await execute({ replacement });
      expect(result.details).toMatchObject({
        outcome,
        selected: { lines: 2, bytes: Buffer.byteLength(before) },
        replacement: { lines, bytes: Buffer.byteLength(expected) },
      });
      expect(writes).toHaveBeenCalledTimes(outcome === "unchanged" ? 0 : 1);
      expect(await fs.readFile(path)).toEqual(Buffer.from(`\uFEFF${expected}`));
      expect(resultText(result)).toContain(outcome);
      if (outcome === "unchanged")
        expect(result.details).toMatchObject({ diff: "", patch: "", changed: false });
    },
  );

  it.each(["line\n".repeat(3000), "🙂".repeat(20_000)])(
    "bounds selection while preserving both ends (%#)",
    async (middle) => {
      await fs.writeFile(path, `START\n${middle}\nEND\n`);
      const writes = vi.spyOn(fs, "writeFile");
      const result = await select();
      const text = resultText(result);
      expect(text).toContain("1 | START");
      expect(text).toMatch(/\d+ \| END/);
      expect(text).toMatch(/omitted|truncated/);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8192);
      expect(text.split("\n").length).toBeLessThanOrEqual(200);
      expect(result.details).toMatchObject({ truncated: true });
      expect(writes).not.toHaveBeenCalled();
    },
  );

  it.each([
    { start: "missing" },
    { end: "missing" },
    { end: "EN" },
    { start: "\n" },
    { end: "\n" },
  ])("shares actionable boundary diagnostics between selection and edit: %j", async (params) => {
    const writes = vi.spyOn(fs, "writeFile");
    const selected = await select(params).catch((error: Error) => error);
    const edited = await execute(params).catch((error: Error) => error);
    expect(selected).toBeInstanceOf(Error);
    expect(edited).toBeInstanceOf(Error);
    const selectMessage = (selected as Error).message;
    const editMessage = (edited as Error).message;
    expect(selectMessage.replace("boundary_select", "boundary_edit")).toBe(editMessage);
    expect(selectMessage).toContain("target.txt");
    expect(selectMessage).toMatch(/reread|distinctive|include/i);
    expect(selectMessage).toMatch(/no changes/i);
    expect(writes).not.toHaveBeenCalled();
  });

  it("reports selection read/decoding/cancellation failures without writes", async () => {
    const writes = vi.spyOn(fs, "writeFile");
    await expect(select({ path: "missing.txt" })).rejects.toMatchObject({
      code: "ENOENT",
      message: expect.stringContaining("boundary_select"),
    });
    await expect(select({}, AbortSignal.abort())).rejects.toThrow(/boundary_select/);
    expect(writes).not.toHaveBeenCalled();
    await fs.writeFile(path, Buffer.from([0xff]));
    writes.mockClear();
    await expect(select()).rejects.toThrow(/UTF-8|encoding/i);
    expect(writes).not.toHaveBeenCalled();
  });

  it("warns about possible partial modification after a failed write", async () => {
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementationOnce(async () => {
      await writeFile(path, "partial");
      throw new Error("fixture partial write");
    });
    const error = await execute().catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("boundary_edit");
    expect((error as Error).message).toContain("target.txt");
    expect((error as Error).message).toContain("fixture partial write");
    expect((error as Error).message).toMatch(/partially modified/);
    expect((error as Error).message).not.toMatch(/no changes/i);
    expect(await fs.readFile(path, "utf8")).toBe("partial");
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
    await expect(execute()).rejects.toMatchObject({
      cause: error,
      message: expect.stringContaining("Writing began"),
    });
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
