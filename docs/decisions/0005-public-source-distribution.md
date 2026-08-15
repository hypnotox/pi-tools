---
format: current-state-v4
slug: public-source-distribution
status: Implemented
date: 2026-08-16
---
# ADR-0005: Public source distribution

## Context

Consumers need stable Git refs for tests and direct Pi package installation without private-repository credentials. Making the repository public exposes its complete reachable history, existing tag, and GitHub-hosted automation history. The publication audit found no credential or private-machine-state blocker; all reachable commits use the owner's accepted public identity.

The repository has no npm publication pipeline or built artifact. Public source availability does not require making the npm package publishable. A license is required to grant downstream reuse rights rather than merely exposing source.

## Decision

1. `decision: public-git-distribution` Distribute pi-tools as a public Git repository with tagged Git refs as the stable package installation boundary.
2. `decision: agpl-license` License the repository as `AGPL-3.0-only` and carry the exact GNU Affero General Public License version 3 text.
3. `decision: npm-publication-guard` Retain `package.json` `private: true` as the load-bearing guard against accidental npm publication.

## State changes

- add `development/distribution-policy:public-git-distribution`

## Consequences

Consumers can inspect, clone, test, and pin tagged revisions without repository credentials. The AGPL-3.0 terms govern redistribution and modification, including its source-availability obligations. The complete repository history and accepted author identity become public.

The package remains unavailable from npm unless a later distribution-policy decision removes the guard. Release tags remain the supported stable installation refs.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Keep the repository private | Consumers would continue to require repository credentials to test pinned refs. |
| Make the source visible without a license | Visibility alone would not grant downstream reuse rights. |
| Use a permissive license | It would not preserve the selected AGPL copyleft and source-availability terms or align licensing with agentic-workflows. |
| Publish the package to npm | Public Git installation satisfies the requirement without introducing a publication pipeline or artifact. |

## Status history

- 2026-08-16: Proposed
- 2026-08-16: Accepted; content-sha256: 436a6c9acb5e2c0a8cc733ab92f98b2f79aeeaf7e660c4958260471bda320ad0
- 2026-08-16: Implemented; content-sha256: 436a6c9acb5e2c0a8cc733ab92f98b2f79aeeaf7e660c4958260471bda320ad0
