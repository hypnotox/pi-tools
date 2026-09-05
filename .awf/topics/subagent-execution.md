---
paths:
  - 'extensions/subagents/**'
---

# Subagent execution

`pi-tools` directly registers generic `subagent` with only `{ task: string }`. `agentic-skills` may publish its complete specialized role set as local structural values containing exactly `toolName`, `description`, and `loadSystemPrompt`. One publication event and one replay-request event support either load order, and repeated publication does not duplicate tools. Both adapters return early in marked children.

Each tool starts a fresh POSIX Pi subprocess in JSON print and no-session mode. It inherits the parent model, thinking level, working directory, trust approval, and ordinary active tools; skills and ordinary extensions load while context files, delegation tools, and handoff do not. Tasks travel through stdin. Specialized prompts use mode-0600 temporary files. JSONL, report, and stderr text are UTF-8 bounded; usage is aggregated; cancellation and shutdown terminate the process group with TERM then KILL. Pi owns parallel tool execution.

The runner projects child JSON events into a bounded execution history containing thinking, correlated tool summaries and durations, retry state, live and completed usage, turn count, and elapsed time. It streams immutable snapshots through Pi tool updates and persists the final projection in tool details. Collapsed rendering budgets at most 10 rendered terminal lines across status, task, recent activity, outcome, omission notice, and usage/elapsed footer; settled outcomes take priority over activity. Expanded rendering shows the complete bounded projection and report. Raw child tool arguments and child tool results are not persisted.

Live progress distinguishes a stalled launch from an active child, while bounded persisted details explain completed or cancelled work without retaining raw child data.

Run `npm test -- extensions/subagents/runner.test.ts extensions/subagents/index.test.ts extensions/subagents/rendering.test.ts extensions/subagents/tool-summaries.test.ts` for focused verification, plus the `agentic-skills` local-checkout adapter test when the private role bridge changes.
