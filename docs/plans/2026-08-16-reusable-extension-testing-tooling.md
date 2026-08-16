---
format: plan-v2
date: 2026-08-16
adrs: [reusable-extension-testing-boundary]
status: Proposed
---
# Plan: Reusable Extension Testing Tooling

## Goal

Offer a source-only `pi-tools/testing` boundary for TypeScript-aware adopter tests and make it the
single home for every reusable Pi extension-boundary fixture in this repository. Do not add compiled
JavaScript, a Vitest dependency to the public helper, historical Pi-version support, a public SDK
session fixture, TUI assertions, or shared timer, process, and stream fakes.

## Architecture summary

A framework-neutral testing module records the documented public `ExtensionAPI` surface while
providing deterministic ordinary and command contexts, capability omission, raw lifecycle-handler
invocation, event-bus traffic, registration inspection, and direct registered-tool invocation. It
uses a capability-oriented partial representation internally and crosses to Pi's complete
`ExtensionAPI` type only where an extension factory is installed. It does not reproduce Pi's event
middleware, error-envelope, or session-orchestration semantics.

Tests depend on this public module wherever they exercise the Pi adapter boundary; pure extension
models and specialized clocks, countdowns, schedulers, subprocesses, streams, and rendering fixtures
remain owned by their domains. A separate package integration test uses Pi's public resource loader,
in-memory managers, and agent-session construction without prompting or network credentials to prove
real loading and registration behavior. Compatibility follows the Pi version in the repository's
current development lockfile.

## Phase 1: Establish and shape the public testing boundary

**Execution mode: subagent-driven.**

Advances: ["single-testing-home", "documented-testing-authority"]
Completes: ["public-testing-boundary"]

### Task 1.1: Define the framework-neutral extension harness and consumer contract
Applying: ["reusable-extension-testing-boundary:single-testing-boundary", "reusable-extension-testing-boundary:typescript-source-distribution", "reusable-extension-testing-boundary:developed-against-pi", "reusable-extension-testing-boundary:real-runtime-verification"]
Paths: ["testing/index.ts", "testing/index.test.ts", "tests/testing-export.test.ts", "package.json", "tsconfig.json", "knip.json"]

Add the source-only runtime export and exercise it through the package self-reference so Vitest proves
an actual TypeScript-aware runtime import rather than compilation alone. The public entry point must
remain independent of Vitest and Pi internals. It supplies one harness factory that installs an
extension factory into a capability-oriented API recorder; deterministic ordinary
`ExtensionContext` and distinct `ExtensionCommandContext` builders; recorded handlers, tools,
commands, entry renderers, queued commands, API calls, mutable active/all-tool discovery, and an
event bus with unsubscribe behavior; explicit capability omission for partial-runtime tests; raw
registration-order handler invocation; and direct five-argument registered-tool invocation with
abort and progress capture.

Default contexts use in-memory public session/settings-compatible state and inert UI/model surfaces.
Command-only session controls do not leak into ordinary contexts, and replacement sessions receive a
fresh command-capable context. Raw handler and direct tool helpers must be named and documented so
they do not claim Pi-faithful middleware, error conversion, or session scheduling. Thrown tool errors
remain thrown by direct invocation. Keep the unsafe cast from the deliberately partial recorder to
Pi's complete `ExtensionAPI` confined to the extension-factory installation edge. Extend strict
TypeScript and Knip entry/project coverage to the new public source tree.

### Task 1.2: Shape the harness through timing and handoff
Kind: batch
Applying: ["reusable-extension-testing-boundary:single-testing-boundary", "reusable-extension-testing-boundary:real-runtime-verification"]
Paths: ["extensions/timing/index.test.ts", "extensions/handoff/index.test.ts"]
Representative: Timing consumes shared lifecycle, renderer, append-entry, and ordinary-context recording while handoff consumes shared command/tool registration, discovery, queueing, and replacement command contexts.
Edge: Preserve timing's fake clock and handoff's countdown/timer controls as local domain fixtures; replacement-session assertions must continue proving that stale UI and context are not reused.
Post-check: At the post-Task-1.2, pre-documentation working-tree snapshot, run `npx vitest run extensions/timing/index.test.ts extensions/handoff/index.test.ts` and require both suites green. Run checked `rg -n 'import type \{ ExtensionAPI \}|as unknown as ExtensionAPI|function (makeApi|makePi)|const (handlers|hooks|commands|tools) = (new Map|\[\])' extensions/timing/index.test.ts extensions/handoff/index.test.ts` and require exit 1 with no matches. The complete authorized residual fixture set in this population is timing's Vitest fake timers/system time and handoff's injected countdown `setTimeout`/`clearTimeout` callbacks; neither may own Pi registration or context behavior.

