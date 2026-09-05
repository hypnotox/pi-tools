# Architecture

## Overview

`pi-tools` is a personal Pi package and development workspace. Its manifest exposes only timing, context telemetry, handoff, and subagent extensions. Contributor guidance is repository-local and is not a package extension entry point.

## Components

- `package.json`: package identity and the four Pi extension entry points.
- `extensions/timing/`: agent, turn, and tool timing plus handoff continuity.
- `extensions/context-usage/`: source-backed context telemetry injected into model context.
- `extensions/handoff/`: immediate persisted-session replacement and kickoff delivery.
- `extensions/subagents/`: direct generic delegation, the private role bridge, POSIX child execution, and bounded live child-activity rendering.
- `tests/`: small test-local fixtures and cross-entrypoint smoke coverage.
- `.awf/project.md` and `.awf/topics/`: project guidance and path-routed current guidance.
- `.pi/`, `.claude/`, `AGENTS.md`, and `CLAUDE.md`: generated contributor surfaces, not package extension entry points.

## Data flow

Pi installs the repository, reads the four explicit extension paths in `package.json`, and loads them at startup or after `/reload`. Timing and context telemetry observe Pi events, handoff replaces a persisted session through a queued command, and subagent tools spawn fresh no-session Pi children and project their JSON event streams into bounded live tool updates. `agentic-skills` may publish specialized roles over Pi's event bus; `pi-tools` owns execution and child-activity presentation.

Maintainers edit package resources and ordinary documentation directly. After changing `.awf/project.md` or `.awf/topics/**/*.md`, run `./awf render` and `./awf check` to update and verify the fixed contributor surfaces. AWF owns contributor-guidance projection, topic routing, and ignored effort memory; it does not manage Git, hooks, provenance, or package gates. npm scripts and hosted CI remain repository-owned.

## Key dependencies

| Dependency | Role |
|---|---|
| Pi | Supplies runtime host modules and loads the four extension entry points. |
| Current Node release | Runs development checks and POSIX child processes. |
| AWF | Renders project guidance and path-routed topic entrypoints. |
| TypeScript, Biome, Knip, and Vitest | Development-only type, format, lint, dead-code, dependency, and test checks. |

Pi core packages and TypeBox are wildcard peers supplied by Pi. Registry development dependencies use `*`; the coding-agent development artifact resolves through its stable latest-release URL. Installs create no lockfile.
