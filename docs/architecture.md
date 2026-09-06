# Architecture

## Overview

`pi-tools` is a personal Pi package and development workspace. Its manifest exposes working-title, timing, context telemetry, and handoff extensions plus a handoff prompt template. Contributor guidance is repository-local and is not a package resource.

## Components

- `package.json`: package identity, four Pi extension entry points, and the handoff prompt export.
- `prompts/handoff.md`: native `/handoff` initiation for the existing handoff capability.
- `extensions/working-title/`: animated terminal-title activity while the agent runs or Pi compacts.
- `extensions/timing/`: agent, turn, and tool timing plus handoff continuity.
- `extensions/context-usage/`: source-backed context telemetry injected into model context.
- `extensions/handoff/`: immediate persisted-session replacement and kickoff delivery.
- `tests/`: small test-local fixtures and cross-entrypoint smoke coverage.
- `.awf/project.md` and `.awf/topics/`: project guidance and path-routed current guidance.
- `.pi/`, `.claude/`, `AGENTS.md`, and `CLAUDE.md`: generated contributor surfaces, not package extension entry points.

## Data flow

Pi installs the repository, reads the four explicit extension paths and handoff prompt path in `package.json`, and loads them at startup or after `/reload`. Working title wraps the shared extension `setTitle` method so later title changes remain the undecorated base while its timer paints a transient activity prefix. Timing buffers a completed turn until the next turn begins or the agent settles, allowing the final block to include the total agent duration without a transcript gap; context telemetry observes Pi events independently. `/handoff` expands to an agent instruction that uses the existing handoff tool, and handoff opts an internal tokenized message into extension-command dispatch while the tool is running. That command waits for full agent settlement before replacing the persisted session. Before delivering the kickoff, the replacement session restores the parent session's active model and thinking level from the same private continuity entry used for timing; if that model is unavailable or unauthenticated, it warns and retains the replacement defaults.

The pending token is claimed once after `waitForIdle()`. Shutdown and completed `session_tree` events invalidate pending work; the captured run signal also detects an accepted competing replacement's abort before shutdown reaches the idle boundary. Cancellable preflight events do not invalidate work. These guards do not serialize independent replacements after the handoff claims its token; that remains a host limitation.

Maintainers edit package resources and ordinary documentation directly. After changing `.awf/project.md` or `.awf/topics/**/*.md`, run `./awf render` and `./awf check` to update and verify the fixed contributor surfaces. AWF owns contributor-guidance projection, topic routing, and ignored effort memory; it does not manage Git, hooks, provenance, or package gates. npm scripts and hosted CI remain repository-owned.

## Key dependencies

| Dependency | Role |
|---|---|
| Pi | Supplies runtime host modules and loads the extension and prompt entry points. |
| Current Node release | Runs development checks. |
| AWF | Renders project guidance and path-routed topic entrypoints. |
| TypeScript, Biome, Knip, and Vitest | Development-only type, format, lint, dead-code, dependency, and test checks. |

Pi core packages and TypeBox are wildcard peers supplied by Pi. Registry development dependencies use `*`. Installs create no lockfile.
