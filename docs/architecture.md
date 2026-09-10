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
- `extensions/boundary-edit/`: content-anchored batched reading and replacement. `replace-range.ts` owns the shared exact-position resolver, original-file batch/overlap validation, structured boundary diagnostics, and literal block statistics without Pi or filesystem imports. `feedback.ts` owns bounded previews and shared diagnostic formatting; `index.ts` owns both tool registrations, schema/path handling, UTF-8/BOM representation, queued filesystem I/O, cancellation, and operation-specific success reporting.
- `tests/`: small test-local fixtures and cross-entrypoint smoke coverage.
- `.awf/project.md` and `.awf/topics/`: project guidance and path-routed current guidance.
- `.pi/`, `.claude/`, `AGENTS.md`, and `CLAUDE.md`: generated contributor surfaces, not package extension entry points.

## Data flow

Pi installs the repository, reads the explicit extension paths and handoff prompt path in `package.json`, and loads them at startup or after `/reload`. Working title wraps the shared extension `setTitle` method so later title changes remain the undecorated base while its timer paints a transient activity prefix. Timing buffers a completed turn until the next turn begins or the agent settles, allowing the final block to include the total agent duration without a transcript gap; context telemetry observes Pi events independently. `/handoff` expands to an agent instruction that uses the existing handoff tool, and handoff opts an internal tokenized message into extension-command dispatch while the tool is running. That command waits for full agent settlement before replacing the persisted session. Before delivering the kickoff, the replacement session restores the parent session's active model and thinking level from the same private continuity entry used for timing; if that model is unavailable or unauthenticated, it warns and retains the replacement defaults.

Working title probes pi-subagents' public `subagents:rpc:v1` API for `fleetStatus` v1 support, then combines `fleet.totalActive > 0` with the local agent and compaction flags. Lifecycle events are refresh hints, not authority: only the owner's current-session snapshot changes subagent activity. Two-second polling reconciles missed events; requests are correlated, serialized, coalesced, and bounded by a five-second timeout. Replies predating a lifecycle hint are discarded. Missing or failed telemetry does not pin the spinner on. The adapter starts only in TUI sessions and disposes subscriptions and timers on shutdown; reload/resume creates a fresh subscription and status snapshot. There are no runtime imports from pi-subagents or filesystem/process discovery.

### Context-operation boundaries

Both tools queue a source-resolved internal command, terminate the originating tool run, and wait for full settlement before executing. Internal commands never become model input. Aborting the originating run, reloading/shutting down extensions, completing tree navigation, or accepting a competing replacement discards a waiting request. A canceled competing preflight alone does not discard it. If handoff's own replacement is canceled, recovery text goes into the current editor; if automatic kickoff delivery fails, it goes into the replacement editor.

Each operation keeps its own queued/settling/executing request. The shared core claims command identity before waiting (duplicates cannot run twice), verifies the originating session and run after `waitForIdle()`, and retains ownership through the operation's terminal outcome. Shutdown and completed `session_tree` events invalidate work; the captured run signal detects an accepted competing replacement's abort before shutdown reaches the idle boundary. Cancellable preflight events do not invalidate work. Native manual compaction itself aborts the settled agent signal, so execution validity then relies on the owned request and session/runtime lifetime rather than mistaking that native abort for request cancellation.

The real loader uses isolated module instances (`jiti` with `moduleCache: false`) and distinct `ExtensionAPI` objects. The two owners therefore use a small synchronous package-internal busy query on Pi's runtime event bus, scoped to the originating session file. Each live owner answers only for its own request and unsubscribes on shutdown/reload. There is no shared singleton assumption, global registry, private dependency state, or generic workflow framework. One threshold-suppression allowance belongs to a pending request; redispatch does not renew it. Manual and overflow compactions pass through. These guards do not serialize unrelated host session operations.

Compaction continuation is decided in `onComplete`, after native manual compaction returns, not in `session_compact`. In Pi 0.85.1, that event precedes clearing manual-compaction state and `compaction_end`; hooks can already request a wake there. The compact owner observes supported `input` preflight and `agent_start` events and checks `ctx.isIdle()`/`ctx.hasPendingMessages()` at completion, deduplicating observable continuations even when a competing wake finishes before the callback or an incoming prompt has reached this `input` observer but remains in preflight. This is not a universal preflight boundary: Pi 0.85.1 awaits earlier `input` hooks sequentially, so a prompt hidden there can race the automatic turn: queued `followUp` input can incur an extra automatic turn, while a plain prompt can be rejected as already processing and not stored. This accepted host boundary is characterized in runtime tests, not a universal no-duplicate/no-loss guarantee. Let either operation finish before submitting new input; this is an operating expectation, not an input embargo. A dormant native steering/follow-up queue is not itself a scheduled continuation: when idle without intervening input/run activity, the tool resumes so Pi can drain that queue in its native order. It neither intercepts nor examines pi-subagents' messages/state. The native attempt's public `session_before_compact` signal additionally prevents automatic continuation if canceled after the checkpoint was saved but before the completion callback; the saved checkpoint is not rolled back. Error callbacks preserve native error text without retries; stale callbacks are discarded. Ordinary native compaction remains unchanged. Native split-turn prefix summarization omits `customInstructions` in Pi 0.85.1; the extension passes instructions through unchanged and documents the limitation rather than substituting a summarizer.

