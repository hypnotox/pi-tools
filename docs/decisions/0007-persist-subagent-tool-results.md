---
format: current-state-v4
slug: persist-subagent-tool-results
status: Implemented
date: 2026-08-16
---
# ADR-0007: Persist Subagent Tool Results

## Context

The subagent toolkit persists bounded thinking and correlated tool rows so live execution history remains useful after completion and session resume. Tool rows currently retain only safe argument summaries, state, and duration. Their results disappear even though Pi already bounds built-in tool output to 50 KiB, leaving expanded and resumed history without the evidence produced by each call.

Compact and expanded rendering need different presentations of the same persisted value. Compact rows must respect the current terminal width, while expanded and resumed rows can expose the bounded result without introducing a second storage representation.

## Decision

1. `decision: retain-bounded-tool-results` Persist an optional text result captured from `tool_execution_end` on each retained subagent tool row, bounded by Pi's 50 KiB tool-output ceiling. Compact rendering shows the first logical result line within terminal width; expanded and resumed rendering wrap the stored bounded result.
2. `decision: disclose-hidden-activity` Show a summary immediately above the activity rows whenever retained rows are omitted from the current view or older rows were discarded. Render each nonzero component as `N rows omitted` and/or `M rows discarded`, in that order and separated by `; ` when both appear.
3. `decision: scale-human-readable-durations` Format elapsed and tool durations with at most two decimal places below one millisecond, then use millisecond, second, minute, and hour scales as their magnitude increases.

## State changes

- update `development/subagent-toolkit:profile-runtime`

## Consequences

Expanded and resumed execution history includes the evidence produced by retained tool calls. Compact rendering stays width-bounded and does not duplicate a separately truncated preview in session data. It deliberately hides later result lines and width-hidden text, so the visible preview varies with terminal width and expansion is required for the full bounded evidence.

Persisted execution details can grow by up to 50 KiB per retained tool row. The existing row-count bound limits total growth, and results already truncated by the child tool cannot be recovered beyond Pi's tool-output ceiling. Scale transitions trade timing precision for readability.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Keep only tool summaries and timings | Expanded and resumed history would continue losing tool evidence. |
| Persist a short fixed-size preview | It would make expanded rendering permanently incomplete and introduce a second arbitrary limit below Pi's tool-output contract. |
| Use a fixed compact character limit | Terminal width already provides the correct display boundary for compact rendering. |
| Place omission information elsewhere or use prose without distinct counts | Keeping both counts directly above the affected rows makes hidden retained rows and discarded historical rows distinguishable in context. |
| Display every duration in milliseconds or at fixed precision | A single unit becomes difficult to scan across long executions, while fixed precision adds noise at larger scales. |

## Status history

- 2026-08-16: Proposed
- 2026-08-16: Implemented; content-sha256: 7b83945812cdc56d6e231d31e0b8ac38bd18c7b16771bacfd826be871af50dba
