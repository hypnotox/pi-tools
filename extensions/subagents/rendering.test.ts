import { join, parse, resolve, sep } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { type ExecutionDetails, type JsonValue, MAX_PROFILE_DATA_BYTES } from "./api.js";
import { renderExecution } from "./rendering.js";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const LINE_BREAKS = /[\r\n\v\f\u0085\u2028\u2029]/;
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

  it("shows a differing child CWD below the header and bounds it to the terminal width", () => {
    const unchanged = {
      ...details,
      cwd: "/same",
      cwdDiffersFromParent: false,
    } as ExecutionDetails;
    const historical = renderExecution(details, false, theme).render(120);
    const unchangedLines = renderExecution(unchanged, false, theme).render(120);
    expect(historical).not.toContain("/tmp");
    expect(unchangedLines).not.toContain("/same");

    const cwd = "/a/child/working/directory/that/is/too/long";
    const changed = { ...details, cwd, cwdDiffersFromParent: true } as ExecutionDetails;
    const lines = renderExecution(changed, false, theme).render(24);
    expect(lines[1]).toContain("path: /a/child");
    expect(lines[1]).not.toBe(`path: ${cwd}`);
    expect(visibleWidth(lines[1] ?? "")).toBeLessThanOrEqual(24);
  });

  it("renders retry progress in the activity log instead of below the header", () => {
    const retrying = {
      ...details,
      state: "running" as const,
      retryActive: true,
      execution: {
        prompt: "retry rendering",
        activity: [
          {
            kind: "retry" as const,
            attempt: 2,
            maxAttempts: 3,
            state: "running" as const,
            durationMs: 1_500,
          },
        ],
        omittedActivity: 0,
        elapsedMs: 1_500,
        turns: 0,
      },
    };
    const rendered = renderExecution(retrying, false, theme).render(120);
    expect(rendered).toContain("running · retry 2/3 · 1.5s");
    expect(rendered.filter((line) => line.startsWith("retries "))).toHaveLength(0);
  });

  it("renders bounded compact and expanded live execution trajectories", () => {
    const trajectory = {
      prompt: `\u001b[31m${"very long prompt ".repeat(20)}\u001b[0m`,
      activity: Array.from({ length: 49 }, (_, index) => ({
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
    expect(queuedLines.join("\n")).toContain("thought-25");
    expect(
      compactLines.filter((line) => line.includes("thought-") || line.includes("unfinished")),
    ).toHaveLength(25);
    expect(
      expandedLines.filter((line) => line.includes("thought-") || line.includes("unfinished")),
    ).toHaveLength(50);
    const compactOmission = compactLines.findIndex((line) => line.startsWith("25 rows omitted;"));
    const expandedOmission = expandedLines.findIndex((line) => line.startsWith("3 rows discarded"));
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

  it("keeps line breaks out of single-line compact rows", () => {
    const spilling = {
      ...details,
      state: "running" as const,
      execution: {
        prompt: "Review the settlement.\n\nTARGET\n- `cd /repo/worktree` before every command.",
        activity: [
          {
            kind: "tool" as const,
            toolCallId: "c1",
            summary: "bash cd /repo/worktree\nrm -rf /",
            state: "success" as const,
            durationMs: 12,
          },
        ],
        omittedActivity: 0,
        elapsedMs: 1_000,
        turns: 1,
      },
    };
    const lines = renderExecution(spilling, false, theme).render(80);
    expect(lines.some((line) => LINE_BREAKS.test(line))).toBe(false);
    expect(lines.filter((line) => line.startsWith("prompt: "))).toHaveLength(1);
    expect(lines.find((line) => line.startsWith("prompt: "))).toContain("TARGET");
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
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

  it("keeps tool rows single-line, makes parent-CWD paths relative, and preserves durations", () => {
    const repositoryRoot = resolve("repository-root-fixture");
    const normalizedOutside = `${repositoryRoot}${sep}directory with spaces${sep}..${sep}..${sep}outside-the-repository`;
    const running: ExecutionDetails = {
      ...details,
      state: "running",
      cwd: join(repositoryRoot, "packages", "example"),
      cwdDiffersFromParent: true,
      execution: {
        prompt: "inspect",
        activity: [
          {
            kind: "tool",
            toolCallId: "call-1",
            summary: `read ${repositoryRoot}/.gitignore with arguments that are much too long`,
            state: "success",
            durationMs: 3_665_000,
          },
          {
            kind: "tool",
            toolCallId: "call-2",
            summary: `read ${normalizedOutside}`,
            state: "success",
            durationMs: 12,
          },
          {
            kind: "tool",
            toolCallId: "call-3",
            summary: `ls ${repositoryRoot}`,
            state: "success",
            durationMs: 13,
          },
        ],
        omittedActivity: 0,
        elapsedMs: 3_665_000,
        turns: 1,
      },
    };

    const lines = renderExecution(running, false, theme, repositoryRoot).render(48);
    expect(lines).toContain("path: ./packages/example");
    const repositoryTool = lines.find(
      (line) => line.startsWith("success ·") && line.includes("1h 1m"),
    );
    expect(repositoryTool).toBeDefined();
    expect(repositoryTool).toContain("./.gitignore");
    expect(repositoryTool).not.toContain(repositoryRoot);
    expect(repositoryTool).toMatch(/ · 1h 1m$/);
    expect(lines.filter((line) => line.includes("arguments that are"))).toHaveLength(0);
    const outsideTool = renderExecution(running, false, theme, repositoryRoot)
      .render(200)
      .find((line) => line.startsWith("success ·") && line.endsWith(" · 12ms"));
    expect(outsideTool).toContain(normalizedOutside);
    expect(outsideTool).not.toMatch(/^success · read \.\//);
    expect(lines).toContain("success · ls ./ · 13ms");
    expect(lines.every((line) => visibleWidth(line) <= 48)).toBe(true);

    const filesystemRoot = parse(repositoryRoot).root;
    const rootChild = join(filesystemRoot, "tmp", "root-file");
    const rootLines = renderExecution(
      {
        ...running,
        cwd: join(filesystemRoot, "tmp"),
        execution: {
          prompt: "inspect",
          activity: [
            {
              kind: "tool",
              toolCallId: "root-call",
              summary: `read ${rootChild}`,
              state: "success",
              durationMs: 14,
            },
            {
              kind: "tool",
              toolCallId: "url-call",
              summary: "bash curl https://example.test/resource",
              state: "success",
              durationMs: 15,
            },
          ],
          omittedActivity: 0,
          elapsedMs: 15,
          turns: 1,
        },
      },
      false,
      theme,
      filesystemRoot,
    ).render(48);
    expect(rootLines).toContain("path: ./tmp");
    expect(rootLines).toContain("success · read ./tmp/root-file · 14ms");
    const urlTool = rootLines.find(
      (line) => line.startsWith("success ·") && line.endsWith(" · 15ms"),
    );
    expect(urlTool).toContain("https://");
    expect(urlTool).not.toContain("https:./");

    if (process.platform === "win32") {
      const differentlyCasedRoot = repositoryRoot.toUpperCase();
      expect(renderExecution(running, false, theme, differentlyCasedRoot).render(80)).toContain(
        "success · ls ./ · 13ms",
      );
    }
  });

  it("appends settled results after retained activity in compact and expanded rendering", () => {
    const settled: ExecutionDetails = {
      ...details,
      execution: {
        prompt: "inspect",
        activity: [
          { kind: "thinking", text: "checking" },
          {
            kind: "tool",
            toolCallId: "call-1",
            summary: "read src",
            state: "success",
            durationMs: 25,
          },
        ],
        omittedActivity: 0,
        elapsedMs: 25,
        turns: 1,
      },
      report: "final report",
    };

    for (const expanded of [false, true]) {
      const rendered = renderExecution(settled, expanded, theme).render(120);
      const activityIndex = rendered.findIndex((line) =>
        line.includes("success · read src · 25ms"),
      );
      const reportIndex = rendered.indexOf("final report");
      expect(activityIndex).toBeGreaterThanOrEqual(0);
      expect(reportIndex).toBeGreaterThan(activityIndex);
    }

    const failure = Array.from({ length: 30 }, (_, index) => `failure-${index}`).join("\n");
    const failed: ExecutionDetails = {
      ...settled,
      state: "failed",
      failure,
    };
    const compactFailure = renderExecution(failed, false, theme).render(120);
    const expandedFailure = renderExecution(failed, true, theme).render(120);
    const compactActivityIndex = compactFailure.findIndex((line) => line.includes("read src"));
    const compactFailureIndex = compactFailure.findIndex((line) => line.startsWith("failure-"));
    expect(compactActivityIndex).toBeGreaterThanOrEqual(0);
    expect(compactFailureIndex).toBeGreaterThan(compactActivityIndex);
    expect(compactFailure.filter((line) => line.startsWith("failure-"))).toHaveLength(24);
    expect(compactFailure.filter((line) => line.startsWith("failure-")).at(-1)).toMatch(/\.\.\.$/);
    expect(expandedFailure.findIndex((line) => line.startsWith("failure-"))).toBeGreaterThan(
      expandedFailure.findIndex((line) => line.includes("read src")),
    );
    expect(expandedFailure.filter((line) => line.startsWith("failure-"))).toHaveLength(30);
  });

  it("updates correlated tools in place and retains settled activity with the report", () => {
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
    expect(compact).toContain("success · read src · 1h 1m");
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
