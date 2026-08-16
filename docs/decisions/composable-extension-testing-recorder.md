---
format: current-state-v4
slug: composable-extension-testing-recorder
status: Implementing
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

1. `decision: configurable-composable-recorder` Keep `pi-tools/testing` as the framework-neutral reusable owner of supported Pi extension-boundary recordings, but configure its capabilities and behaviors before installing any number of synchronous or asynchronous factories. Track and expose every installation as awaitable, make each raw invocation await every prior installation, propagate asynchronous installation failures without an initial-only readiness hole, and preserve synchronous factory execution for factory-time negotiation. Preserve explicit capability omission and permit typed opt-in additions for otherwise unmodeled `ExtensionAPI` capabilities instead of speculatively mirroring the complete API.
2. `decision: first-class-recording-surface` Expose recorded API calls, ordered handlers, tools, ordered command registrations, entry renderers, appended entries, queued commands, and mutable active and all-tool discovery. Keep `setActiveTools`, `invokeRaw`, `invokeToolDirect`, and `invokeCommandDirect` as first-class typed surfaces.
3. `decision: deterministic-raw-semantics` Share one synchronous event bus across every installed factory so factory-time negotiation remains synchronous. Preserve duplicate listeners, registration and nested-emission order, per-registration unsubscribe, ordered emission history, and listener-error propagation. Raw handler, tool, and command helpers await every prior factory installation and forward arguments, results, and failures without schema validation, middleware, error envelopes, session scheduling, command suffix routing, or other Pi runtime behavior.
4. `decision: direct-command-selection` Preserve duplicate command registrations in order. Name-only direct invocation rejects zero or multiple matches; an explicit validated registration index selects a duplicate.
5. `decision: injectable-exec-boundary` Model `exec` with Pi's exact public command, argument, option, and result types; record calls in order; support injected resolved, rejected, killed, and deferred outcomes; and fail clearly when no behavior is configured. Do not attach Git, AWF, subprocess, or other execution policy.
6. `decision: composable-context-fixtures` Provide a recording UI whose `notify`, `select`, `confirm`, and `input` calls are recorded, whose dialog responses are injectable, and whose remaining public methods are inert. Provide a mutable model registry with add, remove, and find controls plus availability and configured-auth state exposed through exact `getAll`, `getAvailable`, `find`, and `hasConfiguredAuth` query behavior. Compose ordinary and command contexts from those fixtures with an in-memory session, model, cwd, and caller overrides; produce fresh replacement contexts; and preserve new-session setup identity in its replacement context. Do not add model routing, provider, TUI-rendering, lifecycle-scenario, or session-scheduling policy.
7. `decision: bounded-adopter-neutrality` Keep adopter-specific seams local and exclude fake providers and Pi runtimes, lifecycle scenario engines, TUI or tool-render scenarios, file-mutation queues, and Git, worktree, filesystem, UUID, clock, subprocess, AWF, profile, routing, effort, or Remote Pi fixtures.

## State changes

- update `development/extension-toolchain:reusable-extension-testing`

## Consequences

Adopters can share one recorder for generic Pi-boundary behavior while retaining small local seams for
their own policy. Multiple factories can negotiate synchronously through one event bus, and every
raw invocation observes the complete prior installation set. Exact `exec` types and response-driven
fixtures make success, failure, cancellation, and deferred behavior explicit without spawning a
process.

The public pre-1.0 API breaks and requires a minor release. Existing consumers and repository tests
must migrate construction, installation, invocation, fixture configuration, and duplicate-command
selection to the redesigned contracts, creating one-time regression risk. Supporting only selected
capabilities means consumers must opt in when their extension crosses an unmodeled API seam. Raw
helper behavior is intentionally easier to observe than Pi runtime behavior, so documentation and
the separate SDK proof must keep that distinction explicit.

Mutable fixtures require a confined translation from their structural test representation to Pi
context types. They do not become substitute providers, registries, runtimes, schedulers, or routing
engines. The broader shared surface also increases compatibility responsibility, bounded by the Pi
version this repository currently develops and verifies against.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Add adopter-only helpers locally | Preserves duplicate generic Pi-boundary fixtures and leaves the public recorder insufficient for its intended adopters. |
| Preserve the v0.2 API through incremental additions or an adapter | Constructor-time installation and lossy event and command representations conflict with configure-before-install and duplicate-preserving semantics; retaining both models would prolong ambiguity in a pre-1.0 boundary. |
| Mirror every `ExtensionAPI` capability | Creates speculative maintenance and implies completeness the recorder does not provide. |
| Reproduce Pi command, lifecycle, and error handling | Turns a raw test seam into a second runtime whose fidelity would be costly and misleading. |
| Execute real subprocesses for `exec` | Adds machine and process policy where deterministic typed injection is sufficient. |
| Select the first or last duplicate command implicitly | Hides ambiguity and diverges silently as factory order changes. |

## Status history

- 2026-08-16: Proposed
- 2026-08-16: Implementing; content-sha256: 46359a2c2334cc59374d1572ed570353bc254dba9c38151951ba2d7101ef62c8
- 2026-08-16: Applied; operations: update `development/extension-toolchain:reusable-extension-testing`
