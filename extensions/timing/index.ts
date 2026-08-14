import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  formatCompletedDuration,
  formatLiveDuration,
  formatTimestamp,
  type TimingCompletion,
  TimingState,
} from "./timing-state.js";

const ENTRY_TYPE = "pi-tools-timing";
const REFRESH_INTERVAL_MS = 100;

type WorkingContext = Parameters<Parameters<ExtensionAPI["on"]>[1]>[1];

export interface TimingEntryData extends TimingCompletion {}

export function formatTimingEntry(data: TimingEntryData): string {
  const identity =
    data.kind === "tool" ? `tool ${data.toolIndex ?? "?"} · ${data.label}` : data.label;
  return `  ↳ ${identity} · ${formatTimestamp(data.startedAt)} → ${formatTimestamp(data.endedAt)} · ${formatCompletedDuration(data.durationMs)}`;
}

function isTimingEntryData(value: unknown): value is TimingEntryData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "tool" || record.kind === "turn") &&
    typeof record.label === "string" &&
    typeof record.startedAt === "number" &&
    typeof record.endedAt === "number" &&
    typeof record.durationMs === "number" &&
    (record.toolIndex === undefined || typeof record.toolIndex === "number")
  );
}

export default function timingExtension(pi: ExtensionAPI): void {
  const state = new TimingState();
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let workingContext: WorkingContext | undefined;

  const restoreWorkingMessage = (): void => {
    if (workingContext?.mode === "tui") workingContext.ui.setWorkingMessage();
    workingContext = undefined;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
  };

  const refreshWorkingMessage = (): void => {
    if (workingContext?.mode !== "tui") return;
    const live = state.getLiveTurn();
    if (!live) return;
    const label = live.label.replace(/^turn/, "Turn");
    workingContext.ui.setWorkingMessage(
      `Working... · ${label} · ${formatLiveDuration(live.durationMs)}`,
    );
  };

  const beginWorkingMessage = (ctx: WorkingContext): void => {
    restoreWorkingMessage();
    if (ctx.mode !== "tui") return;
    workingContext = ctx;
    refreshWorkingMessage();
    refreshTimer = setInterval(refreshWorkingMessage, REFRESH_INTERVAL_MS);
  };

  const appendCompletion = (completion: TimingCompletion, ctx: WorkingContext): void => {
    if (ctx.mode === "tui") pi.appendEntry(ENTRY_TYPE, completion);
  };

  pi.registerEntryRenderer(ENTRY_TYPE, (entry, _options, theme) => {
    if (!isTimingEntryData(entry.data)) {
      return new Text(theme.fg("warning", "  ↳ invalid timing entry"), 0, 0);
    }
    return new Text(theme.fg("dim", formatTimingEntry(entry.data)), 0, 0);
  });

  pi.on("session_start", (_event, ctx) => {
    restoreWorkingMessage();
    state.reset();
    if (ctx.mode === "tui") ctx.ui.setWorkingMessage();
  });

  pi.on("turn_start", (event, ctx) => {
    state.startTurn(event.turnIndex, event.timestamp);
    beginWorkingMessage(ctx);
  });

  pi.on("tool_execution_start", (event) => {
    state.startTool(event.toolCallId, event.toolName);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const completion = state.endTool(event.toolCallId);
    if (completion) appendCompletion(completion, ctx);
  });

  pi.on("turn_end", (_event, ctx) => {
    const completion = state.endTurn();
    if (completion) appendCompletion(completion, ctx);
    restoreWorkingMessage();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    restoreWorkingMessage();
    state.reset();
    if (ctx.mode === "tui") ctx.ui.setWorkingMessage();
  });
}
