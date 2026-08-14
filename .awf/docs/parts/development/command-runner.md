npm scripts run executable-resource checks:

- `npm run format`: format authored code and configuration.
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run deadcode`, and `npm test`: run focused non-mutating checks.
- `npm run check`: run the complete executable-resource gate.

Use the root `./awf` wrapper for governed workflow maintenance:

- `./awf render`: regenerate awf-owned files after editing `.awf/`.
- `./awf check`: verify the repository, generated-file drift, and workflow state.
- `./awf check staged`: verify the staged transaction before committing.

See [Working with awf](working-with-awf.md) for the full command reference.
