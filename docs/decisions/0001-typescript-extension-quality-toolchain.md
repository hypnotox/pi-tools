---
format: current-state-v4
slug: typescript-extension-quality-toolchain
status: Proposed
date: 2026-08-14
---
# ADR-0001: TypeScript Extension Quality Toolchain

## Context

The repository is beginning to ship executable Pi extensions after previously containing only
resource scaffolds. Future extensions need a shared TypeScript foundation that catches type errors,
format drift, lint findings, unused code, unused dependencies, and regressions before commit. The
package must remain compatible with its declared Node.js 20 minimum and with Pi's package-loading
model, where Pi core imports are peers rather than bundled runtime dependencies.

Using separate formatters, linters, type checkers, dead-code analyzers, and test runners adds tools,
but each detects a distinct class of defect. The project needs one deterministic aggregate gate so
future extensions do not invent their own quality conventions.

## Decision

1. `decision: strict-typescript-extensions` Author executable extensions in TypeScript under a shared strict configuration that includes unused-symbol and unsafe-index checks.
2. `decision: consolidated-quality-toolchain` Use Biome for formatting and linting, TypeScript for static type checking, Knip for dead-code and dependency analysis, and Vitest for automated tests.
3. `decision: deterministic-extension-gate` Maintain one non-mutating extension-quality gate that runs formatting, linting, type, dead-code, dependency, and test checks alongside the awf repository checks before commit.

## State changes

- add `development/extension-toolchain:typescript-quality-gate`

## Consequences

Future extensions share one typed, formatted, linted, tested baseline, and dead files, exports, or
dependencies become detectable before they accumulate. Individual checks remain runnable for quick
feedback while the aggregate gate provides the authoritative result.

The repository gains development dependencies, configuration files, a lockfile, and an installation
step for contributors. Biome's intentionally smaller lint ecosystem provides fewer specialized rules
than ESLint, while Knip requires explicit entry-point configuration for Pi-discovered resources.
Tool upgrades can change findings and therefore require deliberate lockfile updates and full-gate
verification.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| ESLint, typescript-eslint, Prettier, Knip, and Vitest | Offers the broadest lint plugin ecosystem but duplicates formatting concerns and adds more configuration and dependencies than the current package needs. |
| TypeScript compiler checks and Node's test runner only | Keeps the toolchain small but does not provide a cohesive formatter, broad linting, or package-aware dead-code analysis. |
| Plain JavaScript with Node's test runner | Avoids a TypeScript test runtime but does not establish the typed foundation requested for a growing extension collection. |

## Status history

- 2026-08-14: Proposed
