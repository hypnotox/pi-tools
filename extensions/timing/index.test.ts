import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionHarness } from "../../tests/extension-harness.js";
import timingExtension, { formatTimingEntry } from "./index.js";

function createHarness(sessionManager: { getEntries(): unknown[] } = { getEntries: () => [] }) {
  const harness = createExtensionHarness();
  const setWorkingMessage = vi.fn();
  const context = {
    mode: "tui",
    sessionManager,
    ui: { setWorkingMessage },
  };
  timingExtension(harness.api);
  return { ...harness, context, setWorkingMessage };
}

describe("timing extension", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 14, 14, 32, 6, 411));
  });
  afterEach(() => vi.useRealTimers());

  it("records source-order parallel tool indexes and settled durations", async () => {
    const harness = createHarness();
    await harness.invoke("agent_start", {}, harness.context);
    await harness.invoke("turn_start", { turnIndex: 0, timestamp: Date.now() }, harness.context);
    await harness.invoke(
      "tool_execution_start",
      { toolCallId: "read", toolName: "read" },
      harness.context,
    );
    await harness.invoke(
      "tool_execution_start",
      { toolCallId: "bash", toolName: "bash" },
      harness.context,
    );
    await vi.advanceTimersByTimeAsync(884);
    await harness.invoke("tool_execution_end", { toolCallId: "bash" }, harness.context);
    await harness.invoke("tool_execution_end", { toolCallId: "read" }, harness.context);
    await harness.invoke("turn_end", {}, harness.context);
    await harness.invoke("agent_settled", {}, harness.context);

    expect(harness.appendEntries).toEqual([
      [
        "pi-tools-timing",
        {
          kind: "tool-block",
          tools: [
            expect.objectContaining({ label: "read", toolIndex: 1, durationMs: 884 }),
            expect.objectContaining({ label: "bash", toolIndex: 2, durationMs: 884 }),
          ],
          turn: expect.objectContaining({ kind: "turn", durationMs: 884 }),
          agent: expect.objectContaining({ kind: "agent", durationMs: 884 }),
        },
      ],
    ]);
  });

  it("flushes earlier turns separately and joins the agent duration only to the last turn", async () => {
    const harness = createHarness();
    await harness.invoke("agent_start", {}, harness.context);
    await harness.invoke("turn_start", { turnIndex: 0, timestamp: Date.now() }, harness.context);
    await vi.advanceTimersByTimeAsync(100);
    await harness.invoke("turn_end", {}, harness.context);
    expect(harness.appendEntries).toHaveLength(0);

    await harness.invoke("turn_start", { turnIndex: 1, timestamp: Date.now() }, harness.context);
    expect(harness.appendEntries[0]?.[1]).toMatchObject({
      kind: "tool-block",
      turn: { kind: "turn", label: "turn 1" },
    });
    expect(harness.appendEntries[0]?.[1]).not.toHaveProperty("agent");

    await vi.advanceTimersByTimeAsync(200);
    await harness.invoke("turn_end", {}, harness.context);
    await harness.invoke("agent_settled", {}, harness.context);
    expect(harness.appendEntries[1]?.[1]).toMatchObject({
      kind: "tool-block",
      turn: { kind: "turn", label: "turn 2" },
      agent: { kind: "agent", durationMs: 300 },
    });
  });

  it("restores timing continuity before the first replacement turn", async () => {
    const sessionManager = {
      getEntries: () => [
        {
          type: "custom",
          customType: "pi-tools:handoff-continuity",
          data: { timing: { agentDurationMs: 64_200, turnCount: 4 } },
        },
      ],
    };
    const harness = createHarness(sessionManager);
    await harness.invoke("session_start", { reason: "new" }, harness.context);
    await harness.invoke("turn_start", { turnIndex: 0, timestamp: Date.now() }, harness.context);
    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith(
      "Working... · Turn 5: 0.0s · Total: 1m 04.2s",
    );
  });

  it("cleans up its refresh timer on shutdown", async () => {
    const harness = createHarness();
    await harness.invoke("turn_start", { turnIndex: 0, timestamp: Date.now() }, harness.context);
    expect(vi.getTimerCount()).toBe(1);
    await harness.invoke("session_shutdown", {}, harness.context);
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.setWorkingMessage).toHaveBeenLastCalledWith();
  });

  it("registers portable timing entry rendering", () => {
    const harness = createHarness();
    expect(harness.entryRenderers.get("pi-tools-timing")?.options).toBeUndefined();
    expect(
      formatTimingEntry({
        kind: "tool",
        label: "bash",
        toolIndex: 2,
        startedAt: new Date(2026, 7, 14, 14, 32, 8, 210).getTime(),
        endedAt: new Date(2026, 7, 14, 14, 32, 11, 940).getTime(),
        durationMs: 3_730,
      }),
    ).toBe("  ↳ tool 2 · bash · 14:32:08.210 → 14:32:11.940 · 3.73s");

    expect(
      formatTimingEntry({
        kind: "tool-block",
        tools: [
          {
            kind: "tool",
            label: "read",
            toolIndex: 1,
            startedAt: new Date(2026, 7, 14, 14, 32, 6, 411).getTime(),
            endedAt: new Date(2026, 7, 14, 14, 32, 7, 295).getTime(),
            durationMs: 884,
          },
          {
            kind: "tool",
            label: "bash",
            toolIndex: 2,
            startedAt: new Date(2026, 7, 14, 14, 32, 6, 411).getTime(),
            endedAt: new Date(2026, 7, 14, 14, 32, 8, 179).getTime(),
            durationMs: 1_768,
          },
        ],
        turn: {
          kind: "turn",
          label: "turn 1",
          startedAt: new Date(2026, 7, 14, 14, 32, 6, 411).getTime(),
          endedAt: new Date(2026, 7, 14, 14, 32, 8, 200).getTime(),
          durationMs: 1_789,
        },
        agent: {
          kind: "agent",
          label: "agent",
          startedAt: new Date(2026, 7, 14, 14, 32, 6, 411).getTime(),
          endedAt: new Date(2026, 7, 14, 14, 32, 8, 210).getTime(),
          durationMs: 1_799,
        },
      }),
    ).toBe(
      [
        "  ↳ tool 1 · read · 14:32:06.411 → 14:32:07.295 · 884ms",
        "  ↳ tool 2 · bash · 14:32:06.411 → 14:32:08.179 · 1.77s",
        "  ↳ turn 1 · 14:32:06.411 → 14:32:08.200 · 1.79s",
        "  ↳ agent · 14:32:06.411 → 14:32:08.210 · 1.80s",
      ].join("\n"),
    );
  });
});
