import { describe, expect, it } from "vitest";
import {
  BoundaryError,
  type Endpoint,
  replaceRanges,
  resolveRange,
  resolveRanges,
} from "./replace-range.js";

const beforeText = (text: string): Endpoint => ({ text, side: "before" });
const afterText = (text: string): Endpoint => ({ text, side: "after" });
const range = (start: Endpoint, end: Endpoint) => ({ start, end });
const edit = (start: Endpoint, end: Endpoint, replacement: string) => ({ start, end, replacement });

function replaced(text: string, edits: Parameters<typeof replaceRanges>[1]) {
  const result = replaceRanges(text, edits);
  expect(result.errors).toBeUndefined();
  return result.text;
}

describe("exact boundary model", () => {
  it.each([
    ["before", "before", "LEFTmiddle"],
    ["before", "after", "LEFTmiddleRIGHT"],
    ["after", "before", "middle"],
    ["after", "after", "middleRIGHT"],
  ] as const)("resolves %s/%s without snapping", (startSide, endSide, selected) => {
    const text = "prefix LEFTmiddleRIGHT suffix";
    const selectors = range({ text: "LEFT", side: startSide }, { text: "RIGHT", side: endSide });
    const result = resolveRange(text, selectors);
    expect(text.slice(result.from, result.to)).toBe(selected);
    expect(replaced(text, [{ ...selectors, replacement: "X" }])).toBe(text.replace(selected, "X"));
  });

  it("replaces the handoff's inline example", () => {
    expect(
      replaced("The result is acceptable, provided retries are enabled.", [
        edit(afterText("The result is "), beforeText(", provided"), "reliable"),
      ]),
    ).toBe("The result is reliable, provided retries are enabled.");
  });

  it("uses multiline context outside the replaced region", () => {
    const text = "function first() {\r\n  old();\r\n}\r\n\r\nfunction next() {\n}\n";
    const selectors = range(
      beforeText("function first() {\r\n"),
      beforeText("function next() {\n"),
    );
    expect(replaced(text, [{ ...selectors, replacement: "function first() {}\n" }])).toBe(
      "function first() {}\nfunction next() {\n}\n",
    );
  });

  it.each(["", "new", "new\r", "new\n", "新\r\n🙂", "$&$1"])(
    "inserts exactly %j, preserving mixed endings, lone CR and Unicode outside",
    (replacement) => {
      const text = "前\r\nSTART\nold\rEND\r\n後";
      const selectors = range(beforeText("START"), afterText("END\r"));
      expect(replaced(text, [{ ...selectors, replacement }])).toBe(`前\r\n${replacement}\n後`);
    },
  );

  it("reports half-open line/column positions including EOF and Unicode", () => {
    expect(resolveRange("🙂a\r\nb", range(afterText("🙂"), afterText("b")))).toMatchObject({
      from: 2,
      to: 6,
      start: { line: 1, column: 2 },
      end: { line: 2, column: 2 },
    });
  });

  it("permits zero-length spans and exact insertion, including EOF", () => {
    for (const endpoint of [beforeText("body"), afterText("body")]) {
      const selectors = range(endpoint, endpoint);
      const result = resolveRange("body", selectors);
      expect(result.from).toBe(result.to);
      expect(replaced("body", [{ ...selectors, replacement: "!" }])).toBe(
        endpoint.side === "before" ? "!body" : "body!",
      );
    }
  });

  it.each([
    [beforeText(""), afterText("END"), "empty"],
    [beforeText("start"), afterText("END"), "missing"],
    [beforeText("START"), afterText("END\r\n"), "missing"],
    [afterText("END"), beforeText("START"), "reversed"],
    [afterText("START"), beforeText("START"), "reversed"],
  ])("rejects literal selector or range errors", (start, end, kind) => {
    expect(() => resolveRange("START\nEND\n", range(start as Endpoint, end as Endpoint))).toThrow(
      BoundaryError,
    );
    expect(
      resolveRanges("START\nEND\n", [range(start as Endpoint, end as Endpoint)])[0]?.error?.kind,
    ).toBe(kind);
  });

  it("requires globally unique anchors, including overlapping occurrences and ends before start", () => {
    for (const selectors of [
      range(beforeText("aa"), afterText("END")),
      range(beforeText("aaa"), afterText("END")),
    ]) {
      const result = resolveRanges("END aaa END", [selectors])[0];
      expect(result?.error?.kind).toBe("ambiguous");
    }
  });
});

