import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { type ExecutionDetails, type JsonValue, MAX_PROFILE_DATA_BYTES } from "./api.js";
import { renderExecution } from "./rendering.js";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const details: ExecutionDetails = {
  profileId: "p",
  state: "completed",
  cwd: "/tmp",
  model: { provider: "x", id: "y", thinkingLevels: ["off"] },
  thinkingLevel: "off",
  retryActive: false,
  retries: 1,
  activity: [{ kind: "retry_end", text: "recovered" }],
  omittedActivity: 2,
  usage: {
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheWrite: 4,
    totalTokens: 10,
    cost: { input: 0.1, output: 0.2, cacheRead: 0.1, cacheWrite: 0.1, total: 0.5 },
  },
  report: "done",
  profileData: { secret: "not compact" },
};

describe("renderExecution", () => {
  it("keeps profile data and expanded execution facts out of compact rendering", () => {
    const compact = renderExecution(details, false, theme).render(120).join("\n");
    expect(compact).not.toContain("secret");
    expect(compact).not.toContain("usage");
    const expanded = renderExecution(details, true, theme).render(120).join("\n");
    expect(expanded).toContain("secret");
    expect(expanded).toContain("recovered");
    expect(expanded).toContain("activity entries omitted");
    expect(expanded).toContain("usage");
  });

  it("bounds pretty-printed deeply nested profile data", () => {
    let nested: JsonValue = "leaf";
    for (let depth = 0; depth < 1_000; depth++) nested = [nested];
    const styled: string[] = [];
    renderExecution({ ...details, profileData: nested }, true, {
      fg: (_color, text) => {
        styled.push(text);
        return text;
      },
      bold: (text) => text,
    }).render(120);
    const renderedProfile = styled.at(-1) ?? "";
    expect(Buffer.byteLength(renderedProfile, "utf8")).toBeLessThanOrEqual(MAX_PROFILE_DATA_BYTES);
    expect(renderedProfile).toContain("...[truncated]");
  });

  it("renders historical details without live state", () => {
    expect(renderExecution(details, true, theme).render(120).join("\n")).toContain("completed");
  });

  it("renders bounded compact and expanded live execution trajectories", () => {
    const trajectory = {
      prompt: `\u001b[31m${"very long prompt ".repeat(20)}\u001b[0m`,
      activity: Array.from({ length: 50 }, (_, index) => ({
        kind: "thinking" as const,
        text: `thought-${index}`,
      })),
      omittedActivity: 3,
      unfinishedThinking: "unfinished thought",
      elapsedMs: 1_234,
      turns: 2,
      activeUsage: { ...details.usage, cacheWrite: 0 },
      latestTurnUsage: { ...details.usage, cacheRead: 80, cacheWrite: 20, input: 100 },
    };
    const running = { ...details, state: "running" as const, execution: trajectory };
    const queued = { ...running, state: "queued" as const, queuePosition: 2 };
    const compactLines = renderExecution(running, false, theme).render(32);
    const expandedLines = renderExecution(running, true, theme).render(32);
    const queuedLines = renderExecution(queued, false, theme).render(32);
    const expandedWide = renderExecution(running, true, theme).render(120).join("\n");
    expect(compactLines).toContainEqual(expect.stringContaining("running"));
    expect(compactLines).toContainEqual(expect.stringContaining("1.2s"));
    expect(queuedLines.join("\n")).toContain("queue position 2");
    expect(queuedLines.join("\n")).toContain("thought-26");
    expect(
      compactLines.filter((line) => line.includes("thought-") || line.includes("unfinished")),
    ).toHaveLength(25);
    expect(
      expandedLines.filter((line) => line.includes("thought-") || line.includes("unfinished")),
    ).toHaveLength(50);
    const compactOmission = compactLines.findIndex((line) => line.startsWith("26 rows omitted;"));
    const expandedOmission = expandedLines.findIndex((line) =>
      line.startsWith("1 row omitted; 3 rows"),
    );
    expect(compactOmission).toBeGreaterThanOrEqual(0);
    expect(compactLines.slice(compactOmission, compactOmission + 2).join(" ")).toContain(
      "3 rows discarded",
    );
    expect(expandedOmission).toBeGreaterThanOrEqual(0);
    expect(compactOmission).toBeLessThan(
      compactLines.findIndex((line) => line.includes("thought-")),
    );
    expect(expandedOmission).toBeLessThan(
      expandedLines.findIndex((line) => line.includes("thought-")),
    );
    expect(compactLines.filter((line) => line.includes("very long prompt"))).toHaveLength(1);
    expect(
      expandedLines.filter((line) => line.includes("very long prompt")).length,
    ).toBeGreaterThan(1);
    expect(expandedLines.some((line) => line.includes("prompt"))).toBe(true);
    expect(compactLines.every((line) => visibleWidth(line) <= 32)).toBe(true);
    expect(expandedLines.every((line) => visibleWidth(line) <= 32)).toBe(true);
    expect(expandedWide).toContain("turns 2");
    expect(expandedWide).toContain("↑2");
    expect(expandedWide).toContain("↓4");
    expect(expandedWide).toContain("R6");
    expect(expandedWide).toContain("W4");
    expect(expandedWide).toContain("CH75.0%");
    expect(expandedWide).toContain("$1.000");
    const withoutCacheWrites = renderExecution(
      {
        ...running,
        usage: { ...running.usage, cacheWrite: 0 },
        execution: {
          ...trajectory,
          activeUsage: { ...trajectory.activeUsage, cacheWrite: 0 },
          latestTurnUsage: { ...trajectory.latestTurnUsage, cacheWrite: 0 },
        },
      },
      true,
      theme,
    )
      .render(120)
      .join("\n");
    expect(withoutCacheWrites).not.toMatch(/(?:^|\s)W\d/);
  });

  it("promotes rounded durations at unit boundaries", () => {
    const durations = [
      { milliseconds: 999.6, expected: "1s" },
      { milliseconds: 59_960, expected: "1m" },
      { milliseconds: 3_599_600, expected: "1h" },
    ];
    for (const { milliseconds, expected } of durations) {
      const rendered = renderExecution(
        {
          ...details,
          state: "running",
          execution: {
            prompt: "timing",
            activity: [
              {
                kind: "tool",
                toolCallId: expected,
                summary: "read",
                state: "success",
                durationMs: milliseconds,
              },
            ],
            omittedActivity: 0,
            elapsedMs: milliseconds,
            turns: 0,
          },
        },
        true,
        theme,
      )
        .render(120)
        .join("\n");
      expect(rendered).toContain(`success · read · ${expected}`);
      expect(rendered).not.toMatch(/(?:1000ms|60s|60m)/);
    }
  });

  it("updates correlated tools in place and switches only compact settled details to the report", () => {
    const execution = {
      prompt: "inspect the repository",
      activity: [
        { kind: "thinking" as const, text: "checking" },
        {
          kind: "tool" as const,
          toolCallId: "call-1",
          summary: "read src",
          state: "running" as const,
          durationMs: 0.126,
        },
      ],
      omittedActivity: 0,
      elapsedMs: 2_000,
      turns: 1,
      latestTurnUsage: details.usage,
    };
    const running = { ...details, state: "running" as const, execution };
    const settled = {
      ...running,
      state: "completed" as const,
      report: "final report",
      execution: {
        ...execution,
        activity: [
          { kind: "thinking" as const, text: "checking" },
          {
            kind: "tool" as const,
            toolCallId: "call-1",
            summary: "read src",
            state: "success" as const,
            durationMs: 3_665_000,
          },
        ],
      },
    };
    expect(renderExecution(running, true, theme).render(120).join("\n")).toContain(
      "running · read src · 0.13ms",
    );
    const compactRunning = renderExecution(running, false, theme).render(32);
    expect(compactRunning.every((line) => visibleWidth(line) <= 32)).toBe(true);
    const resumed = JSON.parse(JSON.stringify(settled)) as ExecutionDetails;
    const compact = renderExecution(resumed, false, theme).render(120).join("\n");
    const expanded = renderExecution(resumed, true, theme).render(120).join("\n");
    expect(compact).toContain("final report");
    expect(compact).not.toContain("read src");
    expect(expanded).toContain("success · read src · 1h 1m");
    expect(expanded).toContain("checking");
  });

  it("bounds the compact outer result preview and preserves discarded-row disclosure", () => {
    const report = Array.from({ length: 30 }, (_, index) => `report-${index}`).join("\n");
    const settled: ExecutionDetails = {
      ...details,
      report,
      execution: {
        prompt: "inspect",
        activity: [{ kind: "thinking", text: "retained" }],
        omittedActivity: 3,
        elapsedMs: 1_000,
        turns: 1,
      },
    };

    const compact = renderExecution(settled, false, theme).render(120);
    const compactReport = compact.filter((line) => line.startsWith("report-"));
    expect(compactReport).toHaveLength(24);
    expect(compactReport.at(-1)).toMatch(/\.\.\.$/);
    expect(compact).toContain("3 rows discarded");

    const expanded = renderExecution(settled, true, theme).render(120);
    expect(expanded.filter((line) => line.startsWith("report-"))).toHaveLength(30);
  });

  it("applies the compact result limit after ANSI-aware terminal wrapping", () => {
    const settledWith = (report: string): ExecutionDetails => ({
      ...details,
      report,
      execution: {
        prompt: "inspect",
        activity: [],
        omittedActivity: 0,
        elapsedMs: 1_000,
        turns: 1,
      },
    });
    const resultLines = (report: string) =>
      renderExecution(settledWith(`\u001b[31m${report}\u001b[0m`), false, theme)
        .render(20)
        .filter((line) => line.includes("界"));

    const exact = resultLines("界".repeat(240));
    expect(exact).toHaveLength(24);
    expect(exact.some((line) => line.includes("..."))).toBe(false);
    expect(exact.every((line) => visibleWidth(line) <= 20)).toBe(true);

    const truncated = resultLines("界".repeat(250));
    expect(truncated).toHaveLength(24);
    expect(truncated.at(-1)).toContain("...");
    expect(truncated.every((line) => visibleWidth(line) <= 20)).toBe(true);
  });
});
