# Testing

This document is the repository-specific authority for test commands, feedback tiers, lane ownership, and expected runtime. Keep concrete setup and measurements here rather than relying on shared guidance that cannot reflect the repository's language, dependencies, or execution environment.

Every behavior-changing fix requires the strongest practical durable oracle. The normal and preferred path is an automated regression test observed failing for the right reason and then passing. When that path is impractical, state a concrete reason, preserve or improve verification strength, and retain the strongest safe, reproducible alternative. Never weaken expected behavior or verification strength. Fix the root cause rather than the symptom.

Use this evidence order as guidance, not a requirement to mechanically attempt every earlier option:

1. An automated regression test observed red then green.
2. A deterministic integration or reproduction harness.
3. A contract or invariant test that directly exercises the failure.
4. Scripted, reproducible manual verification with recorded inputs and expected results.
5. An explicit explanation of why durable automation is unavailable, plus the strongest safe evidence that can be retained.

For a nondeterministic race, stress or invariant evidence may be the strongest practical oracle. For a destructive migration defect, use safe fixture or dry-run evidence rather than unsafe reproduction. An alternative is valid because the preferred path is impractical, not merely inconvenient, and its reason and retained evidence must make any verification-strength judgment reviewable.

## Gate

Run `./awf check` and `npm run check` before every commit. The AWF check validates project guidance sources and their fixed generated projection. The npm gate verifies direct Biome formatting and linting, strict TypeScript, Knip dead-code and dependency analysis, and focused Vitest behavior. No local Git hook wiring is assumed.

Hosted CI uses the current Node release, checks the AWF projection, performs `npm install --no-package-lock`, and runs the npm gate without dependency caching. Completion evidence also includes the isolated real-Pi loader smoke.

## Tiers and lanes

Focused Vitest files provide fast feedback. `npm run check` is the executable-resource gate; `./awf check` verifies contributor-guidance projection. Fresh-install, real-loader, and cross-package checks are completion evidence.

## Layout and test shape

Keep narrowly coupled tests beside each extension and tiny shared fixtures under `tests/`. Tests cover terminal-title animation and title composition, context telemetry, immediate handoff, model and thinking-level continuity, timing behavior, final-block grouping and continuity, and boundary editing. `tests/handoff-runtime.test.ts` loads the real extension files into Pi's `AgentSession` and session-replacement lifecycle with a deterministic faux provider, persisted sessions, and both TUI and RPC bindings. It checks settlement order, threshold-compaction suppression, parent linkage, model/thinking/timing continuity, command invisibility, canceled competing preflight, and an accepted competing replacement before idle. Its faux credentials use the SDK's awaited `setRuntimeApiKey` synchronization boundary: native provider registration alone can leave the auth-availability snapshot unsettled at startup. The loader smoke uses the real current Pi CLI with isolated package, config, and session directories; it also installs the local package through settings and verifies native handoff prompt discovery and expansion.

## Working-title verification

`extensions/working-title/index.test.ts` checks title composition and overlapping parent, compaction, and child activity, including an idle parent with multiple children and shutdown cleanup. The parent-only activity predicate makes the child regression fail by restoring the idle title too early. `subagent-activity.test.ts` uses deterministic public RPC replies to cover capability discovery, startup/restored work, missed lifecycle events, current-session snapshot authority, bounded fleet overflow, stale replies, errors/timeouts, synchronous replies, and subscription/timer cleanup. These are contract tests, not live child-process launches; nested and recovered work rely on pi-subagents' own fleet accounting.

Run focused feedback with `npx vitest run extensions/working-title`. The full gate also exercises real Pi extension loading without requiring pi-subagents to be installed.

## Boundary-edit verification

