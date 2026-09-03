# 2026-09-04 load skills in subagents

## Context

Subagent children run with focused profile prompts and automatic repository context files disabled, but they also disabled Pi's skill discovery. Skills are progressively disclosed, task-specific resources, and some repositories use them to carry doctrine that applies equally to delegated exploration, review, and implementation. Preventing their discovery leaves those children without relevant workflow guidance even though the child already runs inside Pi's ordinary trusted resource boundary.

## Decision

Allow Pi's normal skill discovery in every subagent child while continuing to disable automatic context-file loading. This supersedes only the skill-loading portion of ADR-0002's isolated-child-runtime decision; its context-file isolation remains in force. Keep the profile-owned system prompt, tool policy, recursion prevention, working directory, and trust propagation unchanged. Which global, package, or project skills are available remains governed by Pi's ordinary discovery, configuration, and project-trust rules.

## Consequences

Child prompts gain the skill catalog metadata discovered by Pi, and subagents whose tool policy includes `read` can load applicable skill bodies on demand. This lets delegated work follow repository-specific doctrine without duplicating it in every profile prompt, at the cost of additional prompt content and influence from trusted skill instructions. Profile prompts remain the authoritative role contract, context files remain excluded, and untrusted project skills remain unavailable under Pi's trust policy.
