The project gate is `npm run check`. It runs non-mutating formatting, lint, type, dead-code, dependency, and test checks for executable resources. The pre-commit payload runs `./awf check` first for configuration, generated-file drift, documentation links and prose, and workflow state, then runs the project gate.

Keep both layers deterministic and fast. Add the cheapest reliable check for each new executable-resource failure mode, and update the gate documentation and command in the same commit.