### Boundary-edit contract

`boundary_edit` and `boundary_read` are additional local-filesystem tools, not native-tool overrides or read hooks. The [README](../README.md#boundary-editing) owns their input, matching, output, and operating contract. No compatibility alias or argument conversion retains the old `boundary_select`/string-selector API.

The pure resolver owns exact `{text, side}` endpoints and half-open spans. Each anchor must be globally unique, counting overlapping occurrences. It resolves both reads and edits identically without line snapping, terminator inheritance, or inferred whitespace. Batched reads retain independent resolution results; batched edits collect selector/replacement errors, reject overlapping replacement regions and duplicate insertion points, then build the result from original-file slices in position order. Context anchors do not participate in overlap checks. Valid adjacent spans and insertions at span edges have deterministic output independent of input order. No numeric, fuzzy, occurrence, hashline, or structural selectors exist.

Both adapters resolve the path relative to `ctx.cwd` before entering Pi's exported `withFileMutationQueue`. Reading, strict decoding, resolution, feedback preparation, and (only for changed edits) a single write happen inside that queue. One initial BOM is kept outside editable text; fatal UTF-8 decoding and rejection of unpaired surrogates in anchors/replacements prevent lossy rewrites. Literal slicing preserves all unselected bytes, including mixed endings. Byte-identical results skip writing. The adapter never races write completion against cancellation or claims rollback after writing starts.

`feedback.ts` owns bounded diagnostics, literal read previews, span formatting and byte/line budgets. Reads report per-range content or errors, with explicit completeness and omission markers under one 8 KiB response ceiling. `maxLines` changes previewing, not resolution; `"all"` has no separate line ceiling. Invalid ranges cause the adapter to throw the assembled report so Pi marks it as an error while retaining successful content. Other I/O errors retain host error codes. Boundary errors carry selector/kind, a resolved start when available and bounded candidate locations; searches stop at a sixth match and identify that count as a lower bound. Formatting merges overlapping context windows and centers excerpts near long-line candidates without choosing a match.

Edit feedback retains per-entry outcomes/statistics in input order, an overall summary, and Pi-generated bounded `diff`, `patch`, and `firstChangedLine` details. The TUI uses Pi's default tool shell and public `renderDiff`, including native coloring, alongside the summary. Rendering performs no file I/O and execution needs no UI. Native edit normalizes CRLF before diff generation, whereas boundary editing passes literal text to Pi's diff generator; display removes CR for native-equivalent rendering. Text-only historical results still render without retaining an obsolete callable API.

A read is independent and stateless: it never writes, reserves a region or retains a snapshot. Editing always re-resolves current content; moved intact unique anchors still work and changed interiors are deliberately overwritten. Pi owns queue canonicalization/cleanup, including symlink aliases, but the queue does not cover other processes, editors or nonparticipating tools. There is no extension session history or long-lived resource. Consumers restricting tool activation or routing native tools to remote/sandbox operations must configure these local tools separately; the extension neither forces activation nor inherits native operations.

### Contributor guidance

Maintainers edit package resources and ordinary documentation directly. After changing `.awf/project.md` or `.awf/topics/**/*.md`, run `./awf render` and `./awf check` to update and verify the fixed contributor surfaces. AWF owns contributor-guidance projection, topic routing, and ignored effort memory; it does not manage Git, hooks, provenance, or package gates. npm scripts and hosted CI remain repository-owned.

## Key dependencies

| Dependency | Role |
|---|---|
| Pi | Supplies runtime host modules and loads the extension and prompt entry points. |
| Current Node release | Runs development checks. |
| AWF | Renders project guidance and path-routed topic entrypoints. |
| TypeScript, Biome, Knip, and Vitest | Development-only type, format, lint, dead-code, dependency, and test checks. |

Pi core packages and TypeBox are wildcard peers supplied by Pi. Registry development dependencies use `*`. Installs create no lockfile.
