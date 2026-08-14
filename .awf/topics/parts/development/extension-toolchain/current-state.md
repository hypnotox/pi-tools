This topic records the active language, quality, and verification contracts for executable Pi extensions.

## Claims

### `rule: typescript-quality-gate`

Executable extensions use the shared strict TypeScript configuration, Biome formatting, import organization, and linting, Knip dead-code and dependency analysis, and Vitest tests. `npm run check` runs those non-mutating checks as the project gate; the pre-commit flow runs it alongside `./awf check`. Imported Pi core packages remain wildcard peer dependencies, development tools remain development dependencies, and the npm lockfile is committed.

Origin: ADR-0001
