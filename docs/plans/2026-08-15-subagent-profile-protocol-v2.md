---
format: plan-v2
date: 2026-08-15
adrs: [subagent-profile-protocol-evolution]
status: Proposed
---
# Plan: Subagent Profile Protocol V2

## Goal

Deliver the complete protocol-v2 profile contract required by awf, with deterministic tests and current user-facing and current-state documentation. Do not add Git-specific toolkit fields or redesign the subprocess runner or scheduler.

## Architecture summary

Extend the public profile API and registry-owned snapshots first, then adapt the toolkit registration and execution boundary to those validated values. Post-run policy remains consumer-owned through `profileData`; the toolkit translates an optional callback failure into common terminal execution details. Exclusive-call correlation fails closed only for the exclusive call itself. Registry finalization exposes its pending transitions to the toolkit, which installs accepted tools before publishing typed results. The same transaction updates the public documentation and applies the linked current-state claim.

## Phase 1: Deliver protocol v2

**Execution mode: subagent-driven.**

Completes: ["protocol-v2-contract", "protocol-v2-assurance", "protocol-v2-documentation"]

### Task 1.1: Extend the public API and registry model
Applying: ["subagent-profile-protocol-evolution:protocol-v2", "subagent-profile-protocol-evolution:profile-prompt-metadata", "subagent-profile-protocol-evolution:finalized-registration-event"]
Paths: ["extensions/subagents/api.ts", "extensions/subagents/api.test.ts", "extensions/subagents/profile-registry.ts", "extensions/subagents/profile-registry.test.ts"]

Begin only after review-settled ADR-subagent-profile-protocol-evolution is Accepted; its single claim operation is applied later in this phase after the complete behavior is present. Add focused failing tests for protocol version 2, the typed registration-result payload, optional prompt metadata validation, defensive guideline snapshotting, and exact pending-to-terminal transition reporting. Then add the public fields, schemas/constants/types, registry validation and snapshots, and a finalization return shape that reports each pending batch transition without emitting runtime events itself. Preserve idempotent receipts, atomic batches, immediate invalid rejection, and late-registration behavior.

### Task 1.2: Adapt profile execution and registration
Applying: ["subagent-profile-protocol-evolution:profile-prompt-metadata", "subagent-profile-protocol-evolution:post-run-policy-failure", "subagent-profile-protocol-evolution:fail-closed-exclusivity", "subagent-profile-protocol-evolution:finalized-registration-event"]
Paths: ["extensions/subagents/index.ts", "extensions/subagents/index.test.ts", "tests/subagent-integration.test.ts"]

Add focused failing tests, then forward validated prompt metadata to `pi.registerTool`; normalize callback failures into bounded failed execution details while retaining validated `profileData`, usage, activity, retries, and execution identity; keep cancellation authoritative and failure text model-visible. Replace the fabricated singleton correlation fallback with an unavailable result, blocking only an uncorrelated exclusive profile call with a retry-alone reason. After all accepted tools are installed and exclusivity state is ready, emit exactly one typed result for every finalization transition with protocol version, stable `registrationId`, final state, and optional reason. Exercise both extension load orders and verify that registered events cannot observe an absent accepted tool.

### Task 1.3: Apply authority and document the consumer contract
Applying: ["subagent-profile-protocol-evolution:protocol-v2", "subagent-profile-protocol-evolution:profile-prompt-metadata", "subagent-profile-protocol-evolution:post-run-policy-failure", "subagent-profile-protocol-evolution:fail-closed-exclusivity", "subagent-profile-protocol-evolution:finalized-registration-event"]
Paths: ["README.md", ".awf/topics/parts/development/subagent-toolkit/current-state.md", "docs/topics/development/subagent-toolkit.md", "docs/decisions/subagent-profile-protocol-evolution.md", "docs/decisions/INDEX.md", ".awf/awf.lock"]

Document protocol-v2 negotiation, profile prompt guidance, callback policy failures with schema-owned audit data, fail-closed exclusive correlation, and factory-time result subscription. Update `development/subagent-toolkit:profile-runtime` without overstating Git-specific behavior. Use the ADR lifecycle procedure to append the Implementing and matching Applied events for the single claim operation, render awf-owned outputs, and inspect the generated claim and index for the intended meaning.

### Phase close

Close one coherent transaction containing the API, runtime behavior, tests, user documentation, claim mutation, and matching ADR application history.

```commit
feat(extensions): add subagent profile protocol v2
```

## Definition of done

- `dod: protocol-v2-contract` A version-2 consumer can register prompt-guided profiles, retain validated policy-audit data on terminal callback failure, rely on fail-closed exclusive-call correlation, and receive a correlated final registration result after tool installation.
- `dod: protocol-v2-assurance` Focused tests cover validation and snapshots, completed/failed/cancelled post-run precedence, correlation availability, finalization transitions, event ordering, both extension load orders, and unchanged immediate-invalid and late receipts; the full repository gate passes over the managed-worktree snapshot.
- `dod: protocol-v2-documentation` README and the rendered subagent-toolkit claim describe the shipped protocol accurately, and ADR-subagent-profile-protocol-evolution records its Applied claim operation while remaining Implementing until terminal effort closure.

## Notes

Inline owners immediately correct stale instructions and record reasoned deviations here. Delegated owners may report rather than edit; the parent supplies the report to phase review and reconciles it with findings in one focused post-review settlement commit before checkpointing or later execution. Record deviations, spike answers, follow-ups, and findings surfaced during implementation.

- Phase 1 review: signal-only cancellation after runner completion could retain a noncancelled terminal state. Disposition: treat this as authority-preserving rather than a new user decision because the approved ADR makes cancellation authoritative; force the final state to cancelled and cover abort during `afterRun`.
- Phase 1 review: empty policy failures could create a failed result without model-visible failure text. Disposition: require a non-whitespace failure in the public post-run schema and add boundary tests.
