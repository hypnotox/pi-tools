---
format: plan-v2
date: 2026-08-14
adrs: [subagent-profile-toolkit]
status: Proposed
---
# Plan: Subagent Profile Toolkit

## Goal

Ship a standalone Pi extension that delegates work through typed subagent profiles and exposes a versioned profile-integration API. Consumer-specific configuration, package provisioning, recursive delegation, context-file or skill injection, and an in-process child runner are out of scope.

## Architecture summary

A public type module defines profile schemas, callbacks, tool policies, registration batches, execution outcomes, and bounded persisted profile data. A registry owns the built-in profile, validates consumer batches atomically, derives default suppression, and creates one Pi tool per active profile. A scheduler owns per-profile concurrency and exclusive parent-batch enforcement. Tool selection resolves either an exact allowlist or the parent's active tools minus profile exclusions, then always removes every registered profile tool.

A process runner launches fresh ephemeral Pi children from the working directory returned by profile preparation. Children receive a minimal profile prompt, normal extension discovery, disabled context-file and skill discovery, an exact tool allowlist, the chosen model, and the clamped effective thinking level. A child marker prevents every toolkit instance in the child runtime from activating profile tools. The runner owns bounded event parsing, request-retry state, usage aggregation, cancellation, process termination, temporary-file cleanup, and final outcomes.

The Pi adapter owns the versioned event-bus handshake, profile finalization at session start, callback orchestration, error marking, persistence, and one common renderer. Dependency direction points from the adapter through the registry and execution service to the process runner; profile callbacks supply policy but never depend on runner internals. The built-in `subagent` profile uses the same public contract as consumer profiles.

## Phase 1: Ship the standalone profile runtime

**Execution mode: subagent-driven.**

Completes: ["standalone-default", "isolated-bounded-runtime"]

### Task 1.1: Define the typed profile model, tool policy, and scheduler
Applying: ["subagent-profile-toolkit:profile-boundary", "subagent-profile-toolkit:callback-policy", "subagent-profile-toolkit:standalone-default"]
Paths: ["extensions/subagents/api.ts", "extensions/subagents/api.test.ts", "extensions/subagents/profile-registry.ts", "extensions/subagents/profile-registry.test.ts", "extensions/subagents/tool-policy.ts", "extensions/subagents/tool-policy.test.ts", "extensions/subagents/scheduler.ts", "extensions/subagents/scheduler.test.ts"]

Start from the review-settled `subagent-profile-toolkit` decision and the existing strict extension quality gate. Define TypeBox-inferred profile arguments and profile-result schemas, concrete model and thinking selections, prepared-run data, typed pre-run state, post-run transformation, execution outcomes, registration batches, and toolkit execution details. Keep callback state ephemeral. Require runtime validation and bounded JSON serialization for persisted profile data while leaving its object shape consumer-owned.

Build a registry that uses the built-in profile through the same definition path as later consumer profiles, rejects duplicate profile IDs and tool names before mutation, and exposes the complete profile-tool deny set. Implement tool policies for an exact allowlist or parent-active tools with additional exclusions; both modes remove every profile tool after consumer policy is evaluated. Implement FIFO, abort-aware per-profile concurrency and explicit exclusive-batch validation without relying on Pi's global sequential execution mode.

Tests must prove schema inference through compile-time fixtures, invalid callback/result rejection, atomic internal registration, deny-set precedence, unknown and duplicate tool handling, queue fairness, queued cancellation, release after failure, and exclusive sibling-batch rejection.

### Task 1.2: Implement the isolated subprocess runner
Applying: ["subagent-profile-toolkit:isolated-child-runtime", "subagent-profile-toolkit:request-retries"]
Paths: ["extensions/subagents/runner.ts", "extensions/subagents/runner.test.ts"]

