import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  CHILD_MARKER,
  type ConcreteModel,
  ConcreteModelSchema,
  type ExecutionDetails,
  ExecutionDetailsSchema,
  MAX_PROFILE_DATA_BYTES,
  type ProfileDefinition,
  type ProfileRegistration,
  SUBAGENT_CAPABILITY,
  SUBAGENT_PROTOCOL_VERSION,
  type ThinkingLevel,
} from "./api.js";
import { ProfileRegistry } from "./profile-registry.js";
import { renderExecution } from "./rendering.js";
import { SubprocessRunner } from "./runner.js";
import { ProfileScheduler } from "./scheduler.js";
import { resolveTools } from "./tool-policy.js";

export type {
  ConcreteModel,
  ExecutionDetails,
  ExecutionOutcome,
  JsonValue,
  ProfileDefinition,
  ProfileRegistration,
  ThinkingLevel,
  ToolPolicy,
} from "./api.js";
export type { RunnerDependencies, RunRequest } from "./runner.js";

const DEFAULT_PARAMETERS = Type.Object({
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
});

function clampThinking(model: ConcreteModel, requested: ThinkingLevel): ThinkingLevel {
  return model.thinkingLevels.includes(requested)
    ? requested
    : ((model.thinkingLevels[0] as ThinkingLevel | undefined) ?? "off");
}

function profileData(value: unknown): ExecutionDetails["profileData"] | undefined {
  if (value === undefined || !Value.Check(ExecutionDetailsSchema.properties.profileData, value))
    return undefined;
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_PROFILE_DATA_BYTES
    ? value
    : undefined;
}

export default function subagentToolkit(pi: ExtensionAPI): void {
  const defaultProfile: ProfileDefinition<typeof DEFAULT_PARAMETERS> = {
    id: "default",
    toolName: "subagent",
    label: "Subagent",
    description: "Delegate a focused task to a fresh Pi subprocess.",
    parameters: DEFAULT_PARAMETERS,
    concurrency: 1,
    exclusiveParentBatch: true,
    selectModel({ args, parent }) {
      if (!args.model) return parent.model;
      const [provider, ...parts] = args.model.split("/");
      if (!provider || parts.length === 0) throw new Error("Model must use provider/model format");
      return { ...parent.model, provider, id: parts.join("/") } as ConcreteModel;
    },
    selectThinkingLevel({ args, parent }) {
      return args.thinkingLevel ?? parent.thinkingLevel;
    },
    prepare({ args, parent }) {
      return { cwd: parent.cwd, prompt: args.task, toolPolicy: { mode: "inherit", deny: [] } };
    },
  };
  const registry = new ProfileRegistry(defaultProfile);
  const scheduler = new ProfileScheduler();
  const runner = new SubprocessRunner();
  const register = (batch: ProfileRegistration): void => registry.register(batch);
  pi.events.on(`${SUBAGENT_CAPABILITY}:request`, () => ({
    version: SUBAGENT_PROTOCOL_VERSION,
    register,
  }));
  pi.events.emit(`${SUBAGENT_CAPABILITY}:available`, {
    version: SUBAGENT_PROTOCOL_VERSION,
    register,
  });

  if (process.env[CHILD_MARKER] === "1") return;

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
    if (!Value.Check(profile.parameters, params))
      throw new Error(`Invalid ${profile.toolName} arguments`);
    const parentModel = ctx.model;
    if (!parentModel) throw new Error("No active parent model");
    const parent = {
      cwd: ctx.cwd,
      activeTools: pi.getActiveTools(),
      model: {
        provider: parentModel.provider,
        id: parentModel.id,
        thinkingLevels: ["off", "minimal", "low", "medium", "high"] as ThinkingLevel[],
      },
      thinkingLevel: ctx.thinkingLevel ?? ("off" as ThinkingLevel),
      trusted: ctx.isProjectTrusted(),
    };
    const profileContext = { args: params, parent, signal: signal ?? new AbortController().signal };
    return scheduler.run(profile.id, profile.concurrency ?? 1, signal, async () => {
      const model = profile.selectModel(profileContext);
      if (!Value.Check(ConcreteModelSchema, model))
        throw new Error("Profile selected an invalid model");
      const thinking = clampThinking(
        model,
        profile.selectThinkingLevel?.(profileContext) ?? parent.thinkingLevel,
      );
      const prepared = await profile.prepare(profileContext);
      const tools = resolveTools(prepared.toolPolicy, parent.activeTools, registry.profileTools());
      let state: unknown;
      try {
        state = await profile.beforeRun?.(profileContext);
        const outcome = await runner.run({
          prepared,
          model,
          thinkingLevel: thinking,
          tools,
          parentCwd: parent.cwd,
          parentTrusted: parent.trusted,
          ...(signal === undefined ? {} : { signal }),
          onUpdate: () => undefined,
        });
        const data = profile.afterRun
          ? profileData(await profile.afterRun(outcome, state))
          : undefined;
        const details: ExecutionDetails = {
          profileId: profile.id,
          cwd: prepared.cwd,
          model,
          thinkingLevel: thinking,
          outcome: outcome.state,
          ...(outcome.report ? { report: outcome.report } : {}),
          ...(outcome.failure ? { failure: outcome.failure } : {}),
          ...(data === undefined ? {} : { profileData: data }),
        };
        onUpdate?.({ content: [{ type: "text", text: outcome.report ?? "Running…" }], details });
        return {
          content: [
            {
              type: "text" as const,
              text: outcome.report ?? outcome.failure ?? "Subagent completed.",
            },
          ],
          details,
        };
      } catch (error) {
        const details: ExecutionDetails = {
          profileId: profile.id,
          cwd: parent.cwd,
          model,
          thinkingLevel: thinking,
          outcome: "failed",
          failure: error instanceof Error ? error.message : String(error),
        };
        return {
          content: [{ type: "text" as const, text: details.failure ?? "Subagent failed" }],
          details,
        };
      }
    });
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
        renderExecution(result.details as ExecutionDetails | undefined, options.expanded, theme),
    });
  }
  pi.on("tool_call", (event) =>
    scheduler.validateExclusiveSiblingBatch(
      [event.toolName],
      new Set(
        registry
          .profiles()
          .filter((profile) => profile.exclusiveParentBatch)
          .map((profile) => profile.toolName),
      ),
    ),
  );
  pi.on("session_shutdown", () => {
    scheduler.shutdown();
    runner.shutdown();
  });
}
