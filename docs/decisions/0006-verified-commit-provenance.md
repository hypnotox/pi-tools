---
format: current-state-v4
slug: verified-commit-provenance
status: Implemented
date: 2026-08-16
---
# ADR-0006: Verified commit provenance

## Context

Public repository history makes commit attribution and integrity externally visible. All 65 commits reachable through `v0.1.0` use `Josua Müller <hypnotox@pm.me>` for both author and committer and carry SSH signatures made with the owner's current Ed25519 signing key. GitHub verifies the release commit, but the repository's awf commit policy is disabled, so repository workflow does not yet reject a future identity or signature mismatch.

The parent of the existing release commit provides a stable policy baseline. Its ancestry does not need rewriting, while the `v0.1.0` commit and later descendants can be checked deterministically against an explicit identity and signer allowlist.

## Decision

1. `decision: awf-verified-commits` Require commit `af7cb25d4ceaeb0468df87c3ed47d35e8f2fb066` (tagged `v0.1.0`) and every descendant to use `Josua Müller <hypnotox@pm.me>` as both author and committer and carry a verified SSH signature from the owner's allowed Ed25519 key. Enforce this through the repository's awf commit policy with immutable baseline `d901af765a933556f563e573e1a184caf2096b28`.


## State changes

- add `development/commit-provenance:verified-maintainer-commits`

## Consequences

Explicit awf commit-policy checks reject policy-era commits with an unexpected author, committer, missing signature, or unapproved signing key. Rendered local hook payloads provide automatic enforcement only when separately wired. Compliance before the baseline remains an observed repository fact rather than an awf-enforced invariant.

The policy does not replace GitHub server-side branch protection. Key rotation or an additional authorized contributor requires an explicit allowlist update before affected commits can pass.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Rely on local Git signing configuration | Configuration enables signing but does not verify committed history or reject identity drift. |
| Require signed commits only through a GitHub branch ruleset | It would not enforce the repository's exact identity and signer allowlist or provide local preflight verification. |
| Use the repository root as the awf baseline | It would retrospectively govern existing descendants beyond the accepted from-`v0.1.0` scope. |
| Grandfather the `v0.1.0` commit | It would exempt the release commit rather than enforce the policy from that release onward. |

## Status history

- 2026-08-16: Proposed
- 2026-08-16: Accepted; content-sha256: 442c8a81f2708042624254d92546567852be79992a82c68ae19ff841c5933276
- 2026-08-16: Implemented; content-sha256: 442c8a81f2708042624254d92546567852be79992a82c68ae19ff841c5933276