Implement a dependency-injected runner that invokes the current Pi executable in JSON print mode with no session, a minimal custom system prompt, disabled context-file and skill discovery, exact model and thinking arguments, and the computed `--tools` allowlist. Launch from the canonical prepared working directory and set a private child-runtime marker. Pi must continue loading extensions. Pass temporary project approval only when the parent reports trust and the canonical child directory equals or descends from the canonical parent directory; otherwise leave trust resolution to Pi.

Bound stdout, stderr, assistant reports, failure text, retained activity count, individual activity payloads, and retry diagnostics. Parse assistant completion, tool start/end, and `auto_retry_start`/`auto_retry_end` events; aggregate usage and expose retry state without retrying the process. On cancellation or runner failure, terminate the complete child process tree with a bounded graceful-to-forced sequence. Create prompt files with restrictive permissions and remove every temporary resource in `finally` paths.

Runner tests use fake processes, clocks, and filesystems to prove exact arguments and environment, canonical CWD/trust decisions including path-prefix and symlink escapes, malformed and oversized streams, bounded multibyte truncation, usage totals, retry transitions, abort before launch and during retry, process-tree escalation, close/error races, and cleanup after every terminal path.

### Task 1.3: Register the default tool and render common execution state
Applying: ["subagent-profile-toolkit:standalone-default", "subagent-profile-toolkit:bounded-observability", "subagent-profile-toolkit:callback-policy"]
Paths: ["extensions/subagents/index.ts", "extensions/subagents/index.test.ts", "extensions/subagents/rendering.ts", "extensions/subagents/rendering.test.ts"]

Compose registry, scheduler, callbacks, and runner into one extension. Register `subagent` with required `task` and optional exact `model` and `thinkingLevel` inputs. Its callbacks select explicit values or inherit the parent model and thinking level, use the parent CWD, and inherit parent-active tools. Validate the chosen model against the current registry, clamp thinking to that model's capabilities, serialize default invocations, and reject sibling parent tool calls.

Mark the private child runtime before profile activation: child instances may collect profile names for defense in depth but must never register or activate profile tools. Capture every callback, scheduling, and runner failure into the same bounded result shape, then use tool-result middleware to mark terminal failures as errors without discarding details. Persist only final execution details and runtime-validated profile data.

Provide one compact/expanded renderer for profile identity, state, CWD, chosen model, effective thinking, queue and retry state, bounded activity with omission counts, usage and cost, report or failure, and bounded expanded profile JSON. Tests must restore historical results without live state, cover partial and final rendering, ensure profile data never enters model-visible content unless a post-run callback deliberately changes the report, and prove session shutdown clears timers, queues, and child resources.

### Task 1.4: Expose the standalone resource and document its behavior
Kind: batch
Applying: ["subagent-profile-toolkit:standalone-default", "subagent-profile-toolkit:isolated-child-runtime", "subagent-profile-toolkit:bounded-observability", "subagent-profile-toolkit:request-retries"]
Paths: ["package.json", "package-lock.json", "README.md", "docs/testing.md"]
Representative: Resolve `docs/testing.md` to its provenance-declared authored source, update the source, and regenerate the rendered guide.
Edge: Never hand-edit generated documentation; restore the temporary Biome override even when a check fails, and reject a successful check that processed zero intended files.
Post-check: Resolve the authored source for `docs/testing.md` from its generated provenance, render it, and require the changed documentation set to remain confined to that source, `docs/testing.md`, README, and expected generated lock output. Run the executable-resource gate with an ephemeral, fully restored Biome include override covering the exhaustive population `biome.json`, `knip.json`, `package.json`, `tsconfig.json`, `types/**`, `extensions/**`, `tests/**`, `prompts/**`, and `themes/**`; require every intended file to be processed, then require the ordinary repository check to pass and the override to leave no diff.

Declare every directly imported Pi core package as a wildcard peer and keep test tooling in development dependencies. Ensure package discovery loads only the directory entry point rather than helper and test modules. Document the default tool schema, inheritance, serialization/exclusivity, minimal child prompt, CWD/trust boundary, tool isolation, extension loading, recursion prohibition, retry ownership, persisted-details behavior, limits, reload, and standalone installation.

