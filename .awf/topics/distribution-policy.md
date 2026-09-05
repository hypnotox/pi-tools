---
paths:
  - '**'
---

# Distribution policy

The repository is public and licensed as `AGPL-3.0-only`. Consumers install the current default Git branch without credentials or a pinned ref and update explicitly through Pi. `package.json` remains private to prevent npm publication.

Git source distribution keeps the installable package inspectable without introducing an npm publication pipeline. The AGPL preserves source-availability obligations for redistribution and modification.

Keep source distribution, installation instructions, `LICENSE`, `package.json`, and `docs/releasing.md` consistent when this policy changes.
