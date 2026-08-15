---
format: plan-v2
date: 2026-08-15
adrs: [subagent-execution-observability]
status: Proposed
---
# Plan: Implement Subagent Execution Observability

## Goal

Make every subagent invocation expose bounded live and resumed-session progress, cost, timing, and safe extensible tool summaries. Do not add an overlay, expose the child system prompt, persist raw tool arguments, or support asynchronous resolvers.

## Architecture summary

The runner translates child JSON events into a bounded structured execution projection owned by the toolkit. It persists the prepared task prompt, newline-delimited thinking rows, correlated in-place tool rows, monotonic durations, active-turn usage, terminal output, and no raw tool arguments. The renderer projects the latest 25 rows in compact live mode, 50 when expanded, and replaces compact activity with the terminal report after settlement while retaining expanded history. A Pi-like footer reports turns, token and cache totals, latest cache-hit rate, cost, and elapsed time.

Known Pi core tools use toolkit-owned argument summarizers. Independent extensions negotiate a separate typed and versioned event-bus capability and register synchronous resolver batches before session-start finalization. One resolver exclusively owns each custom tool name; built-ins cannot be claimed, conflicts reject atomically, and contained invalid or throwing resolvers fall back to the tool name. Public imports remain types only, and the event bus remains the runtime dependency direction.

## Phase 1: Establish exclusive tool argument summaries

**Execution mode: subagent-driven.**

Advances: ["observable-tool-activity", "documented-authority"]
Completes: ["extensible-summary-protocol"]

### Task 1.1: Define and finalize the resolver capability
Applying: ["subagent-execution-observability:resolver-capability", "subagent-execution-observability:resolver-containment"]
Paths: ["extensions/subagents/api.ts", "extensions/subagents/api.test.ts", "extensions/subagents/tool-summary-registry.ts", "extensions/subagents/tool-summary-registry.test.ts", "extensions/subagents/index.ts", "extensions/subagents/index.test.ts"]

Begin only from the reviewed Proposed ADR and the current green subagent toolkit. Add the public protocol constants and JSON-safe resolver registration, receipt, capability, and registration-result types to the existing types-only export surface. Implement a focused registry that collects stable atomic batches during extension initialization, reserves toolkit-owned names, rejects duplicate or late ownership, freezes accepted ownership at `session_start`, and reports terminal registration results through the shared event bus. Resolver calls receive immutable snapshots; validate and bound returned plain text, contain exceptions, and expose name-only fallback without changing child execution. Tests must cover both extension load orders, replay idempotence, reserved and duplicate names, atomic rejection, late registration, invalid output, exceptions, and listener cleanup.

### Task 1.2: Apply built-in and registered summaries to child tool activity
Applying: ["subagent-execution-observability:core-tool-summaries", "subagent-execution-observability:resolver-containment"]
Paths: ["extensions/subagents/tool-summaries.ts", "extensions/subagents/tool-summaries.test.ts", "extensions/subagents/runner.ts", "extensions/subagents/runner.test.ts", "extensions/subagents/index.ts", "extensions/subagents/index.test.ts"]
Implement stable argument-only summaries for the Pi core `read`, `edit`, `write`, `bash`, `grep`, `find`, and `ls` tools without importing Pi internal renderer modules. `read` shows path plus an optional offset/limit range; `edit` and `write` show path only; `bash` shows a bounded sanitized first logical command line; `grep` shows pattern plus optional path/glob; `find` shows pattern plus optional path; and `ls` shows its optional path or the current-directory marker. Missing or malformed fields, control characters, and oversized values yield a bounded sanitized summary or the tool name. Never include `edit` replacement text or `write` content. Pass the finalized resolver set into each run and summarize `tool_execution_start` arguments before they enter bounded activity; never retain raw arguments. Registered custom resolvers own only their exact tool name, and unregistered, invalid, or throwing resolvers render the name alone. Preserve all existing subprocess, cancellation, retry, and output bounds. Add sentinel-based negative tests proving raw arguments are absent from partial snapshots, final details, rendered output, and reconstructed historical details while only the bounded summary survives.

