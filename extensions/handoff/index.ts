import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  HANDOFF_CONTINUITY_ENTRY,
  HANDOFF_CONTINUITY_REQUEST,
  type HandoffContinuity,
} from "../handoff-continuity.js";

const COMMAND = "handoff-session-continue";
const TOOL = "handoff_session";
const MAX_KICKOFF_BYTES = 16 * 1024;

interface PendingHandoff {
  id: string;
  kickoff: string;
}

export interface HandoffDependencies {
  randomUUID(): string;
}

export function handoffEnvelope(kickoff: string): string {
  return `Handoff context from the previous session; this is not user input:\n\n${kickoff}`;
}

function toolCallsInCurrentBatch(context: ExtensionContext, event: ToolCallEvent) {
  const leaf = context.sessionManager.getLeafEntry();
  const content =
    leaf?.type === "message" &&
    leaf.message.role === "assistant" &&
    Array.isArray(leaf.message.content)
      ? leaf.message.content
      : [];
  const calls = content.filter((part) => part.type === "toolCall");
  return {
    calls,
    correlated: calls.some((call) => call.id === event.toolCallId && call.name === event.toolName),
  };
}

export function registerHandoff(pi: ExtensionAPI, dependencies: HandoffDependencies): void {
  let pending: PendingHandoff | undefined;
  let suppressThresholdCompaction = false;
  let ownsTool = false;
  let registered = false;

  pi.on("tool_call", (event, context) => {
    if (!ownsTool) return;
    const { calls, correlated } = toolCallsInCurrentBatch(context, event);
    if (!correlated)
      return event.toolName === TOOL
        ? {
            block: true,
            reason: "Cannot verify the current tool batch; retry handoff_session alone.",
          }
        : undefined;
    if (calls.length > 1 && calls.some((call) => call.name === TOOL))
      return {
        block: true,
        reason:
          "A batch containing handoff_session cannot contain siblings; retry handoff_session alone.",
      };
  });

  pi.on("session_before_compact", (event) => {
    if (suppressThresholdCompaction && pending && event.reason === "threshold") {
      suppressThresholdCompaction = false;
      return { cancel: true };
    }
  });

  pi.on("session_shutdown", () => {
    pending = undefined;
    suppressThresholdCompaction = false;
    ownsTool = false;
  });

  const queueHandoff = (request: PendingHandoff): void => {
    pi.queueCommand(COMMAND, request.id);
    suppressThresholdCompaction = true;
  };

  pi.on("session_start", (_event, sessionContext) => {
    if (registered || !sessionContext.sessionManager.getSessionFile()) return;
    if (pi.getAllTools().some((tool) => tool.name === TOOL)) return;
    registered = true;

    pi.registerCommand(COMMAND, {
      description: "Continue a fresh-session handoff.",
      async handler(token, context) {
        const request = pending;
        if (!request || token !== request.id) return;
        const envelope = handoffEnvelope(request.kickoff);
        try {
          if (pending !== request) return;
          const parentSession = context.sessionManager.getSessionFile();
          if (!parentSession) throw new Error("The active session is no longer persisted");
          const continuity: HandoffContinuity = {};
          pi.events.emit(HANDOFF_CONTINUITY_REQUEST, continuity);
          const result = await context.newSession({
            parentSession,
            async setup(sessionManager) {
              sessionManager.appendCustomEntry(HANDOFF_CONTINUITY_ENTRY, continuity);
            },
            async withSession(replacement) {
              try {
                await replacement.sendMessage(
                  { customType: "session-handoff", content: envelope, display: true },
                  { triggerTurn: true },
                );
              } catch (deliveryError) {
                try {
                  replacement.ui.setEditorText(envelope);
                } catch {
                  throw deliveryError;
                }
                replacement.ui.notify(
                  "Automatic kickoff failed; submit the prepared editor text.",
                  "warning",
                );
              }
            },
          });
          if (result.cancelled) {
            context.ui.setEditorText(envelope);
            context.ui.notify(
              "Fresh-session handoff canceled; recovery text is in the editor.",
              "warning",
            );
          }
        } finally {
          if (pending?.id === request.id) pending = undefined;
          suppressThresholdCompaction = false;
        }
      },
    });

    ownsTool = true;
    pi.registerTool({
      name: TOOL,
      label: "Fresh Session Handoff",
      description:
        "Continue work immediately in a fresh parent-linked Pi session. Call this tool alone, without sibling tool calls, from a persisted TUI or RPC session. Provide a nonempty self-contained kickoff of at most 16 KiB of UTF-8 data containing the objective, current state, next action, and the continuity the replacement needs.",
      parameters: Type.Object({ kickoff: Type.String() }, { additionalProperties: false }),
      async execute(_id, params, _signal, _update, context) {
        if (
          (context.mode !== "tui" && context.mode !== "rpc") ||
          !context.sessionManager.getSessionFile()
        )
          throw new Error("handoff_session requires a persisted Pi session");
        if (pending) {
          queueHandoff(pending);
          return {
            content: [{ type: "text", text: "Fresh-session handoff already queued." }],
            details: {},
            terminate: true,
          };
        }
        if (!params.kickoff.trim()) throw new Error("kickoff must contain non-whitespace content");
        if (new TextEncoder().encode(params.kickoff).byteLength > MAX_KICKOFF_BYTES)
          throw new Error("kickoff must not exceed the 16 KiB UTF-8 limit");

        const request = { id: dependencies.randomUUID(), kickoff: params.kickoff };
        pending = request;
        try {
          queueHandoff(request);
        } catch (error) {
          if (pending === request) pending = undefined;
          suppressThresholdCompaction = false;
          throw error;
        }
        return {
          content: [{ type: "text", text: "Fresh-session handoff queued." }],
          details: {},
          terminate: true,
        };
      },
    });
  });
}

export default function handoffExtension(pi: ExtensionAPI): void {
  registerHandoff(pi, { randomUUID });
}
