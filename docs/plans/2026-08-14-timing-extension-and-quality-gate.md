---
format: plan-v2
date: 2026-08-14
adrs: [typescript-extension-quality-toolchain]
status: Proposed
---
# Plan: Timing Extension and Quality Gate

## Goal

Ship a portable Pi extension that displays non-contextual timestamps and live per-turn and per-tool durations, while establishing the shared TypeScript quality gate for future extensions. Configuration, persistence beyond Pi custom entries, and timing of a full autonomous agent sequence are out of scope.

## Architecture summary

A typed timing-state module owns wall-clock timestamps, monotonic durations, active-turn state, and source-ordered parallel-tool indexes. A thin Pi adapter translates lifecycle events into that model, appends TUI-only custom entries when tools and turns complete, registers their renderer, and adds the live per-turn duration to Pi's native working message with a session-scoped refresh timer. Sequential tool timing lines naturally follow their rows; parallel completions remain unambiguous through stable one-based indexes matching tool-row source order. Custom entries never become model messages.

The repository uses a strict TypeScript configuration, Biome for formatting/import organization/linting, Knip for dead-code and dependency analysis, and Vitest for tests with fake clocks. Individual scripts compose into one non-mutating npm quality gate, and awf's pre-commit flow runs that gate alongside repository checks. Pi runtime packages remain wildcard peers, development tools remain development dependencies, and the npm lockfile is committed.

## Phase 1: Establish the toolchain and ship timing telemetry

**Execution mode: inline.**

Completes: ["timing-transcript", "live-timing", "quality-gate", "documented-contract"]

### Task 1.1: Configure the shared TypeScript quality toolchain
Applying: ["typescript-extension-quality-toolchain:strict-typescript-extensions", "typescript-extension-quality-toolchain:consolidated-quality-toolchain", "typescript-extension-quality-toolchain:pi-dependency-classes", "typescript-extension-quality-toolchain:reproducible-toolchain-lock"]
Paths: ["package.json", "package-lock.json", "tsconfig.json", "biome.json", "knip.json"]

Add Node.js-20-compatible pinned development tooling and wildcard Pi peers. Configure strict no-emit TypeScript checks, Biome formatting/import organization/linting, and Knip entry and project patterns that understand both single-file extensions and extension directories. Expose mutating formatting separately from non-mutating format, lint, type, dead-code, test, and aggregate check scripts. Keep generated awf resources and package-install directories outside formatting and analysis populations without excluding authored extension or test files.

Before phase close, perform a clean lockfile installation and run the aggregate quality gate under an actual Node.js 20 runtime. Record the reported Node version, successful `npm ci`, and successful `npm run check`; a newer local runtime is not substitute evidence for the declared minimum.

### Task 1.2: Implement and test deterministic timing state
Applying: ["typescript-extension-quality-toolchain:strict-typescript-extensions", "typescript-extension-quality-toolchain:consolidated-quality-toolchain"]
Paths: ["extensions/timing/timing-state.ts", "extensions/timing/timing-state.test.ts"]

Create a clock-injected state model that records local wall timestamps and monotonic elapsed time for one Pi turn and any parallel tools. Assign each tool a stable one-based index in `tool_execution_start` source order, resetting the sequence at each `turn_start`, so parallel completion order cannot obscure which visible tool row a timing entry describes. Produce serializable completion records and adaptive duration text without depending on Pi or TUI APIs.

Render local timestamps as `HH:mm:ss.SSS`. Render completed durations below one second as integral milliseconds (`884ms`), durations below one minute with two decimal seconds (`8.49s`), and longer durations as minutes plus one-decimal seconds (`1m 02.3s`). Render the live turn duration with one decimal second. Cover turn boundaries, threshold values, one-based indexing, parallel completion order, malformed completion attempts, and reset behavior with deterministic tests.

### Task 1.3: Adapt Pi events to non-context transcript entries and a live widget
Applying: ["typescript-extension-quality-toolchain:strict-typescript-extensions", "typescript-extension-quality-toolchain:consolidated-quality-toolchain"]
Paths: ["extensions/timing/index.ts", "extensions/timing/index.test.ts"]

Register a TUI-only custom-entry renderer whose indented lines read `↳ tool 2 · bash · 14:32:08.210 → 14:32:11.940 · 3.73s` for a tool and `↳ turn 4 · 14:32:06.411 → 14:32:14.902 · 8.49s` for a turn. Append the tool entry on `tool_execution_end`; sequential calls naturally place it beneath the tool row, while parallel entries use the stable source-order index to map back to rows even when they finish in another order. Append the turn entry on `turn_end`. Never call `sendMessage` or `sendUserMessage`; use `appendEntry` exclusively for transcript history.

