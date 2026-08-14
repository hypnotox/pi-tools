import { Text } from "@earendil-works/pi-tui";
import type { ExecutionDetails } from "./api.js";

function usageLine(details: ExecutionDetails): string {
  const usage = details.usage;
  return `usage ${usage.input} in / ${usage.output} out / ${usage.cacheRead} cache read / ${usage.cacheWrite} cache write · $${usage.cost.toFixed(4)}`;
}

export function renderExecution(
  details: ExecutionDetails | undefined,
  expanded: boolean,
  theme: { fg(color: string, text: string): string; bold(text: string): string },
): Text {
  if (!details) return new Text(theme.fg("warning", "Invalid subagent result"), 0, 0);
  const status =
    details.state === "completed"
      ? "✓"
      : details.state === "cancelled"
        ? "⊘"
        : details.state === "failed"
          ? "✗"
          : details.state === "queued"
            ? "○"
            : "●";
  let text = `${status} ${theme.bold(details.profileId)} · ${details.state} · ${details.model.provider}/${details.model.id} · ${details.thinkingLevel}`;
  text += `\n${theme.fg("dim", details.cwd)}`;
  if (details.queuePosition !== undefined)
    text += `\n${theme.fg("dim", `queue position ${details.queuePosition}`)}`;
  if (details.retries > 0 || details.retryActive)
    text += `\n${theme.fg("dim", `retries ${details.retries}${details.retryActive ? " (active)" : ""}`)}`;
  if (details.failure) text += `\n${theme.fg("error", details.failure)}`;
  else if (details.report) text += `\n${details.report}`;
  if (expanded) {
    text += `\n${theme.fg("dim", usageLine(details))}`;
    for (const entry of details.activity)
      text += `\n${theme.fg("dim", `${entry.kind}: ${entry.text}`)}`;
    if (details.omittedActivity > 0)
      text += `\n${theme.fg("dim", `${details.omittedActivity} activity entries omitted`)}`;
    if (details.profileData !== undefined)
      text += `\n${theme.fg("dim", JSON.stringify(details.profileData, null, 2))}`;
  }
  return new Text(text, 0, 0);
}
