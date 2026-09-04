{{=awf:sectionDefault}}

- **Focused, portable resources.** Keep the four package capabilities focused and portable, and document user-facing behavior in `README.md`.
- **No private machine state.** Never commit credentials, tokens, session data, or machine-specific absolute paths.
- **Floating current dependencies.** Keep Pi core and TypeBox imports as wildcard peers, registry development dependencies as `*`, and installs lockfile-free.
- **Pi authority first.** Read Pi's installed documentation and working examples before implementing or changing a resource.
- **Bounded extension resources.** Truncate potentially large tool output and clean up long-lived resources on `session_shutdown`.
