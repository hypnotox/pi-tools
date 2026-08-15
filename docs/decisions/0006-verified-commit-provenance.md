---
format: current-state-v4
slug: verified-commit-provenance
status: Proposed
date: 2026-08-16
---
# ADR-0006: Verified commit provenance

## Context

Public repository history makes commit attribution and integrity externally visible. All 65 commits reachable through `v0.1.0` use `Josua Müller <hypnotox@pm.me>` for both author and committer and carry SSH signatures made with the owner's current Ed25519 signing key. GitHub verifies the release commit, but the repository's awf commit policy is disabled, so repository workflow does not yet reject a future identity or signature mismatch.

The existing release commit provides a stable policy baseline. Its ancestry does not need rewriting, while commits after it can be checked deterministically against an explicit identity and signer allowlist.

## Decision

1. `decision: awf-verified-commits` Require every commit after `v0.1.0` to use `Josua Müller <hypnotox@pm.me>` as both author and committer and carry a verified SSH signature from the owner's allowed Ed25519 key, enforced by the repository's awf commit policy.

## State changes

- add `development/commit-provenance:verified-maintainer-commits`

## Consequences

Repository checks and wired local hooks reject policy-era commits with an unexpected author, committer, missing signature, or unapproved signing key. The public history gains a deterministic provenance contract aligned with the owner's Git configuration.

The policy does not replace GitHub server-side branch protection. Key rotation or an additional authorized contributor requires an explicit allowlist update before affected commits can pass.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Rely on local Git signing configuration | Configuration enables signing but does not verify committed history or reject identity drift. |
| Rely only on GitHub's verified badge | It does not enforce the repository's exact accepted identity and signer policy in local workflow. |
| Rewrite history before enabling policy | Existing commits already satisfy the intended identity and signing contract; rewriting published history adds risk without improving provenance. |

## Status history

- 2026-08-16: Proposed
