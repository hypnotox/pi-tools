---
format: current-state-v4
slug: subagent-activity-presentation
status: Proposed
date: 2026-08-18
---
# ADR-0013: Subagent Activity Presentation

## Context

The subagent toolkit preserves bounded execution history, but its terminal compact view replaced that
history with the result. Long tool summaries also wrapped onto additional rows, making activity harder
to scan and allowing the duration suffix to disappear beyond the terminal edge. Absolute paths inside
the parent project consumed space and exposed machine-specific prefixes even though the parent Pi CWD
provides a stable display root.

ADR-0004 established execution activity rendering, ADR-0009 bounded terminal results, and ADR-0012
made retry progress a correlated activity row. This decision refines their presentation without
changing persisted execution facts or model-visible tool results.

## Decision

1. `decision: cwd-relative-paths` Render absolute paths within the parent Pi CWD as `./`-prefixed
   paths, render the CWD itself as `./`, and leave paths outside that root unchanged.
2. `decision: single-line-timed-activity` Render each tool and retry activity entry on at most one
   terminal-width line, truncating the summary tail as necessary while keeping the duration visible.
3. `decision: append-terminal-result` Retain the bounded activity log when execution settles and
   append the report or failure beneath it, preserving the compact result limit and expanded result.

## State changes

- update `development/subagent-toolkit:profile-runtime`

## Consequences

Activity remains visible through settlement, durations stay scannable, and project-local paths are
portable and use less horizontal space. Compact terminal output can grow by the retained activity
rows plus the already bounded result preview. Thinking and result text may still wrap because the
single-line constraint applies only to tool and retry activity entries. Relativization remains a
presentation concern, so persisted CWD and activity facts retain their existing representation.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Keep replacing activity with the terminal result | It discards the execution trajectory precisely when the result becomes available. |
| Wrap long tool summaries | Wrapped arguments obscure activity boundaries and can push the duration off-screen. |
| Rewrite persisted paths | Display portability does not justify changing the persisted execution representation. |

## Status history

- 2026-08-18: Proposed
