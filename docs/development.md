# Development

## Setup

Use Git, Bash, the current Node release, npm, and the current personal Pi fork. Clone the repository, run `npm install --no-package-lock`, and open it in Pi; trust the project so Pi can load project-local workflow resources. No build step or environment variable is required.

The AWF wrapper uses its cached configured binary when available. First use on Linux or macOS requires network access to GitHub, `curl`, `tar`, and either `sha256sum` or `shasum`. Run `/reload` after changing a Pi resource during an active session.

## Command runner

npm scripts run executable-resource checks:

- `npm run format`: format authored code and configuration.
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run deadcode`, and `npm test`: run focused non-mutating checks.
- `npm run check`: run the complete executable-resource gate.

Use the root `./awf` wrapper for contributor guidance:

- `./awf resolve <path>...`: list topics that apply to paths.
- `./awf render`: regenerate fixed AWF outputs after editing `.awf/project.md` or `.awf/topics/**/*.md`.
- `./awf check`: verify AWF sources and generated projection.
- `./awf effort new|list|show|finish`: manage optional ignored effort memory; AWF does not manage Git worktrees or install hooks.

## Dependencies

Run `npm install --no-package-lock` to resolve current dependencies without creating a lockfile. Registry development dependencies use `*`; the current coding-agent fork resolves from `releases/latest/download/pi-coding-agent.tgz`. Pi core packages and TypeBox remain wildcard peers supplied by Pi at runtime.
