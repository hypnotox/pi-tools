import { Text } from "@earendil-works/pi-tui";
import type { ExecutionDetails } from "./api.js";

export function renderExecution(
  details: ExecutionDetails | undefined,
  expanded: boolean,
  theme: { fg(color: string, text: string): string; bold(text: string): string },
): Text {
  if (!details) return new Text(theme.fg("warning", "Invalid subagent result"), 0, 0);
  const status =
    details.outcome === "completed" ? "✓" : details.outcome === "cancelled" ? "⊘" : "✗";
  let text = `${status} ${theme.bold(details.profileId)} · ${details.model.provider}/${details.model.id} · ${details.thinkingLevel}`;
  text += `\n${theme.fg("dim", details.cwd)}`;
  if (details.failure) text += `\n${theme.fg("error", details.failure)}`;
  else if (details.report) text += `\n${details.report}`;
  if (expanded && details.profileData !== undefined)
    text += `\n${theme.fg("dim", JSON.stringify(details.profileData, null, 2))}`;
  return new Text(text, 0, 0);
}
