import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  HANDOFF_CONTINUITY_ENTRY,
  HANDOFF_CONTINUITY_REQUEST,
  type HandoffContinuity,
} from "../handoff-continuity.js";
import {
  formatCompletedDuration,
  formatLiveDuration,
  formatTimestamp,
  type HandoffTimingContinuation,
  type TimingCompletion,
  TimingState,
} from "./timing-state.js";

const ENTRY_TYPE = "pi-tools-timing";
const REFRESH_INTERVAL_MS = 100;

type WorkingContext = Parameters<Parameters<ExtensionAPI["on"]>[1]>[1];

export interface ToolTimingBlockData {
  kind: "tool-block";
  tools: TimingCompletion[];
  /** Absent only on entries persisted before turn timings joined the block. */
  turn?: TimingCompletion;
  /** Present on the final turn block after the whole agent run settles. */
  agent?: TimingCompletion;
}

export type TimingEntryData = TimingCompletion | ToolTimingBlockData;

function formatCompletion(data: TimingCompletion): string {
  const identity =
    data.kind === "tool" ? `tool ${data.toolIndex ?? "?"} · ${data.label}` : data.label;
  return `  ↳ ${identity} · ${formatTimestamp(data.startedAt)} → ${formatTimestamp(data.endedAt)} · ${formatCompletedDuration(data.durationMs)}`;
}

export function formatTimingEntry(data: TimingEntryData): string {
  return data.kind === "tool-block"
    ? [...data.tools, ...(data.turn ? [data.turn] : []), ...(data.agent ? [data.agent] : [])]
        .map((completion) => formatCompletion(completion))
        .join("\n")
    : formatCompletion(data);
}

function isHandoffTimingContinuation(value: unknown): value is HandoffTimingContinuation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.agentDurationMs === "number" &&
    Number.isFinite(record.agentDurationMs) &&
    record.agentDurationMs >= 0 &&
    typeof record.turnCount === "number" &&
    Number.isSafeInteger(record.turnCount) &&
    record.turnCount >= 0
  );
}

function isTimingCompletion(value: unknown): value is TimingCompletion {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "agent" || record.kind === "tool" || record.kind === "turn") &&
    typeof record.label === "string" &&
    typeof record.startedAt === "number" &&
    typeof record.endedAt === "number" &&
    typeof record.durationMs === "number" &&
    (record.toolIndex === undefined || typeof record.toolIndex === "number")
  );
}

function isTimingEntryData(value: unknown): value is TimingEntryData {
  if (isTimingCompletion(value)) return true;
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === "tool-block" &&
    Array.isArray(record.tools) &&
    record.tools.every((tool) => isTimingCompletion(tool) && tool.kind === "tool") &&
    (record.turn === undefined ||
      (isTimingCompletion(record.turn) && record.turn.kind === "turn")) &&
    (record.agent === undefined ||
      (isTimingCompletion(record.agent) && record.agent.kind === "agent")) &&
    (record.tools.length > 0 || record.turn !== undefined || record.agent !== undefined)
  );
}

export default function timingExtension(pi: ExtensionAPI): void {
  const state = new TimingState();
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let workingContext: WorkingContext | undefined;
  let toolCompletions: TimingCompletion[] = [];
  let pendingTurnBlock: ToolTimingBlockData | undefined;

  const restoreWorkingMessage = (fallbackContext?: WorkingContext): void => {
    const context = workingContext ?? fallbackContext;
    workingContext = undefined;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    if (context?.mode === "tui") context.ui.setWorkingMessage();
  };

  const refreshWorkingMessage = (): void => {
    if (workingContext?.mode !== "tui") return;
    const live = state.getLiveTurn();
    if (!live) return;
    const label = live.label.replace(/^turn/, "Turn");
    workingContext.ui.setWorkingMessage(
      `Working... · ${label}: ${formatLiveDuration(live.durationMs)} · Total: ${formatLiveDuration(live.agentDurationMs)}`,
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

  const finishTurnBlock = (turn: TimingCompletion | undefined): void => {
    const tools = [...toolCompletions].sort(
      (left, right) => (left.toolIndex ?? 0) - (right.toolIndex ?? 0),
    );
    toolCompletions = [];
    pendingTurnBlock =
      tools.length > 0 || turn
        ? {
            kind: "tool-block",
            tools,
            ...(turn ? { turn } : {}),
          }
        : undefined;
  };

  const appendPendingTurnBlock = (ctx: WorkingContext, agent?: TimingCompletion): boolean => {
    if (!pendingTurnBlock) return false;
    if (ctx.mode === "tui") {
      pi.appendEntry(ENTRY_TYPE, {
        ...pendingTurnBlock,
        ...(agent ? { agent } : {}),
      } satisfies ToolTimingBlockData);
    }
    pendingTurnBlock = undefined;
    return true;
  };

  pi.registerEntryRenderer(ENTRY_TYPE, (entry, _options, theme) => {
    if (!isTimingEntryData(entry.data)) {
      return new Text(theme.fg("warning", "  ↳ invalid timing entry"), 0, 0);
    }
    return new Text(theme.fg("dim", formatTimingEntry(entry.data)), 0, 0);
  });

  pi.events.on(HANDOFF_CONTINUITY_REQUEST, (value: unknown) => {
    if (!value || typeof value !== "object") return;
    (value as HandoffContinuity).timing = state.getHandoffContinuation();
  });

  pi.on("session_start", (event, ctx) => {
    try {
      restoreWorkingMessage(ctx);
    } finally {
      state.reset();
      toolCompletions = [];
      pendingTurnBlock = undefined;
    }
    if (event.reason !== "new") return;
    const entry = [...ctx.sessionManager.getEntries()]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === "custom" && candidate.customType === HANDOFF_CONTINUITY_ENTRY,
      );
    const continuity =
      entry && "data" in entry ? (entry.data as HandoffContinuity | undefined) : undefined;
    if (isHandoffTimingContinuation(continuity?.timing)) state.restoreHandoff(continuity.timing);
  });

  pi.on("agent_start", () => {
    state.startAgent();
  });

  pi.on("turn_start", (event, ctx) => {
    appendPendingTurnBlock(ctx);
    toolCompletions = [];
    state.startTurn(event.turnIndex, event.timestamp);
    beginWorkingMessage(ctx);
  });

  pi.on("tool_execution_start", (event) => {
    state.startTool(event.toolCallId, event.toolName);
  });

  pi.on("tool_execution_end", (event) => {
    const completion = state.endTool(event.toolCallId);
    if (completion) toolCompletions.push(completion);
  });

  pi.on("turn_end", (_event, ctx) => {
    const completion = state.endTurn();
    try {
      finishTurnBlock(completion);
    } finally {
      restoreWorkingMessage(ctx);
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    const completion = state.endAgent();
    if (appendPendingTurnBlock(ctx, completion)) return;
    if (completion) appendCompletion(completion, ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    try {
      restoreWorkingMessage(ctx);
      appendPendingTurnBlock(ctx);
    } finally {
      state.reset();
      toolCompletions = [];
      pendingTurnBlock = undefined;
    }
  });
}
