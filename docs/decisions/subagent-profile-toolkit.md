---
format: current-state-v4
slug: subagent-profile-toolkit
status: Proposed
date: 2026-08-14
---
# ADR-subagent-profile-toolkit: Subagent Profile Toolkit

## Context

The package exports executable Pi extensions but has no reusable boundary for delegating work to fresh-context child agents. A specialized extension can launch a child directly, but repeating process supervision, scheduling, tool confinement, model selection, result persistence, and rendering across integrations would duplicate the difficult policy while coupling each implementation to one caller's configuration.

Pi extensions share a synchronous event bus but separately installed Pi packages do not share module roots. Pi also discovers extensions independently in every process. A reusable boundary therefore needs runtime capability negotiation rather than direct runtime imports, and it must prevent a child from exposing the same delegation tools that launched it. At the same time, model routing, prompts, working-directory selection, and verification rules vary by integration and should not become toolkit configuration.

The first implementation should serve known integration requirements without predicting a general orchestration framework. It must remain standalone, preserve Pi's own request retry behavior, bound all child output and persisted data, and keep extension-owned policy strongly typed.

## Decision

1. `decision: profile-boundary` Provide a consumer-neutral subagent toolkit whose unit of composition is a typed profile that registers exactly one Pi tool. The toolkit owns execution mechanics and common presentation; profiles own their schemas, instructions, model and thinking selection, working directory, tool policy, lifecycle policy, and bounded result data.
2. `decision: capability-handshake` Expose runtime integration through a versioned, load-order-tolerant Pi event-bus capability handshake. Consumers publish profiles in atomic, owner-identified batches and may suppress the built-in default profile in the same transaction. Export canonical TypeScript types for compile-time use without requiring runtime module sharing.
3. `decision: isolated-child-runtime` Run each invocation in a fresh Pi subprocess with a minimal profile prompt, explicit effective tool allowlist, selected working directory, normal extension loading, and automatic context-file and skill loading disabled. Toolkit profile tools are unavailable in child runtimes, making recursive toolkit delegation structurally unavailable.
4. `decision: callback-policy` Keep routing and integration policy outside toolkit configuration. Profiles provide typed callbacks for concrete model selection, optional thinking-level selection, run preparation, and optional pre-run and post-run processing. The toolkit validates callback outputs, clamps the effective thinking level, schedules execution, preserves a bounded standard result envelope, and marks terminal failures without interpreting consumer fallback or verification semantics.
5. `decision: standalone-default` Ship an enabled default `subagent` profile with task plus optional exact model and thinking-level arguments. It otherwise inherits the parent model, thinking level, working directory, and active tools; removes all toolkit profile tools; runs serially; and must be alone in its parent tool batch.
6. `decision: bounded-observability` Persist only final JSON-serializable profile data inside a versioned toolkit result envelope. Use one toolkit-owned renderer for identity, state, working directory, model, effective thinking level, retry state, bounded activity, usage, report, failure, and expanded bounded profile data. Rely on the child Pi process for transient request retries and never retry the whole subprocess.

## State changes

- add `development/extension-toolchain:subagent-profile-toolkit`

## Consequences

- The package is useful on its own while allowing focused integrations to replace the default surface without forking the runtime.
- Consumers retain full control of configuration and policy, but must implement and test their callbacks and handle missing or incompatible capabilities themselves.
- A fresh subprocess provides strong context isolation and preserves extension-provided models, at the cost of startup overhead.
- Normal child extension loading preserves provider availability but remains part of Pi's trusted-extension boundary; a tool allowlist does not sandbox extension code.
- Event-bus negotiation needs replay, correlation, idempotence, registration finalization, and collision handling because the bus is synchronous and unbuffered.
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

## Status history

- 2026-08-14: Proposed
