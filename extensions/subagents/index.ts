import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
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
  MAX_PROFILE_DATA_BYTES,
  PostRunResultSchema,
  PreparedRunSchema,
  type ProfileDefinition,
  type ThinkingLevel,
} from "./api.js";
import { ProfileRegistry } from "./profile-registry.js";
import { renderExecution } from "./rendering.js";
import { SubprocessRunner, truncateUtf8 } from "./runner.js";
import { ProfileScheduler } from "./scheduler.js";
import { resolveTools } from "./tool-policy.js";

export type {
  ConcreteModel,
  ExecutionDetails,
  ExecutionOutcome,
  JsonValue,
  PostRunResult,
  ProfileDefinition,
  ProfileRegistration,
  ThinkingLevel,
  ToolPolicy,
} from "./api.js";
export type { RunnerDependencies, RunRequest } from "./runner.js";

const DEFAULT_PARAMETERS = Type.Object(
  {
    task: Type.String({ minLength: 1, description: "Focused task for a fresh subagent." }),
    model: Type.Optional(Type.String({ description: "Exact provider/model selection." })),
    thinkingLevel: Type.Optional(
      Type.Union([
        Type.Literal("off"),
        Type.Literal("minimal"),
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("xhigh"),
        Type.Literal("max"),
      ]),
    ),
  },
  { additionalProperties: false },
);

const EMPTY_USAGE: ExecutionUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
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

export function validateProfileData(value: unknown): ExecutionDetails["profileData"] | undefined {
  if (value === undefined) return undefined;
  assertJsonValue(value);
  if (!Value.Check(JsonValueSchema, value)) throw new Error("Profile data must be JSON data");
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROFILE_DATA_BYTES)
    throw new Error(`Profile data exceeds ${MAX_PROFILE_DATA_BYTES} bytes`);
  return value;
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
  fallback: string,
): string[] {
  const entries = context.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
    const calls = entry.message.content.flatMap((part) => (part.type === "toolCall" ? [part] : []));
    if (calls.some((call) => call.id === toolCallId)) return calls.map((call) => call.name);
  }
  return [fallback];
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
    profileId,
    state: outcome.state,
    cwd,
    model,
    thinkingLevel,
    retryActive: outcome.retryActive,
    retries: outcome.retries,
    activity: outcome.activity,
    omittedActivity: outcome.omittedActivity,
    usage: outcome.usage,
    ...(extra.queuePosition === undefined ? {} : { queuePosition: extra.queuePosition }),
    ...(outcome.report === undefined ? {} : { report: outcome.report }),
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
    ...(extra.profileData === undefined ? {} : { profileData: extra.profileData }),
  };
}

export interface ToolkitDependencies {
  runner?: Pick<SubprocessRunner, "run" | "shutdown">;
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

  // Child instances load providers and other extensions normally, but never expose toolkit tools.
  if (process.env[CHILD_MARKER] === "1") return;

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

    const failureResult = (error: unknown) => {
      const failure = truncateUtf8(error instanceof Error ? error.message : String(error));
      const details: ExecutionDetails = {
        profileId: profile.id,
        state: signal?.aborted ? "cancelled" : "failed",
        cwd,
        model: selectedModel,
        thinkingLevel,
        retryActive: false,
        retries: 0,
        activity: [],
        omittedActivity: 0,
        usage: { ...EMPTY_USAGE },
        failure,
      };
      return { content: [{ type: "text" as const, text: failure }], details };
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
      const selection = profile.selectModel(profileContext);
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
      thinkingLevel = clampThinkingLevel(runtimeModel, requestedThinking) as ThinkingLevel;
      const prepared = await profile.prepare(profileContext);
      if (!Value.Check(PreparedRunSchema, prepared))
        throw new Error("Profile prepared an invalid run");
      cwd = prepared.cwd;
      const tools = resolveTools(prepared.toolPolicy, parent.activeTools, registry.profileTools());

      return await scheduler.run(
        profile.id,
        profile.concurrency ?? 1,
        signal,
        async () => {
          let state: unknown;
          try {
            state = await profile.beforeRun?.(profileContext);
            const outcome = await runner.run({
              prepared,
              model: selectedModel,
              thinkingLevel,
              tools,
              parentCwd: parent.cwd,
              parentTrusted: parent.trusted,
              ...(signal === undefined ? {} : { signal }),
              onUpdate: (update) => {
                const details = detailsFromOutcome(
                  profile.id,
                  prepared.cwd,
                  selectedModel,
                  thinkingLevel,
                  update,
                );
                onUpdate?.({
                  content: [{ type: "text", text: update.report ?? "Running..." }],
                  details,
                });
              },
            });
            let report = outcome.report;
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
                data = validateProfileData(postRun.profileData);
              }
            }
            const finalOutcome = { ...outcome, ...(report === undefined ? {} : { report }) };
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
                  text: report ?? outcome.failure ?? "Subagent completed.",
                },
              ],
              details,
            };
          } catch (error) {
            return failureResult(error);
          }
        },
        (queuePosition) => {
          const details: ExecutionDetails = {
            profileId: profile.id,
            state: "queued",
            cwd: prepared.cwd,
            model: selectedModel,
            thinkingLevel,
            queuePosition,
            retryActive: false,
            retries: 0,
            activity: [],
            omittedActivity: 0,
            usage: { ...EMPTY_USAGE },
          };
          onUpdate?.({ content: [{ type: "text", text: `Queued (${queuePosition})` }], details });
        },
      );
    } catch (error) {
      return failureResult(error);
    }
  };

  for (const profile of registry.profiles()) {
    pi.registerTool({
      name: profile.toolName,
      label: profile.label,
      description: profile.description,
      parameters: profile.parameters,
      execute: async (_id, params, signal, onUpdate, ctx) =>
        executeProfile(profile, params, signal, onUpdate, ctx),
      renderResult: (result, options, theme) =>
        renderExecution(
          Value.Check(ExecutionDetailsSchema, result.details) ? result.details : undefined,
          options.expanded,
          theme,
        ),
    });
  }

  const exclusiveTools = new Set(
    registry
      .profiles()
      .filter((profile) => profile.exclusiveParentBatch)
      .map((profile) => profile.toolName),
  );
  pi.on("tool_call", (event, ctx) => {
    try {
      scheduler.validateExclusiveSiblingBatch(
        assistantBatchToolNames(ctx, event.toolCallId, event.toolName),
        exclusiveTools,
      );
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
    scheduler.shutdown();
    await runner.shutdown();
  });
}

export default function subagentToolkit(pi: ExtensionAPI): void {
  createSubagentToolkit(pi);
}
