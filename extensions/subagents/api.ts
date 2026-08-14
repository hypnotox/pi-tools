import { type Static, Type, type TSchema as TypeBoxSchema } from "typebox";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const ThinkingLevelSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);

export const ConcreteModelSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    thinkingLevels: Type.Array(ThinkingLevelSchema, { minItems: 1, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type ConcreteModel = Static<typeof ConcreteModelSchema>;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export const JsonValueSchema = Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  Type.Array(Type.Unknown()),
  Type.Record(Type.String(), Type.Unknown()),
]);

export const ToolPolicySchema = Type.Union([
  Type.Object(
    {
      mode: Type.Literal("allowlist"),
      tools: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("inherit"),
      deny: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    },
    { additionalProperties: false },
  ),
]);
export type ToolPolicy = Static<typeof ToolPolicySchema>;

export const PreparedRunSchema = Type.Object(
  {
    cwd: Type.String({ minLength: 1 }),
    systemPrompt: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    toolPolicy: ToolPolicySchema,
  },
  { additionalProperties: false },
);
export interface PreparedRun {
  cwd: string;
  systemPrompt: string;
  prompt: string;
  toolPolicy: ToolPolicy;
}

export const ExecutionUsageSchema = Type.Object(
  {
    input: Type.Number({ minimum: 0 }),
    output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Number({ minimum: 0 }),
    cacheWrite: Type.Number({ minimum: 0 }),
    cost: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ExecutionUsage = Static<typeof ExecutionUsageSchema>;
export const ExecutionActivitySchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("tool_start"),
      Type.Literal("tool_end"),
      Type.Literal("retry_start"),
      Type.Literal("retry_end"),
      Type.Literal("diagnostic"),
    ]),
    text: Type.String(),
  },
  { additionalProperties: false },
);
export type ExecutionActivity = Static<typeof ExecutionActivitySchema>;
export interface ExecutionOutcome {
  state: "running" | "completed" | "failed" | "cancelled";
  report?: string;
  failure?: string;
  usage: ExecutionUsage;
  activity: ExecutionActivity[];
  omittedActivity: number;
  retries: number;
  retryActive: boolean;
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
export const PostRunResultSchema = Type.Object(
  { report: Type.Optional(Type.String()), profileData: Type.Optional(JsonValueSchema) },
  { additionalProperties: false },
);
export interface PostRunResult<TProfileData extends JsonValue = JsonValue> {
  report?: string;
  profileData?: TProfileData;
}

export interface ProfileDefinition<
  TParameters extends TypeBoxSchema = TypeBoxSchema,
  TProfileData extends TypeBoxSchema = TypeBoxSchema,
  TState = unknown,
> {
  id: string;
  toolName: string;
  label: string;
  description: string;
  parameters: TParameters;
  profileDataSchema: TProfileData;
  concurrency?: number;
  exclusiveParentBatch?: boolean;
  selectModel(context: ProfileContext<Static<TParameters>>): ConcreteModel;
  selectThinkingLevel?(context: ProfileContext<Static<TParameters>>): ThinkingLevel | undefined;
  prepare(context: ProfileContext<Static<TParameters>>): Promise<PreparedRun> | PreparedRun;
  beforeRun?(context: ProfileContext<Static<TParameters>>): Promise<TState> | TState;
  afterRun?(
    outcome: ExecutionOutcome,
    state: TState | undefined,
  ):
    | Promise<PostRunResult<Static<TProfileData> & JsonValue> | undefined>
    | PostRunResult<Static<TProfileData> & JsonValue>
    | undefined;
}

export interface ProfileRegistration {
  profiles: ProfileDefinition[];
  suppressDefault?: boolean;
}
export type ProfileRegistrationState = "pending" | "registered" | "rejected" | "late";
export interface ProfileRegistrationReceipt {
  state: ProfileRegistrationState;
  reason?: string;
}

/** Stable event-bus protocol. Consumers import these types only; runtime integration uses pi.events. */
export const SUBAGENT_PROFILE_PROTOCOL_VERSION = 1;
export const SUBAGENT_PROFILE_REQUEST_EVENT = "pi-tools:subagent-profiles:request";
export const SUBAGENT_PROFILE_CAPABILITY_EVENT = "pi-tools:subagent-profiles:capability";
export interface ProfileCapabilityRequest {
  protocolVersion: number;
  correlationId: string;
}
export interface ProfileCapability {
  protocolVersion: number;
  correlationId: string;
  register(batch: ProfileRegistration): ProfileRegistrationReceipt;
}

export const ExecutionDetailsSchema = Type.Object(
  {
    profileId: Type.String(),
    state: Type.Union([
      Type.Literal("queued"),
      Type.Literal("running"),
      Type.Literal("completed"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
    cwd: Type.String(),
    model: ConcreteModelSchema,
    thinkingLevel: ThinkingLevelSchema,
    queuePosition: Type.Optional(Type.Integer({ minimum: 1 })),
    retryActive: Type.Boolean(),
    retries: Type.Integer({ minimum: 0 }),
    activity: Type.Array(ExecutionActivitySchema),
    omittedActivity: Type.Integer({ minimum: 0 }),
    usage: ExecutionUsageSchema,
    report: Type.Optional(Type.String()),
    failure: Type.Optional(Type.String()),
    profileData: Type.Optional(JsonValueSchema),
  },
  { additionalProperties: false },
);
export type ExecutionDetails = Static<typeof ExecutionDetailsSchema>;
export const CHILD_MARKER = "PI_TOOLS_SUBAGENT_CHILD";
export const MAX_PROFILE_DATA_BYTES = 16 * 1024;
