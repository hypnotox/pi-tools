# 2026-09-05 restore live subagent activity

## Context

The simplified subagent runner retained child usage and the final report but stopped forwarding the child's JSON execution events to Pi's tool UI. A long-running child therefore appeared as an unchanged pending tool call. Users could not distinguish a child that had not launched from one that was thinking, invoking tools, retrying, or accumulating usage.

## Decision

Project each child JSON stream into bounded live execution details and forward immutable snapshots through Pi's tool update callback. Show child thinking, correlated tool summaries and durations, retry state, turn and token usage, cost, elapsed time, and the final report in a custom subagent result renderer. Retain at most 50 activity rows, show the newest 25 in compact mode, and keep reports and individual activity text bounded. Persist safe summaries rather than raw child tool arguments or child tool results.

## Consequences

Long-running subagents visibly demonstrate progress and expose where time is being spent. The final tool result retains enough bounded execution history to explain completed or cancelled work after settlement and session resume. The added projection and renderer increase implementation and persisted-detail size, while bounded history and summary-only tool rows prevent unbounded or raw child data from entering the parent transcript.
