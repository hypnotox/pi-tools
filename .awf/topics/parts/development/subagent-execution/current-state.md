This topic records the active ephemeral delegation contracts.

## Claims

### `rule: direct-and-specialized-tools`

`pi-tools` directly registers generic `subagent` with only `{ task: string }`. `agentic-skills` may publish its complete specialized role set as local structural values containing exactly `toolName`, `description`, and `loadSystemPrompt`. One publication event and one replay-request event support either load order, and repeated publication does not duplicate tools. Both adapters return early in marked children.

**Backing: test**
**Verify:** Run `npm test -- extensions/subagents/index.test.ts` and the `agentic-skills` local-checkout adapter test.

### `rule: ephemeral-child-runner`

Each tool starts a fresh POSIX Pi subprocess in JSON print and no-session mode. It inherits the parent model, thinking level, working directory, trust approval, and ordinary active tools; skills and ordinary extensions load while context files, delegation tools, and handoff do not. Tasks travel through stdin. Specialized prompts use mode-0600 temporary files. JSONL, report, and stderr text are UTF-8 bounded; usage is aggregated; cancellation and shutdown terminate the process group with TERM then KILL. Pi owns parallel tool execution.

The runner projects child JSON events into a bounded execution history containing thinking, correlated tool summaries and durations, retry state, live and completed usage, turn count, and elapsed time. It streams immutable snapshots through Pi tool updates and persists the final projection in tool details. Compact rendering shows the newest 25 of at most 50 retained rows, keeps timed tool activity on one physical line, and appends at most 24 wrapped final-report lines; expanded rendering shows the complete bounded projection and report. Raw child tool arguments and child tool results are not persisted.

**Backing: test**
**Verify:** Run `npm test -- extensions/subagents/runner.test.ts extensions/subagents/index.test.ts extensions/subagents/rendering.test.ts extensions/subagents/tool-summaries.test.ts`.
