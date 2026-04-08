# Dojo — Technical Design

This document describes the current technical shape of Dojo after the MVP runtime simplification.

## 1. Architecture summary

The runtime is intentionally small.

It is built around four concepts:

1. `session`
2. `artifact plugin`
3. `template`
4. `context`

There is no branch-planner, workspace reconciler, or Git layout control plane in the current design.

## 2. Main modules

### CLI layer

- `src/commands/init.ts`
- `src/commands/repo.ts`
- `src/commands/session.ts`
- `src/commands/context.ts`
- `src/commands/start.ts`
- `src/commands/status.ts`
- `src/commands/task.ts`
- `src/commands/template.ts`
- `src/commands/artifact.ts`

These handlers stay thin and delegate runtime work to `src/core/`.

### Runtime core

- `src/core/config.ts` — workspace config read/write
- `src/core/state.ts` — workspace and session state read/write
- `src/core/git.ts` — repo bootstrap and commit helpers
- `src/core/workspace.ts` — workspace discovery and path helpers
- `src/core/protocol.ts` — artifact plugin loading, template syntax helpers, validation, directory resolution
- `src/core/command-distributor.ts` — render templates into `.agents/commands/`
- `src/core/context-generator.ts` — generate `.dojo/context.md`
- `src/core/task-overview.ts` — derive task overview from manifest + task state

### Template and starter assets

- `src/starter/commands/` — built-in starter template sources
- `src/starter/workspace/` — starter workspace files such as `AGENTS.md` and `.gitignore`
- `src/builtins/artifacts/` — built-in artifact plugins
- `src/skills/dojo-template-authoring/SKILL.md` — real authoring skill asset

## 3. Session model

A session owns:

- `id`
- `description`
- `external_link?`
- `created_at`
- `updated_at?`
- `status`

Important rule:

**a session is a runtime namespace, not a Git branch layout.**

Session activation changes:

- the active session id in `.dojo/state.json`
- the rendered command set under `.agents/commands/`
- the generated `.dojo/context.md`
- the artifact directory namespace used by session-scoped templates

It does **not** switch repo branches.

## 4. Repository model

Repositories are registry entries in `.dojo/config.json`.

Each repo entry contains:

- `name`
- `type`
- `git`
- `path`
- `description`

`dojo repo add` may clone a remote repo or register a local repo path, but Dojo does not try to align or validate branches.

## 5. Command rendering model

Template source files live under `.dojo/commands/`.

Rendered outputs live under `.agents/commands/` and are then linked into tool-specific locations when needed.

Rendering flow:

1. lint template syntax and artifact references
2. apply session/no-session blocks
3. resolve `${session_id}` and `${context_path}`
4. resolve `${artifact_dir:<id>}` and `${artifact_description:<id>}`
5. expand `<dojo_read_block ... />` and `<dojo_write_block ... />`
6. write the rendered command

`$ARGUMENTS` is preserved untouched.

## 6. Context generation model

`.dojo/context.md` is generated from:

1. a fixed runtime header
2. `context.artifacts` in `.dojo/config.json`
3. loaded artifact plugins
4. each plugin's `renderContext()` output

The header now focuses on runtime mode, not Git state.

It includes:

- active session or baseline mode
- registered repositories
- context notes

When no session is active:

- session-scoped commands are hidden
- workspace and mixed-scope artifacts may still render
- session placeholders use the internal `baseline` token when needed for no-session expansion

## 7. Skill provisioning model

`dojo init` provisions the real authoring skill into the workspace:

- source: `src/skills/dojo-template-authoring/SKILL.md`
- installed path: `.dojo/skills/dojo-template-authoring/SKILL.md`
- materialized path: `.agents/skills/dojo-template-authoring/SKILL.md`
- tool link example: `.claude/skills/dojo-template-authoring/SKILL.md`

## 8. Start behavior

`dojo start` does exactly this:

1. detect the active session
2. regenerate rendered commands
3. regenerate `.dojo/context.md`
4. launch the selected coding tool

It deliberately does not gate on branch state.

## 9. Status behavior

`dojo status` is now a runtime overview, not a Git alignment dashboard.

It shows:

- workspace name
- active session or baseline mode
- enabled agents
- registered repos
- known sessions
- active-session task summary when available

`dojo session status` shows one session's metadata and task summary.

## 10. Deliberate simplifications

The current runtime deliberately avoids:

- Git branch switching
- dirty-worktree blocking
- branch existence validation
- repo-to-session branch bindings
- workspace reconciliation and switch planning
- live context reinjection into already-running AI sessions

Those were removed to keep the system easier to use and easier to extend.
