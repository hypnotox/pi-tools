# pi-tools

Personal Pi extensions:

1. **Working title** prefixes the interactive terminal tab title with an animated braille spinner while the agent is running, Pi is compacting, or linked pi-subagents work remains active. It preserves title changes made through Pi's extension UI API and restores the unchanged idle title when work settles.
2. **Timing** records agent, turn, and tool durations and carries timing continuity into a handoff. Each turn's tool durations render in invocation order with the turn duration after them; the final turn block also includes the total agent duration last. Each block is one multiline entry without transcript spacing between its lines, while separate blocks use the host's default transcript spacing for upstream portability.
3. **Context telemetry** adds Pi-sourced estimated token usage, known context-window size, estimated remaining tokens, and estimated percentage used to each model request. Estimated values carry a `~` prefix; unusable source values produce `unavailable`.
4. **Fresh-session handoff** immediately replaces a persisted TUI or RPC session with a parent-linked session, preserves the active model and thinking level when that model remains available and authenticated, and delivers a self-contained kickoff. Otherwise, it warns and uses the replacement session's defaults. Invoke `/handoff` as an optional manual entry point.
5. **Boundary editing** adds `boundary_edit` for replacing an inclusive whole-line block using exact start/end content instead of line numbers or the complete old region. Native `read`, `edit`, and `write` stay unchanged.

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

## Handoff lifecycle

Handoff waits for the current run to settle before starting the replacement; its internal command is not sent to the model. Aborting the originating run, reloading extensions, or completing tree navigation discards a waiting handoff. A canceled competing session action alone does not discard it. If handoff's own replacement is canceled, the kickoff is prepared in the editor for recovery.

Avoid overlapping session-changing actions once handoff starts: upstream Pi does not serialize independent replacement requests.

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
