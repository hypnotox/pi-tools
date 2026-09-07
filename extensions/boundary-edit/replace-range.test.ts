import { describe, expect, it } from "vitest";
import { replaceRange } from "./replace-range.js";

describe("content-anchored whole-line replacement", () => {
  it.each([
    {
      name: "inclusive lines and untouched surroundings",
      text: "prefix\n  start here\nold\nend here\nsuffix\n",
      start: "start",
      end: "end here",
      replacement: "new",
      expected: "prefix\nnew\nsuffix\n",
    },
    {
      name: "multiline anchors",
      text: "prefix\nstart\npart\nold\nlast\nend\nsuffix",
      start: "start\npart",
      end: "last\nend",
      replacement: "one\ntwo\nthree",
      expected: "prefix\none\ntwo\nthree\nsuffix",
    },
    {
      name: "end before start on the same line",
      text: "prefix END START\nsuffix",
      start: "START",
      end: "prefix END START",
      replacement: "new",
      expected: "new\nsuffix",
    },
    {
      name: "overlapping anchors",
      text: "prefix abcdef\nsuffix",
      start: "abcd",
      end: "cdef",
      replacement: "new",
      expected: "new\nsuffix",
    },
    {
      name: "identical anchors on one line",
      text: "old\n",
      start: "old",
      end: "old",
      replacement: "new",
      expected: "new\n",
    },
    {
      name: "end before the starting line does not count",
      text: "END\nstart\nEND\n",
      start: "start",
      end: "END",
      replacement: "new",
      expected: "END\nnew\n",
    },
    {
      name: "mid-line end occurrences do not count",
      text: "start END middle\nEND\nsuffix",
      start: "start",
      end: "END",
      replacement: "new",
      expected: "new\nsuffix",
    },
    {
      name: "end that would truncate multiline start does not count",
      text: "start END\npart\nEND\n",
      start: "start END\npart",
      end: "END",
      replacement: "new",
      expected: "new\n",
    },
    {
      name: "start includes the selected terminator",
      text: "start\nsuffix",
      start: "start\n",
      end: "start",
      replacement: "new",
      expected: "new\nsuffix",
    },
    {
      name: "end includes LF",
      text: "old\nsuffix",
      start: "old",
      end: "old\n",
      replacement: "new",
      expected: "new\nsuffix",
    },
    {
      name: "end includes CRLF",
      text: "old\r\nsuffix",
      start: "old",
      end: "old\r\n",
      replacement: "new",
      expected: "new\r\nsuffix",
    },
    {
      name: "end excludes CRLF",
      text: "old\r\nsuffix",
      start: "old",
      end: "old",
      replacement: "new",
      expected: "new\r\nsuffix",
    },
    {
      name: "deletion",
      text: "prefix\nold\nsuffix",
      start: "old",
      end: "old",
      replacement: "",
      expected: "prefix\nsuffix",
    },
    {
      name: "blank replacement line",
      text: "prefix\nold\nsuffix",
      start: "old",
      end: "old",
      replacement: "\n",
      expected: "prefix\n\nsuffix",
    },
    {
      name: "extra trailing newlines",
      text: "old\nsuffix",
      start: "old",
      end: "old",
      replacement: "new\n\n",
      expected: "new\n\nsuffix",
    },
    {
      name: "supplied indentation and blank lines",
      text: "old\n",
      start: "old",
      end: "old",
      replacement: "  new\n\n    more\n",
      expected: "  new\n\n    more\n",
    },
    {
      name: "unterminated EOF",
      text: "prefix\nold",
      start: "old",
      end: "old",
      replacement: "new",
      expected: "prefix\nnew",
    },
    {
      name: "explicit EOF termination",
      text: "old",
      start: "old",
      end: "old",
      replacement: "new\r\n",
      expected: "new\r\n",
    },
    {
      name: "deleting entire file",
      text: "old\n",
      start: "old",
      end: "old\n",
      replacement: "",
      expected: "",
    },
    {
      name: "final blank line is real, not phantom",
      text: "start\n\n",
      start: "start",
      end: "start\n\n",
      replacement: "new",
      expected: "new\n",
    },
    {
      name: "leading newline anchor selects its preceding empty line",
      text: "\nother",
      start: "\n",
      end: "\n",
      replacement: "new",
      expected: "new\nother",
    },
    {
      name: "bare CR is not a terminal newline",
      text: "old\r\nsuffix",
      start: "old",
      end: "old",
      replacement: "new\r",
      expected: "new\r\r\nsuffix",
    },
    {
      name: "bare CR in file is content",
      text: "old\rmore\nsuffix",
      start: "old",
      end: "more",
      replacement: "new",
      expected: "new\nsuffix",
    },
    {
      name: "mixed endings stay literal",
      text: "prefix\r\nold\nend\r\nsuffix\n",
      start: "old\nend",
      end: "end",
      replacement: "new\n\r\nmore",
      expected: "prefix\r\nnew\n\r\nmore\r\nsuffix\n",
    },
    {
      name: "supplied LF is not converted to CRLF",
      text: "old\r\nsuffix",
      start: "old",
      end: "old",
      replacement: "new\n",
      expected: "new\nsuffix",
    },
    {
      name: "Unicode is literal",
      text: "前\n  🙂 café é\n後",
      start: "🙂",
      end: "é",
      replacement: "  新 🙂",
      expected: "前\n  新 🙂\n後",
    },
    {
      name: "whitespace-only anchors remain valid",
      text: "x \nsuffix",
      start: " ",
      end: " ",
      replacement: "new",
      expected: "new\nsuffix",
    },
    {
      name: "no-op",
      text: "prefix\nold\nsuffix",
      start: "old",
      end: "old",
      replacement: "old",
      expected: "prefix\nold\nsuffix",
    },
  ])("$name", ({ text, start, end, replacement, expected }) => {
    expect(replaceRange(text, { start, end, replacement }).text).toBe(expected);
  });

  it.each([
    { name: "missing start", text: "old\n", start: "missing", end: "old" },
    { name: "ambiguous start", text: "start\nstart\nEND", start: "start", end: "END" },
    { name: "overlapping start occurrences", text: "aaa END", start: "aa", end: "END" },
    { name: "missing end", text: "start\n", start: "start", end: "END" },
    { name: "ambiguous eligible ends", text: "start\nEND\nEND", start: "start", end: "END" },
    { name: "overlapping eligible ends", text: "start\n\n\n", start: "start", end: "\n\n" },
    { name: "end only before the starting line", text: "END\nstart\n", start: "start", end: "END" },
    { name: "end only mid-line", text: "start END middle\n", start: "start", end: "END" },
    {
      name: "range truncates start",
      text: "start END\npart\n",
      start: "start END\npart",
      end: "END",
    },
    { name: "end splits CRLF", text: "start\r\nsuffix", start: "start", end: "start\r" },
    {
      name: "bare CR is not a line boundary",
      text: "start\rmiddle\n",
      start: "start",
      end: "start",
    },
    { name: "no LF normalization", text: "start\r\nend\r\n", start: "start\nend", end: "end" },
    { name: "no Unicode normalization", text: "café\n", start: "café", end: "café" },
    { name: "case sensitive", text: "start\n", start: "START", end: "start" },
    { name: "empty file has no selectable line", text: "", start: "x", end: "x" },
    { name: "empty start", text: "old", start: "", end: "old" },
    { name: "empty end", text: "old", start: "old", end: "" },
  ])("rejects $name", ({ text, start, end }) => {
    expect(() => replaceRange(text, { start, end, replacement: "new" })).toThrow();
  });

  it("reports selected whole lines without counting a phantom EOF line", () => {
    expect(
      replaceRange("prefix\r\nstart\nend\r\n", {
        start: "start",
        end: "end\r\n",
        replacement: "new",
      }),
    ).toEqual({ text: "prefix\r\nnew\r\n", startLine: 2, endLine: 3 });
  });

  it("resolves moved anchors against current content and replaces changed interior", () => {
    const selectors = { start: "START", end: "END", replacement: "new" };
    const original = "START\nold\nEND\nsuffix";
    expect(replaceRange(original, selectors).text).toBe("new\nsuffix");
    const current = `new prefix\n${original.replace("old", "changed interior")}`;
    expect(replaceRange(current, selectors).text).toBe("new prefix\nnew\nsuffix");
    expect(() => replaceRange(current.replace("START", "removed"), selectors)).toThrow();
    expect(() => replaceRange(`START\n${current}`, selectors)).toThrow();
  });
});
