# Repository instructions

This is a private pi package containing personal extensions, skills, prompt templates, and themes.

- Keep resources focused, portable, and documented in `README.md` when they add user-facing behavior.
- Never commit credentials, tokens, session data, or machine-specific absolute paths.
- Put extension runtime packages in `dependencies`; pi core imports belong in `peerDependencies` with a `*` range.
- Follow pi's installed documentation and working examples before implementing or changing a resource.
- Extensions must truncate potentially large tool output and clean up long-lived resources on `session_shutdown`.
- Skills must use valid Agent Skills frontmatter and resolve helper paths relative to the skill directory.
