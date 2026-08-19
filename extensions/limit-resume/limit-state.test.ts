import { describe, expect, it } from "vitest";
import {
  BLIND_RETRY_INTERVAL_MS,
  classifyLimitError,
  exhaustedWindowFromHeaders,
  MIN_DELAY_MS,
  nextAttempt,
  RESET_MARGIN_MS,
  resetFromErrorMessage,
  waitingStatus,
} from "./limit-state.js";

/** Captured from an openai-codex 429 over the sse transport, trimmed to the limit headers. */
const OBSERVED_429_HEADERS: Record<string, string> = {
  "x-codex-active-limit": "premium",
  "x-codex-bengalfox-limit-name": "GPT-5.3-Codex-Spark",
  "x-codex-bengalfox-primary-reset-after-seconds": "18000",
  "x-codex-bengalfox-primary-reset-at": "1787199960",
  "x-codex-bengalfox-primary-used-percent": "0",
  "x-codex-bengalfox-primary-window-minutes": "300",
  "x-codex-bengalfox-secondary-reset-at": "1787786760",
  "x-codex-bengalfox-secondary-used-percent": "0",
  "x-codex-bengalfox-secondary-window-minutes": "10080",
  "x-codex-plan-type": "pro",
  "x-codex-primary-reset-after-seconds": "14890",
  "x-codex-primary-reset-at": "1787196849",
  "x-codex-primary-used-percent": "100",
  "x-codex-primary-window-minutes": "10080",
  "x-codex-secondary-reset-after-seconds": "0",
  "x-codex-secondary-reset-at": "",
  "x-codex-secondary-used-percent": "0",
  "x-codex-secondary-window-minutes": "0",
};

describe("exhaustedWindowFromHeaders", () => {
  it("selects the exhausted window and ignores unexhausted and empty ones", () => {
    expect(exhaustedWindowFromHeaders(OBSERVED_429_HEADERS)).toEqual({
      resetAt: 1_787_196_849_000,
      usedPercent: 100,
      windowMinutes: 10_080,
    });
  });

  it("reports no window when nothing is exhausted", () => {
    const headers = { ...OBSERVED_429_HEADERS, "x-codex-primary-used-percent": "62" };
    expect(exhaustedWindowFromHeaders(headers)).toBeUndefined();
    expect(exhaustedWindowFromHeaders({})).toBeUndefined();
  });

  it("waits for the latest reset when several windows are exhausted", () => {
    const headers = {
      ...OBSERVED_429_HEADERS,
      "x-codex-bengalfox-secondary-used-percent": "100",
    };
    expect(exhaustedWindowFromHeaders(headers)?.resetAt).toBe(1_787_786_760_000);
  });

  it("matches header names case-insensitively and skips unusable values", () => {
    expect(
      exhaustedWindowFromHeaders({
        "X-Codex-Primary-Reset-At": "1787196849",
        "X-Codex-Primary-Used-Percent": "100",
      }),
    ).toMatchObject({ resetAt: 1_787_196_849_000, windowMinutes: undefined });
    expect(
      exhaustedWindowFromHeaders({
        "x-codex-primary-reset-at": "not-a-number",
        "x-codex-primary-used-percent": "100",
      }),
    ).toBeUndefined();
  });
});

describe("resetFromErrorMessage", () => {
  it("reads the minutes a provider states in its own failure text", () => {
    const now = 1_787_182_000_000;
    expect(
      resetFromErrorMessage(
        "You have hit your ChatGPT usage limit (pro plan). Try again in ~248 min.",
        now,
      ),
    ).toBe(now + 248 * 60_000);
  });

  it("reports nothing when the text carries no time", () => {
    expect(
      resetFromErrorMessage("Codex error: The usage limit has been reached", 0),
    ).toBeUndefined();
  });
});

describe("classifyLimitError", () => {
  it("treats both observed provider dialects as resumable", () => {
    expect(classifyLimitError("Codex error: The usage limit has been reached")).toBe("resumable");
    expect(
      classifyLimitError(
        "You have hit your ChatGPT usage limit (pro plan). Try again in ~248 min.",
      ),
    ).toBe("resumable");
  });

  it("treats credit and billing exhaustion as terminal even when it mentions a usage limit", () => {
    expect(classifyLimitError("Monthly usage limit reached")).toBe("terminal");
    expect(classifyLimitError("You have insufficient_quota remaining")).toBe("terminal");
  });

  it("does not claim unrelated failures", () => {
    expect(classifyLimitError("Connection reset by peer")).toBe("other");
    expect(classifyLimitError(undefined)).toBe("other");
  });
});

describe("nextAttempt", () => {
  const now = 1_787_182_000_000;

  it("waits past an observed future reset", () => {
    expect(nextAttempt({ now, observedResetAt: now + 3_600_000 })).toEqual({
      attemptAt: now + 3_600_000 + RESET_MARGIN_MS,
      known: true,
    });
  });

  it("floors an imminent reset so attempts cannot loop hot", () => {
    expect(nextAttempt({ now, observedResetAt: now + 1_000 })).toEqual({
      attemptAt: now + MIN_DELAY_MS,
      known: true,
    });
  });

  it("falls back to the blind interval for a past or absent reset", () => {
    expect(nextAttempt({ now, observedResetAt: now - 1 })).toEqual({
      attemptAt: now + BLIND_RETRY_INTERVAL_MS,
      known: false,
    });
    expect(nextAttempt({ now })).toEqual({
      attemptAt: now + BLIND_RETRY_INTERVAL_MS,
      known: false,
    });
  });
});

describe("waitingStatus", () => {
  const attemptAt = 1_787_196_849_000;
  const expectedClock = new Date(attemptAt).toTimeString().slice(0, 5);

  it("reports the target time and attempt count when the reset is known", () => {
    expect(waitingStatus({ attemptAt, known: true }, 1)).toBe(
      `limit reached · resuming at ${expectedClock} · attempt 1`,
    );
  });

  it("states plainly that no reset time is known", () => {
    expect(waitingStatus({ attemptAt, known: false }, 3)).toBe(
      `limit reached · reset time unknown · retrying at ${expectedClock} · attempt 3`,
    );
  });
});
