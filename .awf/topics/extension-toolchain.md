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

The executable extensions use strict TypeScript, direct Biome formatting and linting, Knip dead-code and dependency analysis, and focused Vitest tests. Each tool covers a distinct failure class; the aggregate `npm run check` gate keeps extensions on one baseline while individual commands provide focused feedback. CI uses the current Node release, resolves dependencies with `npm install --no-package-lock`, and creates no lockfile.

Registry development dependencies use `*`; Pi core packages and TypeBox remain wildcard peers. Verify dependency or toolchain changes with `npm install --no-package-lock && npm run check`, then confirm `package-lock.json` is absent.

Tests use small local fixtures and the real Pi loader. Handoff additionally uses Pi's real `AgentSession` and replacement lifecycle with a deterministic faux provider. Boundary editing keeps selection/replacement policy in a pure core and filesystem/Pi concerns in its adapter; its real-runtime tests check package discovery, native-tool coexistence, error flags, and shared-queue coordination. Completed boundary feedback follows native edit's text/details split, with independently bounded diff/patch previews; adapter tests compare its rendered diff with native edit through Pi's real tool component. Keep diff generation/coloring Pi-owned rather than copying renderer internals. User-facing semantics live in `README.md`. Keep new extension entrypoints in the manifest, Knip entry list, and loader smoke together. No reusable testing SDK or package export exists. Run focused Vitest files while editing and the complete npm gate before completion.
