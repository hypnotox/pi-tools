---
format: current-state-v4
slug: composable-extension-testing-recorder
status: Proposed
date: 2026-08-16
---
# ADR-composable-extension-testing-recorder: Composable Extension Testing Recorder

## Context

ADR-0008 established a public, source-only, framework-neutral testing boundary for documented Pi
extension seams while reserving Pi runtime behavior for real SDK verification. Its first recorder
consolidated this repository's fixtures, but adopter work now needs a composable boundary that can
replace generic Pi API, event, context, UI, model-registry, command, and tool fixtures without
absorbing adopter policy.

The current recorder installs one factory during construction, captures only its initial readiness,
deduplicates event listeners through a `Set`, overwrites duplicate command registrations, and
provides inert UI and model-registry objects that cannot express ordinary test outcomes. Its
name-only tool metadata is also narrower than Pi's public `ToolInfo` surface. These representations
cannot carry multiple negotiating factories, deferred `exec` outcomes, duplicate listeners or
commands, or reusable response-driven contexts.

The recorder remains a direct test seam rather than a fake Pi runtime. Pi catches event-listener
errors and assigns suffixes to duplicate command names at runtime; raw recorder calls instead expose
errors and require explicit duplicate selection so tests stay deterministic without reproducing
runtime routing or error handling. Pi's public `exec` contract has one `ExecResult` shape, including
the `killed` cancellation signal, so injected outcomes must preserve that exact type rather than add
a synthetic cancellation union.

## Decision

1. `decision: configurable-composable-recorder` Keep `pi-tools/testing` as the framework-neutral reusable owner of supported Pi extension-boundary recordings, but configure its capabilities and behaviors before installing any number of synchronous or asynchronous factories. Preserve explicit capability omission and permit typed opt-in additions for otherwise unmodeled `ExtensionAPI` capabilities instead of speculatively mirroring the complete API.
2. `decision: deterministic-raw-semantics` Preserve each supported API call and registration in order. Raw event communication is synchronous, preserves duplicate listeners and nested emission, removes only the unsubscribed registration, records emission order, and propagates listener errors. Raw handler, tool, and command helpers await every prior factory installation and forward arguments, results, and failures without schema validation, middleware, error envelopes, session scheduling, command suffix routing, or other Pi runtime behavior.
3. `decision: direct-command-selection` Preserve duplicate command registrations in order. Name-only direct invocation rejects zero or multiple matches; an explicit validated registration index selects a duplicate.
4. `decision: injectable-exec-boundary` Model `exec` with Pi's exact public command, argument, option, and result types; record calls in order; support injected resolved, rejected, killed, and deferred outcomes; and fail clearly when no behavior is configured. Do not attach Git, AWF, subprocess, or other execution policy.
5. `decision: composable-context-fixtures` Provide composable recording UI, mutable model-registry, ordinary context, command context, and fresh replacement-context fixtures. Record and inject the supported dialog and notification methods, model availability and configured-auth state, and command-session transitions while preserving new-session setup identity, without adding model routing, provider, TUI-rendering, lifecycle-scenario, or session-scheduling policy.
6. `decision: bounded-adopter-neutrality` Keep adopter-specific seams local and exclude fake providers and Pi runtimes, lifecycle scenario engines, TUI or tool-render scenarios, file-mutation queues, and Git, worktree, filesystem, UUID, clock, subprocess, AWF, profile, routing, effort, or Remote Pi fixtures.

## State changes

- update `development/extension-toolchain:reusable-extension-testing`

## Consequences

Adopters can share one recorder for generic Pi-boundary behavior while retaining small local seams for
their own policy. Multiple factories can negotiate synchronously through one event bus, and every
raw invocation observes the complete prior installation set. Exact `exec` types and response-driven
fixtures make success, failure, cancellation, and deferred behavior explicit without spawning a
process.

The public pre-1.0 API breaks and requires a minor release. Supporting only selected capabilities
means consumers must opt in when their extension crosses an unmodeled API seam. Raw helper behavior
is intentionally easier to observe than Pi runtime behavior, so documentation and the separate SDK
proof must keep that distinction explicit.

Mutable fixtures require a confined translation from their structural test representation to Pi
context types. They do not become substitute providers, registries, runtimes, schedulers, or routing
engines. The broader shared surface also increases compatibility responsibility, bounded by the Pi
version this repository currently develops and verifies against.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Add adopter-only helpers locally | Preserves duplicate generic Pi-boundary fixtures and leaves the public recorder insufficient for its intended adopters. |
| Mirror every `ExtensionAPI` capability | Creates speculative maintenance and implies completeness the recorder does not provide. |
| Reproduce Pi command, lifecycle, and error handling | Turns a raw test seam into a second runtime whose fidelity would be costly and misleading. |
| Execute real subprocesses for `exec` | Adds machine and process policy where deterministic typed injection is sufficient. |
| Select the first or last duplicate command implicitly | Hides ambiguity and diverges silently as factory order changes. |

## Status history

- 2026-08-16: Proposed
