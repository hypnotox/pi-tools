import { describe, expect, it } from "vitest";
import { boundaryDiagnostic, operationError, rangePreview, readFeedback } from "./feedback.js";
import { BoundaryError, blockStats, resolveRanges } from "./replace-range.js";

const range = (start = "START", end = "END") => ({
  start: { text: start, side: "before" as const },
  end: { text: end, side: "after" as const },
});
function diagnose(text: string, start: string, end: string) {
  const error = resolveRanges(text, [range(start, end)])[0]?.error;
  if (!(error instanceof BoundaryError)) throw new Error("Expected a boundary failure");
  return { error, message: boundaryDiagnostic(text, error) };
}
function expectBounded(text: string) {
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8192);
  expect(text).not.toContain("\uFFFD");
  expect(Buffer.from(text).toString()).toBe(text);
}

describe("boundary diagnostics", () => {
  it("explains literal failures with resolved-start context", () => {
    expect(diagnose("START\nEND", "start", "END").message).toMatch(/literal.*case-sensitive/);
    const end = diagnose("prefix\nSTART\nbody\nEND\n", "START", "end");
    expect(end.error).toMatchObject({ selector: "end", kind: "missing", startAt: 7 });
    expect(end.message).toContain("Resolved start: line 2");
    expect(end.message).toContain("2 | START");
    expect(end.message).toContain("3 | body");
  });
  it("reports overlapping candidates with distinct columns and merged context", () => {
    const { error, message } = diagnose("before\naaa END\nafter\n", "aa", "END");
    expect(error).toMatchObject({
      kind: "ambiguous",
      matchCount: 2,
      candidates: [{ at: 7 }, { at: 8 }],
    });
    expect(message).toContain("line 2, column 1");
    expect(message).toContain("line 2, column 2");
    expect(message.match(/2 \| aaa END/g)).toHaveLength(1);
    expect(message).toContain("distinctive");
  });
  it("distinguishes exact counts from stopped searches, for both endpoints", () => {
    expect(diagnose("END START END", "START", "END").message).toContain("2 matches (exact total)");
    for (const text of [`${"START\n".repeat(1000)}END`, `START\n${"END\n".repeat(1000)}`]) {
      const { error, message } = diagnose(text, "START", "END");
      expect(error).toMatchObject({ matchCount: 6, countExact: false });
      expect(error.candidates).toHaveLength(5);
      expect(message).toMatch(/At least 6 matches.*search stopped.*showing 5/);
      expectBounded(message);
    }
  });
  it("explains reversed positions and bounds long-line context, anchors and I/O errors", () => {
    expect(diagnose("END START", "START", "END").message).toContain("before/after");
    const text = `${"🙂".repeat(5000)}END trailing\nSTART`;
    const message = diagnose(text, "START", "END").message;
    expect(message).toContain("END trailing");
    expect(message).toContain("column 5001");
    expectBounded(message);
    expectBounded(diagnose(text, "🙂".repeat(30_000), "END").message);
    const failure = operationError(
      "boundary_edit",
      "🙂".repeat(30_000),
      new Error(`ENAMETOOLONG: ${"🙂".repeat(30_000)}`),
      false,
    );
    expect(failure.message).toContain("ENAMETOOLONG");
    expect(failure.message).toContain("No changes");
    expectBounded(failure.message);
  });
});

describe("literal content previews", () => {
  it.each([
    ["", 0, 0],
    ["\n", 1, 1],
    ["a\n", 1, 2],
    ["a\n\n", 2, 3],
    ["a", 1, 1],
    ["新\r\n🙂", 2, 9],
    ["a\rb", 1, 3],
  ])("counts %j", (text, lines, bytes) => {
    expect(blockStats(text as string)).toEqual({ lines, bytes });
  });
  it.each(["", "first\r\n\r\nlast\n", "inline", "\n", "a\rb"])(
    "returns small content unchanged: %j",
    (text) => {
      expect(rangePreview(text)).toEqual({ text, truncated: false });
    },
  );
  it.each([1, 2, 3, 40])(
    "honors a total %i content-line budget, retaining both ends when possible",
    (budget) => {
      const text = Array.from({ length: 100 }, (_, i) => `line-${i + 1}\n`).join("");
      const preview = rangePreview(text, budget);
      expect(preview.truncated).toBe(true);
      expect(preview.text.match(/line-\d+/g)).toHaveLength(budget);
      expect(preview.text).toContain(`[${100 - budget} content lines omitted]`);
      expect(preview.text).toContain("line-1\n");
      if (budget > 1) expect(preview.text).toContain("line-100\n");
    },
  );
  it("all returns complete content beyond default and old 200-line limits, subject only to bytes", () => {
    const text = "x\n".repeat(1000);
    expect(rangePreview(text, "all")).toEqual({ text, truncated: false });
    expect(rangePreview(text).truncated).toBe(true);
  });
  it("bounds long Unicode lines while showing both ends and explicit truncation", () => {
    const preview = rangePreview(`START ${"🙂".repeat(10_000)} END\r\n`, "all");
    expect(preview.truncated).toBe(true);
    expect(preview.text).toContain("START ");
    expect(preview.text).toContain(" END\r\n");
    expect(preview.text).toContain("truncated");
    expectBounded(preview.text);
  });
  it("bounds the whole multi-range response without mislabeling truncated sections", () => {
    const text = `START\n${"a\n".repeat(5000)}END`;
    const report = readFeedback(
      "file",
      text,
      resolveRanges(
        text,
        Array.from({ length: 100 }, () => range()),
      ),
      "all",
    );
    expectBounded(report.text);
    expect(report.truncated).toBe(true);
    expect(report.text).not.toContain("| complete");
    expect(report.text).toContain("Output ceiling reached");
    expect(report.text).toContain("END");
    expect(report.ranges.every((result) => result.truncated)).toBe(true);
  });
  it("keeps unequal-sized ranges complete when their combined output fits", () => {
    const text = `START${"x".repeat(7800)}END`;
    const report = readFeedback(
      "file",
      text,
      resolveRanges(text, [range(), range("END", "END")]),
      "all",
    );
    expectBounded(report.text);
    expect(report.truncated).toBe(false);
    expect(report.text).toContain(text);
    expect(report.ranges).toHaveLength(2);
  });

  it("shares the byte ceiling so a large first range does not hide later diagnostics", () => {
    const text = `START\n${"large\n".repeat(5000)}END`;
    const results = resolveRanges(text, [range(), range("missing"), range("END", "END")]);
    const report = readFeedback("file", text, results, "all");
    expectBounded(report.text);
    expect(report.text).toContain("Range 2 | ERROR");
    expect(report.text).toContain("Range 3 |");
    expect(report.ranges).toHaveLength(3);
    expect(report.ranges[2]?.truncated).toBe(false);
  });

  it("does not change selected statistics with preview budgets and reports mixed results", () => {
    const text = "START\r\nbody\nEND";
    const results = resolveRanges(text, [range("absent"), range(), range("START", "missing")]);
    const report = readFeedback("file", text, results, 1);
    expect(report.failed).toBe(true);
    expect(report.text).toContain("Range 1 | ERROR");
    expect(report.text).toContain("Range 2 | [1:1, 3:4) | 3 lines, 15 bytes | truncated");
    expect(report.text).toContain("Range 3 | ERROR");
    expect(report.ranges[1]?.selected).toEqual(
      readFeedback("file", text, results, "all").ranges[1]?.selected,
    );
  });
});
