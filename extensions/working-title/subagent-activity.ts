import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SUBAGENT_POLL_MS = 2_000;
export const SUBAGENT_REQUEST_TIMEOUT_MS = 5_000;
const RPC = "subagents:rpc:v1";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Optional, process-local public RPC integration; never imports pi-subagents internals. */
export function trackSubagentActivity(
  events: ExtensionAPI["events"],
  onActivity: (active: boolean) => void,
): () => void {
  let disposed = false;
  let supported = false;
  let active = false;
  let revision = 0;
  let refreshPending = false;
  let pending: (() => void) | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;

  const setActive = (next: boolean): void => {
    if (next === active) return;
    active = next;
    onActivity(active);
  };

  const request = (method: "ping" | "status"): void => {
    if (disposed) return;
    if (pending) {
      refreshPending = true;
      return;
    }
    const requestId = randomUUID();
    const requestedRevision = revision;
    let timeout: ReturnType<typeof setTimeout>;
    const cleanup = (): void => {
      unsubscribe();
      clearTimeout(timeout);
      pending = undefined;
    };
    const finish = (raw?: unknown): void => {
      cleanup();
      if (disposed) return;
      const reply = record(raw);
      const data = reply?.version === 1 && reply.success === true ? record(reply.data) : undefined;
      if (method === "ping") {
        supported = record(record(data?.capabilities)?.fleetStatus)?.version === 1;
        if (supported && !poll) {
          poll = setInterval(() => request("status"), SUBAGENT_POLL_MS);
          poll.unref?.();
        }
      } else if (requestedRevision === revision) {
        const fleet = record(data?.fleet);
        const count = fleet?.totalActive;
        // Unavailable/malformed telemetry must not leave the title stuck busy.
        setActive(
          fleet?.version === 1 &&
            typeof count === "number" &&
            Number.isSafeInteger(count) &&
            count > 0,
        );
      }
      const refresh = refreshPending;
      refreshPending = false;
      if ((method === "ping" && supported) || refresh) request(supported ? "status" : "ping");
    };
    const unsubscribe = events.on(`${RPC}:reply:${requestId}`, (raw) => {
      if (record(raw)?.requestId === requestId) finish(raw);
    });
    pending = cleanup;
    timeout = setTimeout(() => finish(), SUBAGENT_REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    events.emit(`${RPC}:request`, { version: 1, requestId, method });
  };

  const refresh = (): void => {
    // Events are hints, not activity truth: only the owner's current-session
    // snapshot may affect the title. Discard replies predating a lifecycle hint.
    revision += 1;
    request(supported ? "status" : "ping");
  };
  const unsubscribers = [
    events.on(`${RPC}:ready`, refresh),
    events.on("subagent:async-started", refresh),
    events.on("subagent:async-complete", refresh),
    events.on("subagent:foreground-complete", refresh),
  ];
  request("ping");

  return () => {
    disposed = true;
    pending?.();
    clearInterval(poll);
    for (const unsubscribe of unsubscribers) unsubscribe();
    setActive(false);
  };
}
