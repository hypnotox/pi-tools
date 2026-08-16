---
format: plan-v2
date: 2026-08-16
adrs: [composable-extension-testing-recorder]
status: Implemented
---
# Plan: Composable Extension Testing Recorder

## Goal

Replace the v0.2 constructor-installed harness with a configurable, multi-factory, framework-neutral
Pi extension recorder and composable fixtures that are sufficient for neutral adopter API, event,
context, UI, model-registry, command, and tool tests. Keep runtime, provider, rendering, machine,
subprocess, AWF, and adopter policy simulation outside the public boundary; leave the integrated tree
ready for the separately governed v0.3.0 release transaction.

## Architecture summary

The source-only `pi-tools/testing` module exposes a configured recorder before any factory installs.
The recorder owns ordered registration and call state, one shared synchronous event bus, per-install
readiness, exact typed `exec` injection, mutable tool discovery, and raw handler, tool, and command
invocation. It models only explicitly supported `ExtensionAPI` capabilities; omission removes a
capability, and generic typed additions extend the partial recorder at its single factory-install
translation edge without claiming a complete API mirror. Every supported injected behavior records
its call before delegating.

Reusable fixture controllers own recording UI state and exact dialog response injection, mutable
model catalogue/availability/auth state, and ordinary or command context composition. The context
boundary uses public in-memory sessions, exact Pi public types, caller-supplied model and cwd values,
and fresh replacement contexts that retain a new session's setup identity. Exact `ToolInfo` discovery
state remains caller-controlled rather than inventing source provenance from a registered tool.

Raw operations deliberately call registered functions directly. They await the installations that
precede each invocation and preserve arguments and errors, but do not implement schema validation,
middleware, runtime command suffixes, event error swallowing, error envelopes, lifecycle scenarios,
or session scheduling. The separate public-SDK test remains the runtime proof. Repository consumers
migrate in the same green phase while clocks, countdowns, profiles, models, processes, streams,
rendering, and policy fixtures remain in their owning domains.

## Phase 1: Land the composable recorder boundary

**Execution mode: subagent-driven.**

Completes: ["recorder-contract", "composable-fixtures", "repository-adoption", "documented-boundary"]

### Task 1.1: Specify the breaking recorder contract with focused tests
Applying: ["composable-extension-testing-recorder:configurable-composable-recorder", "composable-extension-testing-recorder:first-class-recording-surface", "composable-extension-testing-recorder:deterministic-raw-semantics", "composable-extension-testing-recorder:direct-command-selection", "composable-extension-testing-recorder:injectable-exec-boundary", "composable-extension-testing-recorder:composable-context-fixtures", "composable-extension-testing-recorder:bounded-adopter-neutrality"]
Paths: ["testing/index.test.ts", "tests/testing-export.test.ts"]

Begin from the reviewed ADR and settled plan commits, after the execution owner confirms the managed
implementation snapshot is clean and the repository baseline is green. Rewrite the public contract
suite around configure-before-install construction and assert the complete approved behavior before
production implementation. Cover synchronous and multiple asynchronous
factories, late installs, per-install and aggregate readiness, raw invocation waiting for every prior
install, rejection propagation, and synchronous factory-time negotiation. Cover ordered API calls and
registrations; explicit omission; generic typed additions; and injected supported methods recording
before their behavior runs.

Exercise exact `exec` command, argument, and option forwarding with resolved, rejected, `killed`,
pre-aborted or abort-observing, and manually deferred outcomes plus the unconfigured failure. Exercise
one shared bus across factories with duplicate listeners, registration order, nested emits,
per-registration unsubscribe, ordered emission history, and raw listener-error propagation. Exercise
UI response queues or callbacks and records for `notify`, `select`, `confirm`, and `input`; inert
remaining UI methods; mutable model add/remove/find, availability, and configured-auth queries;
ordinary versus command contexts; fresh fork/switch/new-session replacement contexts; and
new-session setup identity.

Invoke tools with all five Pi arguments and commands with exact arguments and contexts. Preserve
thrown/rejected errors. Prove name-only command invocation rejects zero and multiple matches, while a
validated registration index selects duplicates and rejects invalid bounds. Keep the export smoke
framework-neutral by importing the package subpath without coupling public source to Vitest.

### Task 1.2: Implement the typed recorder and composable fixtures
Applying: ["composable-extension-testing-recorder:configurable-composable-recorder", "composable-extension-testing-recorder:first-class-recording-surface", "composable-extension-testing-recorder:deterministic-raw-semantics", "composable-extension-testing-recorder:direct-command-selection", "composable-extension-testing-recorder:injectable-exec-boundary", "composable-extension-testing-recorder:composable-context-fixtures", "composable-extension-testing-recorder:bounded-adopter-neutrality"]
Paths: ["testing/index.ts"]

