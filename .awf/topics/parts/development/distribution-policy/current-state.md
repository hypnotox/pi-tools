This topic records how the project makes its source and package resources available.

## Claims

### `rule: public-git-distribution`

The repository is public and licensed as `AGPL-3.0-only`. Consumers install the current default Git branch without credentials or a pinned ref and update explicitly through Pi. `package.json` remains private to prevent npm publication.

**Backing: unbacked**
**Verify:** Inspect `LICENSE`, `package.json`, and the install commands in `README.md`.
