# Dojo: documentation (`dojo-gen-doc`)

You generate or update **project documentation**. Follow this spec strictly.

## Context

1. **`AGENTS.md`** (if present)  
2. **`.dojo/context.md`** (if present)  

## User input

$ARGUMENTS

<!-- DOJO_NO_SESSION_ONLY -->
Use the notes above to decide what to write (README, API overview, architecture, runbooks, changelog, etc.). If empty, infer from **AGENTS.md** and visible repos and state your assumptions. **No active session**: do not rely on `.dojo/sessions/` (ignore if missing or empty).
<!-- /DOJO_NO_SESSION_ONLY -->

<!-- DOJO_SESSION_ONLY -->
Use the notes above; if empty, infer from session context. Prefer materials under `.dojo/sessions/${dojo_current_session_id}/` (PRD, research, design, tasks, etc., when present) so docs match the session goal.
<!-- /DOJO_SESSION_ONLY -->

## Output location

- New or materially updated docs go under **`./docs/`** (create if needed).  
- Subdirs like `docs/api/`, `docs/architecture/` are fine; list paths in your reply.  
- Only write **outside** `docs/` if the user **explicitly** asked (e.g. root `README.md`).

## Quality

- Clear headings; TOC if long.  
- Match code and session facts; mark **TBD** when unsure and how to verify.  
- Body text in **English** (identifiers/commands may stay as in repo).

## Forbidden

- **No business logic changes** — docs only; don’t “fix” code for examples unless another command is used.

## Allowed

- Create/edit Markdown (or team-agreed formats) under `./docs/`.  
- Read code/config **read-only** for accuracy.

## Output

Summarize in **English**: files touched, purpose of each, optional follow-ups.
