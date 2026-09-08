import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtensionHarness } from "../../tests/extension-harness.js";
import {
  SUBAGENT_POLL_MS,
  SUBAGENT_REQUEST_TIMEOUT_MS,
  trackSubagentActivity,
} from "./subagent-activity.js";

interface Request {
  version: number;
  requestId: string;
  method: string;
}

const disposers: Array<() => void> = [];

function setup() {
  vi.useFakeTimers();
  const { bus } = createExtensionHarness();
  const requests: Request[] = [];
  bus.on("subagents:rpc:v1:request", (raw) => requests.push(raw as Request));
  const onActivity = vi.fn();
  const dispose = trackSubagentActivity(bus, onActivity);
  disposers.push(dispose);
  const reply = (data: unknown, request = requests.at(-1)) => {
    if (!request) throw new Error("No request");
    bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
      version: 1,
      requestId: request.requestId,
      success: true,
      data,
    });
  };
  const ready = () => reply({ capabilities: { fleetStatus: { version: 1 } } });
  const status = (totalActive: number) =>
    reply({ fleet: { version: 1, totalActive, entries: [], omitted: totalActive } });
  return { bus, requests, onActivity, dispose, reply, ready, status };
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe("optional subagent activity", () => {
  it("does one bounded probe and remains inactive without pi-subagents", async () => {
    const h = setup();
    expect(h.requests).toEqual([{ version: 1, requestId: expect.any(String), method: "ping" }]);
    await vi.advanceTimersByTimeAsync(SUBAGENT_REQUEST_TIMEOUT_MS * 3);
    expect(h.requests).toHaveLength(1);
    expect(h.onActivity).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requires fleet v1 support, but can discover an owner that becomes ready later", () => {
    const h = setup();
    h.reply({ capabilities: {} });
    expect(h.requests).toHaveLength(1);
    h.bus.emit("subagents:rpc:v1:ready");
    h.ready();
    expect(h.requests.at(-1)?.method).toBe("status");
    h.status(1);
    expect(h.onActivity).toHaveBeenLastCalledWith(true);
  });

  it("restores active work from status without a launch event and uses totalActive, not entries", () => {
    const h = setup();
    h.ready();
    h.status(100);
    expect(h.onActivity).toHaveBeenCalledExactlyOnceWith(true);
    h.bus.emit("subagent:async-complete", { runId: "one-of-many" });
    h.status(99);
    expect(h.onActivity).toHaveBeenCalledTimes(1);
    h.bus.emit("subagent:async-complete", { runId: "last" });
    h.status(0);
    expect(h.onActivity).toHaveBeenLastCalledWith(false);
  });

  it("reconciles missed start and completion events, including restored/detached workflows", async () => {
    const h = setup();
    h.ready();
    h.status(0);
    await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_MS);
    h.status(1);
    expect(h.onActivity).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_MS);
    h.status(0);
    expect(h.onActivity).toHaveBeenLastCalledWith(false);
  });

  it("treats lifecycle events only as hints so unrelated sessions cannot raise activity", () => {
    const h = setup();
    h.ready();
    h.status(0);
    for (const event of [
      "subagent:async-started",
      "subagent:async-complete",
      "subagent:foreground-complete",
    ]) {
      h.bus.emit(event, { id: "unrelated", sessionId: "other-session" });
      expect(h.requests.at(-1)?.method).toBe("status");
      h.status(0);
    }
    expect(h.onActivity).not.toHaveBeenCalled();
  });

  it("coalesces refreshes and ignores replies older than the latest lifecycle event", async () => {
    const h = setup();
    h.ready();
    h.status(1);
    await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_MS);
    const stale = h.requests.at(-1);
    const requestCount = h.requests.length;
    h.bus.emit("subagent:async-started");
    h.bus.emit("subagent:async-complete");
    expect(h.requests).toHaveLength(requestCount);
    h.reply({ fleet: { version: 1, totalActive: 0 } }, stale);
    expect(h.onActivity).toHaveBeenCalledExactlyOnceWith(true);
    expect(h.requests).toHaveLength(requestCount + 1);
    h.status(1);
    expect(h.onActivity).toHaveBeenCalledTimes(1);
    // Duplicate old replies no longer have a subscriber.
    h.reply({ fleet: { version: 1, totalActive: 0 } }, stale);
    expect(h.onActivity).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    {},
    { version: 2, totalActive: 1 },
    { version: 1, totalActive: -1 },
    { version: 1, totalActive: "1" },
    { version: 1, totalActive: Infinity },
  ])("clears stale activity for invalid fleet data: %j", (fleet) => {
    const h = setup();
    h.ready();
    h.status(1);
    h.bus.emit("subagent:async-complete");
    h.reply({ fleet });
    expect(h.onActivity).toHaveBeenLastCalledWith(false);
  });

  it("clears on RPC errors and timeouts, then recovers on a successful snapshot", async () => {
    const h = setup();
    h.ready();
    h.status(1);
    h.bus.emit("subagent:async-complete");
    const request = h.requests.at(-1);
    h.bus.emit(`subagents:rpc:v1:reply:${request?.requestId}`, {
      version: 1,
      requestId: request?.requestId,
      success: false,
      error: { code: "no_active_session" },
    });
    expect(h.onActivity).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_MS);
    h.status(1);
    await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_MS + SUBAGENT_REQUEST_TIMEOUT_MS);
    expect(h.onActivity).toHaveBeenLastCalledWith(false);
    h.status(1);
    expect(h.onActivity).toHaveBeenLastCalledWith(true);
  });

  it("cleans up pending replies, polling, and event listeners on shutdown", () => {
    const h = setup();
    h.ready();
    h.status(1);
    h.bus.emit("subagent:async-complete");
    const requestCount = h.requests.length;
    h.dispose();
    expect(h.onActivity).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
    h.status(1);
    h.bus.emit("subagents:rpc:v1:ready");
    h.bus.emit("subagent:async-started");
    expect(h.requests).toHaveLength(requestCount);
    expect(h.onActivity).toHaveBeenCalledTimes(2);
  });

  it("does not carry old-session activity or replies into a replacement tracker", () => {
    const h = setup();
    h.ready();
    h.status(1);
    h.bus.emit("subagent:async-complete");
    const oldRequest = h.requests.at(-1);
    h.dispose();
    const replacementActivity = vi.fn();
    disposers.push(trackSubagentActivity(h.bus, replacementActivity));
    h.reply({ fleet: { version: 1, totalActive: 1 } }, oldRequest);
    expect(replacementActivity).not.toHaveBeenCalled();
    h.ready();
    h.status(0);
    expect(replacementActivity).not.toHaveBeenCalled();
    h.bus.emit("subagent:async-started");
    h.status(1);
    expect(replacementActivity).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("supports an owner replying synchronously", () => {
    vi.useFakeTimers();
    const { bus } = createExtensionHarness();
    bus.on("subagents:rpc:v1:request", (raw) => {
      const request = raw as Request;
      bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
        version: 1,
        requestId: request.requestId,
        success: true,
        data:
          request.method === "ping"
            ? { capabilities: { fleetStatus: { version: 1 } } }
            : { fleet: { version: 1, totalActive: 1 } },
      });
    });
    const onActivity = vi.fn();
    disposers.push(trackSubagentActivity(bus, onActivity));
    expect(onActivity).toHaveBeenCalledExactlyOnceWith(true);
  });
});
