import type { ToolPolicy } from "./api.js";

/** Resolve consumer policy first, then structurally remove every toolkit profile tool. */
export function resolveTools(
  policy: ToolPolicy,
  parentActive: readonly string[],
  profileTools: ReadonlySet<string>,
): string[] {
  const candidate =
    policy.mode === "allowlist"
      ? policy.tools
      : parentActive.filter((tool) => !policy.deny.includes(tool));
  return [...new Set(candidate)].filter((tool) => !profileTools.has(tool));
}
