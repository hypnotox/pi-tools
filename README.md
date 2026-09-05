# pi-tools

Personal Pi extensions for three capabilities:

1. **Timing** records agent, turn, and tool durations and carries timing continuity into a handoff.
2. **Context telemetry** adds Pi-sourced estimated token usage, known context-window size, estimated remaining tokens, and estimated percentage used to each model request. Estimated values carry a `~` prefix; unusable source values produce `unavailable`.
3. **Fresh-session handoff** immediately replaces a persisted TUI or RPC session with a parent-linked session, preserves the active model and thinking level when that model remains available and authenticated, and delivers a self-contained kickoff. Otherwise, it warns and uses the replacement session's defaults. Invoke `/handoff` as an optional manual entry point.

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

## Check

Install fresh dependencies and run the normal gate:

```bash
npm install --no-package-lock
npm run check
```