Implement the smallest public source model that satisfies Task 1.1. Replace constructor-time factory
installation and the captured initial `ready` promise with a recorder configured first and explicit
`install()` calls. Execute each factory immediately, retain each installation promise, expose each as
awaitable, and snapshot all prior installations at raw invocation time so a later install cannot be
missed. Suppress no rejection except the internal unhandled-rejection guard needed before a consumer
awaits it.

Use arrays for event registrations and command registrations so duplicates remain distinct. Record
bus emissions in call order before synchronously traversing the current listener registrations, with
ordinary JavaScript nested-call and thrown-error behavior. Keep tool definitions and exact
caller-controlled `ToolInfo` discovery separate. Record `setActiveTools` before applying its injected
behavior or default state mutation. Type `exec` directly from Pi's public `ExtensionAPI` signature,
record exact arguments, and delegate only to configured behavior; the default throws a clear error.
Do not import a process runner or invent a cancellation type.

Expose recording UI and mutable registry controllers separately enough to compose or replace them.
Confine the registry structural cast necessitated by Pi's private runtime member to context
composition. Build ordinary, command, and replacement contexts from fresh public in-memory session
managers and explicit fixture/model/cwd/override inputs; share the newly created session manager
between `newSession.setup` and its replacement callback. Keep the deliberately partial-recorder to
complete-`ExtensionAPI` translation confined to factory installation, including typed additions.

### Task 1.3: Migrate every repository consumer without absorbing domain fixtures
Kind: batch
Applying: ["composable-extension-testing-recorder:first-class-recording-surface", "composable-extension-testing-recorder:deterministic-raw-semantics", "composable-extension-testing-recorder:direct-command-selection", "composable-extension-testing-recorder:composable-context-fixtures", "composable-extension-testing-recorder:bounded-adopter-neutrality"]
Paths: ["extensions/context-usage/index.test.ts", "extensions/handoff/index.test.ts", "extensions/runtime-guard.test.ts", "extensions/subagents/index.test.ts", "extensions/timing/index.test.ts", "tests/subagent-integration.test.ts", "tests/sdk-extension-integration.test.ts"]
Representative: Timing installs explicitly and consumes lifecycle, renderer, append-entry, and context recording; handoff consumes mutable discovery, ordered commands, raw lifecycle, direct tool/command calls, and replacement contexts; subagent tests consume repeated installs and shared factory-time event negotiation.
Edge: Preserve clocks, timers, countdowns, handoff failure injection, profile protocol data, model/routing policy, registries beyond the neutral fixture, deferred runner outcomes, subprocesses, streams, schemas, rendering state, and the credential-free public-SDK proof in their current domains.
Post-check: At the final Phase 1 working snapshot, run `npx vitest run testing/index.test.ts tests/testing-export.test.ts extensions/context-usage/index.test.ts extensions/handoff/index.test.ts extensions/runtime-guard.test.ts extensions/subagents/index.test.ts extensions/timing/index.test.ts tests/subagent-integration.test.ts tests/sdk-extension-integration.test.ts` and require every named suite green. Run checked `rg -n 'createExtensionHarness|Map<string, Set<\(value: unknown\) => void>>' testing extensions tests` and require exit 1 with no matches. This census targets the retired public constructor and Set-based bus only; the approved domain fixtures listed in Edge remain authorized. Run the complete `npm run check` gate over an exact external materialization of the final Phase 1 snapshot so Biome processes a nonzero exhaustive intended-file population and Knip resolves the checkout outside `.awf`; require every lane and the complete test suite green, then remove the materialization.

Migrate construction to the new recorder, configure all omissions, tool discovery, UI responses, model
state, event behavior, and additions before the first install, and await the applicable installation
or raw helper before inspecting asynchronous registrations. Replace direct command-map handler calls
with the named direct helper where they test raw command forwarding. Use exact `ToolInfo` seed values
where discovery matters; do not synthesize provenance inside production recorder code.

Leave the SDK integration proof on documented public Pi loading/session APIs and keep it credential-
free, isolated, and separate from the recorder. Preserve each existing behavioral assertion unless
the v0.3 contract replaces setup-only inspection with an equivalent recorder assertion.

