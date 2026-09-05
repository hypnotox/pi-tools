---
paths:
  - 'extensions/**'
  - 'package.json'
  - 'tsconfig.json'
  - 'biome.json'
  - 'knip.json'
  - 'tests/**'
---

# Extension toolchain

The three executable extensions use strict TypeScript, direct Biome formatting and linting, Knip dead-code and dependency analysis, and focused Vitest tests. Each tool covers a distinct failure class; the aggregate `npm run check` gate keeps extensions on one baseline while individual commands provide focused feedback. CI uses the current Node release, resolves dependencies with `npm install --no-package-lock`, and creates no lockfile.

Registry development dependencies use `*`; Pi core packages and TypeBox remain wildcard peers; the personal coding-agent fork resolves from its stable latest-release asset. Verify dependency or toolchain changes with `npm install --no-package-lock && npm run check`, then confirm `package-lock.json` is absent.

Tests use small local fixtures and the real Pi loader. No reusable testing SDK or package export exists. Run focused Vitest files while editing and the complete npm gate before completion.
