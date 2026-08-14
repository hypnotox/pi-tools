The current gate is `./awf check`. It covers awf configuration, generated-file drift, documentation links and prose, and workflow state. Keep it deterministic and fast.

When executable package resources are added, extend the gate with the cheapest reliable tests, type checks, and formatting checks required by that stack. The gate documentation and command must change in the same commit.
