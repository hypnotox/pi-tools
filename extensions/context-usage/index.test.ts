import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
    expect(contextUsageLine(context)).toBe("[session context] 118.2k/272k (43%); compactions=2");
  });

  it("reports deterministic unknown and unavailable values without mutating session state", () => {
    const context = {
      getContextUsage: () => ({ tokens: Number.NaN, contextWindow: 4_000 }),
      sessionManager: { getBranch: () => [{ type: "compaction" }, { type: "message" }] },
    };
    expect(contextUsageLine(context)).toBe("[session context] unknown/4k; compactions=1");
    expect(
      contextUsageLine({
        ...context,
        getContextUsage: () => ({ tokens: 1, contextWindow: 0 }),
      }),
    ).toBe("[session context] unavailable; compactions=1");
    expect(formatCount(999.5)).toBe("1000");
    expect(formatCount(1_250_000)).toBe("1.3m");
  });

  it("injects a fresh hidden, package-neutral message for each model request", () => {
    let contextHandler:
      | ((event: { messages: unknown[] }, context: unknown) => { messages: unknown[] })
      | undefined;
    const pi = {
      on(name: string, handler: typeof contextHandler) {
        if (name === "context") contextHandler = handler;
      },
    } as unknown as ExtensionAPI;

    registerContextUsage(pi);
    const messages = [{ role: "user", content: "hello" }];
    const context = {
      getContextUsage: () => ({ tokens: 2_000, contextWindow: 4_000 }),
      sessionManager: { getBranch: () => [{ type: "compaction" }] },
    };
    const result = contextHandler?.({ messages }, context);

    expect(result?.messages).toHaveLength(2);
    expect(result?.messages[1]).toMatchObject({
      role: "custom",
      customType: "context-usage",
      content: "[session context] 2k/4k (50%); compactions=1",
      display: false,
    });
    expect(messages).toHaveLength(1);
  });
});
