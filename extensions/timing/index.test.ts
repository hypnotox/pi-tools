import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createExtensionRecorder } from "pi-tools/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import timingExtension, { formatTimingEntry, type TimingEntryData } from "./index.js";

function createHarness(sessionManager = SessionManager.inMemory()) {
  const shared = createExtensionRecorder();
  void shared.install(timingExtension);
  const setWorkingMessage = vi.fn();
  const context = shared.makeContext({ sessionManager, ui: { setWorkingMessage } as never });
  return {
    ...shared,
    context,
    emit: (event: string, payload: unknown = {}) => shared.invokeRaw(event, payload, context),
    setWorkingMessage,
    getRenderer: () => shared.entryRenderers.get("pi-tools-timing")?.renderer,
    getRendererOptions: () => shared.entryRenderers.get("pi-tools-timing")?.options,
  };
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
    expect(harness.appendEntries).toHaveLength(2);
    expect(harness.appendEntries[0]).toMatchObject([
      "pi-tools-timing",
      { kind: "tool", label: "bash", toolIndex: 2, durationMs: 884 },
    ]);
    expect(harness.appendEntries[1]).toMatchObject([
      "pi-tools-timing",
      { kind: "tool", label: "read", toolIndex: 1 },
    ]);
  });
  it("shows turn and full agent durations, then records the settled agent run", async () => {
    const harness = createHarness();
    await harness.emit("agent_start");
    await vi.advanceTimersByTimeAsync(64_200);
    await harness.emit("turn_start", { turnIndex: 3, timestamp: Date.now() });
    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith(
      "Working... · Turn 4: 0.0s · Total: 1m 04.2s",
    );
    await vi.advanceTimersByTimeAsync(8_249);
    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith(
      "Working... · Turn 4: 8.2s · Total: 1m 12.4s",
    );
    await harness.emit("turn_end");
    expect(harness.appendEntries.at(-1)?.[1]).toMatchObject({
      kind: "turn",
      label: "turn 4",
      durationMs: 8_249,
    });
    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith();
    await harness.emit("agent_settled");
    expect(harness.appendEntries.at(-1)?.[1]).toMatchObject({
      kind: "agent",
      label: "agent",
      durationMs: 72_449,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores handoff timing continuity before the replacement turn starts", async () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendCustomEntry("pi-tools:handoff-continuity", {
      timing: { agentDurationMs: 64_200, turnCount: 4 },
    });
    const harness = createHarness(sessionManager);
    await harness.emit("session_start", { reason: "new" });
    await harness.emit("turn_start", { turnIndex: 0, timestamp: Date.now() });

    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith(
      "Working... · Turn 5: 0.0s · Total: 1m 04.2s",
    );
  });

  it("does not restart the full duration when an agent run retries", async () => {
    const harness = createHarness();
    await harness.emit("agent_start");
    await vi.advanceTimersByTimeAsync(5_000);
    await harness.emit("agent_start");
    await vi.advanceTimersByTimeAsync(2_000);
    await harness.emit("turn_start", { turnIndex: 1, timestamp: Date.now() });
    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith(
      "Working... · Turn 2: 0.0s · Total: 7.0s",
    );
  });
  it("restores the native message when turn persistence throws", async () => {
    const harness = createHarness();
    await harness.emit("turn_start", { turnIndex: 0, timestamp: Date.now() });
    harness.api.appendEntry = () => {
      throw new Error("persistence failed");
    };
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
    expect(harness.appendEntries).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("renders restored agent timing entries without leading spacing", () => {
    const harness = createHarness();
    const renderer = harness.getRenderer() as
      | ((entry: unknown, options: unknown, theme: unknown) => { render(width: number): string[] })
      | undefined;
    expect(renderer).toBeTypeOf("function");
    expect(harness.getRendererOptions()).toEqual({ spacingBefore: 0 });

    const component = renderer?.(
      {
        data: {
          kind: "agent",
          label: "agent",
          startedAt: new Date(2026, 7, 14, 14, 31, 2, 202).getTime(),
          endedAt: new Date(2026, 7, 14, 14, 32, 14, 902).getTime(),
          durationMs: 72_700,
        },
      },
      {},
      { fg: (_color: string, text: string) => text },
    );
    expect(component?.render(120).map((line) => line.trimEnd())).toEqual([
      "  ↳ agent · 14:31:02.202 → 14:32:14.902 · 1m 12.7s",
    ]);
  });
});

describe("formatTimingEntry", () => {
  it("formats tool, turn, and agent lines with stable grammar", () => {
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
    const agent: TimingEntryData = {
      kind: "agent",
      label: "agent",
      startedAt: new Date(2026, 7, 14, 14, 31, 2, 202).getTime(),
      endedAt: new Date(2026, 7, 14, 14, 32, 14, 902).getTime(),
      durationMs: 72_700,
    };
    expect(formatTimingEntry(tool)).toBe("  ↳ tool 2 · bash · 14:32:08.210 → 14:32:11.940 · 3.73s");
    expect(formatTimingEntry(turn)).toBe("  ↳ turn 4 · 14:32:06.411 → 14:32:14.902 · 8.49s");
    expect(formatTimingEntry(agent)).toBe("  ↳ agent · 14:31:02.202 → 14:32:14.902 · 1m 12.7s");
  });
});
