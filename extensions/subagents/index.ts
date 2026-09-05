import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SubagentDetails } from "./activity.js";
import { renderExecution } from "./rendering.js";
import {
  CHILD_MARKER,
  type ExecutionUsage,
  type RunOutcome,
  type RunRequest,
  SubprocessRunner,
} from "./runner.js";

const ROLE_PUBLICATION_EVENT = "agentic-skills:roles";
const ROLE_REQUEST_EVENT = "agentic-skills:roles:request";
const GENERIC_TOOL = "subagent";
const HANDOFF_TOOL = "handoff_session";
const TASK_PARAMETERS = Type.Object(
  { task: Type.String({ minLength: 1, description: "Self-contained task for a fresh Pi child." }) },
  { additionalProperties: false },
);

interface AgenticRole {
  toolName: string;
  description: string;
  loadSystemPrompt(): Promise<string>;
}

interface ToolDetails {
  state: RunOutcome["state"];
  usage: ExecutionUsage;
}

type ToolUpdate = (result: {
  content: Array<{ type: "text"; text: string }>;
  details: SubagentDetails;
}) => void;

export interface SubagentDependencies {
  runner?: Pick<SubprocessRunner, "run" | "shutdown">;
}

function isAgenticRole(value: unknown): value is AgenticRole {
  if (!value || typeof value !== "object") return false;
  const role = value as Record<string, unknown>;
  return (
    typeof role.toolName === "string" &&
    role.toolName.length > 0 &&
    typeof role.description === "string" &&
    role.description.length > 0 &&
    typeof role.loadSystemPrompt === "function"
  );
}

function labelFromToolName(toolName: string): string {
  return toolName
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function resultText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) =>
      part && typeof part === "object" && (part as { type?: unknown }).type === "text"
        ? [String((part as { text?: unknown }).text ?? "")]
        : [],
    )
    .join("\n");
}

export function registerSubagents(pi: ExtensionAPI, dependencies: SubagentDependencies = {}): void {
  if (process.env[CHILD_MARKER] === "1") return;

  const runner = dependencies.runner ?? new SubprocessRunner();
  const roleToolNames = new Set<string>();
  const registeredRoleTools = new Set<string>();

  const execute = async (
    label: string,
    task: string,
    systemPrompt: string | undefined,
    signal: AbortSignal | undefined,
    onUpdate: ToolUpdate | undefined,
    context: Parameters<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>[4],
  ) => {
    if (!context.model) {
      const failure = "Subagent requires an active parent model.";
      const usage: ExecutionUsage = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      };
      const details: SubagentDetails = {
        label,
        state: "failed",
        model: { provider: "unknown", id: "unknown" },
        thinkingLevel: context.thinkingLevel ?? "off",
        usage,
        report: failure,
        failure,
      };
      return { content: [{ type: "text" as const, text: failure }], details };
    }
    const denied = new Set([GENERIC_TOOL, HANDOFF_TOOL, ...roleToolNames]);
    const request: RunRequest = {
      cwd: context.cwd,
      task,
      ...(systemPrompt === undefined ? {} : { systemPrompt }),
      model: { provider: context.model.provider, id: context.model.id },
      thinkingLevel: context.thinkingLevel ?? "off",
      tools: pi.getActiveTools().filter((name) => !denied.has(name)),
      approved: context.isProjectTrusted(),
      ...(signal === undefined ? {} : { signal }),
      onUpdate: (progress) => {
        const details: SubagentDetails = {
          label,
          state: progress.state,
          model: request.model,
          thinkingLevel: request.thinkingLevel,
          usage: progress.usage,
          execution: progress.execution,
        };
        onUpdate?.({ content: [{ type: "text", text: "Running..." }], details });
      },
    };
    const outcome = await runner.run(request);
    const details: SubagentDetails = {
      label,
      state: outcome.state,
      model: request.model,
      thinkingLevel: request.thinkingLevel,
      usage: outcome.usage,
      execution: outcome.execution,
      report: outcome.report,
      ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
    };
    return {
      content: [{ type: "text" as const, text: outcome.report }],
      details,
      usage: outcome.usage,
    };
  };

  pi.registerTool({
    name: GENERIC_TOOL,
    label: "Subagent",
    description:
      "Run one self-contained task in a fresh Pi child using the parent model, thinking level, working directory, trust state, and ordinary active tools. The child loads skills but not context files and cannot delegate or hand off.",
    parameters: TASK_PARAMETERS,
    execute: async (_id, params, signal, onUpdate, context) =>
      execute(GENERIC_TOOL, params.task, undefined, signal, onUpdate, context),
    renderResult: (result, options, theme) =>
      renderExecution(result.details, options.expanded, theme, resultText(result.content)),
  });

  const publishRoles = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    const roles = value.filter(isAgenticRole);
    for (const role of roles) roleToolNames.add(role.toolName);
    for (const role of roles) {
      if (registeredRoleTools.has(role.toolName)) continue;
      registeredRoleTools.add(role.toolName);
      pi.registerTool({
        name: role.toolName,
        label: labelFromToolName(role.toolName),
        description: role.description,
        parameters: TASK_PARAMETERS,
        execute: async (_id, params, signal, onUpdate, context) =>
          execute(
            role.toolName,
            params.task,
            await role.loadSystemPrompt(),
            signal,
            onUpdate,
            context,
          ),
        renderResult: (result, options, theme) =>
          renderExecution(result.details, options.expanded, theme, resultText(result.content)),
      });
    }
  };

  pi.events.on(ROLE_PUBLICATION_EVENT, publishRoles);
  pi.events.emit(ROLE_REQUEST_EVENT, undefined);

  pi.on("tool_result", (event) => {
    if (event.toolName !== GENERIC_TOOL && !registeredRoleTools.has(event.toolName)) return;
    const details = event.details as Partial<ToolDetails> | undefined;
    if (details?.state === "failed" || details?.state === "cancelled") return { isError: true };
  });
  pi.on("session_shutdown", async () => {
    await runner.shutdown();
  });
}

export default function subagentExtension(pi: ExtensionAPI): void {
  registerSubagents(pi);
}
