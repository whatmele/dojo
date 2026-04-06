<h1 align="center">
  <img src="docs/assets/dojo-banner.svg" width="520" alt="Dojo — Agent Workspace CLI" />
</h1>

<p align="center"><strong>Agent Workspace CLI</strong> — multi-repo workspaces, dev session lifecycle, and structured context for AI coding tools.</p>

**Languages:** this file is English (default on GitHub). [简体中文 README](README.zh-CN.md) is kept for reference.

---

## What is it?

Most AI coding tools (Claude Code, Codex, Cursor, Trae) assume a single folder. Real work often spans several Git repos and phases: research, design, breakdown, dev/test, review, and ship.

**Dojo is a CLI harness** (not an agent). It gives those tools:

- **Multi-repo layout** — biz / dev / wiki repos in one workspace  
- **Sessions** — per-iteration branches, artifact folders, and status  
- **Structured context** — regenerated docs so agents see the latest state  
- **Command templates** — slash-command prompts for PRD, research, design, tasks, dev loop, review, commit, docs, etc.

## Quick start

```bash
npm install -g dojo-cli

# New workspace (pick one)
mkdir my-workspace && cd my-workspace && dojo init   # init in current directory
# or: dojo create [name]                             # create a child folder and init there

dojo repo add git@github.com:org/backend-service.git
dojo repo add --local ./existing-repo

dojo session new
dojo start
```

## Flow

```
dojo init / dojo create
     ↓
dojo repo add
     ↓
dojo start
     ↓
/dojo-init-context — scan repos; long-form docs → docs/, keep AGENTS.md short
     ↓
dojo session new
     ↓
┌─ /dojo-think-and-clarify
├─ /dojo-prd
├─ /dojo-research
├─ /dojo-tech-design
├─ /dojo-task-decompose
├─ /dojo-dev-loop
├─ /dojo-review
├─ /dojo-commit
└─ /dojo-gen-doc
     ↓
dojo session resume
```

## CLI commands

| Command | Description |
|---------|-------------|
| `dojo init` | Initialize workspace here (interactive) |
| `dojo create [name]` | Create a subdirectory and initialize (same flow as `init`) |
| `dojo repo add <url>` | Clone and register a repo |
| `dojo repo add --local <path>` | Register an existing local repo |
| `dojo repo remove <name>` | Remove from workspace config |
| `dojo repo sync [name]` | `git pull` for one or all repos |
| `dojo session new` | New dev session |
| `dojo session resume <id>` | Resume a session |
| `dojo context reload` | Refresh context and command stubs |
| `dojo start [tool]` | Refresh context and launch an AI tool |

## Slash commands (in the AI tool)

| Command | Phase | May edit product code |
|---------|-------|------------------------|
| `/dojo-init-context` | Index + docs | No |
| `/dojo-think-and-clarify` | Clarify | No |
| `/dojo-prd` | Requirements | No |
| `/dojo-research` | Research | No |
| `/dojo-tech-design` | Design | No |
| `/dojo-task-decompose` | Breakdown | No |
| `/dojo-dev-loop` | Dev | Yes |
| `/dojo-review` | Review | No |
| `/dojo-commit` | Commit | No |
| `/dojo-gen-doc` | Docs | No |

## Workspace layout

```
my-workspace/
├── .dojo/
│   ├── config.json
│   ├── state.json          # often gitignored
│   ├── context.md          # generated (often gitignored)
│   ├── commands/           # template sources
│   └── sessions/<session-id>/...
├── .agents/commands/       # generated stubs (source of truth)
├── .claude/commands/       # file symlinks: dojo-*.md → ../.agents/commands/
├── .trae/commands/         # same pattern if Trae is enabled
├── repos/
├── docs/
└── AGENTS.md
```

## Supported tools

Claude Code, Codex (OpenAI), Cursor, Trae.

Claude / Trae use **per-file** symlinks for `dojo-*.md` into `.agents/commands`. Codex / Cursor read `.agents/commands` directly. With no active session, a “no-session” stub set is still generated (some entries include placeholder warnings).

## Development

```bash
git clone https://github.com/<org>/dojo.git
cd dojo
npm install
npm test
./scripts/dev-link.sh
```

## Docs (English)

- [docs/product-requirement.md](docs/product-requirement.md) — product spec  
- [docs/tech-design.md](docs/tech-design.md) — technical design  

Chinese archive: [docs/zh/](docs/zh/)

## License

MIT
