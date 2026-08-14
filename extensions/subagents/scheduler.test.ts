import { describe, expect, it } from "vitest";
import { ProfileScheduler } from "./scheduler.js";

describe("ProfileScheduler", () => {
  it("runs a profile FIFO and releases after failure", async () => {
    const scheduler = new ProfileScheduler();
    const order: string[] = [];
    const first = scheduler.run("p", 1, undefined, async () => {
      order.push("first");
      throw new Error("failed");
    });
    const second = scheduler.run("p", 1, undefined, async () => {
      order.push("second");
      return 2;
    });
    await expect(first).rejects.toThrow("failed");
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["first", "second"]);
  });
  it("rejects an exclusive tool beside siblings", () => {
    expect(() =>
      new ProfileScheduler().validateExclusiveSiblingBatch(
        ["subagent", "read"],
        new Set(["subagent"]),
      ),
    ).toThrow("exclusive");
  });
});
