The catalog introduction above does not describe the repository's current lanes: no minimum-runtime smoke test exists yet.

Run `./awf check` before every commit. It verifies rendered-file drift, awf configuration, links, prose rules, and workflow state. A failing check blocks the commit.

The package has no executable resource implementation or automated runtime test suite yet. Add focused tests and include them in the gate when executable package resources are introduced.
