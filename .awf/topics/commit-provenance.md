---
paths:
  - '**'
---

# Commit provenance

Commit `af7cb25d4ceaeb0468df87c3ed47d35e8f2fb066` (`v0.1.0`) and every descendant use `Josua Müller <hypnotox@pm.me>` as both author and committer and carry a verified SSH signature from the owner's Ed25519 key. `docs/allowed-signers` preserves the authorized principal and public key. The immutable historical baseline is `d901af765a933556f563e573e1a184caf2096b28`.

Public history makes attribution and integrity externally visible. Verify it against the exact identity and repository signer allowlist rather than relying on local signing configuration or hosting-service presentation.

From a fresh full clone, run this command at the repository root to verify both identities and every signature from `v0.1.0` through `HEAD`:

```sh
baseline=af7cb25d4ceaeb0468df87c3ed47d35e8f2fb066 &&
expected='Josua Müller <hypnotox@pm.me>' &&
expected_pair="$(printf '%s\n%s' "$expected" "$expected")" &&
git rev-list --reverse "$baseline^..HEAD" |
while IFS= read -r commit; do
  identities="$(git show -s --format='%an <%ae>%n%cn <%ce>' "$commit")"
  [ "$identities" = "$expected_pair" ] &&
    git -c gpg.ssh.allowedSignersFile=docs/allowed-signers verify-commit "$commit" ||
    exit 1
done
```

AWF no longer enforces commit policy or installs hooks. Treat provenance as a contributor requirement; the command above is manual verification, not automatic enforcement. Key rotation or an additional authorized contributor requires a new decision before affected commits are accepted.
