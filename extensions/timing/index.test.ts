import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import timingExtension, { formatTimingEntry, type TimingEntryData } from "./index.js";

type Handler = (event: unknown, context: unknown) => unknown;

function createHarness() {
  const handlers = new Map<string, Handler[]>();
  const appendEntry = vi.fn();
  let renderer:
    | ((entry: { data: unknown }, options: unknown, theme: unknown) => unknown)
    | undefined;

  const pi = {
    appendEntry,
    on(event: string, handler: Handler) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
    registerEntryRenderer(_type: string, nextRenderer: typeof renderer) {
      renderer = nextRenderer;
    },
  } as unknown as ExtensionAPI;

  const setWorkingMessage = vi.fn();
  const context = {
    mode: "tui",
    ui: { setWorkingMessage },
  };

  timingExtension(pi);

  const emit = async (event: string, payload: unknown = {}): Promise<void> => {
    for (const handler of handlers.get(event) ?? []) {
      await handler(payload, context);
    }
  };

  return { appendEntry, context, emit, getRenderer: () => renderer, setWorkingMessage };
}

describe("timing extension", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 14, 14, 32, 6, 411));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses indexed non-context entries for parallel tool completion", async () => {
    const harness = createHarness();
    await harness.emit("turn_start", { turnIndex: 3, timestamp: Date.now() });
    await harness.emit("tool_execution_start", { toolCallId: "read-id", toolName: "read" });
    await harness.emit("tool_execution_start", { toolCallId: "bash-id", toolName: "bash" });

    await vi.advanceTimersByTimeAsync(884);
    await harness.emit("tool_execution_end", { toolCallId: "bash-id" });
    await harness.emit("tool_execution_end", { toolCallId: "read-id" });

    expect(harness.appendEntry).toHaveBeenCalledTimes(2);
    expect(harness.appendEntry.mock.calls[0]?.[0]).toBe("pi-tools-timing");
    expect(harness.appendEntry.mock.calls[0]?.[1]).toMatchObject({
      kind: "tool",
      label: "bash",
      toolIndex: 2,
      durationMs: 884,
    });
    expect(harness.appendEntry.mock.calls[1]?.[1]).toMatchObject({
      kind: "tool",
      label: "read",
      toolIndex: 1,
    });
  });

  it("adds turn duration to the native working message and restores the default", async () => {
    const harness = createHarness();
    await harness.emit("turn_start", { turnIndex: 3, timestamp: Date.now() });

    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith("Working... · Turn 4 · 0.0s");
    await vi.advanceTimersByTimeAsync(8_249);
    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith("Working... · Turn 4 · 8.2s");

    await harness.emit("turn_end");

    expect(harness.appendEntry.mock.calls.at(-1)?.[1]).toMatchObject({
      kind: "turn",
      label: "turn 4",
      durationMs: 8_249,
    });
    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores the native message when turn persistence throws", async () => {
    const harness = createHarness();
    await harness.emit("turn_start", { turnIndex: 0, timestamp: Date.now() });
    harness.appendEntry.mockImplementationOnce(() => {
      throw new Error("persistence failed");
    });

    await expect(harness.emit("turn_end")).rejects.toThrow("persistence failed");

    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up idempotently on shutdown", async () => {
    const harness = createHarness();
    await harness.emit("turn_start", { turnIndex: 0, timestamp: Date.now() });
    expect(vi.getTimerCount()).toBe(1);

    await harness.emit("session_shutdown");
    await harness.emit("session_shutdown");

    expect(vi.getTimerCount()).toBe(0);
    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith();
  });

  it("does not persist presentation entries outside TUI mode", async () => {
    const harness = createHarness();
    harness.context.mode = "json";
    await harness.emit("turn_start", { turnIndex: 0, timestamp: Date.now() });
    await harness.emit("tool_execution_start", { toolCallId: "read-id", toolName: "read" });
    await harness.emit("tool_execution_end", { toolCallId: "read-id" });
    await harness.emit("turn_end");

    expect(harness.appendEntry).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("registers a renderer for restored timing entries", () => {
    const harness = createHarness();
    expect(harness.getRenderer()).toBeTypeOf("function");
  });
});

describe("formatTimingEntry", () => {
  it("formats tool and turn lines with stable grammar", () => {
    const tool: TimingEntryData = {
      kind: "tool",
      label: "bash",
      toolIndex: 2,
      startedAt: new Date(2026, 7, 14, 14, 32, 8, 210).getTime(),
      endedAt: new Date(2026, 7, 14, 14, 32, 11, 940).getTime(),
      durationMs: 3_730,
    };
    const turn: TimingEntryData = {
      kind: "turn",
      label: "turn 4",
      startedAt: new Date(2026, 7, 14, 14, 32, 6, 411).getTime(),
      endedAt: new Date(2026, 7, 14, 14, 32, 14, 902).getTime(),
      durationMs: 8_491,
    };

    expect(formatTimingEntry(tool)).toBe("  ↳ tool 2 · bash · 14:32:08.210 → 14:32:11.940 · 3.73s");
    expect(formatTimingEntry(turn)).toBe("  ↳ turn 4 · 14:32:06.411 → 14:32:14.902 · 8.49s");
  });
});
