---
format: current-state-v4
slug: usage-limit-resume-driven-by-observed-telemetry
status: Proposed
date: 2026-08-20
---
# ADR-0014: Usage Limit Resume Driven by Observed Telemetry

## Context

Reaching a provider usage limit ends the agent turn and leaves the session idle until the operator
returns, notices the failure, and retypes the request. The waiting is unattended work a session
extension can perform, but only from facts the extension can actually observe.

Pi exposes two relevant surfaces. `after_provider_response` reports the HTTP status and the complete
normalized response headers of each provider response that reaches it; Pi documents header
availability as provider- and transport-dependent. `message_end` reports the settled assistant
message, whose `stopReason` is `error` and whose `errorMessage` carries the provider's failure text.
Neither surface reports a structured reset time, and Pi's own limit handling collapses the Codex
`resets_at` field into prose before any extension sees it.

Observability depends on the configured transport. Measured against `openai-codex` with an exhausted
limit: under the `sse` transport the 429 reaches `after_provider_response` with `x-codex-*` headers
carrying `primary-reset-at` as an epoch second, `primary-used-percent`, and the window length, and
the settled `errorMessage` names the remaining minutes. Under the default `auto` transport the same
request is served over a WebSocket, `after_provider_response` never fires, and the only signal is the
settled `errorMessage` text `Codex error: The usage limit has been reached`, which carries no time.

An extension therefore cannot assume a reset time exists. It can know one exactly, or not at all, and
which case applies is an operator configuration outcome rather than something the extension controls.

## Decision

1. `decision: unattended-limit-resume` A session extension detects a provider usage-limit stop and
   re-triggers the interrupted turn without operator presence.
2. `decision: observed-reset-only` The resume time is derived only from limit facts observed on a
   provider response or carried by the settled assistant error. The extension never infers a reset
   time from plan, window, or elapsed-time assumptions.
3. `decision: degraded-blind-retry` When no reset time is observable, the extension retries on a
   fixed recurring interval instead of waiting on an inferred time.
4. `decision: visible-cancellable-wait` A pending resume is visible to the operator, reporting its
   target time when one is known, that no reset time is known when one is not, and its attempt
   count, and remains cancellable.
5. `decision: no-synthetic-user-input` Automatic resume never fabricates user input in session
   history.
6. `decision: operator-owned-transport` The extension never changes the operator's transport
   configuration to improve its own limit observability.

## State changes

- add `development/usage-limit-resume:limit-resume-runtime`

## Consequences

Unattended sessions continue on their own after a usage limit clears, and an operator who returns
finds either completed work or an account of what the extension is waiting for.

That continuation is unsupervised by construction. The resumed turn is a full agent turn that may
call tools and write to the repository hours after the operator left, against an intent that may have
gone stale in the interval, and `decision: visible-cancellable-wait` bounds it only once the operator
is back to see it. What bounds it in the meantime is that no new instruction is invented:
`decision: no-synthetic-user-input` keeps the resume from introducing work the operator never asked
for, so the unsupervised turn continues the interrupted request rather than starting a different one.

The extension's precision is bound to operator configuration it does not own. On a transport that
exposes provider headers the wait is exact; on one that does not, the same code retries blind and
says so. `decision: observed-reset-only` accepts a worse experience in the degraded case in exchange
for never displaying a confident time that is wrong, because an operator who trusts a fabricated
resume time stops watching a session that will not resume. `decision: operator-owned-transport` keeps
the extension from resolving that tension by reaching into configuration the operator owns, so
improving observability stays an informed operator choice.

Blind retry spends a request per attempt against a limit that may still be exhausted, bounding how
short the interval can reasonably be. Because `decision: no-synthetic-user-input` keeps the resume
out of the user-message record, the resumed turn is attributable to the extension when the session is
later read or handed off.

The observability difference is worth documenting for operators, since the setting that governs it is
not otherwise connected to limit handling in any visible way.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Assume the plan's window length from the first limit hit | Displays a precise time derived from a guess; a window that began earlier strands the session past its actual reset. |
| Escalating backoff instead of a fixed interval | Adds delay exactly when the limit is most likely to have cleared, for a saving of a few probe requests. |
| Prompt the operator for a resume time | Requires presence at the moment of failure, which is the situation the extension exists to cover. |
| Resume by replaying a synthetic user message | Fabricates operator input in the session record and misattributes the resumed turn. |
| Read limit state by issuing the extension's own probe request | Duplicates provider authentication and spends quota to learn what a response already reports. |
| Pause pre-emptively before the limit is reached | Deferred, not rejected: the observed used-percent and window length would support it, but throttling the operator's own turns is a separate decision from resuming after a stop. |

## Status history

- 2026-08-20: Proposed
