Use Git, Bash, Node.js 22.19.0 or newer, npm, and a compatible Pi installation. Clone the repository, run `npm ci`, and open it in Pi; trust the project so Pi can load the generated project-local workflow resources. No build step, service, or environment variable is required.

The awf wrapper uses the cached pinned binary when available. First use on Linux or macOS requires an amd64 or arm64 system, network access to GitHub, `curl`, `tar`, and either `sha256sum` or `shasum`; installing the pinned awf version on `PATH` avoids the download.

Clone or install the public repository over HTTPS without GitHub credentials. SSH remains available for authenticated maintainer access. Run `/reload` after changing a resource during an active Pi session.
