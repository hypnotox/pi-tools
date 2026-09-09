import { describe, expect, it } from "vitest";
import { boundaryDiagnostic, operationError, selectionPreview } from "./feedback.js";
import { BoundaryError, blockStats, resolveRange } from "./replace-range.js";

function diagnose(text: string, start: string, end: string) {
  try {
    resolveRange(text, { start, end });
  } catch (error) {
    if (!(error instanceof BoundaryError)) throw error;
    return { error, message: boundaryDiagnostic(text, error) };
  }
  throw new Error("Expected a boundary failure");
}

function expectBounded(text: string) {
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8192);
  expect(text.split("\n").length).toBeLessThanOrEqual(200);
  expect(text).not.toContain("\uFFFD");
}

describe("boundary diagnostics", () => {
  it("explains missing literal anchors and retains resolved-start context for an absent end", () => {
    const start = diagnose("START\nbody\nEND\n", "start", "END");
    expect(start.error).toMatchObject({ selector: "start", kind: "missing", matchCount: 0 });
    expect(start.message).toMatch(/literal.*case-sensitive/);
    expect(start.message).toMatch(/reread/i);
    const end = diagnose("prefix\nSTART\nbody\nEND\n", "START", "end");
    expect(end.error).toMatchObject({ selector: "end", kind: "missing", startAt: 7 });
    expect(end.message).toMatch(/Resolved start: line 2/);
    expect(end.message).toContain("2 | START");
    expect(end.message).toContain("3 | body");
  });

  it("reports overlapping ambiguous candidates on the same line with distinct columns", () => {
    const { error, message } = diagnose("before\naaa END\nafter\n", "aa", "END");
    expect(error).toMatchObject({
      kind: "ambiguous",
      matchCount: 2,
      candidates: [{ at: 7 }, { at: 8 }],
    });
    expect(message).toMatch(/line 2, column 1/);
    expect(message).toMatch(/line 2, column 2/);
    expect(message).toMatch(/distinctive/);
    // Context windows overlap but the source is shown only once.
    expect(message.match(/2 \| aaa END/g)).toHaveLength(1);
    expect(message).toContain("1 | before");
    expect(message).toContain("3 | after");
  });

  it("distinguishes exact counts from bounded candidate examples", () => {
    const { error, message } = diagnose(`${"START\n".repeat(1000)}END`, "START", "END");
    expect(error).toMatchObject({ matchCount: 6, countExact: false });
    expect(error.candidates).toHaveLength(5);
    expect(message).toMatch(/at least 6/i);
    expect(message).toMatch(/search stopped.*showing 5/);
    expectBounded(message);
  });

  it("counts only eligible end matches for ambiguity", () => {
    const { error, message } = diagnose("END\nSTART END middle\nEND\nEND", "START", "END");
    expect(error).toMatchObject({ selector: "end", kind: "ambiguous", matchCount: 2 });
    expect(message).toMatch(/2 eligible matches/);
    expect(message).toMatch(/line 3, column 1/);
    expect(message).toMatch(/line 4, column 1/);
    expect(error.countExact).toBe(true);
    const many = diagnose(`START\n${"END\n".repeat(1000)}`, "START", "END");
    expect(many.error).toMatchObject({ matchCount: 6, countExact: false });
    expect(many.message).toMatch(/at least 6 eligible/i);
  });

  it("retains examples of each eligibility failure without choosing one", () => {
    const text = "END\nSTART END\npart\nEND middle\n";
    const { error, message } = diagnose(text, "START END\npart", "END");
    expect(error).toMatchObject({ selector: "end", kind: "ineligible", matchCount: 3 });
    expect(error.candidates.map((candidate) => candidate.reason)).toEqual([
      "before-start",
      "excludes-start",
      "incomplete-line",
    ]);
    expect(message).toMatch(/before.*starting line/);
    expect(message).toMatch(/enclose.*start anchor/);
    expect(message).toMatch(/mid-line|CRLF/);
    expect(message).toMatch(/choose a later end/);
    expect(message).toContain("3 | part");
    expect(message).toContain("4 | END middle");
  });

  it("shows the finishing context when a multiline end splits CRLF", () => {
    const text = "START\nEND\ninside\nlast\r\nsuffix";
    const { error, message } = diagnose(text, "START", "END\ninside\nlast\r");
    expect(error.candidates[0]?.reason).toBe("incomplete-line");
    expect(message).toMatch(/through line 4/);
    expect(message).toContain("4 | last");
    expect(message).toContain("5 | suffix");
  });

  it("centers long-line candidate context and bounds huge anchors and host errors", () => {
    const text = `START\n${"🙂".repeat(5000)}END trailing\n`;
    const { message } = diagnose(text, "START", "END");
    expect(message).toContain("END trailing");
    expect(message).toContain("column 5001");
    expectBounded(message);
    const missing = diagnose(text, "🙂".repeat(30_000), "END").message;
    expectBounded(missing);
    expect(missing).toMatch(/reread/i);
    const failure = operationError(
      "boundary_edit",
      "🙂".repeat(30_000),
      new Error(`ENAMETOOLONG: ${"🙂".repeat(30_000)}`),
      false,
    );
    expect(failure.message).toContain("ENAMETOOLONG");
    expect(failure.message).toContain("boundary_edit");
    expectBounded(failure.message);
  });
});

describe("selection preview and statistics", () => {
  it.each([
    ["", 0, 0],
    ["\n", 1, 1],
    ["a\n", 1, 2],
    ["a\n\n", 2, 3],
    ["a", 1, 1],
    ["新\r\n🙂", 2, 9],
    ["a\rb", 1, 3],
  ])("counts physical lines and UTF-8 bytes for %j", (text, lines, bytes) => {
    expect(blockStats(text as string)).toEqual({ lines, bytes });
  });

  it("shows all small selected lines, with original numbers and no phantom EOF line", () => {
    expect(selectionPreview("first\r\n\r\nlast\n", 12)).toEqual({
      text: "12 | first\n13 | \n14 | last",
      truncated: false,
    });
  });

  it("shows both ends even for a single oversized line", () => {
    const preview = selectionPreview(`START ${"🙂".repeat(10_000)} END\n`, 42);
    expect(preview.truncated).toBe(true);
    expect(preview.text).toContain("42 | START");
    expect(preview.text).toContain(" END");
    expect(preview.text).toMatch(/truncated/);
    expectBounded(preview.text);
  });

  it("accurately marks omitted middle lines under the byte and line limits", () => {
    const text = Array.from({ length: 1000 }, (_, i) => `line-${i + 1}`).join("\n");
    const preview = selectionPreview(text, 10);
    const visibleLines = preview.text.split("\n").filter((line) => /^\d+ \|/.test(line));
    const omitted = Number(preview.text.match(/\[(\d+) lines omitted\]/)?.[1]);
    expect(visibleLines.length + omitted).toBe(1000);
    expect(preview.text).toContain("10 | line-1");
    expect(preview.text).toContain("1009 | line-1000");
    expectBounded(preview.text);
  });
});
