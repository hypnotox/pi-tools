import { describe, expect, it } from "vitest";
import { renderExecution } from "./rendering.js";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
describe("renderExecution", () => {
  it("keeps profile data out of compact rendering", () => {
    const details = {
      profileId: "p",
      cwd: "/tmp",
      model: { provider: "x", id: "y", thinkingLevels: ["off"] },
      thinkingLevel: "off" as const,
      outcome: "completed" as const,
      report: "done",
      profileData: { secret: "not compact" },
    };
    expect(renderExecution(details, false, theme).render(100).join("\n")).not.toContain("secret");
    expect(renderExecution(details, true, theme).render(100).join("\n")).toContain("secret");
  });
});
