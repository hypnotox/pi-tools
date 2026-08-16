This topic records the active language, quality, and verification contracts for executable Pi extensions.

## Claims

### `rule: typescript-quality-gate`

Executable extensions use the shared strict TypeScript configuration, Biome formatting, import organization, and linting, Knip dead-code and dependency analysis, and Vitest tests. `npm run check` runs those non-mutating checks as the project gate; the pre-commit flow runs it alongside `./awf check`. Imported Pi core packages remain wildcard peer dependencies, development tools remain development dependencies, and the npm lockfile is committed.

Origin: ADR-0001

### `rule: reusable-extension-testing`

The public source-only `pi-tools/testing` recorder is the complete repository home for reusable documented Pi extension API, context, lifecycle, event-bus, discovery, registration, injectable `exec`, UI, model-registry, and raw/direct-invocation fixtures. Consumers configure supported capabilities before explicitly installing one or more factories; omitted capabilities remain absent. Raw listener errors and named raw/direct helpers are recorder behavior, not Pi runtime fidelity. Specialized clocks, countdowns, schedulers, runners, rendering, policy, deferred outcomes, models, subprocesses, streams, and schemas remain in their domain suites. A separate credential-free public Pi SDK test proves real extension loading and tool registration without simulating Pi runtime behavior.

Origin: ADR-0008
Revised-by: ADR-composable-extension-testing-recorder