Add focused testing guidance through the generated document's provenance-declared authoritative source and a non-network smoke that loads the extension through Pi's supported extension flag without diagnostics. Before phase close, verify the complete extension gate and repository checks, then run the smoke from a clean dependency installation under Node.js 20 and report the actual version and results as phase evidence for parent-owned reconciliation.

### Phase close

Close only when installing the package exposes exactly one functional default subagent tool, every child receives the selected CWD/model/effective thinking/tools without context files or skills, recursion and sibling overlap are prevented, all outputs and resources are bounded and cleaned up, retry state comes only from child Pi events, documentation matches the visible behavior, and the complete checks pass.

```commit
feat(extensions): add standalone subagent toolkit
```

## Phase 2: Expose atomic profile integration

**Execution mode: subagent-driven.**

Completes: ["profile-integration", "typed-documented-contract"]

### Task 2.1: Implement the versioned capability handshake and batch finalization
Applying: ["subagent-profile-toolkit:capability-handshake", "subagent-profile-toolkit:profile-boundary"]
Paths: ["extensions/subagents/api.ts", "extensions/subagents/api.test.ts", "extensions/subagents/profile-registry.ts", "extensions/subagents/profile-registry.test.ts", "extensions/subagents/index.ts", "extensions/subagents/index.test.ts"]

Start from Phase 1's green standalone profile runtime and shared registry path. Add a protocol-versioned request/capability exchange over `pi.events`. Both sides can listen before announcing or requesting; correlation and idempotence prevent duplicate registration when announcements are replayed. The capability reply exposes only supported facts and the profile-registration API. It performs no dependency discovery or installation.

Collect syntactically valid batches during factory initialization, then freeze and finalize them during `session_start`, when the complete existing tool snapshot is available. Validate every batch fully before registering any of its tools. Reject a colliding batch as a unit, report its final registration outcome, and derive default suppression only from successful batches. Define deterministic handling for duplicate delivery, several suppressing consumers, missing consumers, and registration attempts after finalization. Collision guarantees cover the finalization snapshot; later unrelated dynamic overrides remain Pi-owned behavior.

In a marked child runtime, accept enough registration information to discover profile tool names but finalize no profile tools and remove all discovered names from the active tool set. Tests exercise both extension load orders, duplicate requests and replies, multiple valid batches, invalid and colliding batches, failed suppression, reload and session replacement, late registration, child-only profile names, and absence or incompatibility handling without consumer-specific diagnostics.

### Task 2.2: Publish canonical types and integration evidence
Applying: ["subagent-profile-toolkit:capability-handshake", "subagent-profile-toolkit:bounded-observability"]
Paths: ["package.json", "package-lock.json", "tsconfig.json", "knip.json", "extensions/subagents/api.ts", "tests/subagent-integration.test.ts", "README.md"]

Expose a package subpath for canonical profile and handshake types while keeping runtime consumers on the event bus. Ensure type-only consumption emits no runtime import and that the source package remains directly installable without a build step. Add integration tests that compile an independently typed consumer profile, negotiate capabilities, atomically replace the default surface, execute through fake runner dependencies, preserve typed hook state and profile data, and restore the persisted result.

Extend README with a minimal consumer-neutral profile example, capability-version checks, atomic default suppression, callback ownership, result-data bounds, and the rule that dependency provisioning and incompatibility policy belong to the consumer. Repeat the Pi load smoke and confirm helper modules are not discovered as standalone extensions.

