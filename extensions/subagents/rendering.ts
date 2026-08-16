import {
  type Component,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { type ExecutionDetails, MAX_PROFILE_DATA_BYTES } from "./api.js";
import { truncateUtf8 } from "./runner.js";

type Theme = { fg(color: string, text: string): string; bold(text: string): string };

function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

function compactDecimal(value: number, digits: number): string {
  return Number(value.toFixed(digits)).toString();
}

function formatElapsed(milliseconds: number): string {
  if (milliseconds < 1) return `${compactDecimal(milliseconds, 2)}ms`;
  const roundedMilliseconds = Math.round(milliseconds);
  if (roundedMilliseconds < 1_000) return `${roundedMilliseconds}ms`;
  const seconds = Math.round(milliseconds / 100) / 10;
  if (seconds < 60) return `${compactDecimal(seconds, 1)}s`;
  const roundedSeconds = Math.round(milliseconds / 1_000);
  if (roundedSeconds < 3_600)
    return `${Math.floor(roundedSeconds / 60)}m${roundedSeconds % 60 === 0 ? "" : ` ${roundedSeconds % 60}s`}`;
  const minutes = Math.round(milliseconds / 60_000);
  return `${Math.floor(minutes / 60)}h${minutes % 60 === 0 ? "" : ` ${minutes % 60}m`}`;
}

function isLive(details: ExecutionDetails): boolean {
  return details.state === "queued" || details.state === "running";
}

function status(details: ExecutionDetails): string {
  if (details.state === "completed") return "✓";
  if (details.state === "cancelled") return "⊘";
  if (details.state === "failed") return "✗";
  if (details.state === "queued") return "○";
  return "●";
}

function boundedLines(text: string, width: number): string[] {
  return wrapTextWithAnsi(text, Math.max(1, width)).map((line) => truncateToWidth(line, width));
}

function boundedPreviewLines(text: string, width: number, maxLines: number): string[] {
  const wrapped = boundedLines(text, width);
  if (wrapped.length <= maxLines) return wrapped;
  const preview = wrapped.slice(0, maxLines);
  const ellipsis = truncateToWidth("...", width, "");
  const last = preview.at(-1) ?? "";
  preview[preview.length - 1] =
    truncateToWidth(last, Math.max(0, width - visibleWidth(ellipsis)), "") + ellipsis;
  return preview;
}

function omittedRowsLine(omitted: number, discarded: number): string | undefined {
  const parts: string[] = [];
  if (omitted > 0) parts.push(`${omitted} ${omitted === 1 ? "row" : "rows"} omitted`);
  if (discarded > 0) parts.push(`${discarded} ${discarded === 1 ? "row" : "rows"} discarded`);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function usageLine(details: ExecutionDetails): string | undefined {
  const execution = details.execution;
  if (!execution) return undefined;
  const active = isLive(details) ? execution.activeUsage : undefined;
  const latest = active ?? execution.latestTurnUsage;
  const usage = active
    ? {
        input: details.usage.input + active.input,
        output: details.usage.output + active.output,
        cacheRead: details.usage.cacheRead + active.cacheRead,
        cacheWrite: details.usage.cacheWrite + active.cacheWrite,
        cost: { total: details.usage.cost.total + active.cost.total },
      }
    : details.usage;
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

class ExecutionView implements Component {
  constructor(
    private readonly details: ExecutionDetails | undefined,
    private readonly expanded: boolean,
    private readonly theme: Theme,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.details)
      return [truncateToWidth(this.theme.fg("warning", "Invalid subagent result"), width)];
    const details = this.details;
    const lines: string[] = [];
    const add = (line: string): void => {
      lines.push(truncateToWidth(line, width));
    };
    const addWrapped = (line: string): void => {
      lines.push(...boundedLines(line, width));
    };
    const addPreview = (line: string): void => {
      lines.push(...boundedPreviewLines(line, width, 24));
    };
    const execution = details.execution;
    const elapsed = execution ? ` · ${formatElapsed(execution.elapsedMs)}` : "";
    add(
      `${status(details)} ${this.theme.bold(details.profileId)} · ${details.state} · ${details.model.provider}/${details.model.id} · ${details.thinkingLevel}${elapsed}`,
    );
    add(this.theme.fg("dim", details.cwd));
    if (details.queuePosition !== undefined)
      add(this.theme.fg("dim", `queue position ${details.queuePosition}`));
    if (details.retries > 0 || details.retryActive)
      add(
        this.theme.fg("dim", `retries ${details.retries}${details.retryActive ? " (active)" : ""}`),
      );

    if (execution) {
      const prompt = `prompt: ${execution.prompt}`;
      if (this.expanded) addWrapped(prompt);
      else add(truncateToWidth(prompt, width));
    }

    const settled = !isLive(details);
    const completeHistory = execution
      ? [
          ...execution.activity,
          ...(execution.unfinishedThinking
            ? [{ kind: "thinking" as const, text: execution.unfinishedThinking }]
            : []),
        ]
      : [];
    const history = completeHistory.slice(-(this.expanded ? 50 : 25));
    const omission = execution
      ? omittedRowsLine(completeHistory.length - history.length, execution.omittedActivity)
      : undefined;
    if (settled && (details.failure || details.report)) {
      const result = this.theme.fg(
        details.failure ? "error" : "text",
        details.failure ?? details.report ?? "",
      );
      if (this.expanded) addWrapped(result);
      else {
        if (omission) addWrapped(this.theme.fg("dim", omission));
        addPreview(result);
      }
    }

    if (execution && (!settled || this.expanded)) {
      if (omission) addWrapped(this.theme.fg("dim", omission));
      for (const entry of history) {
        if (entry.kind === "thinking") addWrapped(this.theme.fg("dim", `thinking: ${entry.text}`));
        else {
          const color =
            entry.state === "error" ? "error" : entry.state === "success" ? "success" : "warning";
          addWrapped(
            this.theme.fg(
              color,
              `${entry.state} · ${entry.summary} · ${formatElapsed(entry.durationMs)}`,
            ),
          );
        }
      }
    }

    const footer = usageLine(details);
    if (footer) add(this.theme.fg("dim", footer));

    // Legacy details retain the former expanded activity and profile-data presentation.
    if (!execution && this.expanded) {
      add(
        this.theme.fg(
          "dim",
          `usage ${details.usage.input} in / ${details.usage.output} out / ${details.usage.cacheRead} cache read / ${details.usage.cacheWrite} cache write · $${details.usage.cost.total.toFixed(4)}`,
        ),
      );
      for (const entry of details.activity)
        addWrapped(this.theme.fg("dim", `${entry.kind}: ${entry.text}`));
      if (details.omittedActivity > 0)
        add(this.theme.fg("dim", `${details.omittedActivity} activity entries omitted`));
    }
    if (this.expanded && details.profileData !== undefined)
      addWrapped(
        this.theme.fg(
          "dim",
          truncateUtf8(JSON.stringify(details.profileData, null, 2), MAX_PROFILE_DATA_BYTES),
        ),
      );

    return lines.map((line) => (visibleWidth(line) <= width ? line : truncateToWidth(line, width)));
  }
}

export function renderExecution(
  details: ExecutionDetails | undefined,
  expanded: boolean,
  theme: Theme,
): Component {
  if (!details) return new Text(theme.fg("warning", "Invalid subagent result"), 0, 0);
  return new ExecutionView(details, expanded, theme);
}
