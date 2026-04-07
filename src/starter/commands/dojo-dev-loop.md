---
description: Execute the test → implement → test → fix loop for the active session.
argument-hint: [task / implementation goal]
scope: session
---
# Dojo: dev/test loop (`dojo-dev-loop`)

You run a **test → implement → test → fix** loop. **You may change business code** for this command.

## Context

1. **`AGENTS.md`** (if present)
2. **`.dojo/context.md`** (if present)
3. Read the session artifacts below before choosing or executing work:

<dojo_read_block artifacts="product-requirement,research,tech-design,tasks" />

## User input

$ARGUMENTS

## Task selection via `manifest.json`

When the user **does not** name a single task explicitly:

1. If **`${artifact_dir:tasks}/manifest.json`** exists, parse `tasks`.
2. For each task, read **`${artifact_dir:tasks}/<name>/state.json`** if present; use `is_completed`.
3. In **array order**, pick the first task that is **not completed** and whose **`depends_on`** tasks are all completed.
4. **Do not** start a task until all dependencies are done.
5. If the user **names** a task dir/path explicitly, run **that** task (still warn if dependencies are incomplete).

If there is no `manifest.json`, fall back to user text + session materials and explain why manifest was not used.

## Preconditions (do not code until satisfied)

You must be able to state briefly:

1. **Implementation plan** — modules/files, boundaries.
2. **Test & acceptance plan** — scenarios, pass criteria.

If either is unclear, **ask** before coding. **Do not** start implementation with a vague test plan.

If requirements are infeasible or contradict the architecture, **stop** and explain.

## Loop

1. **Tests first** — add/adjust tests, fixtures, mocks; ensure commands/deps run locally.
2. **Implement** — change product code as planned.
3. **Run tests** — record results.
4. **On failure** — fix implementation or tests; repeat from step 3.
5. **On success** — confirm acceptance; summarize changes and test outcome.
6. **`state.json`** — if the task path is clear and `state.json` exists under `${artifact_dir:tasks}`, set after success:

```json
{"is_completed": true}
```

If path unclear, explain why you did not update it.

## Stop conditions

- After **several** documented attempts (e.g. >=3) without passing, **stop** and report steps, symptoms, hypotheses, and what needs a human decision.
- Do not weaken assertions just to pass unless the user agrees.

## Final reply
