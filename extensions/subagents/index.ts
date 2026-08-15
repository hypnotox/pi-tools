import { clampThinkingLevel, getSupportedThinkingLevels, StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  CHILD_MARKER,
  type ConcreteModel,
  ConcreteModelSchema,
  type ExecutionDetails,
  ExecutionDetailsSchema,
  type ExecutionOutcome,
  type ExecutionUsage,
  JsonValueSchema,
  MAX_EXECUTION_FACT_BYTES,
  MAX_EXECUTION_FACT_CHARACTERS,
  MAX_PROFILE_DATA_BYTES,
  PostRunResultSchema,
  PreparedRunSchema,
  type ProfileCapabilityRequest,
  type ProfileDefinition,
  type ProfileRegistration,
  type ProfileRegistrationReceipt,
  SUBAGENT_PROFILE_CAPABILITY_EVENT,
  SUBAGENT_PROFILE_PROTOCOL_VERSION,
  SUBAGENT_PROFILE_REGISTRATION_RESULT_EVENT,
  SUBAGENT_PROFILE_REQUEST_EVENT,
  SUBAGENT_TOOL_SUMMARY_CAPABILITY_EVENT,
  SUBAGENT_TOOL_SUMMARY_PROTOCOL_VERSION,
  SUBAGENT_TOOL_SUMMARY_REGISTRATION_RESULT_EVENT,
  SUBAGENT_TOOL_SUMMARY_REQUEST_EVENT,
  THINKING_LEVELS,
  type ThinkingLevel,
  type ToolSummaryCapabilityRequest,
  type ToolSummaryRegistration,
  type ToolSummaryRegistrationReceipt,
} from "./api.js";
import { ProfileRegistry } from "./profile-registry.js";
import { renderExecution } from "./rendering.js";
import { SubprocessRunner, truncateUtf8 } from "./runner.js";
import { ProfileScheduler } from "./scheduler.js";
import { resolveTools } from "./tool-policy.js";
import { summarizeBuiltinTool } from "./tool-summaries.js";
import { ToolSummaryRegistry } from "./tool-summary-registry.js";

export type {
  ConcreteModel,
  ExecutionDetails,
  ExecutionOutcome,
  JsonValue,
  PostRunResult,
  ProfileDefinition,
  ProfileRegistration,
  ProfileRegistrationResult,
  ThinkingLevel,
  ToolPolicy,
  ToolSummaryCapability,
  ToolSummaryRegistration,
  ToolSummaryRegistrationReceipt,
  ToolSummaryRegistrationResult,
  ToolSummaryResolver,
} from "./api.js";
export type { RunnerDependencies, RunRequest } from "./runner.js";

const DEFAULT_PARAMETERS = Type.Object(
  {
    task: Type.String({ minLength: 1, description: "Focused task for a fresh subagent." }),
    model: Type.Optional(Type.String({ description: "Exact provider/model selection." })),
    thinkingLevel: Type.Optional(
      StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const),
    ),
  },
  { additionalProperties: false },
);

const EMPTY_USAGE: ExecutionUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assertJsonValue(value: unknown): asserts value is ExecutionDetails["profileData"] {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean" ||
      (typeof current === "number" && Number.isFinite(current))
    )
      continue;
    if (typeof current !== "object") throw new Error("Profile data must be JSON data");
    if (seen.has(current)) throw new Error("Profile data must be acyclic JSON data");
    seen.add(current);
    if (Array.isArray(current)) pending.push(...current);
    else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null)
        throw new Error("Profile data must use plain JSON objects");
      pending.push(...Object.values(current));
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableSnapshot<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export function validateProfileData(value: unknown): ExecutionDetails["profileData"] | undefined {
  if (value === undefined) return undefined;
  assertJsonValue(value);
  if (!Value.Check(JsonValueSchema, value)) throw new Error("Profile data must be JSON data");
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROFILE_DATA_BYTES)
    throw new Error(`Profile data exceeds ${MAX_PROFILE_DATA_BYTES} bytes`);
  return deepFreeze(JSON.parse(serialized) as ExecutionDetails["profileData"]);
}