Migrate all Pi-boundary scaffolding in the timing and handoff adapter suites to the shared public
module. Use their contrasting lifecycle and command/session demands to keep the shared surface
cohesive; change the public helper rather than adding extension-specific Pi recorders beside it.
Preserve every existing assertion unless its setup-only form becomes an assertion over the shared
recording model.

### Task 1.3: Document and govern the available package boundary
Applying: ["reusable-extension-testing-boundary:single-testing-boundary", "reusable-extension-testing-boundary:typescript-source-distribution", "reusable-extension-testing-boundary:developed-against-pi"]
Paths: ["README.md", ".awf/domains/development.yaml", ".awf/topics/metadata/development/extension-toolchain.yaml", ".awf/docs/parts/architecture/components.md", ".awf/docs/parts/testing/layout.md", "docs/architecture.md", "docs/testing.md", "docs/topics/development/extension-toolchain.md", "docs/topics/development/subagent-toolkit.md", ".awf/awf.lock"]

Document the TypeScript-aware `pi-tools/testing` import, core usage, direct/raw semantics, supported
Pi-version posture, and the distinction between shared Pi-boundary fixtures and specialized local
domain fixtures. Add `testing/**` and the package-level `tests/**` lane to development domain and
extension-toolchain selector coverage. Update the authored architecture and testing sources, render
their generated documents, and inspect the rendered prose for a single public testing owner without
claiming that the remaining suites are migrated or that Pi runtime behavior is simulated. Treat both
generated development topic documents as expected selector-applicability mutations and require the
rendered architecture, testing, extension-toolchain, subagent-toolkit, and lockfile outputs to be the
complete generated population.

### Phase close

Close the importable framework-neutral boundary, strict-tooling coverage, two shaping migrations, and
truthful user/current architecture documentation together.

```commit
feat(testing): add reusable Pi extension harness
```

## Phase 2: Complete adoption and prove the real SDK seam

**Execution mode: subagent-driven.**

Completes: ["single-testing-home", "sdk-runtime-proof", "documented-testing-authority"]

### Task 2.1: Migrate every remaining duplicated Pi-boundary suite
Kind: batch
Applying: ["reusable-extension-testing-boundary:single-testing-boundary", "reusable-extension-testing-boundary:real-runtime-verification"]
Paths: ["extensions/context-usage/index.test.ts", "extensions/runtime-guard.test.ts", "extensions/subagents/index.test.ts", "tests/subagent-integration.test.ts"]
Representative: Context usage consumes ordinary handler/context fixtures; runtime guard omits one capability at a time; subagents consumes lifecycle, event bus, discovery, active-tool mutation, and direct tool invocation; package integration retains its profile-subpath consumer assertions while replacing its duplicate fake Pi boundary.
Edge: Do not migrate subagent profile, registry, scheduler, runner, rendering, policy, process, or stream fixtures. Missing capabilities must remain genuinely absent, and direct invocation must not translate thrown errors into Pi result envelopes.
Post-check: At the post-Task-2.1, pre-SDK-test working-tree snapshot, run `npx vitest run extensions/timing/index.test.ts extensions/handoff/index.test.ts extensions/context-usage/index.test.ts extensions/runtime-guard.test.ts extensions/subagents/index.test.ts tests/subagent-integration.test.ts` and require all six suites green. Run checked `rg -n 'import type \{ ExtensionAPI \}|as unknown as ExtensionAPI|function fakePi|const (handlers|lifecycle|bus|hooks|commands|tools) = (new Map|\[\])' extensions/timing/index.test.ts extensions/handoff/index.test.ts extensions/context-usage/index.test.ts extensions/runtime-guard.test.ts extensions/subagents/index.test.ts tests/subagent-integration.test.ts` and require exit 1 with no matches. This zero-match census is exhaustive only for duplicated Pi-boundary scaffolding. Specialized timing, countdown, deferred-outcome, event-loop, model, scheduler, subprocess/stream, policy, schema, and rendering fixtures may remain in their existing suites, including `extensions/subagents/index.test.ts`, when they do not recreate that boundary.

Begin from the reviewed green Phase 1 commit and consume its public `pi-tools/testing` export. Replace
the remaining local Pi-boundary models with that shared package export while preserving their
observable coverage. Runtime-guard tests configure an intentionally incomplete recorder rather than
mutating a complete fake after construction. Subagent adapter tests reuse the shared event bus and
mutable tool-discovery state but keep toolkit policy and execution models direct. The existing
package integration suite continues compiling and exercising the canonical subagent-profile export,
now through the same shared boundary used elsewhere.

