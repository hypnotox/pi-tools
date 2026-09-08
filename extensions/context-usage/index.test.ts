import { describe, expect, it } from "vitest";
import { createExtensionHarness } from "../../tests/extension-harness.js";
import { contextPressure, contextUsageLine, registerContextUsage } from "./index.js";

describe("context usage extension", () => {
  it("reports source values and direct arithmetic without inference", () => {
    expect(
      contextUsageLine({
        getContextUsage: () => ({ tokens: 118_200, contextWindow: 272_000 }),
      }),
    ).toBe(
      "[session context] tokens=~118200; context-window=272000; remaining=~153800; used=~43.46%",
    );
  });

  it.each([
    [0, 4_000, "[session context] tokens=~0; context-window=4000; remaining=~4000; used=~0.00%"],
    [
      5_000,
      4_000,
      "[session context] tokens=~5000; context-window=4000; remaining=~-1000; used=~125.00%",
    ],
  ])("marks valid estimated arithmetic for tokens=%s", (tokens, contextWindow, expected) => {
    expect(contextUsageLine({ getContextUsage: () => ({ tokens, contextWindow }) })).toBe(expected);
  });

  it.each([
    undefined,
    { tokens: undefined, contextWindow: 4_000 },
    { tokens: 10, contextWindow: undefined },
    { tokens: Number.NaN, contextWindow: 4_000 },
    { tokens: 10.5, contextWindow: 4_000 },
    { tokens: 10, contextWindow: 0 },
  ])("reports unavailable for unavailable source values %#", (usage) => {
    expect(contextUsageLine({ getContextUsage: () => usage })).toBe(
      "[session context] unavailable",
    );
  });

  it("injects a fresh hidden message without scanning session history", async () => {
    const harness = createExtensionHarness();
    registerContextUsage(harness.api);
    const messages = [{ role: "user", content: "hello" }];
    const context = {
      getContextUsage: () => ({ tokens: 2_000, contextWindow: 4_000 }),
    };
    const [result] = await harness.invoke("context", { messages }, context);

    expect(result).toMatchObject({
      messages: [
        { role: "user", content: "hello" },
        {
          role: "custom",
          customType: "context-usage",
          content: expect.stringContaining(
            "[session context] tokens=~2000; context-window=4000; remaining=~2000; used=~50.00%",
          ),
          display: false,
        },
      ],
    });
    expect(messages).toHaveLength(1);
  });
});

describe("pressure policy", () => {
  it.each([
    [69_999, 100_000, "low"],
    [70_000, 100_000, "medium"],
    [70_001, 100_000, "medium"],
    [79_999, 100_000, "medium"],
    [80_000, 100_000, "high"],
    [80_001, 100_000, "high"],
    [89_999, 100_000, "high"],
    [90_000, 100_000, "critical"],
    [90_001, 100_000, "critical"],
    [149_999, 1_000_000, "low"],
    [150_000, 1_000_000, "medium"],
    [150_001, 1_000_000, "medium"],
    [199_999, 1_000_000, "medium"],
    [200_000, 1_000_000, "high"],
    [200_001, 1_000_000, "high"],
    [249_999, 1_000_000, "high"],
    [250_000, 1_000_000, "critical"],
    [250_001, 1_000_000, "critical"],
    [150_000, 160_000, "critical"],
    [200_000, 250_000, "high"],
    [250_000, 500_000, "critical"],
    [0, 100_000, "low"],
  ])("classifies %s/%s as %s", (tokens, contextWindow, level) => {
    expect(contextPressure({ getContextUsage: () => ({ tokens, contextWindow }) })).toBe(level);
  });

  it.each([
    undefined,
    { tokens: -1, contextWindow: 100 },
    { tokens: 1.2, contextWindow: 100 },
    { tokens: NaN, contextWindow: 100 },
    { tokens: Infinity, contextWindow: 100 },
    { tokens: 1, contextWindow: Infinity },
    { tokens: 1, contextWindow: 0 },
  ])("does not infer pressure for unusable telemetry %#", (usage) => {
    expect(contextPressure({ getContextUsage: () => usage })).toBe("unknown");
  });

  it("classifies before display rounding and reevaluates each request without durable warnings", async () => {
    const harness = createExtensionHarness();
    Object.assign(harness.api, { getActiveTools: () => ["compact_session", "handoff_session"] });
    registerContextUsage(harness.api);
    let tokens = 799_999;
    const ctx = { getContextUsage: () => ({ tokens, contextWindow: 1_000_000 }) };
    // Absolute pressure is critical even though rounded percentage reads 80%.
    expect(contextUsageLine(ctx)).toContain("used=~80.00%");
    const first = await harness.invoke("context", { messages: [] }, ctx);
    expect(JSON.stringify(first)).toContain("pressure=critical");
    tokens = 50;
    const next = await harness.invoke("context", { messages: [] }, ctx);
    expect(JSON.stringify(next)).toContain("pressure=low");
    expect(harness.appendEntries).toEqual([]);
    expect(harness.sentUserMessages).toEqual([]);
    const near = { getContextUsage: () => ({ tokens: 79_999, contextWindow: 100_000 }) };
    expect(contextUsageLine(near)).toContain("used=~80.00%");
    expect(contextPressure(near)).toBe("medium");
  });

  it.each([[], ["compact_session"], ["handoff_session"], ["compact_session", "handoff_session"]])(
    "only advertises active tools %j",
    async (...active: string[]) => {
      const harness = createExtensionHarness();
      Object.assign(harness.api, { getActiveTools: () => active });
      registerContextUsage(harness.api);
      const results = JSON.stringify(
        await harness.invoke(
          "context",
          { messages: [] },
          {
            getContextUsage: () => ({ tokens: 90_000, contextWindow: 100_000 }),
          },
        ),
      );
      expect(results.includes("compact_session")).toBe(active.includes("compact_session"));
      expect(results.includes("handoff_session")).toBe(active.includes("handoff_session"));
      expect(results).toContain("Does this live session need to survive?");
    },
  );
});