Use `ctx.ui.setWorkingMessage()` to change the text beside Pi's native animated working spinner to `Working... · Turn 4 · 8.2s`, substituting the active turn and elapsed value. Do not create a widget or show a live tool duration. Update the message at a bounded interval only while a turn is active, restore Pi's default working message on `turn_end`, and restore it plus clear the interval and state idempotently on `session_shutdown`. Guard terminal presentation by mode and tolerate errors and missing lifecycle counterparts. Adapter tests use mocked Pi event registration and fake timers to prove exact line grammar, source-order indexes under parallel completion, non-context persistence, native working-message updates, default restoration, and shutdown cleanup.

Smoke-load the authored entry point through Pi's supported extension path with `pi -e ./extensions/timing/index.ts --list-models`. The command must exit successfully without extension diagnostics; model-catalog output is incidental.

### Task 1.4: Integrate the gate, apply current-state authority, and document use
Kind: batch
Applying: ["typescript-extension-quality-toolchain:deterministic-extension-gate"]
Paths: [".awf/config.yaml", ".awf/awf.lock", "glob:.awf/docs/parts/development/**", "glob:.awf/docs/parts/testing/**", ".awf/docs/parts/architecture/dependencies.md", ".awf/parts/workflow/composing-the-gate.md", ".awf/parts/agents-doc/identity.md", ".awf/topics/parts/development/extension-toolchain/current-state.md", "README.md", "glob:.awf/hooks/**", "glob:docs/**", "glob:.pi/**", "glob:.claude/**", "AGENTS.md", "CLAUDE.md"]
Representative: Configure awf's project gate to run the aggregate npm quality command while retaining `./awf check` as the rendered-output check, then regenerate all awf-owned outputs.
Edge: Treat this phase transaction as ADR-0001's single first-and-final explicit application batch. Transition Proposed to Implementing, append the Applied event for `add development/extension-toolchain:typescript-quality-gate`, and add the matching rule claim with `Origin: ADR-0001` in the same checked pair. Remaining is empty; leave the later Implemented status-only transition to governed terminal closure. Do not hand-edit generated documentation.
Post-check: After `./awf render`, require `./awf check` to exit successfully and capture `git status --short`. The changed-path set must contain the authored configuration, documentation, claim, ADR, and expected lock/hook outputs, must be a subset of this task's exact and glob Paths population, and must contain no `node_modules`, credential, environment, session, temporary, or other machine-specific path. Read the rendered development, testing, architecture, workflow, current-state, AGENTS.md, CLAUDE.md, and pre-commit-hook boundaries and confirm they consistently describe npm installation, the aggregate npm gate, awf checks, and the first executable extension.

Update contributor documentation for dependency installation, individual checks, aggregate gating, and test layout, including the existing architecture, workflow gate-composition, and scaffold-only identity claims that the first extension invalidates. Update the package README with the timing extension's visible behavior, TUI-only/non-context guarantee, local-time and duration semantics, parallel-tool behavior, installation, reload, and verification commands.

### Phase close

Close the phase only when the aggregate npm quality gate and awf checks pass on the complete transaction, Pi can load the extension without diagnostics, custom timing entries remain absent from model context by construction and test, the native working message is restored after every turn and shutdown, and the generated documentation reads consistently with the implemented scripts and hook behavior.

```commit
feat(extensions): add timing and gate (applies 0001 batch)
```

## Definition of done

- `dod: timing-transcript` Every completed tool and Pi turn receives a TUI-only timing line containing its identity, local start/end timestamps, and duration without adding model-context messages; tool lines carry stable one-based source-order indexes so parallel completion remains unambiguous.
- `dod: live-timing` While a Pi turn is running, Pi's native working spinner includes its bounded-refresh elapsed duration, without a custom widget or live tool timer, and returns to the default message at turn end and shutdown.
- `dod: quality-gate` Strict type checks, formatting verification, linting, dead-code/dependency analysis, and tests are independently runnable and compose into the awf-integrated non-mutating pre-commit gate.
- `dod: documented-contract` README and generated development, testing, and current-state documentation describe the shipped extension and contributor workflow, with the ADR operation applied in the implementation transaction.

## Notes

Inline owners immediately correct stale instructions and record reasoned deviations here. Delegated owners may report rather than edit; the parent supplies the report to phase review and reconciles it with findings in one focused post-review settlement commit before checkpointing or later execution. Record deviations, spike answers, follow-ups, and findings surfaced during implementation.

- Plan review made batch scope and ADR application mechanics explicit, added deterministic changed-path evidence, and required actual Node.js 20 clean-install/gate evidence so reproducibility and the declared runtime floor are verified rather than inferred.
- Plan review fixed the user-visible timing grammar at millisecond local timestamps, adaptive completed durations, and one-decimal live durations, and added a concrete Pi extension smoke-load command so implementation and tests do not invent observable semantics.
- Source inspection confirmed Pi emits extension `message_end` handlers before persisting tool-result messages, so generic custom entries cannot guarantee physical insertion beneath every row in a parallel batch. The user approved stable one-based source-order tool indexes instead; completion lines may follow the parallel batch and remain mappable to the visible rows. The user also replaced the extra live widget with per-turn text on Pi's native working spinner and removed live tool timing.
