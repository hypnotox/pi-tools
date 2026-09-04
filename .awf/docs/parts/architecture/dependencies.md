| Dependency | Role |
|---|---|
| Pi | Supplies runtime host modules and loads the four extension entry points. |
| Current Node release | Runs development checks and POSIX child processes. |
| awf | Renders and checks the repository contributor workflow. |
| TypeScript, Biome, Knip, and Vitest | Development-only type, format, lint, dead-code, dependency, and test checks. |

Pi core packages and TypeBox are wildcard peers supplied by Pi. Registry development dependencies use `*`; the coding-agent development artifact resolves through its stable latest-release URL. Installs create no lockfile.