### Task 2.3: Apply current-state authority and complete verification
Kind: batch
Applying: ["subagent-profile-toolkit:profile-boundary", "subagent-profile-toolkit:capability-handshake", "subagent-profile-toolkit:isolated-child-runtime", "subagent-profile-toolkit:callback-policy", "subagent-profile-toolkit:standalone-default", "subagent-profile-toolkit:bounded-observability", "subagent-profile-toolkit:request-retries"]
Paths: ["docs/decisions/subagent-profile-toolkit.md", "docs/decisions/INDEX.md", "docs/topics/development/subagent-toolkit.md", "docs/testing.md", "README.md"]
Representative: Resolve the dedicated topic and testing documents to their provenance-declared authored sources, apply the claim and guidance there, then regenerate the rendered outputs and index.
Edge: Keep the ADR operation and matching claim pair-atomic, leave terminal status for later closure, never hand-edit generated outputs, and restore the temporary verification override on every exit path.
Post-check: Resolve the dedicated topic's authored current-state source and every generated document source from provenance, render them, and require the changed-path set to remain confined to those sources, the linked decision and index, the rendered topic/testing documents, README, and expected generated lock output. Require the sole operation to appear as Applied with its matching claim and no Remaining operations. Run the executable-resource gate through the exhaustive, ephemeral Biome include override defined in Task 1.4, require the ordinary repository check and Pi smoke to pass, restore the override, and confirm a clean verification diff.

Transition the linked decision to Implementing and apply its sole `add development/subagent-toolkit:profile-runtime` operation with the matching current-state claim in the same governed transaction. The claim must describe the shipped profile boundary, handshake, callback ownership, child isolation, recursion guard, default profile, bounded observability, and retry ownership without freezing implementation-only file structure. Resolve and edit the topic's provenance-declared authoritative source, regenerate the rendered topic and decision index, and leave the later Implemented status-only transition to terminal closure.

Run the complete repository and extension gates, clean Node.js 20 installation evidence, Pi load smoke, and focused semantic review of README, testing guidance, the rendered current-state topic, public types, and tool descriptions. Confirm these surfaces agree on default visibility, per-invocation CWD, trust propagation, disabled context and skills, extension loading, tool policy, recursion, callback ownership, retry behavior, bounds, and missing-capability responsibility. Report the evidence and any authority-preserving implementation deviation as phase evidence for parent-owned reconciliation.

### Phase close

Close only when independent extensions can negotiate either load order, validate capabilities, register fully typed profile batches atomically, suppress the default only through a successful batch, and receive bounded persisted results; the standalone default remains unchanged without a consumer; the public type subpath compiles without runtime coupling; the current-state operation is applied; documentation and smoke evidence match the implementation; and every check passes.

```commit
feat(extensions): expose subagent profile API (applies profile-runtime)
```

## Definition of done

- `dod: standalone-default` Installing the package exposes a serialized, exclusive `subagent` tool whose optional model and requested-thinking inputs override parent inheritance while CWD and active tools inherit safely.
- `dod: isolated-bounded-runtime` Every invocation runs in a fresh, cancellable Pi subprocess with a minimal prompt, explicit tools, descendant-scoped trust propagation, structural toolkit-recursion prevention, Pi-owned transient retries, bounded events/results/persistence, and deterministic cleanup.
- `dod: profile-integration` A version-compatible extension can negotiate either load order and atomically register typed profile tools while suppressing the default; invalid, colliding, late, missing, or incompatible registration leaves a deterministic safe surface.
- `dod: typed-documented-contract` Canonical package types, runtime schemas, common rendering, README, testing guidance, current-state authority, Node.js 20 evidence, and Pi smoke consistently describe and verify the shipped toolkit.

## Notes

- Plan review moved the package-level integration test to `tests/` and explicitly extended TypeScript and Knip populations. This follows the existing cross-resource testing convention while keeping colocated unit tests beside the extension.
- The managed worktree's canonical path matches a repository Biome exclusion, so both phase post-checks require an exhaustive ephemeral include override, restoration, and a clean diff rather than accepting a zero-file formatting or lint result.
- Generated testing and current-state documents are updated through provenance-resolved authoritative sources without naming integration-specific tooling in this consumer-neutral plan.
- Phase 1 review settlement completed the typed profile-data schema, model-capability resolution, sibling-batch exclusion, bounded execution details, error marking, stream framing, process-tree shutdown, parser-safe stdin task transport, full-run shutdown tracking, and adapter regression coverage within the declared architecture.
