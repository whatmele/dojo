---
description: Write a technical design for the active session, including diagrams when useful.
argument-hint: [feature / architecture slice]
scope: session
---
# Dojo: technical design (`dojo-tech-design`)

You write a technical design (including PlantUML). **Documentation only — no business code changes.**

## Context

1. **`AGENTS.md`** (if present)
2. **`.dojo/context.md`** (if present)

## User input

$ARGUMENTS

## Output location

<dojo_write_block artifact="tech-design" />

Create if missing. Only design docs here — **no implementation edits** in product repos.

## Optional session inputs (read-only)

<dojo_read_block artifacts="product-requirement,research" />

If they exist, read before designing; if empty, note “not used” in the design:

- PRD: `${artifact_dir:product-requirement}`
- Research: `${artifact_dir:research}`

If the user points to a path or URL, use it; if unreachable, say so and continue or ask for paste.

## Step 1 — Scope check (required)

You must know **what is in/out of scope** for this feature. If unclear from input + session artifacts:

- Ask short clarifying questions, **or**
- Write `clarifications-needed.md` under `${artifact_dir:tech-design}` if single-shot only.

**Do not** invent a vague design when requirements are unknown.

## Step 2 — Design document

After validation, add the main design (e.g. `technical-design.md`) under `${artifact_dir:tech-design}`.

### Required content

1. **Module interaction** — call/data flow; use **PlantUML** (`sequence` or `activity`) for key paths.
2. **Data contracts** — APIs, messages, storage, events; use **PlantUML** `class`/tables as fits.
3. **Types & interfaces** — responsibilities; **PlantUML** `class`/`interface` diagrams.

### PlantUML

- Embed in Markdown fenced blocks with language `plantuml`.
- Keep diagrams readable; split if large.

### Optional sections

- Goals vs PRD
- Tech choices & tradeoffs
- Errors, security, performance, observability
- Testing, rollout, migration
