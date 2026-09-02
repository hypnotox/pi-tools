---
title: Managed Worktree Biome Exclusion
---
Canonical effort worktrees live below `.awf/`, while `biome.json` excludes `**/.awf`. A literal Biome invocation over the current directory from such a worktree can therefore process zero intended files.

The committed npm format and lint commands route through `scripts/run-biome.mjs`. It selects the repository's nonignored executable-resource population explicitly and fails unless Biome reports that every nonzero selected target was checked. Keep that assertion in the canonical gate instead of relying on a temporary per-run configuration override.
