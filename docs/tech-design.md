# Dojo — Technical Design (English)

English is the **public-facing source of truth** for GitHub. The full Chinese tech design is archived at `docs/zh/tech-design.md`.

## 1. Architecture overview

Dojo is a CLI harness with two core responsibilities:

- **State**: read/write workspace and session state (`.dojo/`)
- **Generation**: produce deterministic agent-facing artifacts (context + command stubs/links)

High-level layers:

- **CLI layer** (`src/commands/`): thin command handlers (argument parsing, prompts, logging)
- **Core layer** (`src/core/`): workspace/config/state, git operations, generation logic
- **Utilities** (`src/utils/`): filesystem and logging helpers
- **Templates** (`src/templates/`): markdown templates copied into `dist/` at build time

## 2. Key files and directories

- **Workspace config**: `.dojo/config.json`
- **Workspace context (generated)**: `.dojo/context.md`
- **Session outputs**: `.dojo/sessions/<session-id>/...`
- **Command source (generated)**: `.agents/commands/`
- **Tool-specific command surfaces (linked/distributed)**: e.g. `.claude/commands/`, `.trae/commands/`

## 3. Command distribution model

Design intent:

- Maintain **one canonical generated command directory** (`.agents/commands`)
- For tools that require a specific directory structure, create **file-level links** to the corresponding `dojo-*.md` files
- Support both “with session” and “no active session” modes, where session-only commands can render a helpful banner rather than failing silently

## 4. Context generation model

The context generator should:

- Prefer **determinism**: same inputs produce the same context markdown
- Be **incremental-friendly**: update stable sections without constantly rewriting user-authored docs
- Represent task progress in an unambiguous way (e.g. `Todo` / `Done`)

## 5. Build & test

Build copies templates into the compiled output:

```bash
npm run build
```

Run unit tests:

```bash
npm test
```

## 6. Language policy

- **English-first** for public-facing GitHub docs (`docs/*.md`, root `README.md`, root `AGENTS.md`)
- **Chinese archives** live under `docs/zh/` and `src/templates/**/zh-CN/`
