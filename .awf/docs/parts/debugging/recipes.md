### A package resource does not load

1. Run `pi list` and confirm this repository is installed from the expected source.
2. Run `pi config` and confirm the resource type and item are enabled.
3. Confirm `package.json` declares the resource path and the file follows Pi's layout and format rules.
4. Run `/reload`; restart Pi if an extension changed its startup behavior.

### A project workflow resource is stale or missing

1. Confirm the project is trusted; Pi loads `.pi/` resources only for trusted projects.
2. Run `./awf check` and follow its drift repair hint.
3. If `.awf/` changed, run `./awf render`, then `./awf check` again.
4. Run `/reload` to refresh the active Pi session.

### An awf check fails after a documentation edit

Edit the `.awf/` convention part named by the generated file's `awf:edit` comment, not the rendered file. Render again and stage the part, every regenerated output, and `.awf/awf.lock` as one transaction.