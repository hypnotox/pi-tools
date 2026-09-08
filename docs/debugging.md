# Debugging

## Inspection surfaces

- `pi list`: show installed packages and their configured sources.
- `pi config`: inspect whether package resources are enabled.
- Pi startup output: inspect the loaded package extensions.
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

### A context operation does not proceed

1. Confirm a persisted TUI/RPC parent session and an active `handoff_session` or `compact_session` tool. Neither tool is offered in print/JSON mode or force-enabled by guidance.
2. Use a standalone call with nonblank text of at most 16 KiB UTF-8. Mixed batches block every sibling.
3. Treat the immediate result as queued. Abort, reload, completed tree navigation, or an accepted replacement invalidates waiting work; a canceled competing preflight does not.
4. For compaction, inspect the native terminal error text. Cancellation, insufficient history, and failures do not auto-retry. Pi 0.85.1 omits custom focus from split-turn prefix summarization; see [Context management](../README.md#context-management).
5. For a canceled handoff or failed automatic kickoff, inspect the recovery text in the editor. Avoid overlapping unrelated host session-changing actions.
6. If input submitted during compaction incurs an extra turn or an `Agent is already processing` rejection, check for an earlier asynchronous input hook and the [accepted Pi 0.85.1 input boundary](../README.md#shared-lifecycle-and-handoff-recovery). Let either operation finish before submitting new input; resubmit a rejected prompt after it finishes.
