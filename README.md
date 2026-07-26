# pi-tools

Private, personal tooling for [pi](https://pi.dev): extensions, skills, prompt templates, and themes shared across my systems.

## Layout

- `extensions/` — TypeScript extensions
- `skills/` — Agent Skills (`<name>/SKILL.md`)
- `prompts/` — Markdown prompt templates
- `themes/` — JSON themes

The resource directories are declared in `package.json`, so this repository can be installed directly as a pi package.

## Install

The repository is private, so a system must have GitHub SSH access configured first.

```bash
pi install git:git@github.com:hypnotox/pi-tools
```

For local development without installing a second copy:

```bash
pi install /absolute/path/to/pi-tools
```

Use `/reload` after editing resources. To pull changes on another system:

```bash
pi update --extensions
```

## Adding resources

- Extension: add `extensions/<name>.ts` or `extensions/<name>/index.ts`.
- Skill: add `skills/<name>/SKILL.md` with valid `name` and `description` frontmatter.
- Prompt: add `prompts/<command>.md`; its filename becomes the slash command.
- Theme: add `themes/<name>.json`.

Keep secrets and machine-specific configuration out of the repository. Use environment variables or ignored `.env` files instead.
