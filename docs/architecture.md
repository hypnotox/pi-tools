# Architecture

## Overview

`pi-tools` is a personal Pi package and development workspace. Its manifest exposes working-title, timing, context pressure, handoff, guided-compaction, and boundary-edit extensions plus a handoff prompt template. Contributor guidance is repository-local and is not a package resource.

## Components

- `package.json`: package identity, explicit Pi extension entry points, and the handoff prompt export.
- `prompts/handoff.md`: native `/handoff` initiation for the existing handoff capability.
- `extensions/working-title/`: animated terminal-title activity while the agent runs, Pi compacts, or the current session's pi-subagents fleet remains active. `subagent-activity.ts` isolates the optional public event-bus RPC adapter from title rendering.
- `extensions/timing/`: agent, turn, and tool timing plus handoff continuity.
- `extensions/context-usage/`: validated Pi-sourced telemetry, exact pressure classification, and request-local advice naming only active tools. This is the sole owner of pressure policy.
- `extensions/context-lifecycle.ts`: shared persisted TUI/RPC eligibility, text bounds, standalone-batch enforcement, request identity, source-aware command dispatch, settlement, stale-request invalidation, owned-operation exclusion, and bounded threshold suppression.
- `extensions/handoff/`: replacement, explicit model/thinking/timing continuity, kickoff delivery and editor recovery.
- `extensions/compact/`: native `ctx.compact({ customInstructions, onComplete, onError })`, actual outcomes, and conditional same-runtime continuation. It never creates a session or exports/imports handoff continuity.
- `extensions/boundary-edit/`: content-anchored whole-line replacement. `replace-range.ts` owns literal selection, eligibility, and replacement termination without Pi or filesystem imports; `index.ts` owns schema/path handling, UTF-8/BOM representation, queued filesystem I/O, cancellation, and bounded feedback.
- `tests/`: small test-local fixtures and cross-entrypoint smoke coverage.
- `.awf/project.md` and `.awf/topics/`: project guidance and path-routed current guidance.
- `.pi/`, `.claude/`, `AGENTS.md`, and `CLAUDE.md`: generated contributor surfaces, not package extension entry points.

## Data flow

Pi installs the repository, reads the explicit extension paths and handoff prompt path in `package.json`, and loads them at startup or after `/reload`. Working title wraps the shared extension `setTitle` method so later title changes remain the undecorated base while its timer paints a transient activity prefix. Timing buffers a completed turn until the next turn begins or the agent settles, allowing the final block to include the total agent duration without a transcript gap; context telemetry observes Pi events independently. `/handoff` expands to an agent instruction that uses the existing handoff tool, and handoff opts an internal tokenized message into extension-command dispatch while the tool is running. That command waits for full agent settlement before replacing the persisted session. Before delivering the kickoff, the replacement session restores the parent session's active model and thinking level from the same private continuity entry used for timing; if that model is unavailable or unauthenticated, it warns and retains the replacement defaults.

Working title probes pi-subagents' public `subagents:rpc:v1` API for `fleetStatus` v1 support, then combines `fleet.totalActive > 0` with the local agent and compaction flags. Lifecycle events are refresh hints, not authority: only the owner's current-session snapshot changes subagent activity. Two-second polling reconciles missed events; requests are correlated, serialized, coalesced, and bounded by a five-second timeout. Replies predating a lifecycle hint are discarded. Missing or failed telemetry does not pin the spinner on. The adapter starts only in TUI sessions and disposes subscriptions and timers on shutdown; reload/resume creates a fresh subscription and status snapshot. There are no runtime imports from pi-subagents or filesystem/process discovery.

Each operation keeps its own queued/settling/executing request. The shared core claims command identity before waiting (duplicates cannot run twice), verifies the originating session and run after `waitForIdle()`, and retains ownership through the operation's terminal outcome. Shutdown and completed `session_tree` events invalidate work; the captured run signal detects an accepted competing replacement's abort before shutdown reaches the idle boundary. Cancellable preflight events do not invalidate work. Native manual compaction itself aborts the settled agent signal, so execution validity then relies on the owned request and session/runtime lifetime rather than mistaking that native abort for request cancellation.

