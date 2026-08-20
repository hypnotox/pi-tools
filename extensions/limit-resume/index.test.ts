import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createExtensionRecorder } from "pi-tools/testing";
import { describe, expect, it } from "vitest";
import { type LimitResumeDependencies, registerLimitResume } from "./index.js";
import { BLIND_RETRY_INTERVAL_MS, RESET_MARGIN_MS } from "./limit-state.js";

const NOW = 1_787_182_000_000;
const RESET_AT_SECONDS = 1_787_196_849;

const EXHAUSTED_HEADERS: Record<string, string> = {
  "x-codex-primary-reset-at": String(RESET_AT_SECONDS),
  "x-codex-primary-used-percent": "100",
  "x-codex-primary-window-minutes": "10080",
};

const WEBSOCKET_ERROR = "Codex error: The usage limit has been reached";
const SSE_ERROR = "You have hit your ChatGPT usage limit (pro plan). Try again in ~248 min.";

interface Clock {
  deps: LimitResumeDependencies;
  pending: number;
  runDue(at: number): void;
}

function createClock(start: number): Clock {
  let current = start;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: Clock = {
    deps: {
      now: () => current,
      setTimeout: (callback, milliseconds) => {
        const handle = nextHandle++;
        timers.set(handle, { at: current + milliseconds, callback });
        return handle;
      },
      clearTimeout: (handle) => {
        timers.delete(handle as number);
      },
    },
    get pending() {
      return timers.size;
    },
    runDue(at) {
      current = at;
      for (const [handle, timer] of [...timers]) {
        if (timer.at > at) continue;
        timers.delete(handle);
        timer.callback();
      }
    },
  };
  return clock;
}

function createHarness(clock: Clock) {
  const sent: Array<[unknown, unknown]> = [];
  const sentAsUser: unknown[] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const recorder = createExtensionRecorder({
    additions: {
      sendMessage: async (message: unknown, options: unknown) => {
        sent.push([message, options]);
      },
      // Present so a regression that resumed as the operator would be caught rather than silent.
      sendUserMessage: async (content: unknown) => {
        sentAsUser.push(content);
      },
    },
  });
  void recorder.install((pi) => {
    registerLimitResume(pi as unknown as ExtensionAPI, clock.deps);
  });
  const context = recorder.makeContext({
    ui: {
      ...recorder.ui.ui,
      setStatus: (key: string, text: string | undefined) => {
        statuses.push([key, text]);
      },
    },
  }) as ExtensionContext;
  const assistantError = (errorMessage: string) => ({
    message: { role: "assistant", stopReason: "error", errorMessage },
  });
  return { recorder, context, sent, sentAsUser, statuses, assistantError };
}

