import { describe, expect, it } from "vitest";
import { createExtensionHarness } from "../../tests/extension-harness.js";
import { contextUsageLine, registerContextUsage } from "./index.js";

describe("context usage extension", () => {
  it("reports source values and direct arithmetic without inference", () => {
    expect(
      contextUsageLine({
        getContextUsage: () => ({ tokens: 118_200, contextWindow: 272_000 }),
      }),
    ).toBe("[session context] tokens=118200; context-window=272000; remaining=153800; used=43.46%");
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
          content:
            "[session context] tokens=2000; context-window=4000; remaining=2000; used=50.00%",
          display: false,
        },
      ],
    });
    expect(messages).toHaveLength(1);
  });
});
