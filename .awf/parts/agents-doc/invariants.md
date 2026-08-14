{{=awf:sectionDefault}}

- **Focused, portable resources.** Keep resources focused and portable, and document user-facing behavior in `README.md`.
- **No private machine state.** Never commit credentials, tokens, session data, or machine-specific absolute paths.
- **Correct dependency classes.** Put extension runtime packages in `dependencies`; declare Pi core imports in `peerDependencies` with a `*` range.
- **Pi authority first.** Read Pi's installed documentation and working examples before implementing or changing a resource.
- **Bounded extension resources.** Truncate potentially large extension tool output and clean up long-lived resources on `session_shutdown`.
- **Portable Agent Skills.** Use valid Agent Skills frontmatter and resolve helper paths relative to the skill directory.
