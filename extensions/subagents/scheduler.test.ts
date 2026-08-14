import { describe, expect, it } from "vitest";
import { ProfileScheduler } from "./scheduler.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("ProfileScheduler", () => {
  it("runs a profile FIFO and releases after failure", async () => {
    const scheduler = new ProfileScheduler();
    const gate = deferred<void>();
    const order: string[] = [];
    const first = scheduler.run("p", 1, undefined, async () => {
      order.push("first");
      await gate.promise;
      throw new Error("failed");
    });
    const second = scheduler.run("p", 1, undefined, async () => {
      order.push("second");
      return 2;
    });
    const third = scheduler.run("p", 1, undefined, async () => {
      order.push("third");
      return 3;
    });
    gate.resolve();
    await expect(first).rejects.toThrow("failed");
    await expect(second).resolves.toBe(2);
    await expect(third).resolves.toBe(3);
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("removes an aborted queued invocation", async () => {
    const scheduler = new ProfileScheduler();
    const gate = deferred<void>();
    const first = scheduler.run("p", 1, undefined, () => gate.promise);
    const controller = new AbortController();
    const queued = scheduler.run("p", 1, controller.signal, async () => 2);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    gate.resolve();
    await first;
  });

  it("rejects queued invocations on shutdown and refuses invalid concurrency", async () => {
    const scheduler = new ProfileScheduler();
    const gate = deferred<void>();
    const first = scheduler.run("p", 1, undefined, () => gate.promise);
    const queued = scheduler.run("p", 1, undefined, async () => 2);
    scheduler.shutdown();
    await expect(queued).rejects.toThrow("shut down");
    await expect(scheduler.run("q", 0, undefined, async () => 1)).rejects.toThrow("shut down");
    gate.resolve();
    await first;

    const fresh = new ProfileScheduler();
    await expect(fresh.run("q", 0, undefined, async () => 1)).rejects.toThrow("positive integer");
  });

  it("reports queue positions and rejects an exclusive tool beside siblings", async () => {
    const scheduler = new ProfileScheduler();
    const gate = deferred<void>();
    const first = scheduler.run("p", 1, undefined, () => gate.promise);
    const positions: number[] = [];
    const second = scheduler.run(
      "p",
      1,
      undefined,
      async () => 2,
      (value) => positions.push(value),
    );
    expect(positions).toEqual([1]);
    expect(() =>
      scheduler.validateExclusiveSiblingBatch(["read", "subagent"], new Set(["subagent"])),
    ).toThrow("exclusive");
    expect(() =>
      scheduler.validateExclusiveSiblingBatch(["subagent"], new Set(["subagent"])),
    ).not.toThrow();
    gate.resolve();
    await first;
    await second;
  });
});
