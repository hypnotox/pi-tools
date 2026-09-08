# pi-tools

Personal Pi extensions:

1. **Working title** prefixes the interactive terminal tab title with an animated braille spinner while the agent is running, Pi is compacting, or linked pi-subagents work remains active. It preserves title changes made through Pi's extension UI API and restores the unchanged idle title when work settles.
2. **Timing** records agent, turn, and tool durations and carries timing continuity into a handoff. Each turn's tool durations render in invocation order with the turn duration after them; the final turn block also includes the total agent duration last. Each block is one multiline entry without transcript spacing between its lines, while separate blocks use the host's default transcript spacing for upstream portability.
3. **Context pressure guidance** adds Pi-sourced estimated token usage, context-window size, remaining tokens, percentage used, and a current pressure assessment to each model request without durable warnings. Estimated values carry a `~` prefix; unusable source values produce `unavailable`/`unknown`.
4. **Fresh-session handoff** immediately replaces a persisted TUI or RPC session with a parent-linked session, preserves the active model and thinking level when that model remains available and authenticated, and delivers a self-contained kickoff. Otherwise, it warns and uses the replacement session's defaults. Invoke `/handoff` as an optional manual entry point.
5. **Guided compaction** exposes `compact_session({ instructions })` to invoke native summarization in the same session/runtime, with conditional continuation after success. Native `/compact [instructions]` stays unchanged.
6. **Boundary editing** adds `boundary_edit` for replacing an inclusive whole-line block using exact start/end content instead of line numbers or the complete old region. Native `read`, `edit`, and `write` stay unchanged.

## Working title and subagents