`extensions/boundary-edit/replace-range.test.ts` checks consistent selection/edit resolution across literal matching and ambiguity (including overlapping occurrences), inclusive whole-line replacement, termination, EOF, mixed LF/CRLF, lone CR content, Unicode, and the current-content rather than snapshot contract. `feedback.test.ts` checks actionable diagnostics, exact totals versus bounded candidate samples, merged context windows, eligibility reasons, long-line excerpts, physical line/UTF-8 byte counts, and bounded head/tail previews (including oversized single-line selections). `index.test.ts` exercises read-only selection, temporary files, path handling, byte/BOM preservation, strict UTF-8 rejection, accurate effective replacement/deletion/no-change statistics, no-op write avoidance, pre-write cancellation, partial-write failures, editing after intervening changes, and bounds on both text and stored diff previews. It compares diff details and colors with native `edit` through Pi's real `ToolExecutionComponent`, while separately requiring the summary alongside the diff at narrow widths, in both expansion states, and after theme invalidation. Pending, selection, error, no-op, legacy text-only, and truncated-result rendering have focused assertions. Behavior and structured metadata are the oracles, not native confirmation prose.

`tests/boundary-edit-runtime.test.ts` loads the manifest through isolated package settings and exercises the real `AgentSession` with a deterministic faux provider in print mode. It verifies both tools' discovery and execution, native-tool schemas/descriptions/provenance, and actual Pi error flags for invalid schema and selectors. A paused native edit checks that neither loaded boundary tool can read until the native mutation finishes, including through a symlink alias, and that selection preserves bytes while editing retains both unrelated changes. Only native I/O is gated; Pi's selection, mutation queue, and boundary tool execution stay real.

Run focused feedback with:

```bash
npx vitest run extensions/boundary-edit tests/boundary-edit-runtime.test.ts tests/pi-loader-smoke.test.ts
```

For completion, run `npm install --no-package-lock`, confirm `package-lock.json` is absent, then run `./awf check` and `npm run check`. Verify the staged package in a fresh isolated copy with a lockfile-free install and the same gates; the full test suite includes the isolated real-CLI loader smoke. These deterministic checks establish behavior, not improved model performance or token usage.

## Context-management verification

Run focused feedback with:

```bash
npx vitest run extensions/context-usage extensions/handoff extensions/compact tests/handoff-runtime.test.ts tests/compact-runtime.test.ts tests/pi-loader-smoke.test.ts
```

`tests/context-runtime-fixture.ts` creates real persisted TUI/RPC sessions with isolated resources and a deterministic faux provider. The existing real-Pi handoff regressions remain intact. `tests/compact-runtime.test.ts` loads both operation entry points through Pi's real loader (not a shared-import mock), exercises mixed batches in both orders, cross-entrypoint exclusion through terminal compaction, settlement, cancellation/failure/too-small/already-compacted outcomes, repeated calls, and abort/reload/tree/replacement races. It checks session object/identity/file continuity, absence of handoff continuity export, source instructions reaching ordinary native history summarization, and the rebuilt model context containing the native summary. High-usage runs retain native auto-compaction settings while exercising the bounded threshold guard.

Ordering checks establish that Pi 0.85.1 emits `session_compact` before clearing manual compaction state and emitting `compaction_end`, then invokes extension `onComplete`. Native manual compaction never resumes itself. Tests cover an existing wake at `session_compact` or `compaction_end`, a genuine result arriving during summarization whose run finishes before the callback, and a native user prompt starting preflight at `compaction_end` (as the TUI queue does). The native-user-prompt race was observed red with a competing prompt error, then green using the supported `input` event for continuation arbitration when the prompt reaches compact's observer. A separate red/green dormant steering-queue test verifies that pending messages are not mistaken for an already scheduled continuation: successful compaction must resume and let Pi drain that queue. These cases require one continuation and retained incoming messages; they do not establish universal preflight visibility. A red/green late-cancellation regression aborts at `session_compact` after the checkpoint is saved: native Pi still completes, but the extension must not auto-resume. Separate tests retain ordinary native compaction behavior with the extensions loaded. Adapter tests cover late callbacks, duplicate commands, byte bounds, and bounded suppression without relying on timing sleeps.

