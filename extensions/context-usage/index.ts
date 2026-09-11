import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { extensionContext } from "../extension-context.js";

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
  if (!usage) return "unavailable";
  const { tokens, contextWindow } = usage;
  const remaining = contextWindow - tokens;
  const percentage = (tokens / contextWindow) * 100;
  return `tokens=~${tokens}; context-window=${contextWindow}; remaining=~${remaining}; used=~${percentage.toFixed(2)}%`;
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
  unknown: "Do not infer pressure from unavailable telemetry.",
  low: "Continue normally.",
  medium: "Do not reduce context for this level alone; preserve important session-only knowledge.",
  high: "Prepare continuity at a safe checkpoint before further substantial work.",
  critical: "Reduce context as soon as safely possible.",
};

function assessment(context: ContextUsageSource, active: string[]): string {
  // Read Pi once: classification and display must describe the same estimate.
  const usage = context.getContextUsage();
  const snapshot = { getContextUsage: () => usage };
  const pressure = contextPressure(snapshot);
  const selection: string[] = [];
  if (active.includes("compact_session"))
    selection.push("Use compact_session when the live session must survive.");
  if (active.includes("handoff_session"))
    selection.push(
      "Use handoff_session when replacement is safe and a fresh conversation is preferable.",
    );
  if (!active.includes("compact_session") && !active.includes("handoff_session"))
    selection.push(
      "No context-management tool is active; use native controls when reduction is needed.",
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
        content: extensionContext("context-usage", assessment(context, pi.getActiveTools())),
        display: false,
        timestamp: Date.now(),
      },
    ],
  }));
}

export default function contextUsageExtension(pi: ExtensionAPI): void {
  registerContextUsage(pi);
}
