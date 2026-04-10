# Dojo Runtime Design

This document defines the current Dojo runtime model.

The design goal is strict:

- fewer concepts
- fewer moving parts
- one shared contract for AI tools
- enough structure for teams to extend locally

The runtime should be understood through only four concepts:

1. `session`
2. `artifact plugin`
3. `template`
4. `context`

Everything else should be derived from those four.

## 1. Product shape

Dojo is not a bundle of prompts.

Dojo is a workspace runtime that:

- keeps a registry of repos in `.dojo/config.json`
- tracks the active session in `.dojo/state.json`
- renders prompt templates into agent-facing command files
- resolves artifact references inside templates
- generates startup and handoff context from artifact plugins

Dojo MVP does **not** manage Git branch switching.
Sessions are runtime modes, not Git layouts.

## 2. Core model

### 2.1 Session

A session represents one work item.

A session owns:

- session id
- description
- optional external link
- timestamps and status
- session artifact directories

When a session is active, session-scoped commands and session-scoped artifact paths resolve against `.dojo/sessions/<session-id>/`.

When no session is active, Dojo runs in baseline mode.

### 2.2 Artifact plugin

An artifact plugin is the only artifact extension mechanism.

It defines:

- artifact `id`
- artifact directory rule
- artifact description
- how that artifact should be rendered into `.dojo/context.md`

There is no separate summarizer plugin, context section plugin, or artifact registry layer.

### 2.3 Template

A template is a Markdown file under `.dojo/commands/`.

It may:

- reference artifacts
- declare session-only or no-session-only blocks
- use runtime placeholders
- use simple Dojo directives

The runtime intentionally keeps template metadata small.

### 2.4 Context

`.dojo/context.md` is startup and handoff context.

It is not a live mirror of every file change during an already-running AI session.

Its job is to:

- identify the active session or baseline mode
- list registered repositories
- point the AI to the right artifact directories
- include artifact-rendered context blocks in deterministic order

Repository Git helpers such as `dojo repo status`, `dojo repo sync`, and `dojo repo checkout` operate only on the repo registry. They are not part of session switching and do not change the active session or artifact namespace.

## 3. Canonical locations

| Path | Meaning |
|------|---------|
| `.dojo/config.json` | workspace metadata, repo registry, and context artifact order |
| `.dojo/state.json` | workspace-level state, especially active session |
| `.dojo/context.md` | generated startup/handoff context |
| `.dojo/artifacts/*.{ts,js}` | workspace-local artifact plugins |
| `.dojo/commands/*.md` | template source files |
| `.dojo/skills/<skill-id>/SKILL.md` | installed workspace-local skills |
| `.dojo/sessions/<session-id>/state.json` | session state |
| `.agents/commands/*.md` | rendered commands |

## 4. Artifact plugin contract

An artifact plugin is a JavaScript module that exports a default object.

Recommended shape:

```js
export default {
  id: 'research',
  scope: 'session',
  dir: '.dojo/sessions/${session_id}/research',
  description: 'Research notes and technical exploration.',

  async renderContext({ dir, helpers }) {
    const files = helpers.listMarkdownFiles(dir);
    const lines = ['## Research', ''];

    if (files.length === 0) {
      lines.push('- No files yet.');
      return lines.join('\n');
    }

    for (const file of files) {
      lines.push(`- ${helpers.relative(file)}`);
    }

    return lines.join('\n');
  },
};
```

### 4.1 Required fields

| Field | Meaning |
|------|---------|
| `id` | artifact id used by templates and context ordering |
| `scope` | `workspace`, `session`, or `mixed` |
| `dir` | artifact directory template; may be `null` for derived artifacts |
| `renderContext` | function that returns a Markdown block or `null` |

### 4.2 Optional fields

| Field | Meaning |
|------|---------|
| `description` | human-readable explanation for template expansion |

## 5. Config shape

The runtime config stays minimal.

Recommended shape:

```json
{
  "workspace": {
    "name": "my-workspace",
    "description": "Cross-repo AI coding workspace"
  },
  "agents": ["codex", "claude-code"],
  "agent_commands": {
    "codex": "codex",
    "claude-code": "claude"
  },
  "repos": [],
  "context": {
    "artifacts": [
      "product-requirement",
      "research",
      "tech-design",
      "tasks"
    ]
  }
}
```

`context.artifacts` is the only ordering mechanism:

- it defines the context render order after the fixed runtime header
- it also defines the effective artifact plugin call order

If it is omitted, Dojo uses the built-in default order and then appends any extra artifact plugins.

## 6. Template syntax

The template syntax is intentionally small.

### 6.1 Placeholders

Supported placeholders:

- `${session_id}`
- `${context_path}`
- `${artifact_dir:<id>}`
- `${artifact_description:<id>}`

### 6.2 Session blocks

Supported block markers:

- `<!-- DOJO_SESSION_ONLY -->`
- `<!-- /DOJO_SESSION_ONLY -->`
- `<!-- DOJO_NO_SESSION_ONLY -->`
- `<!-- /DOJO_NO_SESSION_ONLY -->`

### 6.3 Read directive

Templates may declare available artifact context through:

```md
<dojo_read_block artifacts="research,tasks" />
```

### 6.4 Write directive

Templates may declare the primary output artifact through:

```md
<dojo_write_block artifact="tech-design" />
```

### 6.5 Validation

Templates should be validated with:

```bash
dojo template lint
dojo template lint dojo-tech-design
```

The runtime uses the same validation path during command materialization.
