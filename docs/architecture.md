# Architecture

## Overview

`pi-tools` is a personal Pi package and development workspace. Its manifest exposes working-title, timing, context telemetry, handoff, and boundary-edit extensions plus a handoff prompt template. Contributor guidance is repository-local and is not a package resource.

## Components

- `package.json`: package identity, explicit Pi extension entry points, and the handoff prompt export.
- `prompts/handoff.md`: native `/handoff` initiation for the existing handoff capability.
- `extensions/working-title/`: animated terminal-title activity while the agent runs, Pi compacts, or the current session's pi-subagents fleet remains active. `subagent-activity.ts` isolates the optional public event-bus RPC adapter from title rendering.
- `extensions/timing/`: agent, turn, and tool timing plus handoff continuity.
- `extensions/context-usage/`: source-backed context telemetry injected into model context.
- `extensions/handoff/`: immediate persisted-session replacement and kickoff delivery.
- `extensions/boundary-edit/`: content-anchored whole-line replacement. `replace-range.ts` owns literal selection, eligibility, and replacement termination without Pi or filesystem imports; `index.ts` owns schema/path handling, UTF-8/BOM representation, queued filesystem I/O, cancellation, and bounded feedback.
- `tests/`: small test-local fixtures and cross-entrypoint smoke coverage.
- `.awf/project.md` and `.awf/topics/`: project guidance and path-routed current guidance.
- `.pi/`, `.claude/`, `AGENTS.md`, and `CLAUDE.md`: generated contributor surfaces, not package extension entry points.

## Data flow

Pi installs the repository, reads the explicit extension paths and handoff prompt path in `package.json`, and loads them at startup or after `/reload`. Working title wraps the shared extension `setTitle` method so later title changes remain the undecorated base while its timer paints a transient activity prefix. Timing buffers a completed turn until the next turn begins or the agent settles, allowing the final block to include the total agent duration without a transcript gap; context telemetry observes Pi events independently. `/handoff` expands to an agent instruction that uses the existing handoff tool, and handoff opts an internal tokenized message into extension-command dispatch while the tool is running. That command waits for full agent settlement before replacing the persisted session. Before delivering the kickoff, the replacement session restores the parent session's active model and thinking level from the same private continuity entry used for timing; if that model is unavailable or unauthenticated, it warns and retains the replacement defaults.

Working title probes pi-subagents' public `subagents:rpc:v1` API for `fleetStatus` v1 support, then combines `fleet.totalActive > 0` with the local agent and compaction flags. Lifecycle events are refresh hints, not authority: only the owner's current-session snapshot changes subagent activity. Two-second polling reconciles missed events; requests are correlated, serialized, coalesced, and bounded by a five-second timeout. Replies predating a lifecycle hint are discarded. Missing or failed telemetry does not pin the spinner on. The adapter starts only in TUI sessions and disposes subscriptions and timers on shutdown; reload/resume creates a fresh subscription and status snapshot. There are no runtime imports from pi-subagents or filesystem/process discovery.

The pending token is claimed once after `waitForIdle()`. Shutdown and completed `session_tree` events invalidate pending work; the captured run signal also detects an accepted competing replacement's abort before shutdown reaches the idle boundary. Cancellable preflight events do not invalidate work. These guards do not serialize independent replacements after the handoff claims its token; that remains a host limitation.

`boundary_edit` is an additional local-filesystem tool, not a native-tool override or read hook. Its adapter resolves the target relative to `ctx.cwd` before entering Pi's exported `withFileMutationQueue`; reading, strict decoding, pure range computation, feedback preparation, and the single write all happen inside that queue. Byte-identical results skip writing. Pi owns queue canonicalization and cleanup; the extension keeps no session history or long-lived resources. Feedback uses Pi's public unified-diff and truncation helpers, with compact metadata rather than an unbounded copy in result details, and does not require UI. The [user-facing contract](../README.md#boundary-editing) owns selection rules and concurrency limits. Consumers that restrict tool activation or route native tools to remote/sandbox operations must configure this additional local tool separately; the extension does not force activation or inherit those operations.

Maintainers edit package resources and ordinary documentation directly. After changing `.awf/project.md` or `.awf/topics/**/*.md`, run `./awf render` and `./awf check` to update and verify the fixed contributor surfaces. AWF owns contributor-guidance projection, topic routing, and ignored effort memory; it does not manage Git, hooks, provenance, or package gates. npm scripts and hosted CI remain repository-owned.

## Key dependencies

| Dependency | Role |
|---|---|
| Pi | Supplies runtime host modules and loads the extension and prompt entry points. |
| Current Node release | Runs development checks. |
| AWF | Renders project guidance and path-routed topic entrypoints. |
| TypeScript, Biome, Knip, and Vitest | Development-only type, format, lint, dead-code, dependency, and test checks. |

Pi core packages and TypeBox are wildcard peers supplied by Pi. Registry development dependencies use `*`. Installs create no lockfile.