describe("original-file batching", () => {
  const text = "A one B two C three D";
  it("resolves all edits against the original, independent of array order and changed anchors", () => {
    const edits = [
      edit(afterText("A "), beforeText(" B"), "C"),
      edit(afterText("C "), beforeText(" D"), "one"),
    ];
    for (const batch of [edits, [...edits].reverse()]) {
      expect(replaced(text, batch)).toBe("A C B two C one D");
    }
    expect(
      replaced(text, [
        edit(beforeText("A"), afterText("B"), "X"),
        edit(afterText("B"), beforeText("D"), "Y"),
      ]),
    ).toBe("XYD");
  });

  it("allows shared and overlapping context anchors when replacement regions are disjoint", () => {
    expect(
      replaced(text, [
        edit(afterText("A"), beforeText("B two C"), "!"),
        edit(afterText("B two C"), beforeText("D"), "?"),
      ]),
    ).toBe("A!B two C?D");
  });

  it("rejects overlaps, nested regions and duplicate insertion points with entry references", () => {
    for (const edits of [
      [edit(beforeText("A"), afterText("C"), ""), edit(beforeText("B"), afterText("D"), "")],
      [edit(beforeText("A"), afterText("D"), ""), edit(beforeText("B"), afterText("C"), "")],
      [edit(beforeText("B"), afterText("C"), ""), edit(afterText("two"), afterText("two"), "!")],
      [edit(beforeText("A"), beforeText("A"), "!"), edit(beforeText("A"), beforeText("A"), "?")],
    ]) {
      const result = replaceRanges(text, edits);
      expect(result.text).toBeUndefined();
      expect(result.errors?.[0]?.error.message).toMatch(/overlaps edit 1/);
      expect(result.errors?.[0]?.index).toBe(1);
    }
  });

  it("rejects duplicate insertions at a preceding replacement's end", () => {
    const result = replaceRanges(text, [
      edit(beforeText("A"), beforeText("B"), "X"),
      edit(beforeText("B"), beforeText("B"), "!"),
      edit(beforeText("B"), beforeText("B"), "?"),
    ]);
    expect(result.text).toBeUndefined();
    expect(result.errors?.[0]).toMatchObject({
      index: 2,
      error: { message: expect.stringContaining("edit 2") },
    });
  });

  it("rejects anchors that split Unicode characters rather than corrupting untouched bytes", () => {
    for (const anchor of ["\uD83D", "\uDE42"]) {
      const result = replaceRanges("START🙂END", [
        edit(beforeText("START"), afterText(anchor), "X"),
      ]);
      expect(result.text).toBeUndefined();
      expect(result.errors?.[0]?.error.message).toMatch(/UTF-8/);
      expect(
        resolveRanges("START🙂END", [range(beforeText("START"), afterText(anchor))])[0]?.error,
      ).toBeDefined();
    }
  });

  it("allows adjacency and insertions at region edges without order-dependent output", () => {
    const edits = [
      edit(beforeText("B"), beforeText("C"), "X"),
      edit(beforeText("B"), beforeText("B"), "!"),
      edit(beforeText("C"), beforeText("C"), "?"),
    ];
    for (const batch of [edits, [...edits].reverse()])
      expect(replaced(text, batch)).toBe("A one !X?C three D");
  });

  it("collects invalid selectors and replacements before producing any result", () => {
    const result = replaceRanges(text, [
      edit(beforeText("missing"), afterText("D"), "x"),
      edit(beforeText("A"), afterText("absent"), "y"),
      edit(beforeText("B"), afterText("C"), "\uD800"),
    ]);
    expect(result.text).toBeUndefined();
    expect(result.errors?.map(({ index }) => index)).toEqual([0, 1, 2]);
    const reads = resolveRanges(text, [
      range(beforeText("missing"), afterText("D")),
      range(beforeText("B"), afterText("C")),
      range(beforeText("A"), afterText("absent")),
    ]);
    expect(reads.map((result) => result.error?.kind ?? "resolved")).toEqual([
      "missing",
      "resolved",
      "missing",
    ]);
  });
});
