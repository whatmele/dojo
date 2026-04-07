# Dojo — Technical Design

This document describes the current technical shape of Dojo after the runtime simplification.

## 1. Architecture summary

The runtime is intentionally small.

It is built around four concepts:

1. `session`
2. `artifact plugin`
3. `template`
4. `context`

There is no separate `kind`, `summarizer plugin`, or `context pipeline item` model anymore.

## 2. Main modules

### CLI layer

- `src/commands/init.ts`
- `src/commands/repo.ts`
- `src/commands/session.ts`
- `src/commands/context.ts`
- `src/commands/start.ts`
- `src/commands/template.ts`

These handlers stay thin and delegate runtime work to `src/core/`.

### Runtime core

- `src/core/config.ts` — workspace config read/write
- `src/core/state.ts` — workspace and session state read/write
- `src/core/git.ts` — branch and repo operations
- `src/core/workspace.ts` — workspace discovery and helpers
- `src/core/protocol.ts` — artifact plugin loading, template syntax helpers, validation, directory resolution
- `src/core/command-distributor.ts` — render templates into `.agents/commands/`
- `src/core/context-generator.ts` — generate `.dojo/context.md`

### Template and starter assets

- `src/starter/commands/` — built-in starter template sources
- `src/starter/workspace/` — starter workspace files such as `AGENTS.md` and `.gitignore`
- `src/builtins/artifacts/` — built-in artifact plugins
- `src/skills/dojo-template-authoring/SKILL.md` — real authoring skill asset

## 3. Session model

A session owns:

- `id`
- `description`
- `created_at`
- `status`
- `workspace_branch`
- `repo_branches`

Important rule:

**the workspace root branch switches with the session.**

That keeps root-level docs, templates, and session state aligned with the same work item.

## 4. Artifact plugin model

Artifact plugins are loaded from:

1. built-ins under `src/builtins/artifacts/`
2. workspace-local overrides/extensions under `.dojo/artifacts/`

Workspace-local plugins override built-ins by `id`.

Each plugin provides:

- `id`
- `dir`
- `description?`
- `renderContext()`

The runtime resolves the directory by expanding `dir` with the current session id.

## 5. Template rendering model

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

1. fixed runtime header
2. `context.artifacts` in `.dojo/config.json`
3. loaded artifact plugins
4. each plugin's `renderContext()` output

The configured artifact order is also the context section order.

If `context.artifacts` is omitted, Dojo falls back to the default built-in order and then appends any extra plugins.

## 7. Skill provisioning model

`dojo init` provisions the real authoring skill into the workspace:

- source: `src/skills/dojo-template-authoring/SKILL.md`
- installed path: `.dojo/skills/dojo-template-authoring/SKILL.md`

That gives AI tools a canonical local instruction file for template and artifact authoring.

## 8. Template validation

The runtime exposes:

```bash
dojo template lint
dojo template lint dojo-tech-design
dojo template lint .dojo/commands/dojo-tech-design.md
dojo template create dojo-my-command --output tech-design --reads research,tasks
dojo artifact create dev-plan --description "Development plan docs."
```

Validation covers:

- unknown artifact ids
- malformed directives
- malformed placeholders
- broken session block markers

The same validation path is used both for explicit linting and for command materialization.

## 9. Init behavior

`dojo init` should:

1. create `.dojo/commands/`, `.dojo/artifacts/`, `.dojo/skills/`, `.dojo/sessions/`, and `.agents/commands/`
2. write `.dojo/config.json` and `.dojo/state.json`
3. copy built-in starter templates
4. copy built-in artifact plugins
5. copy the built-in skill asset
6. render the initial no-session command set
7. initialize Git if needed

## 10. Start behavior

`dojo start` should:

1. detect the active session
2. regenerate rendered commands
3. regenerate `.dojo/context.md`
4. launch the selected coding tool

This ensures the tool starts from current disk-backed state.

## 11. Deliberate simplifications

The current runtime deliberately avoids:

- a separate artifact registry file for concrete outputs
- a summarizer plugin layer separate from artifact plugins
- large template frontmatter metadata blocks
- live context reinjection into already-running AI sessions

Those were removed to keep the system more understandable and easier to extend.
