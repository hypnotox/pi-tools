import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
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

  it("bounds busy running results by rendered lines while keeping recent activity", () => {
    const value = details();
    const execution = value.execution;
    if (!execution) throw new Error("missing execution fixture");
    execution.activity = Array.from({ length: 12 }, (_, index) => ({
      kind: "thinking" as const,
      text: `activity ${index} ${"wrapped ".repeat(8)}`,
    }));
    execution.omittedActivity = 3;
    execution.unfinishedThinking = `old live thought ${"wrapped ".repeat(20)}newest marker`;

    const lines = renderExecution(value, false, theme, "fallback").render(24);
    const text = lines.join("\n");
    expect(lines).toHaveLength(10);
    expect(lines.every((line) => visibleWidth(line) <= 24)).toBe(true);
    expect(stripTerminalSequences(text)).toContain("● subagent_review_cod");
    expect(text).toContain("newest marker");
    expect(text).toContain("details omitted");
    expect(lines.at(-1)).toContain("turns 1");
  });

  it.each([
    ["completed", "No findings after a detailed review."],
    ["failed", "Child failed after a detailed investigation."],
    ["cancelled", "Child was cancelled after a detailed investigation."],
  ] as const)("prioritizes the %s outcome within the collapsed budget", (state, report) => {
    const value = details(state);
    const execution = value.execution;
    if (!execution) throw new Error("missing execution fixture");
    execution.activity = Array.from({ length: 20 }, (_, index) => ({
      kind: "thinking" as const,
      text: `old activity ${index}`,
    }));
    value.report = `${report} ${"More report detail. ".repeat(20)}`;
    if (state === "failed") value.failure = value.report;
    const before = structuredClone(value);

    const lines = renderExecution(value, false, theme, "fallback").render(36);
    const text = lines.join("\n");
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines.every((line) => visibleWidth(line) <= 36)).toBe(true);
    expect(text).toContain(report.slice(0, 20));
    expect(text).toContain("details omitted");
    expect(lines.at(-1)).toContain("turns 1");
    expect(value).toEqual(before);
  });

  it("keeps retained activity and reports available when expanded", () => {
    const value = details("completed");
    const execution = value.execution;
    if (!execution) throw new Error("missing execution fixture");
    execution.activity.unshift({ kind: "thinking", text: "earliest retained detail" });
    value.report = `No findings. ${"Expanded report detail. ".repeat(20)}`;

    const text = renderExecution(value, true, theme, "fallback").render(30).join(" ");
    expect(text).toContain("earliest retained detail");
    expect(text).toContain("Expanded report detail");
  });

  it("bounds failures produced before execution starts", () => {
    const value = details("failed");
    delete value.execution;
    value.failure = `Subagent requires an active parent model. ${"More detail. ".repeat(100)}`;
    const lines = renderExecution(value, false, theme, "fallback").render(24);
    expect(lines).toHaveLength(10);
    expect(lines.join("\n")).toContain("Subagent requires");
    expect(lines.at(-1)).toContain("...");
  });

  it("bounds fallback result content when collapsed", () => {
    const collapsed = renderExecution(
      { state: "completed" },
      false,
      theme,
      "legacy report ".repeat(100),
    ).render(18);
    expect(collapsed).toHaveLength(10);
    expect(collapsed.every((line) => visibleWidth(line) <= 18)).toBe(true);
    expect(collapsed.at(-1)).toContain("...");

    const expanded = renderExecution(
      { state: "completed" },
      true,
      theme,
      "legacy report ".repeat(100),
    ).render(18);
    expect(expanded.length).toBeGreaterThan(10);
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