When a compatible [pi-subagents](https://github.com/nicobailon/pi-subagents) extension is loaded, the title keeps spinning even while the main session is idle, until its active fleet is empty. This follows pi-subagents' current-session accounting, including queued work and active workflows containing nested children; it does not scan unrelated sessions or processes. Work waiting for attention still counts as active while pi-subagents reports it that way.

Integration is automatic and optional, using the public event-bus RPC with the `fleetStatus` v1 capability. Lifecycle events trigger status refreshes, with reconciliation every two seconds to recover missed events and work restored after reload/resume. Requests time out after five seconds; failed or invalid status replies clear the subagent contribution rather than leaving a stuck spinner, and later successful replies restore it. Parent activity and compaction remain independent.

Without a compatible extension, only parent activity and compaction affect the title. This changes the terminal tab title, not Pi's built-in editor working indicator. No model calls or additional package dependencies are needed.

## Boundary editing

Use `boundary_edit` when identifying a whole block by its boundaries is simpler than copying its old contents. Prefer ordinary `edit` for small substitutions or when unique boundaries are unwieldy.

```json
{
  "path": "src/report.ts",
  "start": "export function buildReport(",
  "end": "  return { rows, totals };\n}",
  "replacement": "export function buildReport(items: Item[]): Report {\n  return assembleReport(items);\n}"
}
```

Each call replaces one range in one existing UTF-8 file. All four fields are required strings; only `replacement` may be empty. Paths are relative to the current working directory or absolute, with `~/` expansion and an optional leading `@`.

### Selecting the range

- `start` must occur exactly once in the entire current file, counting overlapping occurrences. Selection begins at the start of the line containing its first character, so any content before the anchor on that line is also replaced.
- Search for `end` from that starting line's beginning. Exactly one eligible occurrence must finish immediately before or after a complete LF/CRLF terminator, or at EOF, and select the entire start occurrence. Earlier lines do not count; multiple eligible occurrences fail rather than choosing the first or nearest. A mid-line end match is not expanded to a line boundary.
- Anchors may span lines, begin mid-line, overlap, or share a line. **Both anchor lines are replaced**, including the selected final line's terminator. Include any selected content you want to retain in `replacement`.
- To select through EOF, supply ordinary identifying end content on the final line. There is no EOF sentinel or implicit rest-of-file selection. A trailing newline does not create a phantom selectable line.

Matching is literal and case-sensitive: no trimming, fuzzy matching, whitespace or Unicode normalization, or LF/CRLF conversion. A lone CR is ordinary content, not a line terminator. Mixed LF/CRLF endings are preserved literally. An existing UTF-8 BOM is preserved separately from editable text. Invalid UTF-8 files and replacement strings that cannot be encoded losslessly are rejected before writing.

### Replacement and safety

`replacement` is one multiline string, preserving its indentation, internal line endings, blank lines, and extra trailing newlines:

- Empty deletes the selected lines; `"\n"` instead inserts one blank line.
- If nonempty replacement lacks a terminal LF/CRLF and the selected final line had a terminator, append that original terminator once. A supplied terminal LF/CRLF is never converted or doubled.
- An unterminated final line stays unterminated unless replacement explicitly supplies a newline. Use ordinary `edit` to deliberately remove an existing EOF terminator.

Untouched content remains byte-for-byte unchanged. Missing or ambiguous selectors and invalid ranges fail before writing. A byte-identical result succeeds without rewriting the file.

Completed results follow native `edit`: a short confirmation in tool text, with a numbered diff, unified patch, and first changed line in result details. The TUI shows a `boundary_edit` path header and Pi's colored, line-numbered diff instead of raw arguments or patch text. The diff appears after execution, not as a speculative pre-write preview. No-op and error messages remain visible. The confirmation and each stored diff preview are individually capped at 200 lines or 8 KiB, with truncation notices; a truncated patch is only a preview, not an apply-ready patch. Use `read` to inspect resulting content beyond that preview.

Selection uses the file read by this call: moved, intact unique anchors still work, but **changed content inside the selected block is deliberately overwritten**. This is not stale-content detection. The whole read–compute–write operation shares Pi's per-file mutation queue with participating native `edit` and `write` calls in the same runtime, including symlink aliases. Other processes, editors, and nonparticipating tools are not coordinated. Cancellation before writing leaves the file unchanged; I/O failure or cancellation during a write does not guarantee unchanged bytes or rollback.

## Context management

**Does this live session need to survive?**

- **Yes:** use `compact_session({ instructions })`. It retains the session identity, file, and runtime, so live session-bound work can survive. Native compaction hooks still run: extensions may react to compaction and change their own state.
- **Replacement is safe and a fresh conversation is preferable:** use `handoff_session({ kickoff })`. It creates a fresh parent-linked session and runtime. The successor must not assume prior conversation knowledge or inheritance of session-bound resources. Model, thinking level, timing continuity, and the self-contained kickoff are explicitly carried; live subagent ownership is not transferred.

Both operations require a persisted TUI or RPC session and must be **alone in their tool-call batch**; a mixed batch blocks all siblings, including when both tools appear together. They are not offered in print/JSON or child runtimes. Each required text argument must contain non-whitespace content and fit within 16 KiB of UTF-8 data. Neither operation is forced or force-enabled by pressure guidance.

### Pressure policy

Classification uses Pi's unrounded current estimated tokens and context window. Conditions are **inclusive alternatives (OR)**; the highest matching level wins, independently of Pi's native automatic-compaction settings.

| Level | Condition | Guidance |
|---|---|---|
| Low | No higher condition matches | Continue normally; either operation remains discretionary. |
| Medium | Used ≥ 70% **or** tokens ≥ 150,000 | Do not reduce context solely for this level. Continue when retained context helps; preserve important session-only knowledge. |
| High | Used ≥ 80% **or** tokens ≥ 200,000 | Identify a safe checkpoint and prepare continuity before further substantial work. |
| Critical | Used ≥ 90% **or** tokens ≥ 250,000 | Reduce context as soon as safely possible, choosing by live-session continuity. |
| Unknown | Unusable current telemetry | Do not infer a pressure action. |

The context extension reassesses every model request and names only active tools. Its warnings are advisory, not stored transcript messages: no automatic handoff, pressure-based tool embargo, or blanket disabling of native compaction.

### Guided compaction

```json
{
  "instructions": "Preserve the objective and constraints.\nKeep the decisions, completed work, important references, unresolved questions, and the next concrete action."
}
```

Instructions are passed as Pi's native `customInstructions`: they guide summarization, **not an exact replacement summary or a verbatim-retention guarantee**. Pi 0.85.1 omits custom focus from its split-turn **prefix** summarization request (including the prefix portion of mixed history/prefix compaction). That portion remains subject to native summarization without the supplied focus; pi-tools does not replace the summarizer or alter cut points to work around it.

The tool reports **queued**, not completed. After successful native compaction, a completion message resumes the parent unless another continuation is observable through Pi's supported events/state. Those observable continuations are deduplicated; pi-subagents' native compaction wake and result messages are not intercepted. Ordinary native manual/automatic compaction does not gain this tool-specific continuation.

Cancellation, failure, and insufficient history remain recoverable without automatic retry or fallback to handoff. Cancellation after Pi has already saved the checkpoint prevents the automatic continuation but does not roll back that checkpoint. Pi currently exposes native error text rather than a stable terminal-outcome enum; pi-tools surfaces that text (for example, `Compaction cancelled`, `Nothing to compact (session too small)`, or `Already compacted`).

### Shared lifecycle and handoff recovery

Both tools queue a source-resolved internal command, terminate the originating tool run, and wait for full settlement before executing. Internal commands never become model input. Duplicate commands execute once, and the two owned operations cannot compete while one is pending or executing. At most one competing **threshold** compaction is suppressed per valid pending request; manual compaction and overflow recovery are not suppressed.

Aborting the originating run, reloading/shutting down extensions, completing tree navigation, or accepting a competing replacement discards a waiting request. A canceled competing preflight alone does not discard it. Late callbacks cannot act on a replacement runtime. If handoff's own replacement is canceled, recovery text goes into the current editor; if automatic kickoff delivery fails, it goes into the replacement editor.

**Allow handoff or compaction to finish before submitting new input.** This is an operating expectation, not an input embargo. In Pi 0.85.1, an earlier asynchronous `input` hook can hide a genuine incoming prompt from compact's observer: queued `followUp` input can incur an extra automatic turn, while a plain prompt can be rejected as already processing and not stored. This accepted host boundary is characterized in runtime tests, not a universal no-duplicate/no-loss guarantee.

Avoid overlapping unrelated session-changing actions once an operation starts: this pair's coordination does not serialize every independent Pi replacement, manual compaction, or tree action. `/handoff` still expands the native prompt entry point, and `/compact [instructions]` still uses Pi's built-in command.

## Install and update

Install the current default branch without pinning a ref:

```bash
pi install git:github.com/hypnotox/pi-tools
```

Update installed packages from their current sources:

```bash
pi update --extensions
```

A clean install or explicit update resolves the dependencies current at that time. An existing running installation does not update itself.

## Check

Install fresh dependencies and run the normal gate:

```bash
npm install --no-package-lock
npm run check
```
