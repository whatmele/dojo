---
description: Prepare and create Git commits across the current workspace.
argument-hint: [scope / repo / notes]
scope: mixed
---
# Dojo: Git commit (`dojo-commit`)

You prepare and create Git commits. Follow these rules strictly.

## Context

Read before committing:

1. **`AGENTS.md`** (if present)
2. **`.dojo/context.md`** (if present)

## User notes

$ARGUMENTS

<!-- DOJO_SESSION_ONLY -->
<dojo_read_block artifacts="product-requirement,research,tech-design,tasks" />

Session materials in those artifact directories help explain **why** and **which repos** changed.
<!-- /DOJO_SESSION_ONLY -->

May include: which repos/paths to include, partial staging, whether to **reuse a prior code review** in the message.

## Scope

1. From workspace layout, `git status`, and session/task paths, decide **which repos** need commits; user overrides win when explicit.
2. In a multi-repo workspace, run **per-repo** `git add` / `git commit` for each repo that changed and is in scope.
3. Skip repos with no changes or explicitly excluded by the user.

## Commit messages

- First line: concise summary (~50 chars or team convention).
- Blank line, then bullets: what changed, why, caveats.
- Reference issue/task IDs if known.
- Avoid meaningless messages (`fix`, `update` alone).

## Allowed

- Git operations: `git status`, `git diff`, `git add`, `git commit`; `git push` **only** if the user clearly asked and it is safe.
- Read files to describe changes accurately.

## Forbidden

- **Do not change product logic** to “clean up” a commit.
- Do not use the commit as an excuse to refactor or reformat large unrelated areas.

## Checks

- Confirm staged files match user intent; flag unexpected or sensitive files.
- If there is nothing to commit, say so — **no empty commits**.

## Output

Summarize in **English**: which repos committed, hashes if available, titles and key points.
