import type { ExecutionUsage } from "./runner.js";

type ActivityState = "running" | "success" | "error";

export type ExecutionActivity =
  | { kind: "thinking"; text: string }
  | {
      kind: "tool";
      toolCallId: string;
      summary: string;
      state: ActivityState;
      durationMs: number;
    }
  | {
      kind: "retry";
      attempt: number;
      maxAttempts: number;
      state: ActivityState;
      durationMs: number;
    };

export interface ExecutionProjection {
  prompt: string;
  activity: ExecutionActivity[];
  omittedActivity: number;
  unfinishedThinking?: string;
  elapsedMs: number;
  turns: number;
  activeUsage?: ExecutionUsage;
  latestTurnUsage?: ExecutionUsage;
}

export interface RunProgress {
  state: "running";
  usage: ExecutionUsage;
  execution: ExecutionProjection;
}

export interface SubagentDetails {
  label: string;
  state: "running" | "completed" | "failed" | "cancelled";
  model: { provider: string; id: string };
  thinkingLevel: string;
  usage: ExecutionUsage;
  execution?: ExecutionProjection;
  report?: string;
  failure?: string;
}
