# pi-tools

Private, personal tooling for [Pi](https://pi.dev): portable extensions, skills, prompt templates, and themes shared across systems.

## Extensions

### Timing

The timing extension adds local `HH:mm:ss.SSS` timestamps and monotonic durations to completed Pi turns and tool calls. Tool lines use a one-based index matching their source order, so parallel completion remains identifiable:

```text
  ↳ tool 2 · bash · 14:32:08.210 → 14:32:11.940 · 3.73s
  ↳ turn 4 · 14:32:06.411 → 14:32:14.902 · 8.49s
```

While a turn runs, its elapsed time appears beside Pi's native working spinner. Tool durations appear directly beneath completed tool output without an extra blank line. Timing history uses custom session entries, which render in the TUI but never enter model context. Run `/reload` after editing or updating the extension.

### Subagent

The standalone `subagent` tool accepts a required `task` and optional exact `provider/model` and `thinkingLevel`. Without overrides it inherits the parent model, thinking level, CWD, and active tools. Calls are serialized and cannot share a parent tool batch.

Each call runs a fresh Pi child with a minimal task prompt, the selected CWD/model/effective thinking/tools, normal extension loading, and context-file and skill discovery disabled. Toolkit profile tools are removed from every child tool set and marked children never activate them, preventing recursive toolkit delegation. Temporary trust is passed only to a canonical child CWD within the canonical trusted parent tree.

The child owns transient request retries; the toolkit never retries a whole process. Child activity, reports, failures, diagnostics, and persisted JSON profile data are bounded. Final execution details persist for TUI rendering while profile data remains out of model-visible content unless a profile deliberately transforms its final report. Run `/reload` after updating the toolkit.

## Layout

- `extensions/` - TypeScript extensions
- `skills/` - Agent Skills (`<name>/SKILL.md`)
- `prompts/` - Markdown prompt templates
- `themes/` - JSON themes

The resource directories are declared in `package.json`, so this repository can be installed directly as a Pi package. The generated `.pi/` directory contains project-local awf workflow resources for maintaining this repository; it is not exported by the package manifest.

## Install

The repository is private, so a system must have GitHub SSH access configured first.

```bash
pi install git:git@github.com:hypnotox/pi-tools
```

For local development without installing a second copy:

```bash
pi install /absolute/path/to/pi-tools
```

Use `/reload` after editing resources. To update this installed package explicitly:

```bash
pi update git:git@github.com:hypnotox/pi-tools
```

`pi update --extensions` updates all unpinned installed packages. A package installed at a Git tag or commit remains pinned until its configured ref changes.

## Adding resources

- Extension: add `extensions/<name>.ts` or `extensions/<name>/index.ts`.
- Skill: add `skills/<name>/SKILL.md` with valid `name` and `description` frontmatter.
- Prompt: add `prompts/<command>.md`; its filename becomes the slash command.
- Theme: add `themes/<name>.json`.

Keep secrets and machine-specific configuration out of the repository. Use environment variables or ignored `.env` files instead.

## Development checks

Install the lockfile-pinned development tools and run the aggregate gate:

```bash
npm ci
npm run check
```

Focused scripts are available as `format`, `format:check`, `lint`, `typecheck`, `deadcode`, and `test`. `npm run format` is the only mutating check. The pre-commit flow runs `./awf check` alongside the npm gate.

## Maintaining the repository

awf owns `AGENTS.md`, `CLAUDE.md`, the generated files under `.pi/` and `.claude/`, and most of `docs/`. Edit the source under `.awf/`, then run:

```bash
./awf render
./awf check
```

Commit `.awf/awf.lock`, authored `.awf/` changes, and regenerated outputs together. See [`docs/working-with-awf.md`](docs/working-with-awf.md) for the full workflow.
