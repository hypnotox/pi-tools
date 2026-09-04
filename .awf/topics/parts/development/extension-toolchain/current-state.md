This topic records the active language, dependency, and verification contracts for executable Pi extensions.

## Claims

### `rule: typescript-quality-gate`

The four executable extensions use strict TypeScript, direct Biome formatting and linting, Knip dead-code and dependency analysis, and focused Vitest tests. `npm run check` runs these non-mutating checks. CI uses the current Node release, resolves dependencies with `npm install --no-package-lock`, and creates no lockfile. Registry development dependencies use `*`; Pi core packages and TypeBox remain wildcard peers; the personal coding-agent fork resolves from its stable latest-release asset.

**Backing: test**
**Verify:** Run `npm install --no-package-lock && npm run check`, then confirm `package-lock.json` is absent.

### `rule: behavioral-fixtures`

Tests use small local fixtures and the real Pi loader. No reusable testing SDK or package export exists.

**Backing: test**
**Verify:** Inspect `tests/`, `package.json`, and the loader smoke, then run `npm test`.
