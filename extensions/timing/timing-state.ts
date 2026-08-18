export interface Clock {
  wallNow(): number;
  monotonicNow(): number;
}

export interface TimingCompletion {
  kind: "agent" | "tool" | "turn";
  label: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  toolIndex?: number;
}

export interface HandoffTimingContinuation {
  agentDurationMs: number;
  turnCount: number;
}

interface ActiveTiming {
  label: string;
  startedAt: number;
  startedMono: number;
}

interface ActiveTool extends ActiveTiming {
  index: number;
}

const systemClock: Clock = {
  wallNow: Date.now,
  monotonicNow: () => performance.now(),
};

export class TimingState {
  readonly #clock: Clock;
  readonly #tools = new Map<string, ActiveTool>();
  #agent: ActiveTiming | undefined;
  #turn: ActiveTiming | undefined;
  #nextToolIndex = 1;
  #handoffAgentDurationMs = 0;
  #lastAgentDurationMs = 0;
  #turnOffset = 0;
  #lastTurnNumber = 0;
  #handoffPending = false;

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }

  startAgent(startedAt = this.#clock.wallNow()): void {
    if (this.#agent) return;
    if (!this.#handoffPending) {
      this.#handoffAgentDurationMs = 0;
      this.#turnOffset = 0;
      this.#lastTurnNumber = 0;
    }
    this.#handoffPending = false;
    this.#lastAgentDurationMs = 0;
    this.#agent = {
      label: "agent",
      startedAt,
      startedMono: this.#clock.monotonicNow(),
    };
  }

  endAgent(): TimingCompletion | undefined {
    const agent = this.#agent;
    if (!agent) return undefined;

    const completion = this.#complete("agent", agent);
    this.#lastAgentDurationMs = completion.durationMs;
    this.#agent = undefined;
    return completion;
  }

  startTurn(turnIndex: number, startedAt = this.#clock.wallNow()): void {
    this.startAgent(startedAt);
    const turnNumber = this.#turnOffset + turnIndex + 1;
    this.#lastTurnNumber = Math.max(this.#lastTurnNumber, turnNumber);
    this.#turn = {
      label: `turn ${turnNumber}`,
      startedAt,
      startedMono: this.#clock.monotonicNow(),
    };
    this.#tools.clear();
    this.#nextToolIndex = 1;
  }

  endTurn(): TimingCompletion | undefined {
    const turn = this.#turn;
    if (!turn) return undefined;

    const completion = this.#complete("turn", turn);
    this.#turn = undefined;
    this.#tools.clear();
    return completion;
  }

  startTool(toolCallId: string, toolName: string): number {
    const existing = this.#tools.get(toolCallId);
    if (existing) return existing.index;

    const index = this.#nextToolIndex++;
    this.#tools.set(toolCallId, {
      index,
      label: toolName,
      startedAt: this.#clock.wallNow(),
      startedMono: this.#clock.monotonicNow(),
    });
    return index;
  }

  endTool(toolCallId: string): TimingCompletion | undefined {
    const tool = this.#tools.get(toolCallId);
    if (!tool) return undefined;

    this.#tools.delete(toolCallId);
    return {
      ...this.#complete("tool", tool),
      toolIndex: tool.index,
    };
  }

  getLiveTurn(): { label: string; durationMs: number; agentDurationMs: number } | undefined {
    if (!this.#turn) return undefined;
    return {
      label: this.#turn.label,
      durationMs: this.#elapsed(this.#turn.startedMono),
      agentDurationMs: this.#agent
        ? this.#handoffAgentDurationMs + this.#elapsed(this.#agent.startedMono)
        : 0,
    };
  }

  getHandoffContinuation(): HandoffTimingContinuation {
    const activeDurationMs = this.#agent ? this.#elapsed(this.#agent.startedMono) : 0;
    return {
      agentDurationMs: this.#handoffAgentDurationMs + this.#lastAgentDurationMs + activeDurationMs,
      turnCount: Math.max(this.#turnOffset, this.#lastTurnNumber),
    };
  }

  restoreHandoff(continuation: HandoffTimingContinuation): void {
    this.#handoffAgentDurationMs = Math.max(0, continuation.agentDurationMs);
    this.#turnOffset = Math.max(0, continuation.turnCount);
    this.#lastTurnNumber = this.#turnOffset;
    this.#handoffPending = true;
  }

  reset(): void {
    this.#agent = undefined;
    this.#turn = undefined;
    this.#tools.clear();
    this.#nextToolIndex = 1;
    this.#handoffAgentDurationMs = 0;
    this.#lastAgentDurationMs = 0;
    this.#turnOffset = 0;
    this.#lastTurnNumber = 0;
    this.#handoffPending = false;
  }

  #complete(kind: TimingCompletion["kind"], timing: ActiveTiming): TimingCompletion {
    return {
      kind,
      label: timing.label,
      startedAt: timing.startedAt,
      endedAt: this.#clock.wallNow(),
      durationMs: this.#elapsed(timing.startedMono),
    };
  }

  #elapsed(startedMono: number): number {
    return Math.max(0, this.#clock.monotonicNow() - startedMono);
  }
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":")
    .concat(`.${String(date.getMilliseconds()).padStart(3, "0")}`);
}

export function formatCompletedDuration(durationMs: number): string {
  const safeMs = Math.max(0, durationMs);
  const roundedMs = Math.round(safeMs);
  if (roundedMs < 1_000) return `${roundedMs}ms`;

  const roundedCentiseconds = Math.round(safeMs / 10);
  if (roundedCentiseconds < 6_000) return `${(roundedCentiseconds / 100).toFixed(2)}s`;

  const roundedTenths = Math.round(safeMs / 100);
  const minutes = Math.floor(roundedTenths / 600);
  const seconds = ((roundedTenths % 600) / 10).toFixed(1).padStart(4, "0");
  return `${minutes}m ${seconds}s`;
}

export function formatLiveDuration(durationMs: number): string {
  const roundedTenths = Math.round(Math.max(0, durationMs) / 100);
  if (roundedTenths < 600) return `${(roundedTenths / 10).toFixed(1)}s`;

  const minutes = Math.floor(roundedTenths / 600);
  const seconds = ((roundedTenths % 600) / 10).toFixed(1).padStart(4, "0");
  return `${minutes}m ${seconds}s`;
}
