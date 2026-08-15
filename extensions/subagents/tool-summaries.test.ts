import { describe, expect, it } from "vitest";
import { summarizeBuiltinTool } from "./tool-summaries.js";

describe("summarizeBuiltinTool", () => {
  it("uses stable safe summaries for core tools", () => {
    expect(summarizeBuiltinTool("read", { path: "a.ts", offset: 2, limit: 5 })).toBe(
      "read a.ts offset=2 limit=5",
    );
    expect(summarizeBuiltinTool("edit", { path: "a.ts", oldText: "SECRET" })).toBe("edit a.ts");
    expect(summarizeBuiltinTool("write", { path: "a.ts", content: "SECRET" })).toBe("write a.ts");
    expect(summarizeBuiltinTool("bash", { command: "git status && SECRET" })).toBe(
      "bash git status",
    );
    expect(summarizeBuiltinTool("bash", { command: "git status\nRAW_ARGUMENT_SENTINEL" })).toBe(
      "bash git status",
    );
    expect(summarizeBuiltinTool("bash", { command: "git status\r\nRAW_ARGUMENT_SENTINEL" })).toBe(
      "bash git status",
    );
    for (const separator of ["\u0085", "\u2028", "\u2029"])
      expect(
        summarizeBuiltinTool("bash", { command: `git status${separator}RAW_ARGUMENT_SENTINEL` }),
      ).toBe("bash git status");
    expect(summarizeBuiltinTool("grep", { pattern: "needle", path: "src", glob: "*.ts" })).toBe(
      "grep needle src *.ts",
    );
    expect(summarizeBuiltinTool("find", { pattern: "*.ts", path: "src" })).toBe("find *.ts src");
    expect(summarizeBuiltinTool("ls", {})).toBe("ls .");
  });

  it("falls back for malformed, control, or oversized values", () => {
    expect(summarizeBuiltinTool("read", { path: "bad\npath" })).toBe("read bad path");
    const unsafeCodePoints = [
      ...Array.from({ length: 0x20 }, (_, codePoint) => codePoint),
      ...Array.from({ length: 0x21 }, (_, offset) => 0x7f + offset),
      0x2028,
      0x2029,
    ];
    for (const codePoint of unsafeCodePoints) {
      const summary = summarizeBuiltinTool("read", {
        path: `before${String.fromCodePoint(codePoint)}after`,
      });
      expect(summary, `U+${codePoint.toString(16)}`).toBe("read before after");
      expect(summary).not.toContain(String.fromCodePoint(codePoint));
    }
    expect(summarizeBuiltinTool("bash", { command: "x".repeat(513) })).toBe("bash");
    expect(summarizeBuiltinTool("unknown", {})).toBeUndefined();
  });
});