function exactModel(value: string): { provider: string; id: string } {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1)
    throw new Error("Model must use provider/model format");
  return { provider: value.slice(0, separator), id: value.slice(separator + 1) };
}

function assistantBatchToolNames(
  context: ExtensionContext,
  toolCallId: string,
): string[] | undefined {
  const entries = context.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
    const calls = entry.message.content.flatMap((part) => (part.type === "toolCall" ? [part] : []));
    if (calls.some((call) => call.id === toolCallId)) return calls.map((call) => call.name);
  }
  return undefined;
}

function boundedExecutionFact(value: string): string {
  const characters = Array.from(value).slice(0, MAX_EXECUTION_FACT_CHARACTERS).join("");
  return truncateUtf8(characters, MAX_EXECUTION_FACT_BYTES);
}

function boundedExecutionIdentity(
  profileId: string,
  cwd: string,
  model: ConcreteModel,
): Pick<ExecutionDetails, "profileId" | "cwd" | "model"> {
  return {
    profileId: boundedExecutionFact(profileId),
    cwd: boundedExecutionFact(cwd),
    model: {
      ...model,
      provider: boundedExecutionFact(model.provider),
      id: boundedExecutionFact(model.id),
    },
  };
}

function initialExecution(prompt: string): NonNullable<ExecutionDetails["execution"]> {
  return immutableSnapshot({
    prompt: truncateUtf8(prompt),
    activity: [],
    omittedActivity: 0,
    elapsedMs: 0,
    turns: 0,
  });
}

function detailsFromOutcome(
  profileId: string,
  cwd: string,
  model: ConcreteModel,
  thinkingLevel: ThinkingLevel,
  outcome: ExecutionOutcome,
  extra: { queuePosition?: number; profileData?: ExecutionDetails["profileData"] } = {},
): ExecutionDetails {
  return {
    ...boundedExecutionIdentity(profileId, cwd, model),
    state: outcome.state,
    thinkingLevel,
    retryActive: outcome.retryActive,
    retries: outcome.retries,
    activity: outcome.activity,
    omittedActivity: outcome.omittedActivity,
    usage: outcome.usage,
    ...(outcome.execution === undefined ? {} : { execution: outcome.execution }),
    ...(extra.queuePosition === undefined ? {} : { queuePosition: extra.queuePosition }),
    ...(outcome.report === undefined ? {} : { report: outcome.report }),
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
    ...(extra.profileData === undefined ? {} : { profileData: extra.profileData }),
  };
}

export interface ToolkitDependencies {
  runner?: Pick<SubprocessRunner, "run" | "shutdown">;
  /** Internal local-composition and test seam; runtime consumers use the event bus. */
  profiles?: ProfileDefinition[];
}

