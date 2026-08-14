import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { guardRuntime } from "../runtime-guard.js";

export function formatCount(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
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
    return `[session context] unavailable; compactions=${compactions}`;
  const tokens = usage?.tokens;
  if (typeof tokens !== "number" || !Number.isFinite(tokens))
    return `[session context] unknown/${formatCount(window)}; compactions=${compactions}`;
  return `[session context] ${formatCount(tokens)}/${formatCount(window)} (${Math.round((tokens / window) * 100)}%); compactions=${compactions}`;
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
