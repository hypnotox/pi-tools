# pi-tools

Personal extensions for [Pi](https://github.com/earendil-works/pi): terminal activity, timing, context management, and content-anchored editing.

## Install and update

Install the current default branch:

```bash
pi install git:github.com/hypnotox/pi-tools
```

Update installed packages explicitly:

```bash
pi update --extensions
```

Installs and updates resolve current dependencies; a running installation does not update itself.

## Extensions

### Working title

Adds an animated braille spinner to the terminal tab title while the agent is working or Pi is compacting. It preserves title changes made by other extensions and restores the idle title when work settles.

With a compatible [pi-subagents](https://github.com/nicobailon/pi-subagents) extension loaded, the spinner also follows the current session's active fleet—even when the parent is idle. Queued work and work waiting for attention count while pi-subagents reports them as active. Unrelated sessions and processes are not tracked.

The integration is automatic and optional. This changes the terminal title, not Pi's editor working indicator, and makes no model calls.

### Timing

Records tool, turn, and total agent durations in the transcript. Each turn gets a compact multiline block: tools in invocation order, then the turn duration. The final block includes the total agent duration last.

Timing continuity carries into a fresh-session handoff.

### Context pressure guidance

Adds Pi's estimated token usage, context-window size, remaining tokens, and percentage used to each model request, together with advice about context pressure. Estimates carry a `~` prefix; unusable telemetry is reported as unavailable.

| Pressure | Condition | Guidance |
|---|---|---|
| Low | No higher condition matches | Continue normally. |
| Medium | Used ≥ 70% **or** tokens ≥ 150,000 | Keep useful context; preserve important session-only knowledge. |
| High | Used ≥ 80% **or** tokens ≥ 200,000 | Prepare continuity at a safe checkpoint. |
| Critical | Used ≥ 90% **or** tokens ≥ 250,000 | Reduce context as soon as safely possible. |
| Unknown | Unusable telemetry | Do not infer a pressure action. |

The highest matching level wins, using unrounded estimates. Medium pressure alone is not a reason to reduce context.

Guidance is advisory and reassessed on every request, not stored as transcript warnings. It names only active tools and never forces a handoff, blocks tools, or changes Pi's native automatic-compaction settings.

### Fresh-session handoff

Adds `handoff_session({ kickoff })` to continue work in a fresh, parent-linked session. Use `/handoff` as a manual entry point: the prompt asks the agent to prepare a self-contained kickoff and invoke the tool.

The replacement receives the kickoff, timing continuity, and the active model and thinking level. If that model is unavailable or unauthenticated, it warns and uses the replacement defaults.

**The conversation and session-bound resources do not transfer.** Live subagent ownership stays behind. Use handoff when replacement is safe and a fresh conversation is preferable; use guided compaction when the live session needs to survive.

If replacement is canceled, recovery text goes into the current editor. If automatic kickoff delivery fails, it goes into the replacement editor.

### Guided compaction

Adds `compact_session({ instructions })` to invoke Pi's native summarizer without replacing the session identity, file, or runtime. For example:

```json
{
  "instructions": "Preserve the objective, constraints, decisions, completed work, important references, unresolved questions, and next action."
}
```

Instructions guide summarization; they are not an exact replacement summary or a verbatim-retention guarantee. Native compaction hooks still run and may change extension state. Pi 0.85.1 does not pass custom focus to split-turn prefix summarization.

The tool initially reports **queued**, not completed. After successful compaction, it resumes the parent unless another continuation is observable through Pi's supported events and state. Cancellation, failure, or insufficient history does not trigger automatic retry or fallback to handoff. A checkpoint already saved by Pi is not rolled back by later cancellation.

Native `/compact [instructions]` remains unchanged.

#### Handoff and compaction requirements

Both tools:

- Require a persisted TUI or RPC parent session; they are not offered in print/JSON or child runtimes.
- Must be called **alone in their tool-call batch**. A mixed batch blocks every sibling, including when both tools appear together.
- Require nonblank text of at most 16 KiB of UTF-8 data.
- Wait for the originating agent run to settle before executing.

**Let either operation finish before submitting new input**, and avoid overlapping unrelated session-changing actions. Pi 0.85.1 has an asynchronous-input boundary that can cause an extra automatic turn or reject a prompt submitted during compaction; see [architecture](docs/architecture.md#context-operation-boundaries) for the runtime details.

### Boundary editing

Adds `boundary_edit` for replacing a whole-line block identified by exact start/end content. Use it when boundaries are simpler than copying the entire old block; prefer ordinary `edit` for small substitutions.

```json
{
  "path": "src/report.ts",
  "start": "export function buildReport(",
  "end": "  return { rows, totals };\n}",
  "replacement": "export function buildReport(items: Item[]): Report {\n  return assembleReport(items);\n}"
}
```

Each call edits one range in one existing UTF-8 file. Paths may be relative to the working directory or absolute; `~/` and a leading `@` are supported.

- `start` must be globally unique. Selection begins at the start of its containing line.
- `end` must have exactly one eligible match from that starting line onward. It must finish at a complete LF/CRLF boundary or EOF and enclose the whole start anchor.
- **Both anchor lines are replaced.** Include their content in `replacement` if you want to keep it. Empty replacement deletes the selected lines.
- Matching is literal and case-sensitive, including whitespace and line endings. Missing or ambiguous anchors fail before writing.
- A nonempty replacement without a final LF/CRLF retains the selected final line's terminator. Untouched content remains byte-for-byte unchanged.

Results include a native-style colored diff. The confirmation and each diff preview are capped at 200 lines or 8 KiB; use `read` to inspect changes beyond a truncated preview.

**This is not stale-content detection:** changed content inside the selected block is overwritten. Edits share Pi's per-file mutation queue with participating native `edit` and `write` calls in the same runtime, not other processes or editors. Cancellation during a write does not guarantee rollback.

Native `read`, `edit`, and `write` stay unchanged. This is an additional local-filesystem tool; remote or sandbox tool routing must configure it separately.

## Development

From a checkout:

```bash
npm install --no-package-lock
./awf check
npm run check
```

Run `/reload` after editing Pi resources during a session. See [development](docs/development.md) for setup, [testing](docs/testing.md) for verification, and [architecture](docs/architecture.md) for implementation details.

## License

[AGPL-3.0-only](LICENSE).
