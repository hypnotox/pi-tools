---
format: current-state-v4
slug: reusable-extension-testing-boundary
status: Implementing
date: 2026-08-16
---
# ADR-0008: Reusable Extension Testing Boundary

## Context

Six test suites independently reconstruct parts of Pi's extension boundary: handler and
registration capture, event-bus traffic, contexts, tool discovery, or tool invocation. The copies
have already diverged in capability and shape, so changes to the shared boundary require finding and
updating several local models rather than one owned abstraction.

Pi documents public extension and SDK seams, but does not provide an extension-specific test
harness. A reusable helper can therefore own the project's test representation of that boundary
without changing extension production design. It must remain distinct from Pi's runtime: event
middleware, error envelopes, and session orchestration are Pi behavior and should be proved against
the real public SDK rather than imperfectly reimplemented.

The package distributes TypeScript source from tagged Git revisions without a build artifact. Its
intended adopter test environments must be TypeScript-aware, and the owner keeps the developed-against
Pi fork current with upstream. The testing boundary consequently does not need plain-Node output or a
historical Pi compatibility matrix.

## Decision

1. `decision: single-testing-boundary` Offer one framework-neutral public testing boundary and make it the sole owner of the reusable Pi extension API recordings, contexts, and invocation facilities exercised by this project's extension tests.
2. `decision: typescript-source-distribution` Distribute the testing boundary as source only for TypeScript-aware adopter test environments, without compiled JavaScript output.
3. `decision: developed-against-pi` Support the Pi version the repository currently develops and verifies against, rather than maintaining a historical compatibility matrix.
4. `decision: real-runtime-verification` Keep the reusable test representation bounded to documented public Pi seams and verify Pi-owned runtime semantics separately through the real public SDK instead of reproducing them in the test boundary.

## State changes

- add `development/extension-toolchain:reusable-extension-testing`

## Consequences

Extension tests gain one cohesive representation of Pi registration and execution seams, and adopter
repositories can reuse the same facilities. Removing local copies makes changes to that
representation deliberate and visible in one place.

The public surface becomes a compatibility responsibility even though the package is pre-1.0 and
used privately. Tracking only the developed-against Pi version keeps that responsibility bounded;
adopters using another Pi version may need to align it with the version currently exercised here.

TypeScript-aware execution is required. Plain Node.js consumers receive no compiled testing
artifact. Converting six divergent suites creates one-time churn and regression risk, so the migration
must preserve their existing coverage and keep specialized domain fixtures outside the shared
boundary. The shared facilities also cannot replace integration coverage: claims about Pi's chaining,
error conversion, loading, and session behavior require the separate SDK-backed verification lane.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Keep per-extension harnesses | Leaves shared Pi-boundary policy duplicated and divergent. |
| Consolidate an internal-only helper | Removes local duplication but does not provide the approved reusable adopter boundary. |
| Publish a Vitest-specific helper | Couples reusable boundary modeling to one assertion and mocking framework. |
| Add compiled JavaScript output | Expands source distribution into a build and artifact concern that adopter repositories do not require. |
| Reimplement Pi's full event runtime | Creates a second runtime whose fidelity and version drift would be harder to verify than using Pi's public SDK. |
| Support historical Pi versions | Adds a multi-version compatibility matrix without a need while the owner's developed-against Pi fork stays current with upstream. |

## Status history

- 2026-08-16: Proposed
- 2026-08-16: Implementing; content-sha256: 09bba0c9054d48d0a8945adb07ae5a8a015ccb77aeb2d7f6cd8706395b7048dc
- 2026-08-16: Applied; operations: add `development/extension-toolchain:reusable-extension-testing`
