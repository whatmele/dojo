# Dojo: code review (`dojo-review`)

You perform code review. **Do not modify business code** — review text only.

## Context

1. **`AGENTS.md`** (if present)  
2. **`.dojo/context.md`** (if present)  

## Optional scope from user

$ARGUMENTS

If empty, use defaults below. If `.dojo/sessions/${dojo_current_session_id}/` contains PRD, research, design, or tasks, use them to align review with product/tech goals.

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

Write the review in **English** (or the team’s agreed language, consistently).
