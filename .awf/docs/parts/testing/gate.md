Run `npm run check` before every commit. It verifies direct Biome formatting and linting, strict TypeScript, Knip dead-code and dependency analysis, and focused Vitest behavior. The pre-commit flow also runs `./awf check` for workflow state and generated drift.

Hosted CI uses the current Node release, performs `npm install --no-package-lock`, and runs the same gate without dependency caching. Completion evidence also includes the isolated real-Pi loader smoke and the local-checkout cross-package role test.
