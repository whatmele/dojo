---
description: Break the active session design into executable task directories and manifests.
argument-hint: [scope / design slice]
scope: session
---
# Dojo: task breakdown (`dojo-task-decompose`)

You decompose a technical design into atomic, executable tasks. **Only create files under the session `tasks/` tree — do not modify business code.** Users may re-run; support incremental updates without touching product source.

## Context

1. **`AGENTS.md`** (if present)
2. **`.dojo/context.md`** (if present)

## User input

$ARGUMENTS

## Output root

<dojo_write_block artifact="tasks" />

Create `tasks/` if needed. Each atomic task is its **own subdirectory** (e.g. `01-auth-login`, `task-03-api`). Keep naming consistent within one run.

## Optional session inputs (read-only)

<dojo_read_block artifacts="product-requirement,research,tech-design" />

Read if present:

- PRD: `${artifact_dir:product-requirement}`
- Research: `${artifact_dir:research}`
- Design: `${artifact_dir:tech-design}`

If something is missing, note the gap in an overview or first task doc and either ask the user or mark items as `TBD`.

## Step 1 — Preconditions (required)

Before creating folders:

1. **Scope is clear enough** — what “done” means, aligned with user input + PRD/design.
2. **Design is usable** — normally under `${artifact_dir:tech-design}`; if empty or insufficient, **do not** invent a huge task list disconnected from the repo.

If blocked:

- Ask what’s missing, and
- Read-only scan relevant dirs + `AGENTS.md`, record visible constraints in task text.

If still blocked, write `clarifications-needed.md` under `${artifact_dir:tasks}` and only add placeholder tasks if appropriate.

Proceed only when scope + design are workable.

## Step 2 — Per-task files + `manifest.json`

For **each** atomic task, under `${artifact_dir:tasks}/<task-name>/` you **must** create:

### 1. `task-implementation.md` (English)

- Goal (maps to which part of design)
- Dependencies (other tasks, env, config)
- Step-by-step plan (ordered)
- Paths/modules (references only — **no edits here**)
- Risks / rollback if relevant

### 2. `task-acceptance.md` (English)
