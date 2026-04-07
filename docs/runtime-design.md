# Dojo Runtime Design

This document defines the simplified Dojo runtime model.

The design goal is strict:

- fewer concepts
- fewer fields
- one clear extension point
- enough structure for users to iterate on their own

The runtime should be understood through only four concepts:

1. `session`
2. `artifact plugin`
3. `template`
4. `context`

Everything else should be derived from those four.

## 1. Product shape

Dojo is not a bundle of prompts.

Dojo is a workspace runtime that:

- switches the workspace root and repo branches by session
- renders prompt templates into agent-facing command files
- resolves artifact references inside templates
- generates startup/handoff context from artifact plugins

## 2. Core model

### 2.1 Session

A session represents one work item.

A session owns:

- session id
- description
- workspace branch
- repo branches
- session artifact directories

### 2.2 Artifact plugin

An artifact plugin is the only artifact extension mechanism.

It defines:

- artifact `id`
- artifact directory rule
- artifact description
- how that artifact should be rendered into `.dojo/context.md`

There is no separate “artifact kind”, “summarizer plugin”, or “context section plugin” concept.

If something wants to participate in context generation, it should be an artifact plugin.

### 2.3 Template

A template is a Markdown file under `.dojo/commands/`.

It may:

- reference artifacts
- declare session-only or no-session-only blocks
- use runtime placeholders
- use simple Dojo directives

The runtime should avoid large metadata blocks. The template body should carry most of the structure.

### 2.4 Context

`.dojo/context.md` is startup and handoff context.

It is not a live mirror of every file change during an already-running AI session.

Its job is to:

- identify the active session
- identify branch state
- point the AI to the right artifact directories
- include artifact-rendered context blocks in a deterministic order

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
| `dir` | artifact directory template; may be `null` for derived artifacts |
| `renderContext` | function that returns a Markdown block or `null` |

### 4.2 Optional fields

| Field | Meaning |
|------|---------|
| `description` | human-readable explanation for template expansion |

### 4.3 Important design rule

The plugin itself should decide how its context block looks.

The runtime should not wrap artifact output in an extra synthetic title/body structure.

This is why the plugin does not need a separate `title` field.

## 5. Config shape

The runtime config should stay minimal.

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

If it is omitted, Dojo should use the default built-in order, then append any extra artifact plugins.

## 6. Template syntax

The template syntax should be small and explicit.

### 6.1 Placeholders

Supported placeholders:

- `${session_id}`
- `${context_path}`
- `${artifact_dir:<id>}`
- `${artifact_description:<id>}`

The most common one is `${artifact_dir:<id>}`.

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

At render time, the runtime expands that into a Markdown block containing:

- artifact id
- resolved directory
- artifact description

### 6.4 Write directive

Templates may declare the primary output artifact through:

```md
<dojo_write_block artifact="tech-design" />
```

At render time, the runtime expands that into a Markdown block containing:

- artifact id
- resolved directory
- artifact description

### 6.5 Why directives instead of large metadata

The runtime should not depend on large `reads/writes` frontmatter blocks.

The body-level directives are:

- easier for humans to read
- easier for runtime to expand
- easier to infer from later if linting is needed

### 6.6 Validation

Templates should be validated with:

```bash
dojo template lint
dojo template lint dojo-tech-design
```

The runtime should use the same validation path during command materialization.

## 7. Context generation

Context generation has two parts.

### 7.1 Fixed header

The runtime always writes a fixed header that includes:

- active session
- workspace branch
- repo branches
- a reminder that this file is startup/handoff context

### 7.2 Artifact blocks

After the fixed header:

1. Dojo resolves the ordered artifact id list
2. Dojo loads the corresponding artifact plugins
3. Dojo resolves each plugin directory
4. Dojo calls `renderContext()`
5. Dojo appends the returned Markdown blocks in order

If a plugin returns `null`, the runtime skips it.

## 8. Startup flow

`dojo init` should:

- create `.dojo/artifacts/`
- install built-in artifact plugins there
- create `.dojo/commands/`
- create `.dojo/skills/`
- install the built-in `dojo-template-authoring` skill
- create `.dojo/sessions/`
- create `.agents/commands/`
- write minimal config

This way the built-in artifacts are already in plugin form, and users can edit them directly.

## 9. Closed loop

The runtime loop should now be understood like this:

1. activate session
2. switch workspace root and repo branches
3. render commands from templates
4. templates write into artifact plugin directories
5. artifact plugins render context blocks
6. Dojo writes `.dojo/context.md`
7. the next AI session continues from that disk-backed state

## 10. Why this design is simpler

This design removes several separate concepts:

- no separate artifact kind registry
- no separate summarizer plugin concept
- no separate context plugin pipeline item concept
- no large `reads/writes` metadata requirement

Instead:

- artifact definition and context expression live in one place
- template syntax stays small
- context ordering is a simple ordered artifact id list

That is the runtime shape the code should implement.

## 11. Source asset layout in this repo

For contributors, the built-in assets are intentionally separated:

- `src/starter/commands/` — built-in starter templates
- `src/starter/workspace/` — starter workspace files
- `src/builtins/artifacts/` — built-in artifact plugins
- `src/skills/dojo-template-authoring/` — real skill asset
