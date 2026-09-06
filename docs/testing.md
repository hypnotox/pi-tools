# Testing

This document is the repository-specific authority for test commands, feedback tiers, lane ownership, and expected runtime. Keep concrete setup and measurements here rather than relying on shared guidance that cannot reflect the repository's language, dependencies, or execution environment.

Every behavior-changing fix requires the strongest practical durable oracle. The normal and preferred path is an automated regression test observed failing for the right reason and then passing. When that path is impractical, state a concrete reason, preserve or improve verification strength, and retain the strongest safe, reproducible alternative. Never weaken expected behavior or verification strength. Fix the root cause rather than the symptom.

Use this evidence order as guidance, not a requirement to mechanically attempt every earlier option:

1. An automated regression test observed red then green.
2. A deterministic integration or reproduction harness.
3. A contract or invariant test that directly exercises the failure.
4. Scripted, reproducible manual verification with recorded inputs and expected results.
5. An explicit explanation of why durable automation is unavailable, plus the strongest safe evidence that can be retained.

For a nondeterministic race, stress or invariant evidence may be the strongest practical oracle. For a destructive migration defect, use safe fixture or dry-run evidence rather than unsafe reproduction. An alternative is valid because the preferred path is impractical, not merely inconvenient, and its reason and retained evidence must make any verification-strength judgment reviewable.

## Gate

Run `./awf check` and `npm run check` before every commit. The AWF check validates project guidance sources and their fixed generated projection. The npm gate verifies direct Biome formatting and linting, strict TypeScript, Knip dead-code and dependency analysis, and focused Vitest behavior. No local Git hook wiring is assumed.

Hosted CI uses the current Node release, checks the AWF projection, performs `npm install --no-package-lock`, and runs the npm gate without dependency caching. Completion evidence also includes the isolated real-Pi loader smoke.

## Tiers and lanes

Focused Vitest files provide fast feedback. `npm run check` is the executable-resource gate; `./awf check` verifies contributor-guidance projection. Fresh-install, real-loader, and cross-package checks are completion evidence.

## Layout and test shape

Keep narrowly coupled tests beside each extension and tiny shared fixtures under `tests/`. Tests cover terminal-title animation and title composition, context telemetry, immediate handoff, model and thinking-level continuity, and timing behavior, final-block grouping, and continuity. `tests/handoff-runtime.test.ts` loads the real extension files into Pi's `AgentSession` and session-replacement lifecycle with a deterministic faux provider, persisted sessions, and both TUI and RPC bindings. It checks settlement order, threshold-compaction suppression, parent linkage, model/thinking/timing continuity, command invisibility, canceled competing preflight, and an accepted competing replacement before idle. Its faux credentials use the SDK's awaited `setRuntimeApiKey` synchronization boundary: native provider registration alone can leave the auth-availability snapshot unsettled at startup. The loader smoke uses the real current Pi CLI with isolated package, config, and session directories; it also installs the local package through settings and verifies native handoff prompt discovery and expansion.