The real loader uses isolated module instances (`jiti` with `moduleCache: false`) and distinct `ExtensionAPI` objects. The two owners therefore use a small synchronous package-internal busy query on Pi's runtime event bus, scoped to the originating session file. Each live owner answers only for its own request and unsubscribes on shutdown/reload. There is no shared singleton assumption, global registry, private dependency state, or generic workflow framework. One threshold-suppression allowance belongs to a pending request; redispatch does not renew it. Manual and overflow compactions pass through. These guards do not serialize unrelated host session operations.

Compaction continuation is decided in `onComplete`, after native manual compaction returns, not in `session_compact`. In Pi 0.85.1, that event precedes clearing manual-compaction state and `compaction_end`; hooks can already request a wake there. The compact owner observes supported `input` preflight and `agent_start` events and checks `ctx.isIdle()`/`ctx.hasPendingMessages()` at completion, deduplicating observable continuations even when a competing wake finishes before the callback or an incoming prompt has reached this `input` observer but remains in preflight. This is not a universal preflight boundary: Pi 0.85.1 awaits earlier `input` hooks sequentially, so a prompt hidden there can race the automatic turn (see the [accepted input boundary](../README.md#shared-lifecycle-and-handoff-recovery)). A dormant native steering/follow-up queue is not itself a scheduled continuation: when idle without intervening input/run activity, the tool resumes so Pi can drain that queue in its native order. It neither intercepts nor examines pi-subagents' messages/state. The native attempt's public `session_before_compact` signal additionally prevents automatic continuation if canceled after the checkpoint was saved but before the completion callback; the saved checkpoint is not rolled back. Error callbacks preserve native error text without retries; stale callbacks are discarded. Ordinary native compaction remains unchanged. Native split-turn prefix summarization omits `customInstructions` in Pi 0.85.1; the extension passes instructions through unchanged and documents the limitation rather than substituting a summarizer.

`boundary_edit` is an additional local-filesystem tool, not a native-tool override or read hook. Its adapter resolves the target relative to `ctx.cwd` before entering Pi's exported `withFileMutationQueue`; reading, strict decoding, pure range computation, feedback preparation, and the single write all happen inside that queue. Byte-identical results skip writing. Pi owns queue canonicalization and cleanup; the extension keeps no session history or long-lived resources. Feedback uses Pi's public diff and truncation helpers: native-edit-style confirmation text plus bounded `diff`/`patch` previews and `firstChangedLine` in result details, alongside range/change metadata. The TUI uses the host's default tool shell and public `renderDiff` for completed results; rendering neither reads nor mutates files. Execution does not require UI. The [user-facing contract](../README.md#boundary-editing) owns selection rules and concurrency limits. Consumers that restrict tool activation or route native tools to remote/sandbox operations must configure this additional local tool separately; the extension does not force activation or inherit those operations.

Maintainers edit package resources and ordinary documentation directly. After changing `.awf/project.md` or `.awf/topics/**/*.md`, run `./awf render` and `./awf check` to update and verify the fixed contributor surfaces. AWF owns contributor-guidance projection, topic routing, and ignored effort memory; it does not manage Git, hooks, provenance, or package gates. npm scripts and hosted CI remain repository-owned.

## Key dependencies

| Dependency | Role |
|---|---|
| Pi | Supplies runtime host modules and loads the extension and prompt entry points. |
| Current Node release | Runs development checks. |
| AWF | Renders project guidance and path-routed topic entrypoints. |
| TypeScript, Biome, Knip, and Vitest | Development-only type, format, lint, dead-code, dependency, and test checks. |

Pi core packages and TypeBox are wildcard peers supplied by Pi. Registry development dependencies use `*`. Installs create no lockfile.
