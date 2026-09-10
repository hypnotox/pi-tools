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

Tests use small local fixtures and the real Pi loader. Handoff additionally uses Pi's real `AgentSession` and replacement lifecycle with a deterministic faux provider. Boundary tools keep one stateless exact-position resolver and original-file batch/overlap policy in `replace-range.ts`, bounded diagnostics/read previews in `feedback.ts`, and filesystem/Pi concerns in the adapter. Both tools use the shared mutation queue for reading, but only `boundary_edit` writes; `boundary_read` reserves nothing. Endpoints are globally unique literal `{text, side}` anchors with no line snapping or terminator inheritance. Read budgets affect output only. Real-runtime tests check both tools' package discovery, active prompt guidance, native-tool coexistence, batch execution, error flags, and shared-queue coordination. Feedback reports literal content statistics excluding the preserved BOM, with independently bounded diff/patch previews. The old `boundary_select`/string-selector API is removed; explicit allowlists and callers must use the new schema. The summary and diff remain visible in model-facing text and the TUI; adapter tests compare only the rendered diff with native edit through Pi's real tool component, not its confirmation prose. Keep diff generation/coloring Pi-owned rather than copying renderer internals. User-facing semantics live in `README.md`. Keep new extension entrypoints in the manifest, Knip entry list, and loader smoke together. No reusable testing SDK or package export exists. Run focused Vitest files while editing and the complete npm gate before completion.

Context management has a single pressure-policy owner in `extensions/context-usage/`, a small shared lifecycle core in `extensions/context-lifecycle.ts`, and separate handoff/replacement and compact/native-outcome owners. Do not assume shared modules or identical Pi API objects under the real loader; scoped package-internal event-bus coordination is verified with both actual entry points loaded. Preserve native `/handoff`, `/compact`, summarization, and dependency ownership. `tests/compact-runtime.test.ts` covers real compaction ordering, native instruction transport and reconstructed context, races, and the Pi 0.85.1 split-prefix instruction omission. The opt-in deterministic process integration in `tests/compact-subagents-live.test.ts` exercises an unmodified live multi-step pi-subagents workflow; use the reproducible command in `docs/testing.md`, not mocks as evidence of live-work survival.
