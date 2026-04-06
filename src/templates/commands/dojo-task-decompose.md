# Dojo: task breakdown (`dojo-task-decompose`)

You decompose a technical design into atomic, executable tasks. **Only create files under the session `tasks/` tree — do not modify business code.** Users may re-run; support incremental updates without touching product source.

## Context

1. **`AGENTS.md`** (if present)  
2. **`.dojo/context.md`** (if present)  

## User input

$ARGUMENTS

## Output root

All task subfolders live under:

`.dojo/sessions/${dojo_current_session_id}/tasks/`

Create `tasks/` if needed. Each atomic task is its **own subdirectory** (e.g. `01-auth-login`, `task-03-api`). Keep naming consistent within one run.

## Optional session inputs (read-only)

Read if present:

- PRD: `.../product-requirements/`  
- Research: `.../research/`  
- Design: `.../tech-design/`  

If something is missing, note the gap in an overview or first task doc and either ask the user or mark items as “TBD”.

## Step 1 — Preconditions (required)

Before creating folders:

1. **Scope is clear enough** — what “done” means, aligned with user input + PRD/design.  
2. **Design is usable** — normally under `tech-design/`; if empty or insufficient, **do not** invent a huge task list disconnected from the repo.

If blocked:

- Ask what’s missing, and  
- Read-only scan relevant dirs + `AGENTS.md`, record visible constraints in task text.

If still blocked, write `clarifications-needed.md` under `tasks/` and only add placeholder tasks if appropriate.

Proceed only when scope + design are workable.

## Step 2 — Per-task files + `manifest.json`

For **each** atomic task, under `tasks/<task-name>/` you **must** create:

### 1. `task-implementation.md` (English)

- Goal (maps to which part of design)  
- Dependencies (other tasks, env, config)  
- Step-by-step plan (ordered)  
- Paths/modules (references only — **no edits here**)  
- Risks / rollback if relevant  

### 2. `task-acceptance.md` (English)

- Acceptance criteria (verifiable)  
- How to test (manual / automated hints)  
- Definition of done  

### 3. `state.json`

Valid JSON, **at least**:

```json
{"is_completed": false}
```

### 4. `manifest.json` at `tasks/` root

Required. Declares order and dependencies for `dojo-dev-loop`.

```json
{
  "tasks": [
    { "name": "task-dir-name", "description": "Short label", "depends_on": [] },
    { "name": "another-task", "description": "…", "depends_on": ["task-dir-name"] }
  ]
}
```

**Ordering:** favor unit-level / single-module work **before** cross-module or E2E tasks.  
**Dependencies:** list prerequisite task **directory names** in `depends_on` explicitly.

Update `manifest.json` when the user iterates (add/remove/reorder tasks).

## Step 3 — Overview (recommended)

Add `README.md` under `tasks/` listing tasks, deps, recommended order — must stay consistent with `manifest.json`.

## Hard rules

1. **No business code** under product `src/` etc.; only `.dojo/sessions/.../tasks/`.  
2. **Every** task dir has the three files; **`manifest.json` at `tasks/` root** always matches the task set.  
3. **Validate first**, then decompose.  
4. Re-runs: merge or revise tasks and **update manifest + overview**.

## When done

List new/updated paths, **`manifest.json`**, execution order, and open questions.
