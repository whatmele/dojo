You scan all repos in the workspace and refresh a **short index** in `AGENTS.md` while putting **detailed notes under `docs/`** — do not move the full scan into `AGENTS.md` alone.

## Read first

1. **`AGENTS.md`** — current entry shape  
2. **`.dojo/config.json`** — workspace name, description, repo paths/types  

**Do not** treat **`.dojo/context.md`** as mandatory input for this command: it is session-maintained and may be stale. Prefer config + repo facts.

## Roles

- **`AGENTS.md`** — **overview index**: name, one-line description, short repo table, list of Dojo slash commands, **links into `docs/`**, how to read `.dojo/context.md` (session-specific notes below).  
- **`docs/`** — **detailed** scan: stacks, build/test commands, modules, cross-repo dependencies. e.g. `docs/workspace-overview.md` or `docs/repos/<name>.md`.

## Steps

### 1. Config

Read `.dojo/config.json` for workspace metadata and repos.

### 2. Scan each repo

Under `repos/`: README, top-level layout, stack, build/test (package.json, Makefile, …), main modules (key paths only).

### 3. Write `docs/` (detail)

Include per-repo paths, types, stacks, commands (copy-pasteable blocks), and relationships. One file or many — stay consistent.

### 4. Update root `AGENTS.md` (keep short)

Suggested shape (adapt as needed; **do not** turn this back into a long report):

```markdown
# {Workspace name}

> {One–two line description}

## Repos (summary)

| Repo | Type | Path | Notes |
|------|------|------|-------|
| … | … | … | one line each |

## Detailed docs

- Overview: **[docs/workspace-overview.md](./docs/workspace-overview.md)** (adjust if you used another path)

## Dojo slash commands

- `dojo-think-and-clarify` — clarify before building
- `dojo-prd` — requirements
- `dojo-research` — research
- `dojo-tech-design` — technical design
- `dojo-task-decompose` — task breakdown
- `dojo-dev-loop` — dev/test loop
- `dojo-review` — code review
- `dojo-commit` — commit
- `dojo-gen-doc` — documentation
- `dojo-init-context` — refresh this index and docs

## Current status

(Choose **one** branch only: if there is an **active session**, point readers to `.dojo/context.md`; if **not**, say there is no active session and suggest `dojo session new`. Do not invent session state.)
```

<!-- DOJO_SESSION_ONLY -->
When running with an active session: in the final `AGENTS.md`, the **Current status** section should point readers to `@.dojo/context.md`.
<!-- /DOJO_SESSION_ONLY -->

<!-- DOJO_NO_SESSION_ONLY -->
When there is **no** active session: in the final `AGENTS.md`, **Current status** should state that and suggest `dojo session new`; do not pretend a session exists.
<!-- /DOJO_NO_SESSION_ONLY -->

## Optional user notes

$ARGUMENTS

## Rules

- **Forbidden**: put the full long scan only in `AGENTS.md`; `AGENTS.md` must stay skimmable.  
- **No business code** changes.  
- If `docs/` already has files, merge/update and link from `AGENTS.md`.
