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

### Context usage

The context usage extension adds a fresh, hidden `[session context]` line to every model request. It reports current token usage, the active model's context window, percentage, and active-branch compaction count. The line is transient: it guides the current request without being saved in the session transcript.

### Fresh-session handoff

The `handoff_session` tool starts a parent-linked fresh interactive session after a five-second cancellable countdown. It accepts required `kickoff` text (up to 1,000 UTF-16 code units), preserves it exactly, and delivers it as visible handoff context that triggers the replacement session. The tool only runs alone in its batch. If automatic delivery fails after replacement, the replacement editor receives the exact prepared text; if another extension cancels replacement before the switch, the original editor receives it for recovery.

A queued handoff suppresses only one imminent threshold-triggered compaction, allowing Pi to drain the queued continuation first. Manual and overflow compactions remain available, and later threshold compactions are unaffected. Run `/reload` after updating either extension.

### Subagent

The standalone `subagent` tool accepts a required `task` and optional exact `provider/model` and `thinkingLevel`. Without overrides it inherits the parent model, thinking level, CWD, and active tools. Calls are serialized and cannot share a parent tool batch.

Each call runs a fresh Pi child with a minimal task prompt, the selected CWD/model/effective thinking/tools, normal extension loading, and context-file and skill discovery disabled. Toolkit profile tools are removed from every child tool set and marked children never activate them, preventing recursive toolkit delegation. Temporary trust is passed only to a canonical child CWD within the canonical trusted parent tree.

The child owns transient request retries; the toolkit never retries a whole process. Reports, failures, retained stderr, persisted profile/CWD/model facts, and expanded profile JSON are each limited to 16 KiB of UTF-8 text. Activity retains 32 entries of 1 KiB each and reports the omitted count; malformed JSONL is ignored and a line over 1 MiB is discarded without corrupting later events. Persisted profile data must be finite, acyclic JSON matching the profile schema and is limited to 16 KiB after serialization. Final execution details persist for TUI rendering while profile data remains out of model-visible content unless a profile deliberately transforms its final report. Child usage, including provider-reported token splits and cost fields, is attached to the parent tool result for Pi session accounting. Invalid model or thinking callback selections fail before launch rather than being silently coerced. Run `/reload` after updating the toolkit.

### Profile integration

An extension that wants a purpose-specific delegation surface imports **types only** from `pi-tools/subagent-profile`; it does not import toolkit runtime code. At factory initialization it listens for `pi-tools:subagent-profiles:capability` and `pi-tools:subagent-profiles:registration-result`, emits a `pi-tools:subagent-profiles:request` containing a unique correlation id and protocol version `2`, and accepts either a matching capability reply or an uncorrelated availability announcement. The capability's `register()` queues one atomic profile batch:

```ts
import type { ProfileDefinition, ProfileRegistration } from "pi-tools/subagent-profile";

const registration: ProfileRegistration = {
  registrationId: "my-extension:review-v1",
  suppressDefault: true,
  profiles: [
    {
      ...reviewProfile,
      promptSnippet: "Use review_agent for focused review.",
      promptGuidelines: ["Use review_agent only for focused review."],
    } satisfies ProfileDefinition,
  ],
};
// On a matching version plus either a matching correlation id or no correlation id:
// capability.register(registration);
```

The toolkit announces availability after installing its listener, while a later consumer requests a correlated replay, so either extension load order works. Consumers reuse one stable `registrationId` for every replay; repeated delivery returns the same receipt without duplicating profiles. Registration receipts are initially `pending` and become `registered` or `rejected` when `session_start` freezes the complete configured tool snapshot, including inactive tools. After accepted tools are installed, the toolkit emits one protocol-versioned `registration-result` event per finalized batch with its `registrationId`, terminal state, and rejection reason when applicable.

Profiles can provide validated `promptSnippet` and `promptGuidelines` metadata for Pi's active-tool prompt. They own model/thinking selection, preparation, lifecycle hooks, and bounded JSON result data. An `afterRun` hook may return a bounded `failure` with schema-valid `profileData`: unless cancellation is authoritative, that creates a terminal failed result, preserves child execution facts and profile audit data, and makes the failure text model-visible. Uncorrelated exclusive calls fail closed with a retry-alone instruction; ordinary calls remain allowed when correlation is unavailable. Consumers own dependency provisioning and their policy for missing or incompatible capabilities.

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
