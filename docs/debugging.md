# Debugging

## Inspection surfaces

- `pi list`: show installed packages and their configured sources.
- `pi config`: inspect whether package resources are enabled.
- Pi startup output: inspect the four loaded package extensions.
- `git status --short`: inspect repository changes.
- `./awf check`: report invalid AWF sources, projection drift, or retired marked outputs.
- `./awf render`: update fixed generated contributor surfaces and report retired marked outputs.

## Recipes

### A package resource does not load

1. Run `pi list` and confirm this repository is installed from the expected source.
2. Run `pi config` and confirm the resource type and item are enabled.
3. Confirm `package.json` declares the resource path and the file follows Pi's layout and format rules.
4. Run `/reload`; restart Pi if an extension changed its startup behavior.

### A project guidance resource is stale or missing

1. Confirm the project is trusted; Pi loads `.pi/` resources only for trusted projects.
2. Run `./awf check` and follow its drift repair hint.
3. If `.awf/project.md` or `.awf/topics/**/*.md` changed, run `./awf render`, then `./awf check` again.
4. Run `/reload` to refresh the active Pi session.

### An AWF check fails after a guidance edit

Edit `.awf/project.md` or the relevant `.awf/topics/**/*.md` source rather than a generated contributor surface. Render again and commit the source with every generated output. Ordinary files under `docs/` are repository-owned and are edited directly.
