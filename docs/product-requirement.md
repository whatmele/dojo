# Dojo — Product Requirements (PRD)

English is the **public-facing source of truth** for GitHub. The full Chinese PRD is archived at `docs/zh/product-requirement.md`.

## 1. Background & problem

AI coding tools (Claude Code, Codex, Cursor, Trae, etc.) typically operate within a **single workspace directory**, but real development frequently spans **multiple Git repositories** (services, tooling, docs/knowledge bases). Without a harness layer, it is hard to:

- Keep a consistent **multi-repo workspace inventory**
- Track **what the current development effort is** (session) and its progress
- Provide an AI agent with **structured, up-to-date context** across repos and phases

## 2. What Dojo is / is not

- **Dojo is** a CLI harness that manages workspace metadata + dev sessions and generates agent-facing command/context artifacts.
- **Dojo is not** an agent, and does not attempt to “orchestrate” decisions or replace your existing process tooling.

## 3. Goals

- **Workspace management**
  - Register multiple repos (path/type/description) in a single Dojo workspace
  - Keep workspace state inspectable and reproducible
- **Session lifecycle**
  - Create/resume/suspend/complete a “session” representing one development effort
  - Optionally create per-repo branches for the session
- **Agent-ready context**
  - Generate a deterministic context document (`.dojo/context.md`) from workspace/session state
  - Generate a single command source (`.agents/commands`) and distribute to tool-specific locations
- **Safe regeneration**
  - Re-running commands should not silently lose user-authored content

## 4. Non-goals

- Full project management, issue tracking, or CI/CD replacement
- A vendor-specific integration that hard-depends on one AI tool
- An agent runtime that runs tasks autonomously without user control

## 5. Key concepts

- **Workspace**: a directory with Dojo config and generated artifacts.
- **Repo registry**: the set of repos managed by the workspace.
- **Session**: a unit of work with metadata, status, optional branches, and outputs (PRD/research/design/tasks).
- **Context**: a generated snapshot for AI agents (status, progress, pointers).
- **Command distribution**: `.agents/commands` is the source; other tool folders link to it.

## 6. Primary workflow (happy path)

1. `dojo init`
2. `dojo repo add ...` (repeat for each repo)
3. `dojo session new` (optionally create branches)
4. `dojo start`
5. Iterate: produce session docs (PRD/research/design/tasks), implement, test, review, commit.

## 7. Documentation map

- **English PRD (this file)**: `docs/product-requirement.md`
- **Chinese PRD (archive)**: `docs/zh/product-requirement.md`
- **English tech design**: `docs/tech-design.md`
- **Chinese tech design (archive)**: `docs/zh/tech-design.md`

