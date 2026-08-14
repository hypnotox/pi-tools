Run `npm run check` before every commit. It verifies formatting, lint, strict types, dead code and dependencies, and Vitest tests. The pre-commit payload also runs `./awf check` for rendered drift, awf configuration, links, prose rules, and workflow state. A failure in either layer blocks the commit.

Minimum-runtime evidence uses a clean `npm ci` and `npm run check` under Node.js 20. Pi extension smoke evidence loads the entry point with `pi -e ./extensions/timing/index.ts --list-models` and requires a clean exit without extension diagnostics.
