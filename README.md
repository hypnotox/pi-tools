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

Use `boundary_edit` to replace or delete substantial regions when expressing their boundaries is simpler than reproducing their old contents. Use ordinary `edit` for small, exact substitutions. Use `boundary_read` independently when known start/end content identifies what you want to inspect; it can also validate uncertain boundaries before generating a substantial replacement. Reading first is optional.

Both tools accept one existing UTF-8 file and arrays of ranges using the same explicit endpoints: `{ "text": "...", "side": "before" | "after" }`. Each anchor must occur **exactly once in the entire file**, counting overlapping matches. Matching is literal and case-sensitive, including whitespace and line endings. `before` is immediately before the entire matched text; `after` is immediately after it. Positions do not snap to lines. Anchors may be inline or multiline, overlap, or identify context outside the selected content.

#### Editing

```json
{
  "path": "notes.md",
  "edits": [
    {
      "start": { "text": "The result is ", "side": "after" },
      "end": { "text": ", provided", "side": "before" },
      "replacement": "reliable"
    }
  ]
}
```

For `The result is acceptable, provided retries are enabled.`, this replaces only `acceptable`. The region is the half-open interval from start to end: replace exactly that content with exactly `replacement`. Empty replacement deletes it. **No spaces or line terminators are inferred, appended, or automatically retained inside the selected span.** Content outside it remains byte-for-byte unchanged. To replace a function without including the next one, use the next function's signature with `side: "before"` as the end.

Every entry resolves against the **same original file**, not earlier entries' results. The whole batch is validated before writing. Missing/ambiguous anchors, reversed positions, invalid UTF-8 strings, or overlapping replacement regions leave the file unchanged. Shared or overlapping context anchors are fine if the actual regions are disjoint. Adjacent regions are allowed. Equal start/end positions select an empty region for insertion; duplicate insertions at the same position and insertions strictly inside another replacement are rejected. There are no cross-file transactions or rollback promises after an I/O failure.

Results give an overall summary, per-entry `replaced`/`deleted`/`unchanged` outcomes and original spans, selected → replacement line/UTF-8 byte counts, and a bounded native-style diff. Counts describe the actual selected and supplied content, not diff additions/deletions. A trailing newline adds no phantom content line. Byte-identical results skip writing. Edit feedback and each stored diff/patch preview are capped at 200 lines / 8 KiB; a truncated patch is not apply-ready.

#### Reading

```json
{
  "path": "README.md",
  "ranges": [
    {
      "start": { "text": "## Installation", "side": "before" },
      "end": { "text": "## Configuration", "side": "before" }
    }
  ],
  "maxLines": 40
}
```

In a document with these unique headings, this reads the installation section without the configuration heading. `ranges` can contain several independent or overlapping regions. A compact header identifies the file, each exact half-open `[line:column, line:column)` span, total content lines/UTF-8 bytes, and whether its content is complete. Positions are one-based; columns count Unicode code points. Content appears without line-number decoration and retains literal line endings.

| `maxLines` | Content returned per range |
|---|---|
| Omitted | Compact preview, up to 40 content lines |
| Positive integer `N` | A total budget of N content lines |
| `"all"` | Complete selected content, subject to the output ceiling |

`maxLines` controls output only; it never changes the selected span. Large ranges use beginning/end excerpts (with a one-line budget, only one content line fits) and explicit omission/truncation markers. The **entire read response is capped at 8 KiB**, including headers, long lines, diagnostics, and multiple ranges. Truncated content is never marked complete. When the ceiling is tight, preview space is shared so a large first range does not hide later results or diagnostics. If later ranges cannot fit, the response identifies the omitted range numbers; request fewer or narrower ranges, or use native `read` to inspect omitted content.

Each range is resolved independently so a bad range does not hide the other results. A call with any invalid range is flagged as an error by Pi, with successful content and available per-range diagnostics retained in the error text. There are no selection IDs, stored snapshots, or reservations.

#### File handling and limitations

Paths may be relative to the working directory or absolute; `~/` and a leading `@` are supported. One initial UTF-8 BOM is preserved separately and excluded from editable content and counts. Malformed UTF-8 files and unpaired surrogates in anchors or replacements are rejected. LF, CRLF, lone CR, indentation, and Unicode are not normalized.

Failures identify the entry, selector and cause, suggest corrections, and show bounded candidate locations/context when available. Ambiguous searches stop after six matches and distinguish that lower bound from exact totals. Corrections never guess an anchor or relax matching. I/O failures identify the operation/path/reason; once writing begins, failures warn that the file may be partially modified.

**Reading is not stale-content protection:** editing re-resolves anchors against current content, and changed interiors are deliberately overwritten. Both tools use Pi's per-file mutation queue, including symlink aliases, to avoid reading during participating native `edit`/`write` calls in the same runtime. Reading releases the queue when it returns. Other processes, editors, and nonparticipating tools are not covered; cancellation during writing does not guarantee rollback.

`boundary_read` replaces `boundary_select`; the old tool name and single-range string-selector API are not retained. Reload resources and update any explicit tool allowlists or callers. Content anchors are the only addressing model: no numerical selectors, hashline addressing, occurrence selectors, regex/fuzzy matching, or structural parsing.

Native `read`, `edit`, and `write` stay unchanged. These are additional local-filesystem tools; remote or sandbox tool routing must configure them separately. Registration tests establish availability and guidance transport, not spontaneous model adoption or improved token usage.

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
