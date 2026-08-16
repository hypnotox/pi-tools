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

function formatElapsed(milliseconds: number): string {
  return milliseconds < 1_000 ? `${milliseconds}ms` : `${(milliseconds / 1_000).toFixed(1)}s`;
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

function omittedRowsLine(omitted: number, discarded: number): string | undefined {
  const parts: string[] = [];
  if (omitted > 0) parts.push(`${omitted} ${omitted === 1 ? "row" : "rows"} omitted`);
  if (discarded > 0) parts.push(`${discarded} discarded`);
  return parts.length > 0 ? parts.join(" and ") : undefined;
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
    if (settled && (details.failure || details.report))
      addWrapped(
        this.theme.fg(details.failure ? "error" : "text", details.failure ?? details.report ?? ""),
      );

    if (execution && (!settled || this.expanded)) {
      const completeHistory = [
        ...execution.activity,
        ...(execution.unfinishedThinking
          ? [{ kind: "thinking" as const, text: execution.unfinishedThinking }]
          : []),
      ];
      const history = completeHistory.slice(-(this.expanded ? 50 : 25));
      const omission = omittedRowsLine(
        completeHistory.length - history.length,
        execution.omittedActivity,
      );
      if (omission) add(this.theme.fg("dim", omission));
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
  // Historical session entries have no execution projection, so retain their established rendering.
  if (!details.execution) {
    let text = `${status(details)} ${theme.bold(details.profileId)} · ${details.state} · ${details.model.provider}/${details.model.id} · ${details.thinkingLevel}`;
    text += `\n${theme.fg("dim", details.cwd)}`;
    if (details.queuePosition !== undefined)
      text += `\n${theme.fg("dim", `queue position ${details.queuePosition}`)}`;
    if (details.retries > 0 || details.retryActive)
      text += `\n${theme.fg("dim", `retries ${details.retries}${details.retryActive ? " (active)" : ""}`)}`;
    if (details.failure) text += `\n${theme.fg("error", details.failure)}`;
    else if (details.report) text += `\n${details.report}`;
    if (expanded) {
      text += `\n${theme.fg("dim", `usage ${details.usage.input} in / ${details.usage.output} out / ${details.usage.cacheRead} cache read / ${details.usage.cacheWrite} cache write · $${details.usage.cost.total.toFixed(4)}`)}`;
      for (const entry of details.activity)
        text += `\n${theme.fg("dim", `${entry.kind}: ${entry.text}`)}`;
      if (details.omittedActivity > 0)
        text += `\n${theme.fg("dim", `${details.omittedActivity} activity entries omitted`)}`;
      if (details.profileData !== undefined)
        text += `\n${theme.fg("dim", truncateUtf8(JSON.stringify(details.profileData, null, 2), MAX_PROFILE_DATA_BYTES))}`;
    }
    return new Text(text, 0, 0);
  }
  return new ExecutionView(details, expanded, theme);
}
