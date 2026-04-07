# Dojo — Contributor Guide

English contributor guide for this repository.

## What this repo is building

Dojo is a **workspace runtime for AI coding**, not an agent.

It gives AI tools one shared contract for:

- multi-repo workspaces
- session switching
- artifact-aware prompt templates
- startup/handoff context generation
- local authoring guidance through a real skill asset that is synced into supported tool skill directories

The runtime is intentionally small. Everything should be understandable through four concepts:

1. `session`
2. `artifact plugin`
3. `template`
4. `context`

## How Dojo works

At runtime, the loop is:

1. a workspace is initialized under `.dojo/`
2. repos are registered in `.dojo/config.json`
3. a session becomes active
4. Dojo switches the workspace root branch and the participating repo branches together
5. Dojo renders `.dojo/commands/*.md` into `.agents/commands/*.md`
6. Dojo materializes `.dojo/skills/*/SKILL.md` into `.agents/skill/*.md` and symlinks supported tool skill dirs such as `.claude/skills/`
7. the AI tool runs one of those templates
8. the template reads or writes artifact ids such as `research` or `tech-design`
9. artifact plugins under `.dojo/artifacts/*.{ts,js}` define where those artifacts live and how they appear in `.dojo/context.md`
10. `dojo context reload` or `dojo start` regenerates startup/handoff context for the next run

The important rule is that **context is startup/handoff state, not a live mirror of every file change inside an already-running AI session**.

## Repository layout

```text
bin/dojo.ts                    # CLI entry
src/
├── commands/                  # Thin CLI handlers
│   ├── init.ts                # dojo init / dojo create
│   ├── repo.ts
│   ├── session.ts
│   ├── context.ts
│   ├── start.ts
│   ├── template.ts            # dojo template lint/create
│   └── artifact.ts            # dojo artifact create
├── core/
│   ├── builtins.ts            # resolve built-in starter/artifact/skill asset dirs
│   ├── config.ts
│   ├── state.ts
│   ├── git.ts
│   ├── workspace.ts
│   ├── protocol.ts            # artifact loading, syntax expansion, validation
│   ├── context-generator.ts
│   └── command-distributor.ts
├── starter/
│   ├── commands/              # built-in starter templates
│   ├── workspace/             # starter AGENTS.md + gitignore
├── builtins/
│   └── artifacts/             # built-in artifact plugins
├── skills/
│   └── dojo-template-authoring/SKILL.md
├── types.ts
└── utils/
tests/
```

## Current extension model

### Artifact plugins

Built-in artifact plugins live in:

- `src/builtins/artifacts/`

Workspace-local artifact plugins live in:

- `.dojo/artifacts/`

Each plugin exports:

- `id`
- `dir`
- `description?`
- `renderContext()`

TypeScript is the preferred authoring format for workspace-local artifact plugins. `dojo init` installs `.dojo/types/dojo-artifact-plugin.d.ts`, and `dojo artifact create` scaffolds a `.ts` plugin by default.

### Templates

Built-in starter templates live in:

- `src/starter/commands/`

Workspace-local templates live in:

- `.dojo/commands/`

Supported syntax:

- YAML frontmatter for tool UX and runtime guards:
  - `description`
  - `argument-hint`
  - `scope`
- `${session_id}`
- `${context_path}`
- `${artifact_dir:<id>}`
- `${artifact_description:<id>}`
- `<!-- DOJO_SESSION_ONLY -->`
- `<!-- DOJO_NO_SESSION_ONLY -->`
- `<dojo_read_block artifacts="..." />`
- `<dojo_write_block artifact="..." />`

### Skill asset

The real authoring skill lives in:

- `src/skills/dojo-template-authoring/SKILL.md`

`dojo init` installs it into a workspace at:

- `.dojo/skills/dojo-template-authoring/SKILL.md`

When supported tools are enabled, Dojo also symlinks the materialized skill file into tool-specific locations such as `.claude/skills/dojo-template-authoring.md`.

## Commands contributors should know

```bash
npm install
npm run build
npm test
npx tsc --noEmit

# validate templates inside a workspace
dojo template lint

# scaffold a template or artifact inside a workspace
dojo template create dojo-my-command --output tech-design --reads research,tasks --scope session
dojo artifact create dev-plan --description "Development plan docs." --scope session
```

## Source of truth docs

Start with:

- [README.md](README.md)
- [docs/runtime-design.md](docs/runtime-design.md)
- [docs/template-protocol.md](docs/template-protocol.md)
- [docs/tech-design.md](docs/tech-design.md)

## If this repo is also a Dojo workspace

Read [context.md](/Users/popogolo/CursorProject/dojo/.dojo/context.md) when present.
