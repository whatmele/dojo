# {{workspace_name}}

{{workspace_description}}

## What This Workspace Uses Dojo For

Dojo gives this workspace a shared runtime for:

- session switching
- artifact-aware prompt templates
- startup/handoff context in `.dojo/context.md`
- reusable local templates under `.dojo/commands/`
- reusable local artifact plugins under `.dojo/artifacts/`
- tool-facing skill guidance under `.dojo/skills/`

## How To Work Here

1. Read this file for the workspace overview.
2. Read `.dojo/context.md` for the current active-session state.
3. Use `.dojo/commands/` for workspace-local templates.
4. Use `.dojo/artifacts/` for workspace-local artifact behavior.
5. Read `.dojo/skills/dojo-template-authoring/SKILL.md` before adding templates or artifacts.
6. Keep long-form knowledge in `docs/`, not only in this file.

## Current Runtime Model

This workspace follows four Dojo concepts:

1. `session`
2. `artifact plugin`
3. `template`
4. `context`

## Current State

- Read `@.dojo/context.md` when it exists.
- If there is no active session, create or resume one first.
- Dojo syncs rendered commands into `.agents/commands/` and tool directories such as `.claude/commands/`.
- Dojo syncs installed skills into `.agents/skills/<slug>/SKILL.md` and supported tool skill directories such as `.claude/skills/<slug>/SKILL.md`.

## Recommended Starter Flow

1. `/dojo-init-context` — scan repos and refresh workspace docs/index
2. `/dojo-prd` — write requirements
3. `/dojo-research` — write research notes
4. `/dojo-tech-design` — write technical design
5. `/dojo-task-decompose` — break work into executable tasks
6. `/dojo-dev-loop` — implement and update task state
7. `/dojo-review` — review changes
8. `/dojo-commit` — prepare the final commit

## Customization Points

- Add templates in `.dojo/commands/`
- Add artifact plugins in `.dojo/artifacts/` with `.ts` preferred over `.js`
- Use `.dojo/types/dojo-artifact-plugin.d.ts` to inspect the artifact plugin contract and helpers
- Read `.dojo/skills/dojo-template-authoring/SKILL.md` before authoring either one
