Pi installs the repository as a package, reads `package.json`, and discovers resources through its declared paths. A Pi session loads those resources at startup or after `/reload`.

Maintainers edit package resources directly. For governed workflow or generated documentation changes, maintainers edit `.awf/`, run `./awf render`, and commit the source, rendered outputs, and `.awf/awf.lock` together. `./awf check` verifies the resulting tree.
