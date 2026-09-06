# pi-tools

Personal Pi extensions for four capabilities:

1. **Working title** prefixes the interactive terminal tab title with an animated braille spinner while the agent is running or Pi is compacting. It preserves title changes made through Pi's extension UI API and restores the unchanged idle title when work settles.
2. **Timing** records agent, turn, and tool durations and carries timing continuity into a handoff. Each turn's tool durations render in invocation order with the turn duration after them; the final turn block also includes the total agent duration last. Each block is one multiline entry without transcript spacing between its lines, while separate blocks use the host's default transcript spacing for upstream portability.
3. **Context telemetry** adds Pi-sourced estimated token usage, known context-window size, estimated remaining tokens, and estimated percentage used to each model request. Estimated values carry a `~` prefix; unusable source values produce `unavailable`.
4. **Fresh-session handoff** immediately replaces a persisted TUI or RPC session with a parent-linked session, preserves the active model and thinking level when that model remains available and authenticated, and delivers a self-contained kickoff. Otherwise, it warns and uses the replacement session's defaults. Invoke `/handoff` as an optional manual entry point.

## Handoff lifecycle

Handoff waits for the current run to settle before starting the replacement; its internal command is not sent to the model. Aborting the originating run, reloading extensions, or completing tree navigation discards a waiting handoff. A canceled competing session action alone does not discard it. If handoff's own replacement is canceled, the kickoff is prepared in the editor for recovery.

Avoid overlapping session-changing actions once handoff starts: upstream Pi does not serialize independent replacement requests.

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
