# pi-tools

Personal tooling for [Pi](https://pi.dev): portable extensions, skills, prompt templates, and themes shared across systems.

## Extensions

### Timing

The timing extension adds local `HH:mm:ss.SSS` timestamps and monotonic durations to completed Pi agent runs, turns, and tool calls. Tool lines use a one-based index matching their source order, so parallel completion remains identifiable:

```text
  ↳ tool 2 · bash · 14:32:08.210 → 14:32:11.940 · 3.73s
  ↳ turn 4 · 14:32:06.411 → 14:32:14.902 · 8.49s
  ↳ agent · 14:31:02.202 → 14:32:14.902 · 1m 12.7s
```

While a turn runs, its duration and the total duration since the current prompt started appear beside Pi's native working spinner as `Working... · Turn 4: 8.2s · Total: 1m 12.4s`. The total survives retries and completes only when the agent settles. A `handoff_session` carries that accumulated active-agent duration and turn count into its replacement session, so the next turn continues both values; the countdown and session-switch gap are excluded. Tool durations appear directly beneath completed tool output without an extra blank line. Timing history uses custom session entries, which render in the TUI but never enter model context. Run `/reload` after editing or updating the extension.

### Context usage

The context usage extension adds a fresh, hidden `[session context]` line to every model request. It reports current token usage, the active model's context window, percentage, context pressure, and active-branch compaction count. The line is transient: it guides the current request without being saved in the session transcript.

Context pressure is the highest level reached by either relative or absolute usage: `medium` at 50% or 100k tokens, `high` at 70% or 150k, and `critical` at 85% or 200k. Lower usage is `low`; unavailable usage is `unknown`.

### Usage limit resume

The limit resume extension waits out a provider usage limit and continues the interrupted work on its own. When an agent turn settles with a usage-limit error, it schedules a resume and shows the wait in the status bar:

```text
limit reached · resuming at 03:34 · attempt 1
limit reached · reset time unknown · retrying at 03:49 · attempt 2
```

The resume time comes only from limit facts the provider actually reports: an exhausted window's reset in the response headers, or a reset the failure text states outright. Nothing is inferred from plan or window assumptions. With no reset observable the extension retries every 15 minutes instead, says so in the status line, and warns once per session that it is running blind. Credit and billing exhaustion is left alone, since waiting never clears it.

Resuming sends an extension-owned message rather than a synthetic user message, so the session transcript never gains input you did not type. A pending resume is cancelled by sending any message, or by `/limit-resume`; its timer is cleared at session shutdown. Attempts are not capped, so a session left alone keeps retrying until it succeeds or you cancel it.

Reset times are only observable on the `sse` transport. Pi's default `auto` transport serves `openai-codex` over a WebSocket, where no response headers reach extensions at all and the failure text carries no time, so every wait there is blind. Set `"transport": "sse"` in `~/.pi/agent/settings.json`, or per project in `.pi/settings.json`, to get exact resume times. That transport re-uploads the full conversation per turn instead of sending deltas over a cached socket, which is the cost of the exchange. The extension never changes this setting for you.

### Fresh-session handoff

The `handoff_session` tool starts a parent-linked fresh interactive session after a five-second cancellable countdown. It accepts required `kickoff` text up to 16 KiB of UTF-8, preserves it exactly, delivers it as visible handoff context that triggers the replacement session, and transfers compatible extension continuity data such as timing. The tool only runs alone in its batch. If automatic delivery fails after replacement, the replacement editor receives the exact prepared text; if another extension cancels replacement before the switch, the original editor receives it for recovery. At session startup, pi-tools yields `handoff_session` ownership when another loaded extension already provides a tool with that name, avoiding conflicts with older awf project extensions.

The replacement starts without knowledge of the preceding conversation. Put every fact needed to continue in durable files or in the kickoff, and cite relevant files explicitly. Depending on the work, useful kickoff content includes the objective, current state, next action, decisions, constraints, completed work, verification, blockers, and unresolved questions. At medium pressure preserve important session-only knowledge, at high pressure identify a safe handoff point and prepare continuity, and at critical pressure hand off as soon as safely possible.

A queued handoff suppresses only one imminent threshold-triggered compaction, allowing Pi to drain the queued continuation first. Manual and overflow compactions remain available, and later threshold compactions are unaffected. Run `/reload` after updating either extension.

### Subagent

The standalone `subagent` tool accepts a required `task` and optional exact `provider/model` and `thinkingLevel`. Without overrides it inherits the parent model, thinking level, CWD, and active tools. Calls are serialized and cannot share a parent tool batch.

Each call runs a fresh Pi child with a minimal task prompt, the selected CWD/model/effective thinking/tools, normal extension loading, and context-file and skill discovery disabled. Toolkit profile tools are removed from every child tool set and marked children never activate them, preventing recursive toolkit delegation. Temporary trust is passed only to a canonical child CWD within the canonical trusted parent tree.

The child owns transient request retries; the toolkit never retries a whole process. Retry progress appears as one activity row that updates with the current attempt, configured maximum, terminal status, and duration. Reports, failures, retained stderr, the prepared task prompt, persisted profile/CWD/model facts, and expanded profile JSON are each limited to 16 KiB of UTF-8 text. Malformed JSONL is ignored and a line over 1 MiB is discarded without corrupting later events. The persisted execution projection retains the newest 50 logical thinking, correlated tool, and retry rows, including each safe tool summary, live-to-terminal status, and human-readable duration; it never retains raw tool arguments or child-owned tool results. Rendering shortens absolute paths within the parent Pi CWD to `./`-prefixed paths in the child CWD line and activity summaries, renders the parent CWD itself as `./`, and leaves paths outside it unchanged. When the child CWD differs from the parent's, rendering shows it beneath the header with a `path:` label and truncates the line to the terminal width. Compact live rendering shows the bounded prompt on one truncated line and the newest 25 rows. Expanded rendering wraps the prompt and shows all 50 rows. Activity rows use aligned `success:`, `error:`, `running:`, and `thought:` labels. Tool and retry activity rows occupy one terminal-width line: their summary tail is truncated as needed while the variable-width duration remains visible, and the truncation marks and duration retain the row's activity color. A summary above the visible rows distinguishes retained rows hidden by the compact limit from older rows discarded by the persistence limit, using `N rows omitted; M rows discarded` when both apply. Terminal rendering retains the activity log and appends the final report or failure beneath it; compact mode shows at most 24 terminal-width-wrapped result lines and ends the last visible line with `...` when truncated, while expanded and resumed rendering show the full bounded outer result. The header reports overall elapsed time, and the Pi-like footer reports completed turns, live-plus-completed input/output and cache usage, the latest turn cache-hit rate, cumulative cost, and human-readable elapsed time; zero cache writes are omitted.

Persisted profile data must be finite, acyclic JSON matching the profile schema and is limited to 16 KiB after serialization. Profile data remains out of model-visible content unless a profile deliberately transforms its final report. Child usage, including provider-reported token splits and cost fields, is attached to the parent tool result for Pi session accounting. Invalid model or thinking callback selections fail before launch rather than being silently coerced. Run `/reload` after updating the toolkit.

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

Profiles can provide validated `promptSnippet` and `promptGuidelines` metadata for Pi's active-tool prompt. They own model/thinking selection, preparation, lifecycle hooks, and bounded JSON result data; model selection may resolve synchronously or asynchronously before validation and lookup. An `afterRun` hook may return a bounded `failure` with schema-valid `profileData`: unless cancellation is authoritative, that creates a terminal failed result, preserves child execution facts and profile audit data, and makes the failure text model-visible. Uncorrelated exclusive calls fail closed with a retry-alone instruction; ordinary calls remain allowed when correlation is unavailable. Consumers own dependency provisioning and their policy for missing or incompatible capabilities.

### Tool summary integration

Extensions import **types only** from `pi-tools/subagent-profile` and use the version-`1` `pi-tools:subagent-tool-summaries:*` event-bus handshake. A registration has a stable `registrationId` and synchronous resolvers, each owning one exact custom tool name. Listen for capability and result events, request a correlated replay, and reuse the registration id for replayed delivery. Registrations are pending during extension initialization and become registered or rejected when `session_start` freezes ownership.

The toolkit exclusively reserves `read`, `edit`, `write`, `bash`, `grep`, `find`, and `ls`; extensions cannot claim them. A batch with a reserved or already-owned name is rejected atomically, ownership is never overridden, and late registration is rejected. Resolvers receive an immutable JSON snapshot of raw arguments in the trusted extension process and must return bounded, single-line plain text synchronously. They run inline on the child event-processing path and must return quickly. Resolver failures or invalid output, and every unregistered tool, safely display only the tool name. Raw arguments are not persisted by the toolkit.

## Layout

- `extensions/` - TypeScript extensions
- `skills/` - Agent Skills (`<name>/SKILL.md`)
- `prompts/` - Markdown prompt templates
- `themes/` - JSON themes

The resource directories are declared in `package.json`, so this repository can be installed directly as a Pi package. The generated `.pi/` directory contains project-local awf workflow resources for maintaining this repository; it is not exported by the package manifest.

## Install

Install a tagged release so the package stays pinned until its configured ref changes:

```bash
pi install git:github.com/hypnotox/pi-tools@v0.3.0
```

Omit `@v0.3.0` only when intentionally following the repository's latest revision. For local development without installing a second copy:

```bash
pi install /absolute/path/to/pi-tools
```

Use `/reload` after editing resources. To update this installed package explicitly:

```bash
pi update git:github.com/hypnotox/pi-tools
```

`pi update --extensions` updates all unpinned installed packages. A package installed at a Git tag or commit remains pinned until its configured ref changes.

## Adding resources

- Extension: add `extensions/<name>.ts` or `extensions/<name>/index.ts`.
- Skill: add `skills/<name>/SKILL.md` with valid `name` and `description` frontmatter.
- Prompt: add `prompts/<command>.md`; its filename becomes the slash command.
- Theme: add `themes/<name>.json`.

Keep secrets and machine-specific configuration out of the repository. Use environment variables or ignored `.env` files instead.

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE).

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

## Extension testing

TypeScript-aware extension tests can import the source-only `pi-tools/testing` boundary:

```ts
import { createExtensionRecorder } from "pi-tools/testing";
const recorder = createExtensionRecorder({ exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }) });
const installation = recorder.install(myExtension);
await installation; // Await an async factory before inspecting its registrations.
```

The framework-neutral recorder is the complete repository home for reusable documented Pi extension seams, contexts, lifecycle handlers, registrations, discovery, event traffic, injectable `exec`, recording UI, mutable model registry, and direct invocation. Configure omissions and injected behavior before installing factories. `invokeRaw`, `invokeToolDirect`, and `invokeCommandDirect` intentionally call registered functions directly: raw listener-error propagation is recorder behavior, not Pi runtime fidelity, and these helpers do not simulate Pi middleware, error envelopes, command routing, or session scheduling. The recorder deliberately does not mirror every `ExtensionAPI` capability. It is developed against the Pi version pinned for this repository. Reusable Pi-boundary fixtures belong here; extension-specific clocks, countdowns, schedulers, runners, rendering, policy, deferred outcomes, models, subprocesses, streams, and schemas remain local to their domain tests. A separate credential-free test proves real extension loading and tool registration through Pi's public SDK.
