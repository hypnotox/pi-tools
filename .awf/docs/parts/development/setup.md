Use Git, Bash, Node.js 20 or newer, and a compatible Pi installation. Clone the repository and open it in Pi; trust the project so Pi can load the generated project-local workflow resources. No dependency installation, build step, service, or environment variable is currently required.

The awf wrapper uses the cached pinned binary when available. First use on Linux or macOS requires an amd64 or arm64 system, network access to GitHub, `curl`, `tar`, and either `sha256sum` or `shasum`; installing the pinned awf version on `PATH` avoids the download.

GitHub SSH access is required only to clone the private remote or install it as a Git package. Run `/reload` after changing a resource during an active Pi session.