### Task 2.2: Add a credential-free public SDK loading proof
Applying: ["reusable-extension-testing-boundary:real-runtime-verification", "reusable-extension-testing-boundary:developed-against-pi"]
Paths: ["tests/sdk-extension-integration.test.ts"]

Use only documented public Pi exports: `DefaultResourceLoader` with inline extension factories,
`createAgentSession`, in-memory `SessionManager` and `SettingsManager`, public extension diagnostics,
and public session tool inspection. Create isolated temporary `cwd` and `agentDir` directories; pass
`noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, and `noContextFiles` so ambient project
and user resources remain disabled while the inline factory still loads; reload explicitly; and
assert clean diagnostics plus the registered tool through public session inspection. Dispose the
created session and remove only the temporary filesystem directories. Keep the test deterministic
and credential-free: do not prompt a model, reach the network, import `ExtensionRunner` or runtime
internals, claim that the loader has a disposal API, or publish the SDK fixture as part of
`pi-tools/testing`.

### Task 2.3: Apply the completed testing authority
Kind: batch
Applying: ["reusable-extension-testing-boundary:single-testing-boundary", "reusable-extension-testing-boundary:typescript-source-distribution", "reusable-extension-testing-boundary:developed-against-pi", "reusable-extension-testing-boundary:real-runtime-verification"]
Paths: ["README.md", ".awf/topics/parts/development/extension-toolchain/current-state.md", ".awf/docs/parts/testing/layout.md", "docs/topics/development/extension-toolchain.md", "docs/testing.md", "docs/decisions/reusable-extension-testing-boundary.md", "docs/decisions/INDEX.md", ".awf/awf.lock"]
Representative: The authored extension-toolchain claim states the public source-only boundary, complete repository adoption, current developed-against Pi posture, retained specialized fixtures, and separate real-SDK proof; generated topic/testing prose and ADR operation history agree.
Edge: Preserve the existing TypeScript quality-gate claim and unrelated documentation, keep the ADR nonterminal at `Implementing`, and produce no generated mutations beyond the declared topic, testing document, decision index, and lockfile.
Post-check: From the staged Phase 2 snapshot, render awf outputs and run the staged awf check. Require the source claim, rendered topic/testing documents, ADR, index, README, and lockfile to be the complete documentation mutation population; require `development/extension-toolchain:reusable-extension-testing` to exist with `Origin: ADR-reusable-extension-testing-boundary`; and require the ADR's sole add operation to be Applied with no Remaining or Canceled operation while status remains `Implementing`.

Update the README and authored testing prose to describe complete adoption rather than the Phase 1
shaping state. Add the `development/extension-toolchain:reusable-extension-testing` current-state
claim, render and semantically inspect the generated outputs, and use the ADR lifecycle workflow to
transition the ADR to `Implementing` and apply its sole add operation in the same checked transaction.
Leave terminal `Implemented` closure to effort finalization after implementation assurance settles.

### Phase close

Close complete shared-boundary adoption, credential-free real-SDK verification, user documentation,
and matching Applied current-state authority as one green transaction.

```commit
test(extensions): centralize Pi boundary fixtures
```

## Definition of done

- `dod: public-testing-boundary` A TypeScript-aware adopter can import `pi-tools/testing` at runtime and use a framework-neutral typed harness for the documented Pi extension seams without compiled output, Vitest coupling, or Pi internals.
- `dod: single-testing-home` All six adapter/integration suites use the public harness for reusable Pi API, context, lifecycle, event-bus, registration, discovery, and direct-invocation concerns, while specialized domain fixtures remain local.
- `dod: sdk-runtime-proof` A deterministic credential-free integration test proves extension loading and registration through Pi's current public SDK and disposes its resources without model prompting or network access.
- `dod: documented-testing-authority` Package documentation, awf selector ownership, the Applied extension-toolchain claim, ADR history, exports, tests, and implementation describe the same source-only developed-against testing boundary.

## Notes

- Every managed-worktree phase gate must follow the documented Biome exclusion workaround with a temporary exhaustive include population that now includes `testing/**`; require nonzero intended-file processing and restore `biome.json` with no diff on every exit path.
- Plan review: added both selector-affected generated topic documents, the explicit Phase 2 dependency, snapshot-scoped checked migration audits with their exact authorized residual fixture sets, and isolated SDK loader inputs plus session/filesystem cleanup. These refinements make the approved boundary executable without expanding its semantics.
- Plan verify pass: restored parser-required phase-field adjacency, completed the six-file `rg` command, and narrowed the residual census to duplicated Pi-boundary scaffolding so specialized fixtures can remain wherever their domain tests own them.
- Record reasoned implementation deviations, review dispositions, migration inventories, focused test evidence, and rendered-prose inspection results here.