### Task 1.3: Document the resolver integration surface
Applying: ["subagent-execution-observability:resolver-capability", "subagent-execution-observability:resolver-containment"]
Paths: ["README.md"]

Document the types-only registration contract, exclusive ownership and built-in reservation rules, session-start finalization, safety bounds, trusted-extension access to raw snapshots, synchronous latency implication, and name-only fallback. Keep implementation examples aligned with the exported protocol and avoid duplicating ADR rationale.

### Phase close

Close the independently usable resolver protocol, built-in summaries, runtime integration, tests, and user-facing documentation together. Focused close evidence covers the affected API, registry, summary, runner, and index test files.

```commit
feat(extensions): add exclusive subagent tool summaries
```

## Phase 2: Render and persist the execution trajectory

**Execution mode: inline.**

Completes: ["observable-tool-activity", "live-execution-trajectory", "documented-authority"]

### Task 2.1: Model bounded correlated execution history
Applying: ["subagent-execution-observability:bounded-execution-history", "subagent-execution-observability:execution-presentation"]
Paths: ["extensions/subagents/api.ts", "extensions/subagents/api.test.ts", "extensions/subagents/runner.ts", "extensions/subagents/runner.test.ts"]

Begin only from the reviewed green Phase 1 commit. Replace flat tool start/end strings with a schema-valid bounded projection that can correlate a tool call by ID while persisting only its safe summary, state, and duration. Parse `thinking_delta` events into bounded nonblank logical lines, retain a bounded unfinished line while streaming, and keep the newest 50 chronological thinking and tool rows. Track monotonic invocation and tool durations. Treat `message_update` usage as the active turn's cumulative replacement, commit it once at `message_end`, and retain completed turn totals plus the latest turn cache-hit inputs. Preserve terminal usage accounting, cancellation authority, retry reporting, malformed and oversized JSONL recovery, and immutable update snapshots. Tests must exercise split deltas, unfinished lines, rolling eviction, parallel and interleaved tool IDs, error completion, cumulative usage replacement, cache-hit inputs, timing, and cancellation.

### Task 2.2: Present compact, expanded, live, and terminal states
Applying: ["subagent-execution-observability:bounded-execution-history", "subagent-execution-observability:execution-presentation"]
Paths: ["extensions/subagents/index.ts", "extensions/subagents/index.test.ts", "extensions/subagents/rendering.ts", "extensions/subagents/rendering.test.ts"]

Carry the safety-bounded prepared task prompt and live execution projection through partial and final `ExecutionDetails`. Render the prompt on one terminal-width-truncated compact line and fully wrapped within its bound when expanded. While running or queued, interleave the newest 25 compact or 50 expanded thinking and tool rows; show one tool row changing from running to success or failure with its duration. After settlement, replace compact activity with the report or failure and retain expanded history. Add the state/profile/model/thinking/elapsed header and a live footer whose semantics match Pi for turns, input, output, cache read, nonzero cache write, latest cache-hit rate, and cumulative cost. Use ANSI-aware width handling and preserve profile-data confinement. Focused tests must prove the 25/50 row limits, bounded compact and expanded prompts, in-place status changes, compact terminal replacement, expanded and resumed history, ANSI-aware line widths, elapsed time, cache-write omission, latest cache-hit calculation, cumulative cost, and rendering of legacy details without the new projection.

### Task 2.3: Apply authority and document completed behavior
Kind: batch
Applying: ["subagent-execution-observability:bounded-execution-history", "subagent-execution-observability:execution-presentation", "subagent-execution-observability:core-tool-summaries", "subagent-execution-observability:resolver-capability", "subagent-execution-observability:resolver-containment"]
Paths: ["README.md", ".awf/topics/parts/development/subagent-toolkit/current-state.md", "docs/topics/development/subagent-toolkit.md", "docs/decisions/subagent-execution-observability.md", "docs/decisions/INDEX.md", ".awf/awf.lock"]
Representative: The awf claim source renders the complete live-history and resolver contract into the topic while the ADR records its matching Applied update.
Edge: Remove contradictory legacy observability wording, preserve unrelated profile-runtime guarantees, and produce no generated mutations outside the declared index, topic, and lockfile.
Post-check: From the staged Phase 2 snapshot, render awf outputs and run the staged awf check. Verify that the source claim, rendered topic, ADR, index, and lockfile are the complete mutation population; the ADR is `Implementing`; its sole `update development/subagent-toolkit:profile-runtime` operation is Applied with no Remaining or Canceled operation; and the rendered claim has no contradictory old observability or resolver fragments.