describe("limit-resume extension", () => {
  it("waits for an observed reset, then resumes without fabricating user input", async () => {
    const clock = createClock(NOW);
    const { recorder, context, sent, sentAsUser, statuses, assistantError } = createHarness(clock);

    await recorder.invokeRaw(
      "after_provider_response",
      { status: 429, headers: EXHAUSTED_HEADERS },
      context,
    );
    await recorder.invokeRaw("message_end", assistantError(SSE_ERROR), context);
    await recorder.invokeRaw("agent_settled", {}, context);

    expect(statuses.at(-1)?.[0]).toBe("limit-resume");
    expect(statuses.at(-1)?.[1]).toMatch(/^limit reached · resuming at \d\d:\d\d · attempt 1$/);
    expect(clock.pending).toBe(1);
    expect(sent).toHaveLength(0);

    clock.runDue(RESET_AT_SECONDS * 1_000 + RESET_MARGIN_MS);

    expect(sent).toHaveLength(1);
    const [message, options] = sent[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(message.customType).toBe("limit-resume");
    expect(message.role).toBeUndefined();
    expect(options).toMatchObject({ triggerTurn: true });
    expect(sentAsUser).toHaveLength(0);
    expect(statuses.at(-1)?.[1]).toBeUndefined();
  });

  it("does not reuse an earlier limit's reset for a later stop", async () => {
    const clock = createClock(NOW);
    const { recorder, context, statuses, assistantError } = createHarness(clock);

    await recorder.invokeRaw(
      "after_provider_response",
      { status: 429, headers: EXHAUSTED_HEADERS },
      context,
    );
    await recorder.invokeRaw("message_end", assistantError(SSE_ERROR), context);
    await recorder.invokeRaw("agent_settled", {}, context);
    expect(statuses.at(-1)?.[1]).toMatch(/resuming at/);

    // A later stop observing no exhausted window must not inherit the consumed reset.
    clock.runDue(RESET_AT_SECONDS * 1_000 + RESET_MARGIN_MS);
    await recorder.invokeRaw("message_end", assistantError(WEBSOCKET_ERROR), context);
    await recorder.invokeRaw("agent_settled", {}, context);

    expect(statuses.at(-1)?.[1]).toMatch(/^limit reached · reset time unknown/);
  });

  it("retries blind and discloses the degraded mode once when no reset is observable", async () => {
    const clock = createClock(NOW);
    const { recorder, context, statuses, assistantError } = createHarness(clock);

    await recorder.invokeRaw("message_end", assistantError(WEBSOCKET_ERROR), context);
    await recorder.invokeRaw("agent_settled", {}, context);

    expect(statuses.at(-1)?.[1]).toMatch(
      /^limit reached · reset time unknown · retrying at \d\d:\d\d · attempt 1$/,
    );
    const warnings = recorder.ui.calls.filter((call) => call.name === "notify");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.args[0]).toContain("retrying every 15 minutes");

    clock.runDue(NOW + BLIND_RETRY_INTERVAL_MS);
    await recorder.invokeRaw("message_end", assistantError(WEBSOCKET_ERROR), context);
    await recorder.invokeRaw("agent_settled", {}, context);

    expect(statuses.at(-1)?.[1]).toMatch(/attempt 2$/);
    expect(recorder.ui.calls.filter((call) => call.name === "notify")).toHaveLength(1);
  });

  it("does not schedule for a terminal limit that waiting cannot clear", async () => {
    const clock = createClock(NOW);
    const { recorder, context, statuses, assistantError } = createHarness(clock);

    await recorder.invokeRaw("message_end", assistantError("Monthly usage limit reached"), context);
    await recorder.invokeRaw("agent_settled", {}, context);

    expect(clock.pending).toBe(0);
    expect(statuses.filter(([, text]) => text !== undefined)).toHaveLength(0);
  });

  it("cancels a pending resume when the operator sends a message", async () => {
    const clock = createClock(NOW);
    const { recorder, context, statuses, assistantError } = createHarness(clock);

    await recorder.invokeRaw("message_end", assistantError(WEBSOCKET_ERROR), context);
    await recorder.invokeRaw("agent_settled", {}, context);
    expect(clock.pending).toBe(1);

    await recorder.invokeRaw("message_start", { message: { role: "user" } }, context);

    expect(clock.pending).toBe(0);
    expect(statuses.at(-1)?.[1]).toBeUndefined();
  });

  it("cancels a pending resume on command and clears its timer at shutdown", async () => {
    const clock = createClock(NOW);
    const { recorder, context, assistantError } = createHarness(clock);

    await recorder.invokeRaw("message_end", assistantError(WEBSOCKET_ERROR), context);
    await recorder.invokeRaw("agent_settled", {}, context);
    await recorder.invokeCommandDirect("limit-resume", "", context as never);
    expect(clock.pending).toBe(0);

    await recorder.invokeRaw("message_end", assistantError(WEBSOCKET_ERROR), context);
    await recorder.invokeRaw("agent_settled", {}, context);
    expect(clock.pending).toBe(1);
    await recorder.invokeRaw("session_shutdown", {}, context);
    expect(clock.pending).toBe(0);

    // A settlement arriving after shutdown must not arm a timer that outlives the session.
    await recorder.invokeRaw("message_end", assistantError(WEBSOCKET_ERROR), context);
    await recorder.invokeRaw("agent_settled", {}, context);
    expect(clock.pending).toBe(0);
  });
});