### Task 1.4: Apply and document the reusable testing authority
Kind: batch
Applying: ["composable-extension-testing-recorder:configurable-composable-recorder", "composable-extension-testing-recorder:first-class-recording-surface", "composable-extension-testing-recorder:deterministic-raw-semantics", "composable-extension-testing-recorder:direct-command-selection", "composable-extension-testing-recorder:injectable-exec-boundary", "composable-extension-testing-recorder:composable-context-fixtures", "composable-extension-testing-recorder:bounded-adopter-neutrality"]
Paths: ["README.md", ".awf/topics/parts/development/extension-toolchain/current-state.md", ".awf/docs/parts/testing/layout.md", "docs/topics/development/extension-toolchain.md", "docs/testing.md", "docs/decisions/composable-extension-testing-recorder.md", "docs/decisions/INDEX.md", ".awf/awf.lock"]
Representative: README documents construction, installation/readiness, injectable exec/UI/registry behavior, and named raw/direct boundaries; the current-state claim records the reusable supported recorder while preserving source-only and separate-SDK authority.
Edge: Describe listener-error propagation only as raw-recorder behavior, never Pi runtime fidelity. Do not claim a complete `ExtensionAPI`, provider, runtime, scheduler, validator, or adopter-policy model. Keep package version, lockfile version, pinned install example, tag creation, and push for the post-assurance release transaction governed by `docs/releasing.md`.
Post-check: After updating authored sources and ADR history, run `./awf render`, inspect and stage the complete mutation population, then run `./awf check staged`. Require the cached documentation paths to contain only the authored current-state/testing sources, rendered topic/testing/decision-index outputs, README, ADR, and lockfile. Require the ADR history to show its one update operation Applied with status still `Implementing`, and require the claim to preserve `Origin: ADR-0008` while appending `Revised-by: ADR-composable-extension-testing-recorder`. Record focused semantic inspection of README, `docs/testing.md`, and the rendered extension-toolchain topic: examples configure before install; listener-error propagation is labeled raw-recorder behavior; omissions and source-only distribution remain explicit; no stale constructor-installed example or runtime-fidelity claim remains; and the public-SDK proof stays separate.

Update the single current-state claim rather than creating a second testing subject. Use the ADR
lifecycle handshake to enter `Implementing`, append the Applied update event, and mutate the claim in
the same transaction. Document the public source-only import and API with concise examples and state
the raw/direct no-simulation boundary. Keep the real public-SDK proof explicit and document that
specialized adopter and extension fixtures remain local.

### Phase close

Close the tested public recorder, all repository migrations, rendered authority, and the explicit ADR
application as one green transaction.

```commit
feat(testing): add recorder (applies ADR batch)
```

## Definition of done

- `dod: recorder-contract` A TypeScript-aware consumer configures the public recorder before installing any number of factories and can inspect every approved ordered recording, readiness result, exact typed `exec` outcome, shared raw event, and direct handler/tool/command call without framework or runtime simulation.
- `dod: composable-fixtures` Recording UI, mutable registry, and ordinary, command, and replacement contexts compose with caller overrides, preserve new-session identity, and add no provider, routing, scheduler, rendering, machine, or adopter policy.
- `dod: repository-adoption` Every pi-tools consumer uses the v0.3 recorder contract, focused migration and SDK tests pass, and specialized domain fixtures remain local.
- `dod: documented-boundary` README, testing guidance, current-state authority, ADR application history, and generated outputs describe the same source-only raw/direct boundary and leave versioning/tagging to the separately verified v0.3.0 release transaction.

## Notes

All Phase 1 review settlement occurs before its sole Phase close commit. Later corrections remain
separate governed transactions. Record reasoned deviations, review dispositions, focused evidence,
and rendered-prose inspection here.

After Phase 1 assurance settles, effort finalization integrates the implementation, completes the
ADR and plan lifecycle transaction, and then performs the governed release follow-up before effort
finish. Update `package.json`, `package-lock.json`, and the pinned README install example to `0.3.0`;
verify trusted Pi resource loading, the separate public-SDK proof, the full staged awf gate, the full
npm gate including minimum-Node evidence, and release-tree cleanliness; commit exactly
`chore(release): 0.3.0`; create annotated tag `v0.3.0`; and push the release commit and tag to `origin`
without moving an existing tag. `docs/releasing.md` remains the authority for this follow-up.

Plan review settlement: shortened the local phase subject without changing user-approved semantics;
made the green starting dependency, complete snapshot gate, render-before-stage ordering, deterministic
documentation inventory, and focused prose review explicit; confined all Phase 1 settlement to its
sole close commit; and recorded the separately governed version/tag/push transaction required to
finish the user outcome.

Phase 1 review settlement: independent review found settled installation failures could be forgotten,
duplicate unsubscribe removed the wrong registration, a Set-compatible bus remained, replacement
contexts discarded composed inputs, additions could replace supported recording methods without typed
signatures, `setActiveTools` lacked behavior injection, all-tool and model catalogue values were too
weakly typed, and the contract tests missed these cases. Each issue contradicted explicit ADR and D1
semantics, so no new user decision was required despite the reviewer's classification. The settlement
added failing regression coverage first, then retained all installation failures, introduced the
shared duplicate-preserving recording bus, removed Set compatibility, preserved context inputs and
session cwd, constrained typed additions, injected `setActiveTools`, used exact `ToolInfo` and Pi
model types, confined nominal registry translation to context composition, and migrated affected
consumer fixtures. Focused type and 52-test evidence passed before the complete settlement gate.
Renewed review found one mechanical live-array emission defect: self-unsubscribe skipped the following
listener. A failing regression test reproduced it, and per-emission registration snapshots fixed it
without changing nested synchronous emission semantics.
