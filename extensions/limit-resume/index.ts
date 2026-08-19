import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  MessageStartEvent,
} from "@earendil-works/pi-coding-agent";
import { guardRuntime } from "../runtime-guard.js";
import {
  BLIND_RETRY_INTERVAL_MS,
  classifyLimitError,
  exhaustedWindowFromHeaders,
  nextAttempt,
  resetFromErrorMessage,
  waitingStatus,
} from "./limit-state.js";

const STATUS_KEY = "limit-resume";
const COMMAND = "limit-resume";
const CUSTOM_TYPE = "limit-resume";
const RESUME_CONTENT =
  "The provider usage limit has cleared. Continue the interrupted work from where it stopped.";

/** Pi does not re-export this event's type from its package root, so it is described structurally. */
interface ProviderResponseEvent {
  status: number;
  headers: Record<string, string>;
}

export interface LimitResumeDependencies {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemDependencies: LimitResumeDependencies = {
  now: () => Date.now(),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function isAssistantLimitStop(event: MessageEndEvent): string | undefined {
  const message = event.message as { role?: string; stopReason?: string; errorMessage?: string };
  if (message.role !== "assistant" || message.stopReason !== "error") return undefined;
  return classifyLimitError(message.errorMessage) === "resumable"
    ? (message.errorMessage ?? "")
    : undefined;
}

export function registerLimitResume(
  pi: ExtensionAPI,
  deps: LimitResumeDependencies = systemDependencies,
): void {
  if (!guardRuntime(pi, ["on", "registerCommand"])) return;

  /** Reset observed from provider headers, in epoch milliseconds. */
  let observedResetAt: number | undefined;
  /** Failure text of a limit stop awaiting settlement, so scheduling never races Pi's own retry. */
  let armedError: string | undefined;
  let timer: unknown;
  let attempts = 0;
  let disclosedDegraded = false;
  let latestContext: ExtensionContext | undefined;

  const clearTimer = (): void => {
    if (timer === undefined) return;
    deps.clearTimeout(timer);
    timer = undefined;
  };

  const clearWait = (): void => {
    clearTimer();
    armedError = undefined;
    attempts = 0;
    latestContext?.ui.setStatus(STATUS_KEY, undefined);
  };

  const dispatchResume = (): void => {
    timer = undefined;
    attempts += 1;
    latestContext?.ui.setStatus(STATUS_KEY, undefined);
    if (typeof pi.sendMessage !== "function") return;
    void Promise.resolve(
      pi.sendMessage(
        { customType: CUSTOM_TYPE, content: RESUME_CONTENT, display: true },
        { triggerTurn: true },
      ),
    ).catch(() => undefined);
  };

  const scheduleResume = (errorMessage: string, context: ExtensionContext): void => {
    clearTimer();
    const now = deps.now();
    const schedule = nextAttempt({
      now,
      observedResetAt: observedResetAt ?? resetFromErrorMessage(errorMessage, now),
    });
    context.ui.setStatus(STATUS_KEY, waitingStatus(schedule, attempts + 1));
    if (!schedule.known && !disclosedDegraded) {
      disclosedDegraded = true;
      context.ui.notify(
        `No reset time is available for this limit, so ${COMMAND} is retrying every ${BLIND_RETRY_INTERVAL_MS / 60_000} minutes instead of waiting for a known reset. Pi only exposes provider limit headers on the sse transport.`,
        "warning",
      );
    }
    timer = deps.setTimeout(dispatchResume, Math.max(0, schedule.attemptAt - now));
  };

  pi.on("after_provider_response", (event, context) => {
    latestContext = context;
    const { headers } = event as unknown as ProviderResponseEvent;
    const window = exhaustedWindowFromHeaders(headers ?? {});
    if (window) observedResetAt = window.resetAt;
  });

  pi.on("message_start", (event: MessageStartEvent, context) => {
    latestContext = context;
    // An operator message supersedes a pending resume; the extension's own resume is a custom role.
    if ((event.message as { role?: string }).role === "user") clearWait();
  });

  pi.on("message_end", (event: MessageEndEvent, context) => {
    latestContext = context;
    const errorMessage = isAssistantLimitStop(event);
    if (errorMessage !== undefined) {
      armedError = errorMessage;
      return;
    }
    if ((event.message as { role?: string }).role === "assistant") clearWait();
  });

  pi.on("agent_settled", (_event, context) => {
    latestContext = context;
    if (armedError === undefined) return;
    const errorMessage = armedError;
    armedError = undefined;
    scheduleResume(errorMessage, context);
  });

  pi.on("session_shutdown", () => {
    clearTimer();
  });

  pi.registerCommand(COMMAND, {
    description: "Cancel a pending automatic resume after a provider usage limit",
    handler: async (_args, context) => {
      latestContext = context;
      if (timer === undefined) {
        context.ui.notify("No automatic resume is pending.", "info");
        return;
      }
      clearWait();
      context.ui.notify("Cancelled the pending automatic resume.", "info");
    },
  });
}

export default function limitResumeExtension(pi: ExtensionAPI): void {
  registerLimitResume(pi);
}