Update the Subagent README section with the live and terminal display lifecycle, exact 25/50 limits, prompt and thinking persistence, footer semantics, timing, and bounds. Update `development/subagent-toolkit:profile-runtime` in the awf source to state the complete implemented observability and resolver contract, render generated outputs, and inspect the resulting claim for contradictory fragments. Transition the ADR to `Implementing` and apply its single claim update in the same checked transaction; leave terminal `Implemented` closure deferred to effort finalization.

### Phase close

Close the complete persisted execution projection, renderer, documentation, and matching Applied current-state claim as one green transaction. Focused close evidence covers the affected API, runner, index, and rendering tests plus Task 2.3's governed application post-check.

```commit
feat(extensions): expose live subagent execution progress
```

## Definition of done

- `dod: extensible-summary-protocol` Independently installed extensions can register one exclusive bounded synchronous resolver per custom tool through the versioned event bus, while built-ins remain reserved and every conflict or resolver failure has deterministic safe behavior.
- `dod: observable-tool-activity` Known and registered tools show safe useful argument summaries without persisting raw arguments; one correlated row updates through completion and retains duration.
- `dod: live-execution-trajectory` A running subagent shows its bounded task prompt, thinking and tool trajectory, elapsed time, and Pi-like live usage footer; compact completion shows the final report and expanded or resumed rendering retains up to 50 historical rows.
- `dod: documented-authority` README behavior, the applied current-state claim, ADR operation history, public types, and verified implementation describe the same contract.

## Notes

- Plan review: added explicit core-tool summary readings, `ls`, raw-argument negative coverage, rendering scenarios, compatibility ownership, DoD completion, and the governed application batch. Generic baseline and repository-gate choreography remain owned by the execution workflows rather than duplicated here.
- Phase 1 verification deviation: worktree-local Biome treats the parent `.awf` path as excluded, so the phase owner ran the full gate against a temporary materialization of the exact staged tree. No repository or gate policy changed.
- Phase 1 review: broadened custom and built-in control-character containment, selected the first bash line before sanitizing, froze resolver descriptors, withheld the unused capability from marked children, expanded replay/adapter/raw-argument persistence coverage, and documented synchronous latency. These fixes preserve the approved safety, parent-side projection, and compatibility boundaries.
- Phase 1 renewed review: split bash summaries on CR, LF, NEL, U+2028, and U+2029 before sanitizing, and added exhaustive C0, DEL/C1, and Unicode-separator regression coverage for custom rejection and built-in sanitization. No residual finding changed the approved boundary.
- Phase 2 verification used the Phase 1 staged-tree materialization workaround for the full gate because worktree-local Biome excludes paths beneath `.awf`; focused checks and all 131 tests also passed in the managed worktree.
- Phase 2 review: flushed non-newline thinking on `thinking_end` and defensively at `message_end`, encoded persisted prompt/activity character bounds in the schema, and retained the bounded prompt for pre-launch cancellation. These mechanical settlements preserve the approved projection and compatibility boundary.
- Terminal review: finalized still-active tool rows as errors at every terminal boundary and retained the prepared prompt through post-prepare failures. A one-second unref'ed refresh updates silent live elapsed and tool durations without changing persisted bounds; the runner stops it at settlement. The cadence is an authority-preserving implementation detail of the approved live-timing outcome.
- Terminal assurance: `./awf audit` reported no findings. The generic `./x audit-local` lane is not configured in this repository; no tracked `x` runner exists, so the declared `./awf check` and `npm run check` gates remain the local evidence.
- Record reasoned implementation deviations, review dispositions, and focused evidence here.
