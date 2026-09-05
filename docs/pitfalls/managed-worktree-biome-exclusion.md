# User-Managed Worktree Biome Exclusion

A user-managed Git worktree may live below `.awf/`, while `biome.json` excludes `**/.awf`. A literal Biome invocation over the current directory from such a worktree can therefore process zero intended files. AWF neither creates nor inspects the worktree.

The committed npm format and lint commands invoke Biome directly with `--vcs-enabled=false` and explicit executable-resource paths. Keep those explicit paths in the canonical gate; a literal `biome check .` can silently select no files from a worktree placed below `.awf/`.
