---
format: current-state-v4
slug: reusable-extension-testing-boundary
status: Proposed
date: 2026-08-16
---
# ADR-reusable-extension-testing-boundary: Reusable Extension Testing Boundary

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
adopter repositories are TypeScript-aware, and the owner keeps the developed-against Pi fork current
with upstream. The testing boundary consequently does not need plain-Node output or a historical Pi
compatibility matrix.

## Decision

1. `decision: single-testing-boundary` Offer one framework-neutral, source-only public testing boundary for TypeScript-aware adopters, and make it the sole owner of the reusable Pi extension API recordings, contexts, and invocation facilities exercised by this project's extension tests.
2. `decision: developed-against-pi` Support the Pi version the repository currently develops and verifies against, rather than maintaining a historical compatibility matrix.
3. `decision: real-runtime-verification` Keep the reusable test representation bounded to documented public Pi seams and verify Pi-owned runtime semantics separately through the real public SDK instead of reproducing them in the test boundary.

## State changes

- add `development/extension-toolchain:reusable-extension-testing`

## Consequences

Extension tests gain one cohesive representation of Pi registration and execution seams, and adopter
repositories can reuse the same facilities. Removing local copies makes changes to that
representation deliberate and visible in one place.

The public surface becomes a compatibility responsibility even though the package is pre-1.0 and
used privately. Tracking only the developed-against Pi version keeps that responsibility bounded,
but adopters must update alongside the package rather than expect cross-version compatibility.

TypeScript-aware execution is required. Plain Node.js consumers receive no compiled testing
artifact. The shared facilities also cannot replace integration coverage: claims about Pi's chaining,
error conversion, loading, and session behavior require the separate SDK-backed verification lane.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Keep per-extension harnesses | Leaves shared Pi-boundary policy duplicated and divergent. |
| Publish a Vitest-specific helper | Couples reusable boundary modeling to one assertion and mocking framework. |
| Add compiled JavaScript output | Expands source distribution into a build and artifact concern that adopter repositories do not require. |
| Reimplement Pi's full event runtime | Creates a second runtime whose fidelity and version drift would be harder to verify than using Pi's public SDK. |
| Support historical Pi versions | Adds a multi-version compatibility matrix without a need in the owner's continuously updated adopter repositories. |

## Status history

- 2026-08-16: Proposed
