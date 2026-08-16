---
format: current-state-v4
slug: align-node-runtime-baseline-with-pi
status: Proposed
date: 2026-08-16
---
# ADR-0011: Align Node Runtime Baseline with Pi

## Context

The package declares Node.js 20 as its minimum runtime and release-verification lane. The Pi 0.84.2
packages currently developed and verified here declare Node.js 22.19.0 or newer, as does their
`undici` dependency. A clean Node.js 20.20.2 installation warns that these engines are unsupported,
then the aggregate test gate fails while importing Pi with `webidl.util.markAsUncloneable is not a
function`.

The source-only `pi-tools/testing` boundary imports Pi's public `SessionManager` at runtime to provide
in-memory sessions, while extension and SDK tests also load current Pi runtime packages. The declared
Node.js 20 floor is therefore no longer truthful for either the testing boundary or the repository's
required release evidence. The breaking pre-1.0 v0.3.0 release provides the next correct point to
align the package contract.

## Decision

1. `decision: pi-aligned-node-baseline` Require Node.js 22.19.0 or newer for pi-tools so the package runtime baseline matches the minimum supported by the Pi version it develops and verifies against.
2. `decision: minimum-node-release-evidence` Verify release candidates through a clean dependency installation and complete project gate on an actual supported Node.js 22 runtime at or above the declared floor; do not waive a failing older-runtime lane or retain a lower advertised minimum.

## State changes

- update `development/extension-toolchain:typescript-quality-gate`

## Consequences

Consumers running Node.js 20 must upgrade before installing v0.3.0. This is a breaking compatibility
change, but it removes a package promise that current Pi cannot satisfy and avoids failures during
module import.

Release evidence moves to Node.js 22. A clean run on the approved Node.js 22.23.2 verification
runtime proves the current lockfile on that supported version; the exact 22.19.0 floor follows the
current Pi dependency engine contracts rather than a direct 22.19.0 run. Ordinary development may
use a newer supported runtime. Future Pi upgrades must prompt another baseline review when their
engine requirement rises.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Waive the Node.js 20 failure | Publishes a false engine contract and contradicts the required release gate. |
| Keep advertising Node.js 20 without testing it | Moves the failure to consumers and leaves documentation inconsistent with dependencies. |
| Downgrade Pi to a release that supports Node.js 20 | Abandons the approved current Pi 0.84.2 SDK target and requires renewed compatibility work for the completed v0.3.0 recorder. |
| Decouple every test and extension from Pi runtime imports | Expands into a broad compatibility architecture change and still cannot validate the current public SDK on an unsupported runtime. |

## Status history

- 2026-08-16: Proposed