export function createSubagentToolkit(
  pi: ExtensionAPI,
  dependencies: ToolkitDependencies = {},
): void {
  const defaultProfile: ProfileDefinition<typeof DEFAULT_PARAMETERS> = {
    id: "default",
    toolName: "subagent",
    label: "Subagent",
    description: "Delegate a focused task to a fresh Pi subprocess.",
    parameters: DEFAULT_PARAMETERS,
    profileDataSchema: Type.Object({}, { additionalProperties: false }),
    concurrency: 1,
    exclusiveParentBatch: true,
    selectModel({ args, parent }) {
      return args.model ? { ...exactModel(args.model), thinkingLevels: ["off"] } : parent.model;
    },
    selectThinkingLevel({ args, parent }) {
      return args.thinkingLevel ?? parent.thinkingLevel;
    },
    prepare({ args, parent }) {
      return {
        cwd: parent.cwd,
        systemPrompt:
          "You are a focused subagent. Complete only the supplied task and return a concise report.",
        prompt: args.task,
        toolPolicy: { mode: "inherit", deny: [] },
      };
    },
  };
  const registry = new ProfileRegistry(defaultProfile);
  if (dependencies.profiles?.length)
    registry.register({
      registrationId: "pi-tools:local-composition",
      profiles: dependencies.profiles,
      suppressDefault: true,
    });

  // The bus is deliberately the only runtime bridge: package types never imply a shared module root.
  const register = (batch: ProfileRegistration): ProfileRegistrationReceipt =>
    registry.collect(batch);
  const events = pi.events;
  const capability = (correlationId?: string) => ({
    protocolVersion: SUBAGENT_PROFILE_PROTOCOL_VERSION,
    ...(correlationId === undefined ? {} : { correlationId }),
    register,
  });
  const unsubscribeRequests = events?.on(SUBAGENT_PROFILE_REQUEST_EVENT, (data) => {
    const request = data as Partial<ProfileCapabilityRequest>;
    if (
      request.protocolVersion !== SUBAGENT_PROFILE_PROTOCOL_VERSION ||
      typeof request.correlationId !== "string" ||
      !request.correlationId
    )
      return;
    events.emit(SUBAGENT_PROFILE_CAPABILITY_EVENT, capability(request.correlationId));
  });
  // A consumer that loaded first receives this announcement; one that loads later requests a
  // correlated replay. A stable registrationId makes handling both deliveries idempotent.
  events?.emit(SUBAGENT_PROFILE_CAPABILITY_EVENT, capability());

  // Child instances collect profile names through the same handshake, then remove every discovered
  // name from the active set without finalizing or exposing delegation tools.
  if (process.env[CHILD_MARKER] === "1") {
    pi.on("session_start", () => {
      const denied = registry.profileTools();
      pi.setActiveTools(pi.getActiveTools().filter((name) => !denied.has(name)));
    });
    pi.on("session_shutdown", () => {
      unsubscribeRequests?.();
    });
    return;
  }

  const toolSummaryRegistry = new ToolSummaryRegistry();
  const toolSummaryCapability = (correlationId?: string) => ({
    protocolVersion: SUBAGENT_TOOL_SUMMARY_PROTOCOL_VERSION,
    ...(correlationId === undefined ? {} : { correlationId }),
    register: (batch: ToolSummaryRegistration): ToolSummaryRegistrationReceipt =>
      toolSummaryRegistry.collect(batch),
  });
  const unsubscribeSummaryRequests = events?.on(SUBAGENT_TOOL_SUMMARY_REQUEST_EVENT, (data) => {
    const request = data as Partial<ToolSummaryCapabilityRequest>;
    if (
      request.protocolVersion === SUBAGENT_TOOL_SUMMARY_PROTOCOL_VERSION &&
      typeof request.correlationId === "string" &&
      request.correlationId
    )
      events.emit(
        SUBAGENT_TOOL_SUMMARY_CAPABILITY_EVENT,
        toolSummaryCapability(request.correlationId),
      );
  });
  events?.emit(SUBAGENT_TOOL_SUMMARY_CAPABILITY_EVENT, toolSummaryCapability());

  const scheduler = new ProfileScheduler();
  const runner = dependencies.runner ?? new SubprocessRunner();

  const executeProfile = async (
    profile: ProfileDefinition,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate:
      | ((result: {
          content: Array<{ type: "text"; text: string }>;
          details: ExecutionDetails;
        }) => void)
      | undefined,
    ctx: Parameters<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>[4],
  ) => {
    const parentRuntimeModel = ctx.model;
    const parentFallback: ConcreteModel = {
      provider: parentRuntimeModel?.provider ?? "unknown",
      id: parentRuntimeModel?.id ?? "unknown",
      thinkingLevels: ["off"],
    };
    let selectedModel = parentFallback;
    let thinkingLevel = (ctx.thinkingLevel ?? "off") as ThinkingLevel;
    let cwd = ctx.cwd;
    let preparedExecution: ExecutionDetails["execution"];

    const failureResult = (error: unknown, outcome?: ExecutionOutcome) => {
      const failure = truncateUtf8(error instanceof Error ? error.message : String(error));
      const details: ExecutionDetails = outcome
        ? detailsFromOutcome(profile.id, cwd, selectedModel, thinkingLevel, {
            ...outcome,
            state: signal?.aborted ? "cancelled" : "failed",
            failure,
          })
        : {
            ...boundedExecutionIdentity(profile.id, cwd, selectedModel),
            state: signal?.aborted ? "cancelled" : "failed",
            thinkingLevel,
            retryActive: false,
            retries: 0,
            activity: [],
            omittedActivity: 0,
            usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
            failure,
            ...(preparedExecution === undefined ? {} : { execution: preparedExecution }),
          };
      return {
        content: [{ type: "text" as const, text: failure }],
        details,
        ...(outcome === undefined ? {} : { usage: outcome.usage }),
      };
    };

    try {
      if (!Value.Check(profile.parameters, params))
        throw new Error(`Invalid ${profile.toolName} arguments`);
      if (!parentRuntimeModel) throw new Error("No active parent model");
      const parentLevels = getSupportedThinkingLevels(parentRuntimeModel) as ThinkingLevel[];
      const parent = {
        cwd: ctx.cwd,
        activeTools: pi.getActiveTools(),
        model: {
          provider: parentRuntimeModel.provider,
          id: parentRuntimeModel.id,
          thinkingLevels: parentLevels,
        },
        thinkingLevel: (ctx.thinkingLevel ?? "off") as ThinkingLevel,
        trusted: ctx.isProjectTrusted(),
      };
      const profileContext = {
        args: params,
        parent,
        signal: signal ?? new AbortController().signal,
      };
      const selection = await profile.selectModel(profileContext);
      if (!Value.Check(ConcreteModelSchema, selection))
        throw new Error("Profile selected an invalid model");
      const runtimeModel = ctx.modelRegistry.find(selection.provider, selection.id);
      if (!runtimeModel) throw new Error(`Unknown model: ${selection.provider}/${selection.id}`);
      selectedModel = {
        provider: runtimeModel.provider,
        id: runtimeModel.id,
        thinkingLevels: getSupportedThinkingLevels(runtimeModel) as ThinkingLevel[],
      };
      const requestedThinking =
        profile.selectThinkingLevel?.(profileContext) ?? parent.thinkingLevel;
      if (!THINKING_LEVELS.includes(requestedThinking as ThinkingLevel))
        throw new Error("Profile selected an invalid thinking level");
      thinkingLevel = clampThinkingLevel(runtimeModel, requestedThinking) as ThinkingLevel;
      const prepared = await profile.prepare(profileContext);
      if (!Value.Check(PreparedRunSchema, prepared))
        throw new Error("Profile prepared an invalid run");
      cwd = prepared.cwd;
      const execution = initialExecution(prepared.prompt);
      preparedExecution = execution;
      const tools = resolveTools(prepared.toolPolicy, parent.activeTools, registry.profileTools());

      return await scheduler.run(
        profile.id,
        profile.concurrency ?? 1,
        signal,
        async () => {
          let state: unknown;
          let outcome: ExecutionOutcome | undefined;
          try {
            state = await profile.beforeRun?.(profileContext);
            outcome = immutableSnapshot(
              await runner.run({
                prepared,
                model: selectedModel,
                thinkingLevel,
                tools,
                parentCwd: parent.cwd,
                parentTrusted: parent.trusted,
                ...(signal === undefined ? {} : { signal }),
                summarizeTool: (toolName, args) =>
                  summarizeBuiltinTool(toolName, args) ??
                  toolSummaryRegistry.resolve(toolName, args),
                onUpdate: (update) => {
                  const details = detailsFromOutcome(
                    profile.id,
                    prepared.cwd,
                    selectedModel,
                    thinkingLevel,
                    immutableSnapshot(update),
                  );
                  onUpdate?.({
                    content: [{ type: "text", text: update.report ?? "Running..." }],
                    details,
                  });
                },
              }),
            );
            let report = outcome.report;
            let policyFailure: string | undefined;
            let data: ExecutionDetails["profileData"];
            if (profile.afterRun) {
              const postRun = await profile.afterRun(outcome, state);
              if (postRun !== undefined) {
                if (!Value.Check(PostRunResultSchema, postRun))
                  throw new Error("Profile returned an invalid post-run result");
                if (
                  postRun.profileData !== undefined &&
                  !Value.Check(profile.profileDataSchema, postRun.profileData)
                )
                  throw new Error("Profile returned data that does not match its schema");
                report = postRun.report === undefined ? report : truncateUtf8(postRun.report);
                policyFailure =
                  postRun.failure === undefined ? undefined : truncateUtf8(postRun.failure);
                data = validateProfileData(postRun.profileData);
              }
            }
            const cancelled = outcome.state === "cancelled" || signal?.aborted === true;
            const finalOutcome = {
              ...outcome,
              ...(report === undefined ? {} : { report }),
              ...(cancelled
                ? { state: "cancelled" as const }
                : policyFailure === undefined
                  ? {}
                  : { state: "failed" as const, failure: policyFailure }),
            };
            const details = detailsFromOutcome(
              profile.id,
              prepared.cwd,
              selectedModel,
              thinkingLevel,
              finalOutcome,
              { ...(data === undefined ? {} : { profileData: data }) },
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: finalOutcome.failure ?? report ?? "Subagent completed.",
                },
              ],
              details,
              usage: outcome.usage,
            };
          } catch (error) {
            return failureResult(error, outcome);
          }
        },
        (queuePosition) => {
          const details: ExecutionDetails = {
            ...boundedExecutionIdentity(profile.id, prepared.cwd, selectedModel),
            state: "queued",
            thinkingLevel,
            queuePosition,
            retryActive: false,
            retries: 0,
            activity: [],
            omittedActivity: 0,
            usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
            execution,
          };
          onUpdate?.({ content: [{ type: "text", text: `Queued (${queuePosition})` }], details });
        },
      );
    } catch (error) {
      return failureResult(error);
    }
  };

  let exclusiveTools = new Set<string>();
  pi.on("session_start", (_event, ctx) => {
    // This is the only registration point: Pi's complete configured tool snapshot makes
    // collision decisions deterministic for the session, including inactive tools.
    const summaryTransitions = toolSummaryRegistry.finalize();
    for (const result of summaryTransitions)
      events?.emit(SUBAGENT_TOOL_SUMMARY_REGISTRATION_RESULT_EVENT, result);
    const finalization = registry.finalize(pi.getAllTools().map((tool) => tool.name));
    for (const profile of finalization.profiles) {
      pi.registerTool({
        name: profile.toolName,
        label: profile.label,
        description: profile.description,
        ...(profile.promptSnippet === undefined ? {} : { promptSnippet: profile.promptSnippet }),
        ...(profile.promptGuidelines === undefined
          ? {}
          : { promptGuidelines: profile.promptGuidelines }),
        parameters: profile.parameters,
        execute: async (_id, params, signal, onUpdate, toolContext) =>
          executeProfile(profile, params, signal, onUpdate, toolContext),
        renderResult: (result, options, theme) =>
          renderExecution(
            Value.Check(ExecutionDetailsSchema, result.details) ? result.details : undefined,
            options.expanded,
            theme,
          ),
      });
    }
    exclusiveTools = new Set(
      finalization.profiles
        .filter((profile) => profile.exclusiveParentBatch)
        .map((profile) => profile.toolName),
    );
    for (const result of finalization.transitions)
      events?.emit(SUBAGENT_PROFILE_REGISTRATION_RESULT_EVENT, result);
    // Keep ctx referenced so Pi's event contract remains explicit at this lifecycle boundary.
    void ctx;
  });
  pi.on("tool_call", (event, ctx) => {
    try {
      const batch = assistantBatchToolNames(ctx, event.toolCallId);
      if (batch === undefined && exclusiveTools.has(event.toolName))
        return {
          block: true,
          reason: "Cannot verify this exclusive subagent call is alone; retry this tool alone",
        };
      scheduler.validateExclusiveSiblingBatch(batch ?? [], exclusiveTools);
      return;
    } catch (error) {
      return { block: true, reason: error instanceof Error ? error.message : String(error) };
    }
  });
  pi.on("tool_result", (event) => {
    if (!registry.profileTools().has(event.toolName)) return;
    if (!Value.Check(ExecutionDetailsSchema, event.details)) return;
    if (event.details.state === "failed" || event.details.state === "cancelled")
      return { isError: true };
  });
  pi.on("session_shutdown", async () => {
    unsubscribeRequests?.();
    unsubscribeSummaryRequests?.();
    scheduler.shutdown();
    await runner.shutdown();
  });
}

export default function subagentToolkit(pi: ExtensionAPI): void {
  createSubagentToolkit(pi);
}
