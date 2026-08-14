import { describe, expect, it } from "vitest";
import type { ExecutionDetails } from "./api.js";
import { renderExecution } from "./rendering.js";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const details: ExecutionDetails = {
  profileId: "p",
  state: "completed",
  cwd: "/tmp",
  model: { provider: "x", id: "y", thinkingLevels: ["off"] },
  thinkingLevel: "off",
  retryActive: false,
  retries: 1,
  activity: [{ kind: "retry_end", text: "recovered" }],
  omittedActivity: 2,
  usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5 },
  report: "done",
  profileData: { secret: "not compact" },
};

describe("renderExecution", () => {
  it("keeps profile data and expanded execution facts out of compact rendering", () => {
    const compact = renderExecution(details, false, theme).render(120).join("\n");
    expect(compact).not.toContain("secret");
    expect(compact).not.toContain("usage");
    const expanded = renderExecution(details, true, theme).render(120).join("\n");
    expect(expanded).toContain("secret");
    expect(expanded).toContain("recovered");
    expect(expanded).toContain("activity entries omitted");
    expect(expanded).toContain("usage");
  });

  it("renders historical details without live state", () => {
    expect(renderExecution(details, true, theme).render(120).join("\n")).toContain("completed");
  });
});
