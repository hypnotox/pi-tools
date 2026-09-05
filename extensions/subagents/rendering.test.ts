import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { SubagentDetails } from "./activity.js";
import { renderExecution } from "./rendering.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function details(state: SubagentDetails["state"] = "running"): SubagentDetails {
  return {
    label: "subagent_review_code",
    state,
    model: { provider: "provider", id: "model" },
    thinkingLevel: "high",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 20,
      cacheWrite: 0,
      totalTokens: 35,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.02 },
    },
    execution: {
      prompt: "Review the implementation",
      activity: [
        { kind: "thinking", text: "Inspecting callers" },
        {
          kind: "tool",
          toolCallId: "call-1",
          summary: "read /project/src/very-long-file-name.ts offset=100 limit=200",
          state: "running",
          durationMs: 12_300,
        },
      ],
      omittedActivity: 0,
      elapsedMs: 13_000,
      turns: 1,
      latestTurnUsage: {
        input: 10,
        output: 5,
        cacheRead: 20,
        cacheWrite: 0,
        totalTokens: 35,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.02 },
      },
    },
  };
}

describe("subagent rendering", () => {
  it("shows live thinking, correlated tool activity, duration, and usage", () => {
    const lines = renderExecution(details(), false, theme, "fallback").render(100);
    expect(lines.join("\n")).toContain(
      "subagent_review_code · running · provider/model · high · 13s",
    );
    expect(lines.join("\n")).toContain("thought:  Inspecting callers");
    expect(lines.join("\n")).toContain("running:");
    expect(lines.join("\n")).toContain("12.3s");
    expect(lines.at(-1)).toContain("turns 1");
  });

  it("retains activity and appends the final report after settlement", () => {
    const value = details("completed");
    const execution = value.execution;
    if (!execution) throw new Error("missing execution fixture");
    const tool = execution.activity[1];
    if (tool?.kind !== "tool") throw new Error("missing tool fixture");
    execution.activity[1] = { ...tool, state: "success" };
    value.report = "No findings.";
    const text = renderExecution(value, false, theme, "fallback").render(80).join("\n");
    expect(text).toContain("success:");
    expect(text).toContain("No findings.");
  });

  it("falls back to result content for legacy details", () => {
    expect(
      renderExecution({ state: "completed" }, false, theme, "legacy report")
        .render(80)[0]
        ?.trimEnd(),
    ).toBe("legacy report");
  });

  it("strips terminal controls from child-owned display text", () => {
    const value = details("completed");
    value.report = "safe\u001b]0;owned\u0007 report";
    const output = renderExecution(value, false, theme, "fallback").render(80).join("\n");
    expect(output).not.toContain("\u001b");
    expect(output).toContain("safe report");
  });

  it("keeps every physical line within the available width", () => {
    const lines = renderExecution(details(), false, theme, "fallback").render(38);
    expect(lines.every((line) => visibleWidth(line) <= 38)).toBe(true);
  });
});
