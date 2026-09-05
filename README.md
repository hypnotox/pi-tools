# pi-tools

Personal Pi extensions for four capabilities:

1. **Timing** records agent, turn, and tool durations and carries timing continuity into a handoff.
2. **Context telemetry** adds exact source-backed token usage, context-window size, remaining tokens, and percentage used to each model request.
3. **Fresh-session handoff** immediately replaces a persisted TUI or RPC session with a parent-linked session and delivers a self-contained kickoff.
4. **Ephemeral subagents** run focused tasks in fresh no-session Pi subprocesses that inherit the parent model, thinking level, working directory, trust state, and ordinary active tools. Children load skills without loading context files and expose neither delegation nor handoff. Their tool rows stream a bounded execution view with child thinking, correlated tool calls and durations, retry state, live usage, elapsed time, and the final report.

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

## agentic-skills boundary

`pi-tools` always registers the direct `subagent` tool with the schema `{ task: string }`. It owns child process execution but no specialized role catalog.

[`agentic-skills`](https://github.com/hypnotox/agentic-skills) is the supported producer of specialized roles. Install it separately when those tools are wanted:

```bash
pi install git:github.com/hypnotox/agentic-skills
```

The packages communicate privately through Pi's event bus. `agentic-skills` publishes roles with only `toolName`, `description`, and `loadSystemPrompt`; `pi-tools` requests a replay so either package load order works. This is not a public package export or compatibility protocol.

## Check

Install fresh dependencies and run the normal gate:

```bash
npm install --no-package-lock
npm run check
```
