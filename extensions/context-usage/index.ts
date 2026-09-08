import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface ContextUsageSource {
  getContextUsage():
    | { tokens: number | null | undefined; contextWindow: number | null | undefined }
    | undefined;
}

function validatedUsage(context: ContextUsageSource) {
  const usage = context.getContextUsage();
  const tokens = usage?.tokens;
  const contextWindow = usage?.contextWindow;
  if (
    typeof tokens !== "number" ||
    !Number.isSafeInteger(tokens) ||
    tokens < 0 ||
    typeof contextWindow !== "number" ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0
  )
    return undefined;
  return { tokens, contextWindow };
}

export function contextUsageLine(context: ContextUsageSource): string {
  const usage = validatedUsage(context);
  if (!usage) return "[session context] unavailable";
  const { tokens, contextWindow } = usage;
  const remaining = contextWindow - tokens;
  const percentage = (tokens / contextWindow) * 100;
  return `[session context] tokens=~${tokens}; context-window=${contextWindow}; remaining=~${remaining}; used=~${percentage.toFixed(2)}%`;
}

export function contextPressure(
  context: ContextUsageSource,
): "unknown" | "low" | "medium" | "high" | "critical" {
  const usage = validatedUsage(context);
  if (!usage) return "unknown";
  const { tokens, contextWindow } = usage;
  const fraction = tokens / contextWindow;
  if (fraction >= 0.9 || tokens >= 250_000) return "critical";
  if (fraction >= 0.8 || tokens >= 200_000) return "high";
  if (fraction >= 0.7 || tokens >= 150_000) return "medium";
  return "low";
}

const ADVICE = {
  unknown: "Telemetry unavailable; do not infer a pressure action.",
  low: "Continue normally; context reduction remains discretionary.",
  medium:
    "Do not reduce context solely for this level. Continue when retained context helps; preserve important session-only knowledge.",
  high: "Identify a safe checkpoint and prepare continuity before further substantial work.",
  critical:
    "Reduce context as soon as safely possible using the operation appropriate to live-session continuity.",
};

function assessment(context: ContextUsageSource, active: string[]): string {
  // Read Pi once: classification and display must describe the same estimate.
  const usage = context.getContextUsage();
  const snapshot = { getContextUsage: () => usage };
  const pressure = contextPressure(snapshot);
  const selection = ["Does this live session need to survive?"];
  if (active.includes("compact_session"))
    selection.push(
      "If yes, use compact_session to preserve the session/runtime with native guided compaction.",
    );
  if (active.includes("handoff_session"))
    selection.push(
      "If replacement is safe and a fresh conversation is preferable, use handoff_session; session-bound resources do not transfer.",
    );
  if (!active.includes("compact_session") && !active.includes("handoff_session"))
    selection.push(
      "No context-management tool is active; use available native controls or ask the user when reduction is needed.",
    );
  return `${contextUsageLine(snapshot)}; pressure=${pressure}. ${ADVICE[pressure]} ${selection.join(" ")}`;
}

export function registerContextUsage(pi: ExtensionAPI): void {
  pi.on("context", (event: ContextEvent, context) => ({
    messages: [
      ...event.messages,
      {
        role: "custom",
        customType: "context-usage",
        content: assessment(context, pi.getActiveTools()),
        display: false,
        timestamp: Date.now(),
      },
    ],
  }));
}

export default function contextUsageExtension(pi: ExtensionAPI): void {
  registerContextUsage(pi);
}
