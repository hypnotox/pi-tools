---
format: current-state-v4
slug: subagent-profile-toolkit
status: Implemented
date: 2026-08-14
---
# ADR-0002: Subagent Profile Toolkit

## Context

The package exports executable Pi extensions but has no reusable boundary for delegating work to fresh-context child agents. A specialized extension can launch a child directly, but repeating process supervision, scheduling, tool confinement, model selection, result persistence, and rendering across integrations would duplicate the difficult policy while coupling each implementation to one caller's configuration.

Pi extensions share a synchronous event bus but separately installed Pi packages do not share module roots. Pi also discovers extensions independently in every process. A reusable boundary therefore needs runtime capability negotiation rather than direct runtime imports, and it must prevent a child from exposing the same delegation tools that launched it. At the same time, model routing, prompts, working-directory selection, and verification rules vary by integration and should not become toolkit configuration.

The first implementation should serve known integration requirements without predicting a general orchestration framework. It must remain standalone, preserve Pi's own request retry behavior, bound all child output and persisted data, and keep extension-owned policy strongly typed.

## Decision

1. `decision: profile-boundary` Provide a consumer-neutral subagent toolkit whose unit of composition is a typed profile that registers exactly one Pi tool. The toolkit owns execution mechanics and common presentation; profiles own their schemas, instructions, model and requested thinking selection, working directory, tool policy, lifecycle policy, and bounded result data.
2. `decision: capability-handshake` Expose runtime integration through a versioned, load-order-tolerant Pi event-bus capability handshake. Consumers publish profiles in atomic batches and may suppress the built-in default profile in the same transaction. Export canonical TypeScript types for compile-time use without requiring runtime module sharing. Consumers remain responsible for dependency provisioning and for handling missing or incompatible capabilities.
3. `decision: isolated-child-runtime` Run each invocation in a fresh Pi subprocess with a minimal profile prompt, an independently selected working directory, normal extension loading, and automatic context-file and skill loading disabled. A profile chooses either an explicit tool allowlist or the parent's active tools with an additional denylist; the toolkit applies its automatic recursion deny set in both modes and enforces it again in the child runtime. Temporary project trust propagates only when the canonical child working directory is within the trusted parent tree.
4. `decision: callback-policy` Keep routing and integration policy outside toolkit configuration. Profiles provide typed callbacks for concrete model selection, optional requested thinking-level selection, run preparation, and optional pre-run and post-run processing. The toolkit validates callback outputs, applies Pi's model-capability clamp, passes and displays the resulting effective thinking level, schedules execution, preserves bounded results, and marks terminal failures without interpreting consumer fallback or verification semantics.
5. `decision: standalone-default` Ship an enabled default `subagent` profile with task plus optional exact model and requested thinking-level arguments. It otherwise inherits the parent model, thinking level, working directory, and active tools; removes all toolkit profile tools; runs serially; and cannot overlap sibling parent-tool execution.
6. `decision: bounded-observability` Persist only final bounded JSON-serializable profile data with the toolkit's common execution facts. Use one toolkit-owned renderer for those facts, the final report or failure, and expanded bounded profile data.
7. `decision: request-retries` Rely on the child Pi process for transient request retries and never retry the whole subprocess.

## State changes

- add `development/subagent-toolkit:profile-runtime`

## Consequences

- The package is useful on its own while allowing focused integrations to replace the default surface without forking the runtime.
- Consumers retain full control of configuration and policy, but must implement and test their callbacks and handle missing or incompatible capabilities themselves.
- A fresh subprocess provides strong context isolation and preserves extension-provided models, at the cost of startup overhead.
- Normal child extension loading preserves provider availability but remains part of Pi's trusted-extension boundary; a tool allowlist does not sandbox extension code.
- The synchronous, unbuffered event bus makes load order, duplicate delivery, registration finalization, and tool collisions explicit protocol concerns.
- Recursive delegation is prevented for toolkit profiles through both parent-side tool selection and child-runtime enforcement. Unrelated delegation extensions remain the responsibility of an explicit profile tool policy.
- Arbitrary profile data remains extensible but must pass runtime schema and size checks before session persistence.
- The public type surface and protocol version become compatibility commitments that require deliberate evolution.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Keep each subagent extension self-contained | Duplicates supervision, confinement, scheduling, bounds, persistence, and rendering policy. |
| Expose one generic tool without profiles | Cannot preserve strongly typed, purpose-specific tool schemas or atomically restrict the visible delegation surface. |
| Share the runtime through direct package imports | Separately installed Pi packages use distinct module roots, so direct imports are not a reliable inter-extension runtime boundary. |
| Run children in process through the SDK | Changes extension and provider behavior while adding scope beyond the proven subprocess implementation. |
| Load the ordinary project prompt and context in children | Main-session guidance and skills are often inappropriate for a focused child and weaken profile ownership of its contract. |
| Permit recursive toolkit delegation with an explicit depth limit | Weakens the structural guarantee against accidental delegation chains and adds orchestration policy without a present need. |

## Status history

- 2026-08-14: Proposed
- 2026-08-14: Accepted; content-sha256: ccf778ae90b07f593f60e21609ff3fde7d5bdb6b5ea6c235de91565865daf8c1
- 2026-08-14: Implementing; content-sha256: ccf778ae90b07f593f60e21609ff3fde7d5bdb6b5ea6c235de91565865daf8c1
- 2026-08-14: Applied; operations: add `development/subagent-toolkit:profile-runtime`
- 2026-08-14: Implemented; content-sha256: ccf778ae90b07f593f60e21609ff3fde7d5bdb6b5ea6c235de91565865daf8c1
