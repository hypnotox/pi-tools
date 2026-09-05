import {
  type Component,
  stripTerminalSequences,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { ExecutionActivity, SubagentDetails } from "./activity.js";
import type { ExecutionUsage } from "./runner.js";

interface Theme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

const COLLAPSED_LINE_BUDGET = 10;

function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
}

function formatElapsed(milliseconds: number): string {
  if (milliseconds < 1) return `${Number(milliseconds.toFixed(2))}ms`;
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${Number((milliseconds / 1_000).toFixed(1))}s`;
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const minutes = Math.round(milliseconds / 60_000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function safeDisplay(text: string): string {
  return Array.from(stripTerminalSequences(text), (character) => {
    const code = character.codePointAt(0) ?? 0;
    const unsafeControl =
      (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029;
    return unsafeControl ? " " : character;
  }).join("");
}

function withoutVerticalControls(text: string): string {
  return text.replace(/[\v\f\u0085\u2028\u2029]/g, " ");
}

function withoutLineBreaks(text: string): string {
  return withoutVerticalControls(text).replace(/[\r\n]/g, " ");
}

function wrapped(text: string, width: number): string[] {
  return wrapTextWithAnsi(withoutVerticalControls(text), Math.max(1, width)).map((line) =>
    truncateToWidth(line, width),
  );
}

function preview(text: string, width: number, maxLines: number): string[] {
  if (maxLines <= 0) return [];
  const lines = wrapped(text, width);
  if (lines.length <= maxLines) return lines;
  const result = lines.slice(0, maxLines);
  const last = result.at(-1) ?? "";
  const marker = truncateToWidth("...", width, "");
  result[result.length - 1] = `${truncateToWidth(
    last,
    Math.max(0, width - visibleWidth(marker)),
    "",
  )}${marker}`;
  return result;
}

function activityLines(entry: ExecutionActivity, width: number, theme: Theme): string[] {
  if (entry.kind === "thinking")
    return wrapped(theme.fg("dim", `thought:  ${safeDisplay(entry.text)}`), width);
  const color =
    entry.state === "error" ? "error" : entry.state === "success" ? "success" : "warning";
  const summary =
    entry.kind === "retry"
      ? `retry ${entry.attempt}/${entry.maxAttempts}`
      : safeDisplay(entry.summary);
  return [
    theme.fg(color, activityLine(entry.state, summary, formatElapsed(entry.durationMs), width)),
  ];
}

function tailPreview(lines: string[], width: number, maxLines: number): string[] {
  if (maxLines <= 0) return [];
  const result = lines.slice(-maxLines);
  const first = result[0] ?? "";
  const marker = truncateToWidth("...", width, "");
  result[0] = `${marker}${truncateToWidth(first, Math.max(0, width - visibleWidth(marker)), "")}`;
  return result;
}

function recentActivityLines(
  entries: ExecutionActivity[],
  width: number,
  maxLines: number,
  theme: Theme,
): { lines: string[]; hidden: boolean } {
  const chunks = entries.map((entry) => activityLines(entry, width, theme));
  const totalLines = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (totalLines <= maxLines) return { lines: chunks.flat(), hidden: false };

  const lines: string[] = [];
  for (let index = chunks.length - 1; index >= 0 && lines.length < maxLines; index--) {
    const chunk = chunks[index] ?? [];
    const remaining = maxLines - lines.length;
    lines.unshift(...(chunk.length <= remaining ? chunk : tailPreview(chunk, width, remaining)));
  }
  return { lines, hidden: true };
}

function activityLine(state: string, summary: string, duration: string, width: number): string {
  const label = `${`${state}:`.padEnd("success:".length)} `;
  const suffix = ` · ${duration}`;
  if (visibleWidth(suffix) >= width) return truncateToWidth(duration, width);
  const head = truncateToWidth(
    `${label}${withoutLineBreaks(summary)}`,
    width - visibleWidth(suffix),
    "...",
  );
  return `${stripTerminalSequences(head)}${suffix}`;
}

function combinedUsage(total: ExecutionUsage, active: ExecutionUsage | undefined): ExecutionUsage {
  if (!active) return total;
  return {
    input: total.input + active.input,
    output: total.output + active.output,
    cacheRead: total.cacheRead + active.cacheRead,
    cacheWrite: total.cacheWrite + active.cacheWrite,
    totalTokens: total.totalTokens + active.totalTokens,
    cost: {
      input: total.cost.input + active.cost.input,
      output: total.cost.output + active.cost.output,
      cacheRead: total.cost.cacheRead + active.cost.cacheRead,
      cacheWrite: total.cost.cacheWrite + active.cost.cacheWrite,
      total: total.cost.total + active.cost.total,
    },
  };
}

function usageLine(details: SubagentDetails): string | undefined {
  const execution = details.execution;
  if (!execution) return undefined;
  const active = details.state === "running" ? execution.activeUsage : undefined;
  const usage = combinedUsage(details.usage, active);
  const latest = active ?? execution.latestTurnUsage;
  const parts = [`turns ${execution.turns}`];
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (latest) {
    const prompt = latest.input + latest.cacheRead + latest.cacheWrite;
    if (prompt > 0 && (latest.cacheRead > 0 || latest.cacheWrite > 0))
      parts.push(`CH${((latest.cacheRead / prompt) * 100).toFixed(1)}%`);
  }
  if (usage.cost.total) parts.push(`$${usage.cost.total.toFixed(3)}`);
  parts.push(formatElapsed(execution.elapsedMs));
  return parts.join(" ");
}

function status(state: SubagentDetails["state"]): string {
  if (state === "completed") return "✓";
  if (state === "failed") return "✗";
  if (state === "cancelled") return "⊘";
  return "●";
}

function isDetails(value: unknown): value is SubagentDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Partial<SubagentDetails>;
  return (
    typeof details.label === "string" &&
    typeof details.state === "string" &&
    !!details.model &&
    typeof details.model.provider === "string" &&
    typeof details.model.id === "string" &&
    typeof details.thinkingLevel === "string" &&
    !!details.usage
  );
}

class ExecutionView implements Component {
  constructor(
    private readonly details: SubagentDetails,
    private readonly expanded: boolean,
    private readonly theme: Theme,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const oneLine = (line: string): string => truncateToWidth(withoutLineBreaks(line), width);
    const execution = this.details.execution;
    const header = oneLine(
      `${status(this.details.state)} ${this.theme.bold(safeDisplay(this.details.label))} · ${this.details.state} · ${safeDisplay(this.details.model.provider)}/${safeDisplay(this.details.model.id)} · ${safeDisplay(this.details.thinkingLevel)}${execution ? ` · ${formatElapsed(execution.elapsedMs)}` : ""}`,
    );
    const footer = usageLine(this.details);
    const result =
      this.details.state !== "running" && (this.details.failure || this.details.report)
        ? this.theme.fg(
            this.details.failure ? "error" : "text",
            safeDisplay(this.details.failure ?? this.details.report ?? ""),
          )
        : undefined;

    if (!execution) {
      const resultLines = result
        ? this.expanded
          ? wrapped(result, width)
          : preview(result, width, COLLAPSED_LINE_BUDGET - 1)
        : [];
      return [header, ...resultLines, ...(footer ? [oneLine(footer)] : [])].slice(
        0,
        this.expanded ? undefined : COLLAPSED_LINE_BUDGET,
      );
    }

    const complete: ExecutionActivity[] = [
      ...execution.activity,
      ...(execution.unfinishedThinking
        ? [{ kind: "thinking" as const, text: execution.unfinishedThinking }]
        : []),
    ];

    if (this.expanded) {
      const lines = [header, ...wrapped(`task: ${safeDisplay(execution.prompt)}`, width)];
      const visible = complete.slice(-50);
      const hidden = complete.length - visible.length;
      const omission = [
        hidden > 0 ? `${hidden} ${hidden === 1 ? "row" : "rows"} omitted` : "",
        execution.omittedActivity > 0
          ? `${execution.omittedActivity} ${execution.omittedActivity === 1 ? "row" : "rows"} discarded`
          : "",
      ]
        .filter(Boolean)
        .join("; ");
      if (omission) lines.push(oneLine(this.theme.fg("dim", omission)));
      for (const entry of visible) lines.push(...activityLines(entry, width, this.theme));
      if (result) lines.push(...wrapped(result, width));
      if (footer) lines.push(oneLine(this.theme.fg("dim", footer)));
      return lines;
    }

    const task = oneLine(`task: ${safeDisplay(execution.prompt).replace(/\s+/g, " ").trim()}`);
    const fixedLines = 2 + (footer ? 1 : 0);
    const available = Math.max(0, COLLAPSED_LINE_BUDGET - fixedLines);
    const outcomeLines = result ? wrapped(result, width) : [];
    const allActivityLines = complete.flatMap((entry) => activityLines(entry, width, this.theme));
    const needsOmission =
      execution.omittedActivity > 0 || allActivityLines.length + outcomeLines.length > available;
    const contentBudget = Math.max(0, available - (needsOmission ? 1 : 0));
    const visibleOutcome = preview(
      result ?? "",
      width,
      Math.min(outcomeLines.length, contentBudget),
    );
    const activityBudget = contentBudget - visibleOutcome.length;
    const activity = recentActivityLines(complete, width, activityBudget, this.theme);
    const outcomeHidden = outcomeLines.length > visibleOutcome.length;
    const omission =
      needsOmission || activity.hidden || outcomeHidden
        ? [
            "details omitted; expand to view",
            execution.omittedActivity > 0
              ? `${execution.omittedActivity} ${execution.omittedActivity === 1 ? "row" : "rows"} discarded`
              : "",
          ]
            .filter(Boolean)
            .join("; ")
        : undefined;

    return [
      header,
      task,
      ...(omission ? [oneLine(this.theme.fg("dim", omission))] : []),
      ...activity.lines,
      ...visibleOutcome,
      ...(footer ? [oneLine(this.theme.fg("dim", footer))] : []),
    ].slice(0, COLLAPSED_LINE_BUDGET);
  }
}

export function renderExecution(
  value: unknown,
  expanded: boolean,
  theme: Theme,
  fallback: string,
): Component {
  if (!isDetails(value)) {
    const text = theme.fg("text", safeDisplay(fallback));
    if (expanded) return new Text(text, 0, 0);
    return {
      invalidate() {},
      render: (width) => preview(text, width, COLLAPSED_LINE_BUDGET),
    };
  }
  return new ExecutionView(value, expanded, theme);
}
