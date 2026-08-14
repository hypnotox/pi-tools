# pi-tools

Private, personal tooling for [Pi](https://pi.dev): portable extensions, skills, prompt templates, and themes shared across systems. The package resource directories are currently scaffolds; no user-facing resources ship yet.

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

## Maintaining the repository

awf owns `AGENTS.md`, `CLAUDE.md`, the generated files under `.pi/` and `.claude/`, and most of `docs/`. Edit the source under `.awf/`, then run:

```bash
./awf render
./awf check
```

Commit `.awf/awf.lock`, authored `.awf/` changes, and regenerated outputs together. See [`docs/working-with-awf.md`](docs/working-with-awf.md) for the full workflow.
