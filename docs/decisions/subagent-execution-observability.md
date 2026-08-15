---
format: current-state-v4
slug: subagent-execution-observability
status: Proposed
date: 2026-08-15
---
# ADR-subagent-execution-observability: Subagent Execution Observability

## Context

ADR-0002 limits the subagent toolkit's persisted presentation to final execution facts, the final report or failure, and expanded profile data. The runner also retains a small flat activity list, but it records tool starts and ends as unrelated tool-name strings, ignores streamed thinking, updates usage only after a turn, and cannot show correlated status or duration. A long-running child therefore exposes little evidence of its trajectory until it finishes.

Pi's child JSON protocol supplies thinking deltas, cumulative live usage, and tool lifecycle events with call identifiers, arguments, results, and error state. The toolkit can project those events into bounded execution history, but persisting task and thinking content deliberately broadens the observability and privacy boundary established by ADR-0002.

Useful tool rows also require argument summaries. Core Pi tools have stable summaries the toolkit can own, while custom tools belong to independently installed extensions that do not share runtime module roots. Their summary integration therefore needs the same typed, versioned event-bus boundary used for profiles. Because summaries can persist in session details, resolver ownership, failures, raw argument exposure, and bounds are compatibility and safety concerns rather than renderer details.

## Decision

1. `decision: bounded-execution-history` Persist a bounded projection of each subagent invocation containing its prepared task prompt, logical thinking lines, correlated tool lifecycle summaries and timings, live usage, turn count, elapsed time, terminal report or failure, and existing execution facts. The projection survives session resume.
2. `decision: execution-presentation` Show the task prompt as one truncated line in compact mode and in full within its safety bound when expanded. While running, show the latest 25 chronological thinking and tool rows in compact mode and the latest 50 when expanded; update one correlated row per tool call in place from running to success or failure. When the child settles, replace compact activity with its terminal report while expanded mode retains the bounded history. Show overall elapsed time, per-tool durations, and a live Pi-like footer containing turns, input and output tokens, cache reads and writes, the latest turn's cache-hit rate, and cumulative cost.
3. `decision: core-tool-summaries` Let the toolkit own safe argument summaries for known Pi core tools. Persist summaries rather than raw tool arguments, and render an unrecognized tool by name only when no resolver exists.
4. `decision: resolver-capability` Let independently installed extensions register synchronous custom-tool argument-summary resolvers through a typed, versioned, load-order-tolerant Pi event-bus capability. Resolver ownership is exclusive and non-overridable, toolkit-owned names are reserved, conflicting batches fail atomically, and registration freezes at session start.
5. `decision: resolver-containment` Give a resolver an immutable JSON argument snapshot, require bounded plain-text output, and contain resolver exceptions or invalid output by falling back to the tool name without affecting child execution.

## State changes

- update `development/subagent-toolkit:profile-runtime`

## Consequences

- A user can see where a child has been, what it is doing, how long it has run, and what it costs without opening another session.
- Bounded task and thinking content becomes persistent session data. This improves resumed-session observability at the cost of retaining content that was previously transient or absent.
- Correlated structured activity replaces the flat append-only activity representation and requires careful streaming usage accounting. Historical results lack the new projection and must remain renderable without migration.
- Core summaries stay consistent, while custom extensions gain a runtime-independent integration boundary.
- Exclusive ownership prevents presentation changes caused by resolver replacement, but a collision rejects the conflicting registration instead of choosing a winner.
- Resolver validation and name-only fallback avoid persisting arbitrary arguments or allowing presentation failures to break execution. Resolvers still run inside the trusted extension process with access to raw argument snapshots, so a resolver can inspect sensitive data or delay synchronous event processing.
- The public resolver types and protocol version become compatibility commitments that require deliberate evolution.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Keep activity live-only | Expanded history would disappear after completion or session resume. |
| Persist raw tool arguments and render them generically | Arguments may be large or sensitive and custom tools need domain-aware summaries. |
| Support only toolkit-owned summaries | Leaves independently installed custom tools without useful domain-aware activity summaries. |
| Let later resolvers override earlier registrations | Makes presentation depend on extension load order and weakens ownership. |
| Share resolver implementations through runtime imports | Independently installed Pi packages do not share a reliable runtime module root. |
| Use a separate overlay | Splits child progress from its tool result and does not naturally preserve historical rendering. |

## Status history

- 2026-08-15: Proposed
