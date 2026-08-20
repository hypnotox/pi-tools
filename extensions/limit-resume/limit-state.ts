/** Fixed interval used when no reset time is observable. */
export const BLIND_RETRY_INTERVAL_MS = 15 * 60 * 1_000;
/** Added to an observed reset so an attempt never races the window boundary. */
export const RESET_MARGIN_MS = 30_000;
/** Floor on any scheduled wait, so a stale or imminent reset cannot produce a hot retry loop. */
export const MIN_DELAY_MS = 60_000;

const RESET_AT_PATTERN = /^x-codex-(?:.+-)?(?:primary|secondary)-reset-at$/;
const EXHAUSTED_PERCENT = 100;

/**
 * Providers report several limit windows at once. A window is only usable as a resume time once it
 * reports itself exhausted; an unexhausted window's reset says nothing about why a request failed.
 */
interface ExhaustedWindow {
  /** Epoch milliseconds. */
  resetAt: number;
  usedPercent: number;
  windowMinutes?: number | undefined;
}

function readNumber(headers: Record<string, string>, key: string): number | undefined {
  const raw = headers[key];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The reset an exhausted limit window reports, or `undefined` when no window reports exhaustion.
 * With several windows exhausted the latest reset wins: work cannot resume until every one clears.
 *
 * A window's remaining-seconds header is preferred over its absolute epoch, because the relative
 * value stays correct when the local clock disagrees with the provider's. A skewed clock would
 * otherwise inflate every wait, or read an available reset as already past and retry blind instead.
 */
export function exhaustedWindowFromHeaders(
  headers: Record<string, string>,
  now: number,
): ExhaustedWindow | undefined {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) normalized[key.toLowerCase()] = value;

  let latest: ExhaustedWindow | undefined;
  for (const key of Object.keys(normalized)) {
    if (!RESET_AT_PATTERN.test(key)) continue;
    const prefix = key.slice(0, -"-reset-at".length);
    const usedPercent = readNumber(normalized, `${prefix}-used-percent`);
    if (usedPercent === undefined || usedPercent < EXHAUSTED_PERCENT) continue;

    const remainingSeconds = readNumber(normalized, `${prefix}-reset-after-seconds`);
    const resetAtSeconds = readNumber(normalized, key);
    let resetAt: number | undefined;
    if (remainingSeconds !== undefined && remainingSeconds > 0)
      resetAt = now + remainingSeconds * 1_000;
    else if (resetAtSeconds !== undefined && resetAtSeconds > 0) resetAt = resetAtSeconds * 1_000;
    if (resetAt === undefined) continue;

    const window: ExhaustedWindow = {
      resetAt,
      usedPercent,
      windowMinutes: readNumber(normalized, `${prefix}-window-minutes`),
    };
    if (!latest || window.resetAt > latest.resetAt) latest = window;
  }
  return latest;
}

const RETRY_MINUTES_PATTERN = /try again in ~?\s*(\d+)\s*min/i;

/** The reset a provider states in its own failure text, as epoch milliseconds. */
export function resetFromErrorMessage(message: string, now: number): number | undefined {
  const match = RETRY_MINUTES_PATTERN.exec(message);
  if (!match?.[1]) return undefined;
  const minutes = Number(match[1]);
  return Number.isFinite(minutes) ? now + minutes * 60_000 : undefined;
}

/**
 * `terminal` covers exhausted credit and billing failures, which waiting never clears; retrying
 * those would spend attempts forever against a limit that has no reset.
 */
type LimitClassification = "resumable" | "terminal" | "other";

const TERMINAL_PATTERN =
  /insufficient_quota|available balance|out of budget|monthly usage limit reached|billing/i;
const RESUMABLE_PATTERN = /usage limit|rate limit|too many requests/i;

export function classifyLimitError(message: string | undefined): LimitClassification {
  if (!message) return "other";
  if (TERMINAL_PATTERN.test(message)) return "terminal";
  return RESUMABLE_PATTERN.test(message) ? "resumable" : "other";
}

interface Schedule {
  /** Epoch milliseconds. */
  attemptAt: number;
  /** Whether `attemptAt` came from an observed reset rather than the blind interval. */
  known: boolean;
}

/**
 * A reset already in the past is not evidence about the current failure, so it degrades to the
 * blind interval rather than resuming immediately against a limit that is evidently still closed.
 */
export function nextAttempt(input: {
  now: number;
  observedResetAt?: number | undefined;
}): Schedule {
  const { now, observedResetAt } = input;
  if (observedResetAt !== undefined && observedResetAt > now) {
    return {
      attemptAt: Math.max(observedResetAt + RESET_MARGIN_MS, now + MIN_DELAY_MS),
      known: true,
    };
  }
  return { attemptAt: now + BLIND_RETRY_INTERVAL_MS, known: false };
}

function clockTime(epochMs: number): string {
  const at = new Date(epochMs);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** The operator-facing wait line. States plainly when no reset time is known. */
export function waitingStatus(schedule: Schedule, attempt: number): string {
  const when = clockTime(schedule.attemptAt);
  return schedule.known
    ? `limit reached · resuming at ${when} · attempt ${attempt}`
    : `limit reached · reset time unknown · retrying at ${when} · attempt ${attempt}`;
}
