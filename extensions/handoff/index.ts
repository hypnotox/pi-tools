import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerContextOperation } from "../context-lifecycle.js";
import {
  HANDOFF_CONTINUITY_ENTRY,
  HANDOFF_CONTINUITY_REQUEST,
  type HandoffContinuity,
  type HandoffSessionContinuation,
} from "../handoff-continuity.js";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export interface HandoffDependencies {
  randomUUID(): string;
}

export function handoffEnvelope(kickoff: string): string {
  return `Handoff context from the previous session; this is not user input:\n\n${kickoff}`;
}

function isSessionContinuation(value: unknown): value is HandoffSessionContinuation {
  if (!value || typeof value !== "object") return false;
  const continuation = value as Record<string, unknown>;
  const model = continuation.model;
  return (
    !!model &&
    typeof model === "object" &&
    typeof (model as Record<string, unknown>).provider === "string" &&
    typeof (model as Record<string, unknown>).id === "string" &&
    typeof continuation.thinkingLevel === "string" &&
    THINKING_LEVELS.has(continuation.thinkingLevel)
  );
}

async function restoreSessionContinuation(
  pi: ExtensionAPI,
  context: ExtensionContext,
): Promise<void> {
  const entry = [...context.sessionManager.getEntries()]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === "custom" && candidate.customType === HANDOFF_CONTINUITY_ENTRY,
    );
  const continuity = entry && "data" in entry ? (entry.data as HandoffContinuity) : undefined;
  if (!isSessionContinuation(continuity?.session)) return;

  const { model: requestedModel, thinkingLevel } = continuity.session;
  const model = context.modelRegistry.find(requestedModel.provider, requestedModel.id);
  if (!model) {
    context.ui.notify(
      `Could not preserve handoff model ${requestedModel.provider}/${requestedModel.id}; using the session default.`,
      "warning",
    );
    return;
  }

  const alreadyActive =
    context.model?.provider === requestedModel.provider && context.model.id === requestedModel.id;
  if (!alreadyActive && !(await pi.setModel(model))) {
    context.ui.notify(
      `Could not authenticate handoff model ${requestedModel.provider}/${requestedModel.id}; using the session default.`,
      "warning",
    );
    return;
  }
  pi.setThinkingLevel(thinkingLevel);
}

export function registerHandoff(pi: ExtensionAPI, dependencies: HandoffDependencies): void {
  pi.on("session_start", async (event, context) => {
    if (event.reason === "new") await restoreSessionContinuation(pi, context);
  });
  registerContextOperation(pi, {
    tool: "handoff_session",
    command: "handoff-session-continue",
    field: "kickoff",
    label: "Fresh-session handoff",
    description:
      "Replace this session identity and runtime with a fresh parent-linked Pi session and continue immediately. The successor does not inherit conversation knowledge or session-bound resources. Call this tool alone, without sibling tool calls, from a persisted TUI or RPC session. Provide a nonempty self-contained kickoff of at most 16 KiB of UTF-8 data containing the objective, current state, next action, and the continuity the replacement needs.",
    randomUUID: dependencies.randomUUID,
    async run(kickoff, context) {
      const originatingSession = context.sessionManager.getSessionFile();
      if (!originatingSession) return;
      const envelope = handoffEnvelope(kickoff);
      const continuity: HandoffContinuity = context.model
        ? {
            session: {
              model: { provider: context.model.provider, id: context.model.id },
              thinkingLevel: context.thinkingLevel ?? "off",
            },
          }
        : {};
      pi.events.emit(HANDOFF_CONTINUITY_REQUEST, continuity);
      const result = await context.newSession({
        parentSession: originatingSession,
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
    },
  });
}

export default function handoffExtension(pi: ExtensionAPI): void {
  registerHandoff(pi, { randomUUID });
}
