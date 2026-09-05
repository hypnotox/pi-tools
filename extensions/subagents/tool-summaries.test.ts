import { describe, expect, it } from "vitest";
import { summarizeTool } from "./tool-summaries.js";

describe("subagent tool summaries", () => {
  it("shows as much of a bash command as the bounded single-line preview allows", () => {
    expect(summarizeTool("bash", { command: "printf first\nprintf second" })).toBe(
      "bash printf first printf second",
    );

    const summary = summarizeTool("bash", { command: "x".repeat(300) });
    expect(summary).toBe(`bash ${"x".repeat(253)}...`);
    expect(summary).not.toBe("bash");
    expect(summary).not.toContain("\n");
  });

  it("falls back to the tool name for unknown tools instead of retaining arguments", () => {
    expect(summarizeTool("custom_tool", { secret: "hidden" })).toBe("custom_tool");
  });
});
