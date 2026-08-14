This private package is pre-1.0 and has no publication pipeline or built artifact. Consumers install the Git repository directly; unpinned installations follow repository updates, while pinned Git refs move only when the configured ref changes.

Before marking a stable revision:

1. Verify each shipped resource in a trusted Pi session, including `/reload` after local edits.
2. Run `./awf check staged` and `./awf check` on the complete staged transaction.
3. Update `package.json` when the package version becomes meaningful.
4. Create and push a Git tag only when consumers need a stable install ref.

Do not publish this private package to npm unless the repository's distribution policy changes first.