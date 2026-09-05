import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface ContextUsageSource {
  getContextUsage():
    | { tokens: number | null | undefined; contextWindow: number | null | undefined }
    | undefined;
}

export function contextUsageLine(context: ContextUsageSource): string {
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
    return "[session context] unavailable";
  const remaining = contextWindow - tokens;
  const percentage = (tokens / contextWindow) * 100;
  return `[session context] tokens=~${tokens}; context-window=${contextWindow}; remaining=~${remaining}; used=~${percentage.toFixed(2)}%`;
}

export function registerContextUsage(pi: ExtensionAPI): void {
  pi.on("context", (event: ContextEvent, context) => ({
    messages: [
      ...event.messages,
      {
        role: "custom",
        customType: "context-usage",
        content: contextUsageLine(context),
        display: false,
        timestamp: Date.now(),
      },
    ],
  }));
}

export default function contextUsageExtension(pi: ExtensionAPI): void {
  registerContextUsage(pi);
}
