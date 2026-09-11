import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerContextOperation } from "../context-lifecycle.js";

export default function compactExtension(pi: ExtensionAPI): void {
  let continuationVersion = 0;
  let attempt: { instructions: string; signal: AbortSignal | undefined } | undefined;
  pi.on("agent_start", () => {
    continuationVersion++;
  });
  // Native prompt preflight can still be awaiting before agent_start/isIdle
  // reflects its run (notably the TUI queue flushed at compaction_end). Only
  // input reaching this observer is visible: Pi 0.85.1 awaits earlier input
  // hooks first, so an incoming prompt can still be hidden there.
  pi.on("input", () => {
    continuationVersion++;
  });
  // Unlike the settled agent signal, this is the native attempt's cancellation
  // signal. It also catches cancellation after the checkpoint was saved but
  // before onComplete (Pi still reports success at that late boundary).
  pi.on("session_before_compact", (event) => {
    if (
      attempt &&
      !attempt.signal &&
      event.reason === "manual" &&
      event.customInstructions === attempt.instructions
    )
      attempt.signal = event.signal;
  });
  pi.on("session_shutdown", () => {
    attempt = undefined;
  });
  registerContextOperation(pi, {
    tool: "compact_session",
    command: "compact-session-continue",
    field: "instructions",
    label: "Guided compaction",
    description:
      "Compact context using Pi's native summarizer in the same session and runtime, then continue. Call this tool alone, without sibling tool calls. Supply brief, nonblank instructions identifying what matters most to preserve from the conversation. Refer to relevant context rather than retelling it; restate only essential facts that need emphasis. Use concrete references rather than vague labels. Do not write a handoff or replacement summary, or start a separate kickoff, planning, alignment, or review cycle just to compact.",
    randomUUID,
    async run(instructions, context, current) {
      const startingVersion = continuationVersion;
      const nativeAttempt = { instructions, signal: undefined as AbortSignal | undefined };
      attempt = nativeAttempt;
      try {
        await new Promise<void>((resolve) => {
          context.compact({
            customInstructions: instructions,
            onComplete() {
              try {
                if (!current()) return;
                // session_compact is emitted before manual compaction clears its
                // state. Its hooks (including pi-subagents) can start a wake. The
                // callback runs after compact returns: arbitrate here, not in that
                // event, and remember even a wake that has already finished.
                const resume =
                  !nativeAttempt.signal?.aborted &&
                  continuationVersion === startingVersion &&
                  context.isIdle();
                // A native steer/follow-up queue can be dormant: manual compact
                // never drains it itself. Resume it when idle; do not mistake
                // queued input for an already scheduled/started continuation.
                const pendingMessages = context.hasPendingMessages();
                pi.sendMessage(
                  {
                    customType: "session-guided-compaction",
                    content: nativeAttempt.signal?.aborted
                      ? "Guided compaction completed, but automatic continuation was canceled. The saved native checkpoint was not rolled back."
                      : pendingMessages
                        ? "Guided compaction completed. Process the pending messages and continue the preserved objective as appropriate."
                        : "Guided compaction completed. Continue the preserved objective and next action from the compacted context.",
                    display: true,
                  },
                  { triggerTurn: resume },
                );
              } finally {
                resolve();
              }
            },
            onError(error) {
              try {
                if (!current()) return;
                // Pi currently exposes native errors, not a stable outcome enum
                // (including cancellation, already compacted, and too small).
                pi.sendMessage(
                  {
                    customType: "session-guided-compaction",
                    content: `Guided compaction did not complete: ${error.message}. No automatic retry was requested.`,
                    display: true,
                  },
                  { triggerTurn: false },
                );
                context.ui.notify(
                  `Guided compaction did not complete: ${error.message}`,
                  "warning",
                );
              } finally {
                resolve();
              }
            },
          });
        });
      } finally {
        if (attempt === nativeAttempt) attempt = undefined;
      }
    },
  });
}
