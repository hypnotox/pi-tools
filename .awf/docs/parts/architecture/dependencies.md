| Dependency | Role |
|---|---|
| Pi | Loads the package manifest and executes or presents its resources. |
| Node.js 22.19.0 or newer | Runtime baseline declared by the package. |
| awf | Pinned development tool that renders and checks the repository workflow. |
| TypeScript, Biome, Knip, and Vitest | Development-only type, format, lint, dead-code, dependency, and test checks. |

Imported Pi core packages are wildcard `peerDependencies` supplied by Pi. Quality tooling is confined to `devDependencies`; future third-party extension runtime libraries belong in `dependencies`.
