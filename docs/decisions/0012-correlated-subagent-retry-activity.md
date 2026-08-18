---
format: current-state-v4
slug: correlated-subagent-retry-activity
status: Proposed
date: 2026-08-18
---
# ADR-0012: Correlated Subagent Retry Activity

## Context

The subagent renderer reports child request retries as an aggregate count beneath the execution header. That placement separates retry progress from the thinking and tool activity it interrupts, and the count alone does not show the current retry limit or whether the retry recovered.

Pi's child event stream identifies each retry attempt, its configured maximum, and the terminal success or failure of a retry episode. The toolkit already correlates long-lived execution activity so a running row can settle in place, and the child must continue to own request retries without the toolkit restarting its subprocess.

## Decision

1. `decision: correlated-retry-row` Present each child request-retry episode as one correlated execution activity row. Update that row in place with the current retry attempt and configured maximum, then settle it as successful or failed with its elapsed duration. Do not render a separate aggregate retry row beneath the execution header, and do not retry the child subprocess.

## State changes

- update `development/subagent-toolkit:profile-runtime`

## Consequences

- Retry progress appears in execution order and uses the same running-to-terminal presentation as tool activity.
- Multiple failed requests in one retry episode replace the attempt shown by one row instead of adding a row per attempt.
- Persisted execution history gains a retry-row variant while the existing aggregate retry facts remain available for compatibility.
- Retry errors remain bounded diagnostic facts; the activity row exposes status, attempt progress, and duration rather than provider error text.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Keep the aggregate count beneath the header | It obscures when the retry occurs and whether it succeeds. |
| Add one activity row per retry attempt | Pi emits one terminal event for the retry episode, so separate attempt rows cannot all be correlated to independent terminal results. |

## Status history

- 2026-08-18: Proposed
