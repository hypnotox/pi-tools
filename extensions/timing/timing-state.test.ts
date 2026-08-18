import { describe, expect, it } from "vitest";
import {
  type Clock,
  formatCompletedDuration,
  formatLiveDuration,
  formatTimestamp,
  TimingState,
} from "./timing-state.js";

class FakeClock implements Clock {
  wall = new Date(2026, 7, 14, 14, 32, 6, 411).getTime();
  mono = 100;

  wallNow = (): number => this.wall;
  monotonicNow = (): number => this.mono;

  advance(ms: number): void {
    this.wall += ms;
    this.mono += ms;
  }
}

describe("TimingState", () => {
  it("records the full agent run across turns without restarting on retries", () => {
    const clock = new FakeClock();
    const state = new TimingState(clock);

    state.startAgent(clock.wall);
    clock.advance(2_000);
    state.startTurn(0, clock.wall);
    clock.advance(3_000);
    state.endTurn();
    state.startAgent(clock.wall);
    state.startTurn(1, clock.wall);
    clock.advance(4_000);

    expect(state.getLiveTurn()).toEqual({
      label: "turn 2",
      durationMs: 4_000,
      agentDurationMs: 9_000,
    });
    expect(state.endAgent()).toEqual({
      kind: "agent",
      label: "agent",
      startedAt: new Date(2026, 7, 14, 14, 32, 6, 411).getTime(),
      endedAt: clock.wall,
      durationMs: 9_000,
    });
  });

  it("continues live duration and turn labels after a handoff", () => {
    const firstClock = new FakeClock();
    const first = new TimingState(firstClock);
    first.startTurn(0, firstClock.wall);
    firstClock.advance(2_000);
    first.endTurn();
    first.startTurn(1, firstClock.wall);
    firstClock.advance(3_000);
    first.endTurn();
    first.endAgent();

    const nextClock = new FakeClock();
    const next = new TimingState(nextClock);
    next.restoreHandoff(first.getHandoffContinuation());
    next.startTurn(0, nextClock.wall);
    nextClock.advance(4_000);

    expect(next.getLiveTurn()).toEqual({
      label: "turn 3",
      durationMs: 4_000,
      agentDurationMs: 9_000,
    });
    next.endTurn();
    expect(next.endAgent()).toMatchObject({ durationMs: 4_000 });

    next.startTurn(0, nextClock.wall);
    expect(next.getLiveTurn()).toEqual({
      label: "turn 1",
      durationMs: 0,
      agentDurationMs: 0,
    });
  });

  it("records a one-based turn and monotonic duration", () => {
    const clock = new FakeClock();
    const state = new TimingState(clock);

    state.startTurn(3, clock.wall);
    clock.advance(8_491);

    expect(state.endTurn()).toEqual({
      kind: "turn",
      label: "turn 4",
      startedAt: new Date(2026, 7, 14, 14, 32, 6, 411).getTime(),
      endedAt: clock.wall,
      durationMs: 8_491,
    });
    expect(state.getLiveTurn()).toBeUndefined();
  });

  it("assigns source-order tool indexes despite completion order", () => {
    const clock = new FakeClock();
    const state = new TimingState(clock);
    state.startTurn(0);

    expect(state.startTool("read-id", "read")).toBe(1);
    clock.advance(10);
    expect(state.startTool("bash-id", "bash")).toBe(2);
    clock.advance(100);

    expect(state.endTool("bash-id")).toMatchObject({
      kind: "tool",
      label: "bash",
      toolIndex: 2,
      durationMs: 100,
    });
    clock.advance(25);
    expect(state.endTool("read-id")).toMatchObject({
      label: "read",
      toolIndex: 1,
      durationMs: 135,
    });
  });

  it("reuses an index for duplicate starts and resets indexes each turn", () => {
    const clock = new FakeClock();
    const state = new TimingState(clock);
    state.startTurn(0);

    expect(state.startTool("same", "read")).toBe(1);
    expect(state.startTool("same", "read")).toBe(1);

    state.startTurn(1);
    expect(state.endTool("same")).toBeUndefined();
    expect(state.startTool("next", "bash")).toBe(1);
  });

  it("tolerates missing completions and clamps a regressed monotonic clock", () => {
    const clock = new FakeClock();
    const state = new TimingState(clock);

    expect(state.endTurn()).toBeUndefined();
    expect(state.endTool("missing")).toBeUndefined();

    state.startTurn(0);
    clock.mono -= 50;
    expect(state.getLiveTurn()).toEqual({
      label: "turn 1",
      durationMs: 0,
      agentDurationMs: 0,
    });
  });

  it("resets all active state", () => {
    const clock = new FakeClock();
    const state = new TimingState(clock);
    state.startAgent();
    state.startTurn(0);
    state.startTool("read-id", "read");

    state.reset();

    expect(state.getLiveTurn()).toBeUndefined();
    expect(state.endAgent()).toBeUndefined();
    expect(state.endTool("read-id")).toBeUndefined();
    expect(state.startTool("new-id", "write")).toBe(1);
  });
});

describe("timing formatting", () => {
  it("formats local timestamps with milliseconds", () => {
    const timestamp = new Date(2026, 7, 14, 14, 32, 8, 120).getTime();
    expect(formatTimestamp(timestamp)).toBe("14:32:08.120");
  });

  it.each([
    [884, "884ms"],
    [999.4, "999ms"],
    [999.6, "1.00s"],
    [1_000, "1.00s"],
    [8_491, "8.49s"],
    [59_999, "1m 00.0s"],
    [60_000, "1m 00.0s"],
    [62_340, "1m 02.3s"],
    [119_949, "1m 59.9s"],
    [119_950, "2m 00.0s"],
    [119_999, "2m 00.0s"],
    [-10, "0ms"],
  ])("formats %s completed milliseconds as %s", (duration, expected) => {
    expect(formatCompletedDuration(duration)).toBe(expected);
  });

  it("formats live durations with one decimal second", () => {
    expect(formatLiveDuration(8_249)).toBe("8.2s");
    expect(formatLiveDuration(72_449)).toBe("1m 12.4s");
    expect(formatLiveDuration(-1)).toBe("0.0s");
  });
});