The **accepted host boundary** characterization in `tests/compact-runtime.test.ts` loads an earlier asynchronous `input` extension through the real loader and holds a genuine prompt there at `compaction_end`. Public event-bus and provider gates reproduce both an extra automatic turn with `followUp` (input retained) and a rejected plain prompt (input not stored), without sleeps, host patches, or private-state access. These two bounded tests run only on Pi 0.85.1 and explicitly skip other versions: recharacterize on upgrade rather than requiring the limitation forever. Users should let handoff/compaction finish before new input, as documented in the [operating boundary](../README.md#handoff-and-compaction-requirements). This is characterization of an accepted limitation, not a desired-behavior regression repaired by this change.

The current native split-turn **prefix** summarizer omits custom focus, including the prefix portion of mixed history/prefix compaction. A real provider-request assertion captures this Pi 0.85.1 limitation alongside ordinary instruction-transport coverage. Do not weaken native behavior or manufacture synthetic history to bypass it. Deterministic summarizer responses prove transport and reconstruction, **not real-model retention quality**.

Pressure tests exercise immediately below/at/above every percentage and absolute threshold, independent OR triggers, highest-match precedence, display rounding, invalid values, fresh request assessment, and tool availability. Telemetry values and estimated markers remain separately asserted.

### Unmodified live pi-subagents integration (opt-in)

This lane needs an installed **npm-package** Pi (the regular development dependency suffices) and an unmodified pi-subagents package. It uses no real credentials or external model service. Point to the package directory, not its entrypoint:

```bash
PI_TOOLS_SUBAGENTS_PACKAGE="$SUBAGENTS_PACKAGE" \
  npx vitest run tests/compact-subagents-live.test.ts
```

For a fresh optional dependency without modifying this package's manifest or installed user settings:

```bash
integration_deps=$(mktemp -d)
npm install --prefix "$integration_deps" --no-package-lock pi-subagents
PI_TOOLS_SUBAGENTS_PACKAGE="$integration_deps/node_modules/pi-subagents" \
  npx vitest run tests/compact-subagents-live.test.ts
rm -rf "$integration_deps"
```

The test launches an isolated real Pi RPC process with this manifest and the supplied unmodified package, an isolated HOME/config/session tree, and a loopback deterministic OpenAI SSE provider. A real detached sequential workflow starts its first child; the provider holds it live through native tool-requested compaction. Only after the parent's native compaction wake does that child finish and the second child start. Assertions require the same parent identity/file, one native compaction, one automatic wake, one final workflow delivery, and working subsequent user input and public subagent fleet-status control. It uses only public tools/RPC/settings and observes public messages; no dependency private-state or ownership probes, patches, or copied resources. Temporary process/config/provider resources are cleaned up. Tested with **Pi 0.85.1 and pi-subagents 0.66.0**; the passing command prints the actual versions.

RPC `prompt` responses acknowledge preflight, not completion. The live fixture gates the history response until its acknowledgment arrives, then waits for the expected message and subsequent public `agent_settled` before each independent prompt; acknowledgment-only waits caused a reproduced fresh-install race.

The normal gate skips this optional lane when the environment variable is absent. Report that skip honestly: faux-provider lifecycle unit tests alone are not live-work survival evidence. Run this lane explicitly for context-management completion or record the exact environmental blocker and unverified workflow behavior.

### Fresh isolated completion copy

After the local lockfile-free install and gates, verify the complete proposed package tree (including new, unstaged source files) rather than only `HEAD`. This recipe does not stage or commit anything and does not copy installed dependencies, ignored effort memory, or machine state:

```bash
fresh=$(mktemp -d)
git ls-files -z --cached --others --exclude-standard | \
  tar --null -T - -cf - | tar -xf - -C "$fresh"
(
  cd "$fresh"
  npm install --no-package-lock
  test ! -e package-lock.json
  ./awf check
  npm run check
)
rm -rf "$fresh"
```

The full suite in this copy includes real-CLI entrypoint loading and native handoff prompt discovery/expansion. Run the optional live integration against the same copy when its dependency is available, and record exact commands, versions, results, and any skips in completion evidence. Review/staging/committing remain separate from verification.
