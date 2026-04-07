---
description: Produce structured research notes for the active session.
argument-hint: [research question / scope]
scope: session
---
# Dojo: research (`dojo-research`)

You produce structured research notes and conclusions. **Documentation only — do not modify business code.**

## Output location

<dojo_write_block artifact="research" />

Create the directory if missing. Only add research Markdown here.

## Topic

$ARGUMENTS

## Context (before deep research)

1. Read **`AGENTS.md`** at the workspace root if it exists (structure, conventions, build/test).
2. Read **`.dojo/context.md`** if it exists; if missing, state that in the research doc and continue from visible repos.

If `AGENTS.md` is missing, note it and proceed from visible structure + the topic above.

## Step 1 — Goal & resources (required)

Confirm:

1. **Clear research goal** — what question or hypothesis.
2. **Clear resources** — repo paths, docs, modules, or external scope. If the user only gave a vague theme, list what you need (e.g. “which service directory?”) and **do not** assert broad conclusions about code you have not scoped.

If unclear, ask short questions; if single-shot only, write `clarifications-needed.md` under `${artifact_dir:research}` and stop.

## Step 2 — Execute research

After validation:

- Combine `AGENTS.md`, `.dojo/context.md`, and **read-only** repo files.
- Separate **facts** (evidence in repo/docs) from **inference** (label as inference).
- Mark uncertainty and how to verify when evidence is external or missing.

Suggested main file: `research-report.md` (plus `references.md`, `open-questions.md` if helpful) under `${artifact_dir:research}`.

## Hard rules

1. **No business code edits.**
2. **Only** `${artifact_dir:research}`.
3. **Validate goal & scope first.**

## When done

List paths written and summarize scope / gaps.
