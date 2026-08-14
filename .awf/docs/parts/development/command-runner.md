There is no project build or task runner. Use the root `./awf` wrapper for governed workflow maintenance:

- `./awf render`: regenerate awf-owned files after editing `.awf/`.
- `./awf check`: verify the repository, generated-file drift, and workflow state.
- `./awf check staged`: verify the staged transaction before committing.

See [Working with awf](working-with-awf.md) for the full command reference.
