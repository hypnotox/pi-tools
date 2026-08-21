import { createExtensionRecorder } from "pi-tools/testing";
import { describe, expect, it } from "vitest";
import { contextUsageLine, formatCount, registerContextUsage } from "./index.js";

describe("context usage extension", () => {
  it("formats current usage and active-branch compactions", () => {
    const context = {
      getContextUsage: () => ({ tokens: 118_200, contextWindow: 272_000 }),
      sessionManager: {
        getBranch: () => [{ type: "compaction" }, { type: "message" }, { type: "compaction" }],
      },
    };

    expect(formatCount(118_200)).toBe("118.2k");
    expect(contextUsageLine(context)).toBe(
      "[session context] 118.2k/272k (43%); pressure=medium; compactions=2",
    );
  });

  it("uses the highest pressure reached by either percentage or absolute usage", () => {
    const line = (tokens: number, contextWindow: number) =>
      contextUsageLine({
        getContextUsage: () => ({ tokens, contextWindow }),
        sessionManager: { getBranch: () => [] },
      });

    expect(line(49_000, 100_000)).toContain("pressure=low");
    expect(line(50_000, 100_000)).toContain("pressure=medium");
    expect(line(100_000, 1_000_000)).toContain("pressure=medium");
    expect(line(70_000, 100_000)).toContain("pressure=high");
    expect(line(150_000, 1_000_000)).toContain("pressure=high");
    expect(line(85_000, 100_000)).toContain("pressure=critical");
    expect(line(200_000, 1_000_000)).toContain("pressure=critical");
    expect(line(200_000, 272_000)).toContain("pressure=critical");
  });

  it("reports deterministic unknown and unavailable values without mutating session state", () => {
    const context = {
      getContextUsage: () => ({ tokens: Number.NaN, contextWindow: 4_000 }),
      sessionManager: { getBranch: () => [{ type: "compaction" }, { type: "message" }] },
    };
    expect(contextUsageLine(context)).toBe(
      "[session context] unknown/4k; pressure=unknown; compactions=1",
    );
    expect(
      contextUsageLine({
        ...context,
        getContextUsage: () => ({ tokens: 1, contextWindow: 0 }),
      }),
    ).toBe("[session context] unavailable; pressure=unknown; compactions=1");
    expect(formatCount(999.5)).toBe("1000");
    expect(formatCount(1_250_000)).toBe("1.3m");
  });

  it("injects a fresh hidden, package-neutral message for each model request", async () => {
    const harness = createExtensionRecorder();
    void harness.install(registerContextUsage);
    const messages = [{ role: "user", content: "hello" }];
    const context = harness.makeContext({
      getContextUsage: () => ({ tokens: 2_000, contextWindow: 4_000, percent: 50 }),
      sessionManager: { getBranch: () => [{ type: "compaction" }] } as never,
    });
    const [result] = await harness.invokeRaw("context", { messages }, context);

    expect(result).toMatchObject({
      messages: [
        { role: "user", content: "hello" },
        {
          role: "custom",
          customType: "context-usage",
          content: "[session context] 2k/4k (50%); pressure=medium; compactions=1",
          display: false,
        },
      ],
    });
    expect(messages).toHaveLength(1);
  });
});
