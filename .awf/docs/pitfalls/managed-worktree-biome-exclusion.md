---
title: Managed Worktree Biome Exclusion
---
Canonical effort worktrees live below `.awf/`, while `biome.json` excludes `**/.awf`. A literal Biome or aggregate npm gate run from such a worktree can therefore process zero intended files.

For managed-worktree verification, use a temporary exhaustive Biome include override for the repository's executable-resource population, require the intended files to be processed, and restore the original configuration on every exit path. Never accept a zero-file result as a passing gate.
