---
format: current-state-v4
slug: persist-subagent-tool-results
status: Proposed
date: 2026-08-16
---
# ADR-0007: Persist Subagent Tool Results

## Context

The subagent toolkit persists bounded thinking and correlated tool rows so live execution history remains useful after completion and session resume. Tool rows currently retain only safe argument summaries, state, and duration. Their results disappear even though Pi already bounds built-in tool output to 50 KiB, leaving expanded and resumed history without the evidence produced by each call.

Compact and expanded rendering need different presentations of the same persisted value. Compact rows must respect the current terminal width, while expanded and resumed rows can expose the bounded result without introducing a second storage representation.

## Decision

1. `decision: retain-bounded-tool-results` Persist up to Pi's 50 KiB tool-output ceiling of text result on each retained subagent tool row. Compact rendering shows the first logical result line within terminal width; expanded and resumed rendering expose the stored bounded result.

## State changes

- update `development/subagent-toolkit:profile-runtime`

## Consequences

Expanded and resumed execution history includes the evidence produced by retained tool calls. Compact rendering stays width-bounded and does not duplicate a separately truncated preview in session data.

Persisted execution details can grow by up to 50 KiB per retained tool row. The existing row-count bound limits total growth, and results already truncated by the child tool cannot be recovered beyond Pi's tool-output ceiling.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Keep only tool summaries and timings | Expanded and resumed history would continue losing tool evidence. |
| Persist a short fixed-size preview | It would make expanded rendering permanently incomplete and introduce a second arbitrary limit below Pi's tool-output contract. |
| Use a fixed compact character limit | Terminal width already provides the correct display boundary for compact rendering. |

## Status history

- 2026-08-16: Proposed
