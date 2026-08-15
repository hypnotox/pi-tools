import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { guardRuntime } from "../runtime-guard.js";

const COMMAND = "handoff-session-continue";
const TOOL = "handoff_session";
const MAX_KICKOFF_LENGTH = 1_000;
type QueueingAPI = ExtensionAPI & { queueCommand(name: string, args?: string): void };

export interface HandoffDependencies {
  randomUUID(): string;
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface PendingHandoff {
  id: string;
  kickoff: string;
}

export function handoffEnvelope(kickoff: string): string {
  return `Handoff context from the previous session; this is not user input:\n\n${kickoff}`;
}

function countdown(context: ExtensionCommandContext, deps: HandoffDependencies): Promise<boolean> {
  return context.ui.custom((tui, _theme, keybindings, done) => {
    let seconds = 5;
    let interval: unknown;
    let timeout: unknown;
    let finished = false;
    let cached: { width: number; lines: string[] } | undefined;
    const finish = (result: boolean): void => {
      if (finished) return;
      finished = true;
      if (interval !== undefined) deps.clearInterval(interval);
      if (timeout !== undefined) deps.clearTimeout(timeout);
      done(result);
    };
    const component = {
      render(width: number): string[] {
        const bounded = Math.max(1, width);
        if (!cached || cached.width !== bounded) {
          cached = {
            width: bounded,
            lines: [
              truncateToWidth(
                `Handoff to a fresh session in ${seconds}s - Esc/Ctrl+C to cancel`,
                bounded,
              ),
            ],
          };
        }
        return cached.lines;
      },
      invalidate(): void {
        cached = undefined;
        tui.requestRender();
      },
      handleInput(data: string): void {
        try {
          if (keybindings.matches(data, "tui.select.cancel")) finish(false);
        } catch (error) {
          finish(false);
          throw error;
        }
      },
      dispose(): void {
        if (interval !== undefined) deps.clearInterval(interval);
        if (timeout !== undefined) deps.clearTimeout(timeout);
      },
    };
    try {
      interval = deps.setInterval(() => {
        seconds = Math.max(1, seconds - 1);
        component.invalidate();
      }, 1_000);
      timeout = deps.setTimeout(() => finish(true), 5_000);
    } catch (error) {
      finish(false);
      throw error;
    }
    return component;
  });
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

export function registerHandoff(pi: ExtensionAPI, deps: HandoffDependencies): void {
  if (!guardRuntime(pi, ["on", "registerTool", "registerCommand", "queueCommand", "getAllTools"]))
    return;
  let pending: PendingHandoff | undefined;
  let suppressThresholdCompaction = false;
  let ownsTool = false;

  pi.on("tool_call", (event, context) => {
    if (!ownsTool) return undefined;
    const { calls, correlated } = toolCallsInCurrentBatch(context, event);
    if (!correlated)
      return event.toolName === TOOL
        ? {
            block: true,
            reason: "Cannot verify the current tool batch; retry handoff_session alone.",
          }
        : undefined;
    if (calls.length > 1 && calls.some((call) => call.name === TOOL)) {
      return {
        block: true,
        reason:
          "A batch containing handoff_session cannot contain siblings; retry handoff_session alone.",
      };
    }
    return undefined;
  });

  pi.on("session_before_compact", (event) => {
    if (suppressThresholdCompaction && pending && event.reason === "threshold") {
      suppressThresholdCompaction = false;
      return { cancel: true };
    }
    return undefined;
  });

  pi.on("session_shutdown", () => {
    pending = undefined;
    suppressThresholdCompaction = false;
    ownsTool = false;
  });

  const registerContinuationCommand = (): void => {
    pi.registerCommand(COMMAND, {
      description: "Continue a fresh-session handoff.",
      async handler(token, context) {
        const request = pending;
        if (!request || token !== request.id)
          throw new Error("No matching pending handoff request");
        const envelope = handoffEnvelope(request.kickoff);
        try {
          if (!(await countdown(context, deps))) {
            context.ui.notify("Fresh-session handoff canceled.");
            return;
          }
          if (pending !== request) throw new Error("No matching pending handoff request");
          const parentSession = context.sessionManager.getSessionFile();
          if (!parentSession) throw new Error("The active session is no longer persisted");
          const result = await context.newSession({
            parentSession,
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
                try {
                  replacement.ui.notify(
                    "Automatic kickoff failed; submit the prepared editor text.",
                    "warning",
                  );
                } catch {
                  // The prepared editor text remains available without a notification.
                }
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
  };

  pi.on("session_start", () => {
    if (pi.getAllTools().some((tool) => tool.name === TOOL)) return;
    registerContinuationCommand();
    ownsTool = true;
    pi.registerTool({
      name: TOOL,
      label: "Fresh Session Handoff",
      description: "Continue in a parent-linked fresh Pi TUI session.",
      parameters: Type.Object(
        { kickoff: Type.String({ maxLength: MAX_KICKOFF_LENGTH }) },
        { additionalProperties: false },
      ),
      async execute(_id, params, _signal, _update, context) {
        if (context.mode !== "tui" || !context.sessionManager.getSessionFile())
          throw new Error("handoff_session requires a persisted interactive Pi TUI session");
        if (!params.kickoff.trim()) throw new Error("kickoff must contain non-whitespace content");
        if (params.kickoff.length > MAX_KICKOFF_LENGTH)
          throw new Error("kickoff must not exceed 1000 UTF-16 code units");
        if (pending) throw new Error("A handoff request is already pending");

        const request: PendingHandoff = { id: deps.randomUUID(), kickoff: params.kickoff };
        pending = request;
        try {
          (pi as QueueingAPI).queueCommand(COMMAND, request.id);
          suppressThresholdCompaction = true;
        } catch (error) {
          if (pending === request) pending = undefined;
          suppressThresholdCompaction = false;
          throw error;
        }
        return {
          content: [{ type: "text", text: "Fresh-session handoff queued." }],
          details: { kickoff: request.kickoff },
          terminate: true,
        };
      },
    });
  });
}

export default function handoffExtension(pi: ExtensionAPI): void {
  registerHandoff(pi, { randomUUID, setInterval, clearInterval, setTimeout, clearTimeout });
}
