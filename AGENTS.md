# Dojo — AI Coding Workspace Manager

English contributor guide (default). For Chinese, see [AGENTS.zh-CN.md](AGENTS.zh-CN.md).

## Overview

Dojo is a CLI that manages multi-repo workspaces, dev session lifecycle, and structured context for AI coding tools (Claude Code, Codex, Cursor, Trae). It is a **harness**, not an agent.

## Stack

- TypeScript + Node.js (see `package.json` engines; Node 20+ recommended)
- Commander.js, @inquirer/prompts, simple-git, vitest

## Layout

```
bin/dojo.ts                 # CLI entry
src/
├── commands/               # Thin CLI handlers
│   ├── init.ts             # dojo init / dojo create
│   ├── repo.ts
│   ├── session.ts
│   ├── context.ts
│   └── start.ts
├── core/
│   ├── config.ts
│   ├── state.ts
│   ├── git.ts
│   ├── workspace.ts
│   ├── context-generator.ts
│   └── command-distributor.ts   # placeholders, conditional blocks, per-file symlinks
├── templates/              # Copied to dist on build
│   ├── commands/           # English dojo-*.md (Chinese archive: commands/zh-CN/)
│   ├── zh-CN/AGENTS.md     # Chinese AGENTS template archive
│   ├── AGENTS.md           # Default workspace AGENTS template (English)
│   └── gitignore
├── types.ts
└── utils/
tests/
```

## Build & test

```bash
npm install
npm run build
npm test
./scripts/dev-link.sh
npx tsc --noEmit
```

## Docs

- [docs/product-requirement.md](docs/product-requirement.md) (EN)
- [docs/tech-design.md](docs/tech-design.md) (EN)
- Chinese archive: [docs/zh/](docs/zh/)

## Current state

If this repo is also a Dojo workspace, read `@.dojo/context.md` when present.
