import { type Static, Type, type TSchema as TypeBoxSchema } from "typebox";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const ConcreteModelSchema = Type.Object({
  provider: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
  thinkingLevels: Type.Array(Type.String()),
});
export type ConcreteModel = Static<typeof ConcreteModelSchema>;

const JsonValueSchema = Type.Any();
export type JsonValue = Static<typeof JsonValueSchema>;

export const ToolPolicySchema = Type.Union([
  Type.Object({
    mode: Type.Literal("allowlist"),
    tools: Type.Array(Type.String({ minLength: 1 })),
  }),
  Type.Object({ mode: Type.Literal("inherit"), deny: Type.Array(Type.String({ minLength: 1 })) }),
]);
export type ToolPolicy = Static<typeof ToolPolicySchema>;

export interface PreparedRun {
  cwd: string;
  prompt: string;
  toolPolicy: ToolPolicy;
}

export interface ExecutionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface ExecutionActivity {
  kind: "tool_start" | "tool_end" | "retry_start" | "retry_end";
  text: string;
}

export interface ExecutionOutcome {
  state: "completed" | "failed" | "cancelled";
  report?: string;
  failure?: string;
  usage: ExecutionUsage;
  activity: ExecutionActivity[];
  omittedActivity: number;
  retries: number;
}

export interface ProfileContext<TArgs> {
  args: TArgs;
  parent: {
    cwd: string;
    activeTools: string[];
    model: ConcreteModel;
    thinkingLevel: ThinkingLevel;
    trusted: boolean;
  };
  signal: AbortSignal;
}

export interface ProfileDefinition<
  TParameters extends TypeBoxSchema = TypeBoxSchema,
  TState = unknown,
> {
  id: string;
  toolName: string;
  label: string;
  description: string;
  parameters: TParameters;
  concurrency?: number;
  exclusiveParentBatch?: boolean;
  selectModel(context: ProfileContext<Static<TParameters>>): ConcreteModel;
  selectThinkingLevel?(context: ProfileContext<Static<TParameters>>): ThinkingLevel | undefined;
  prepare(context: ProfileContext<Static<TParameters>>): Promise<PreparedRun> | PreparedRun;
  beforeRun?(context: ProfileContext<Static<TParameters>>): Promise<TState> | TState;
  afterRun?(
    outcome: ExecutionOutcome,
    state: TState,
  ): Promise<JsonValue | undefined> | JsonValue | undefined;
}

export interface ProfileRegistration {
  profiles: ProfileDefinition[];
  suppressDefault?: boolean;
}

export const ExecutionDetailsSchema = Type.Object({
  profileId: Type.String(),
  cwd: Type.String(),
  model: ConcreteModelSchema,
  thinkingLevel: Type.Union(THINKING_LEVELS.map((level) => Type.Literal(level))),
  outcome: Type.Union([
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("cancelled"),
  ]),
  report: Type.Optional(Type.String()),
  failure: Type.Optional(Type.String()),
  profileData: Type.Optional(JsonValueSchema),
});
export interface ExecutionDetails {
  profileId: string;
  cwd: string;
  model: ConcreteModel;
  thinkingLevel: ThinkingLevel;
  outcome: "completed" | "failed" | "cancelled";
  report?: string;
  failure?: string;
  profileData?: JsonValue;
}

export const SUBAGENT_CAPABILITY = "pi-tools:subagent-profiles";
export const SUBAGENT_PROTOCOL_VERSION = 1;
export const CHILD_MARKER = "PI_TOOLS_SUBAGENT_CHILD";
export const MAX_PROFILE_DATA_BYTES = 16 * 1024;
