Use Git, Bash, the current Node release, npm, and the current personal Pi fork. Clone the repository, run `npm install --no-package-lock`, and open it in Pi; trust the project so Pi can load project-local workflow resources. No build step or environment variable is required.

The awf wrapper uses its cached configured binary when available. First use on Linux or macOS requires network access to GitHub, `curl`, `tar`, and either `sha256sum` or `shasum`. Run `/reload` after changing a Pi resource during an active session.
