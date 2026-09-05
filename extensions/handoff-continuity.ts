import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export const HANDOFF_CONTINUITY_ENTRY = "pi-tools:handoff-continuity";
export const HANDOFF_CONTINUITY_REQUEST = "pi-tools:handoff-continuity-request";

export interface HandoffSessionContinuation {
  model: {
    provider: string;
    id: string;
  };
  thinkingLevel: ModelThinkingLevel;
}

export interface HandoffContinuity {
  session?: HandoffSessionContinuation;
  timing?: unknown;
}
