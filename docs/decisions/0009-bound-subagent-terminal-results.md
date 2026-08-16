---
format: current-state-v4
slug: bound-subagent-terminal-results
status: Proposed
date: 2026-08-16
---
# ADR-0009: Bound Subagent Terminal Results

## Context

ADR-0004 established a compact terminal presentation that replaces a settled child's activity with its final report or failure. ADR-0007 later added bounded result payloads to the persisted rows for the child's own tool calls and rendered those payloads in compact and expanded history. That addition conflated the outer subagent tool result with the results of tools owned by the child.

The inner result rows duplicate evidence already consumed by the child, substantially enlarge persisted execution details, and add visual output beneath every retained child tool row. Meanwhile, the outer subagent report—the result the parent requested—renders nearly its entire 16 KiB safety bound in compact mode. Compact completion therefore spends its display budget on the wrong layer.

## Decision

1. `decision: bound-terminal-result-presentation` Persist and render child-owned tool activity without child tool-result payloads. On settlement, compact presentation uses the bounded display region for at most 24 terminal-width-wrapped lines of the outer report or failure, marks truncation on the final visible line, and preserves the omission/discard summary above that preview when applicable. Expanded presentation retains the full safety-bounded outer report or failure and the child activity history.

## State changes

- update `development/subagent-toolkit:profile-runtime`

## Consequences

Persisted execution details remain useful for understanding which child tools ran, their status, summaries, and duration, without duplicating their output. Existing session entries that contain inner results remain structurally readable but no longer display those payloads.

Compact settled results have a predictable vertical bound close to the live 25-row activity backbuffer. Reports longer than the preview require expansion to read in full. The omission/discard summary may add one line above the 24-line preview, keeping historical loss visible without allowing the terminal result to grow to the full report bound.

This changes ADR-0007's result-persistence choice while retaining its omission-summary and duration-formatting decisions.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Stop rendering inner results but continue persisting them | The unused payloads would continue enlarging session details without providing user-visible value. |
| Show only the first logical line of the outer result | It is compact but too little space for a useful delegated report. |
| Keep the complete outer report visible in compact mode | A report near the safety limit overwhelms the transcript and defeats compact presentation. |

## Status history

- 2026-08-16: Proposed
