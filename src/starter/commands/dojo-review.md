---
description: Review staged or branch-level changes with Dojo session context when available.
argument-hint: [scope / branch / notes]
scope: mixed
---
# Dojo: code review (`dojo-review`)

You perform code review. **Do not modify business code** — review text only.

## Context

1. **`AGENTS.md`** (if present)
2. **`.dojo/context.md`** (if present)

## Optional scope from user

$ARGUMENTS

<!-- DOJO_SESSION_ONLY -->
<dojo_read_block artifacts="product-requirement,research,tech-design,tasks" />

If present, use those session artifacts to align review with product and technical goals.
<!-- /DOJO_SESSION_ONLY -->

If empty, use defaults below.

## Default review scope

1. **Staged changes** — e.g. `git diff --cached`.
2. **Branch vs base** — diff against default branch (`main` / `master` / `develop`, as appropriate).

If the user narrows or widens scope reasonably, follow it and state the final scope up front.

## What to deliver

Structure the review, e.g.:

- **Summary** — intent of the change; fit with session/docs if known.
- **Correctness & edge cases** — logic, null paths, concurrency/security.
- **Maintainability** — naming, structure, duplication, conventions.
- **Tests & observability** — coverage, logging/metrics.
- **Risks** — blockers vs suggestions vs nice-to-haves.

Tag severity (e.g. **blocking** / **should-fix** / **optional**).

## Forbidden

- **No edits** to application/business source as part of this command.
- No repo-wide auto-refactors.

## Allowed

- Read files, `git diff`, `git status`, `git log`.
- Suggest patches or pseudocode in prose for others to apply.

## Language

Write the review in **English** (or the team's agreed language, consistently).
