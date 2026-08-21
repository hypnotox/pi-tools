import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { guardRuntime } from "../runtime-guard.js";

export function formatCount(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

export type ContextPressure = "low" | "medium" | "high" | "critical" | "unknown";

export function contextPressure(tokens: number, contextWindow: number): ContextPressure {
  if (!Number.isFinite(tokens) || !Number.isFinite(contextWindow) || contextWindow <= 0)
    return "unknown";
  const ratio = tokens / contextWindow;
  if (ratio >= 0.85 || tokens >= 200_000) return "critical";
  if (ratio >= 0.7 || tokens >= 150_000) return "high";
  if (ratio >= 0.5 || tokens >= 100_000) return "medium";
  return "low";
}

export interface ContextUsageSource {
  getContextUsage():
    | { tokens: number | null | undefined; contextWindow: number | null | undefined }
    | undefined;
  sessionManager: { getBranch(): Array<{ type: string }> };
}

export function contextUsageLine(context: ContextUsageSource): string {
  const usage = context.getContextUsage();
  const compactions = context.sessionManager
    .getBranch()
    .filter((entry) => entry.type === "compaction").length;
  const window = usage?.contextWindow;
  if (!Number.isFinite(window) || !window || window < 0)
    return `[session context] unavailable; pressure=unknown; compactions=${compactions}`;
  const tokens = usage?.tokens;
  if (typeof tokens !== "number" || !Number.isFinite(tokens))
    return `[session context] unknown/${formatCount(window)}; pressure=unknown; compactions=${compactions}`;
  const pressure = contextPressure(tokens, window);
  return `[session context] ${formatCount(tokens)}/${formatCount(window)} (${Math.round((tokens / window) * 100)}%); pressure=${pressure}; compactions=${compactions}`;
}

export function registerContextUsage(pi: ExtensionAPI): void {
  if (!guardRuntime(pi, ["on"])) return;
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
