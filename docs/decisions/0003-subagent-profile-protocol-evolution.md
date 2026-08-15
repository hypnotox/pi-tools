---
format: current-state-v4
slug: subagent-profile-protocol-evolution
status: Implemented
date: 2026-08-15
---
# ADR-0003: Subagent Profile Protocol Evolution

## Context

ADR-0002 established a versioned event-bus profile boundary whose public types and protocol version are compatibility commitments. Awf now needs to consume that boundary for four specialized delegation tools, but protocol version 1 cannot express all of the required behavior.

Profiles cannot currently contribute Pi's active-tool prompt metadata, so a consumer cannot teach the parent when and how to invoke a specialized profile tool. Post-run callbacks can replace a report and retain schema-validated profile data, but they cannot intentionally fail an otherwise completed child; throwing signals an error while discarding callback-produced audit metadata. Exclusive parent-batch enforcement fabricates a singleton batch when the current assistant message cannot be correlated, making an uncertain safety check pass. Finally, a pending registration receipt mutates during `session_start` finalization without notifying the consumer, so collision and prerequisite failures cannot be reported reliably without depending on extension load order or later polling.

The toolkit remains responsible for common execution and registration mechanics while consumers own policy and bounded profile data. Git checkout identity and before/after snapshots therefore belong in consumer-defined `profileData`, not in toolkit-specific fields. Pi already supports `promptSnippet` and `promptGuidelines` on registered tools, synchronizes the session branch before `tool_call`, and provides the shared synchronous event bus used by the existing capability handshake.

## Decision

1. `decision: protocol-v2` Evolve the subagent-profile handshake to protocol version 2 so consumers can require the complete adoption contract rather than silently accepting a version 1 toolkit.
2. `decision: profile-prompt-metadata` Let profiles provide validated optional prompt snippets and tool-specific prompt guidelines, and forward them to Pi's registered profile tools.
3. `decision: post-run-policy-failure` Let a post-run callback return a bounded failure alongside schema-validated profile data. Cancellation remains authoritative; otherwise the callback failure produces a terminal failed result while preserving the child execution facts and consumer-defined structured audit data. Failure text takes precedence in model-visible content.
4. `decision: fail-closed-exclusivity` For an exclusive profile call, treat an uncorrelatable assistant batch as unsafe and block it with an actionable instruction to retry that tool alone. Do not block an ordinary nonexclusive call merely because its sibling set is unavailable.
5. `decision: finalized-registration-event` Publish one typed, protocol-versioned registration-result event after each pending batch becomes registered or rejected during finalization. The event identifies the batch by its stable `registrationId` and carries the final registered or rejected state plus any rejection reason. A registered result is published only after its accepted tools are installed, and consumers subscribe during factory initialization so the notification remains independent of extension load order. Immediate invalid and late receipts remain directly inspectable.

## State changes

- update `development/subagent-toolkit:profile-runtime`

## Consequences

- Awf can negotiate a sufficient toolkit explicitly, provide parent-facing routing guidance, enforce commit policy after child completion, and report registration failures deterministically.
- Consumer audit structures remain extensible and schema-owned rather than becoming Git-specific toolkit API.
- Exclusive profiles refuse uncertain correlation instead of assuming safety; this may require a retry when session evidence is incomplete.
- Consumers must update to protocol version 2 and subscribe to finalization results during factory initialization. Version 1 consumers and toolkits remain detectably incompatible rather than partially interoperating.
- Active profile prompt metadata adds system-prompt tokens and can invalidate a provider's cached prompt prefix when the active tool set changes.
- The toolkit carries additional validation and notification contracts, but does not gain orchestration, Git, runner, or scheduler policy.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Keep protocol version 1 | Older toolkits would appear compatible while ignoring or rejecting required version 2 behavior. |
| Put routing guidance only in tool descriptions or a consumer-global prompt | Descriptions cannot provide Pi's active-tool-scoped snippet and guideline surfaces, while global text would outlive the profile tool it governs. |
| Put Git audit fields in common execution details | Couples a consumer-neutral toolkit to awf's repository policy instead of using the existing profile-data boundary. |
| Signal policy failure by throwing from `afterRun` | Marks an error but cannot return the callback's validated structured audit metadata. |
| Preserve the singleton correlation fallback | Treats missing evidence as proof that an exclusive call is alone. |
| Require consumers to poll mutable receipts | Makes actionable finalization reporting lifecycle-dependent and easy to miss. |
| Add a receipt promise or callback | Provides direct settlement but adds a second asynchronous receipt abstraction; a typed factory-subscribed event fits the existing inter-extension runtime bridge. |

## Status history

- 2026-08-15: Proposed
- 2026-08-15: Accepted; content-sha256: 6787d1cec927ba578c80621d3e955bfc6be5cf3560773b90ca64ae0ad9eb7d8a
- 2026-08-15: Implementing; content-sha256: 6787d1cec927ba578c80621d3e955bfc6be5cf3560773b90ca64ae0ad9eb7d8a
- 2026-08-15: Applied; operations: update `development/subagent-toolkit:profile-runtime`
- 2026-08-15: Implemented; content-sha256: 6787d1cec927ba578c80621d3e955bfc6be5cf3560773b90ca64ae0ad9eb7d8a
