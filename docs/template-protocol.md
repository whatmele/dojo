# Dojo Template and Artifact Protocol

This document defines the current Dojo protocol for templates and artifact plugins.

The design goal is simple:

- few concepts
- few fields
- one obvious extension path
- a closed loop that stays readable to both humans and AI tools

## 1. Core model

The protocol uses only four concepts:

1. `session`
2. `artifact plugin`
3. `template`
4. `context`

Everything else should be derived from those four.

## 2. Canonical locations

| Path | Meaning |
|------|---------|
| `.dojo/config.json` | workspace metadata, repo registry, and context artifact order |
| `.dojo/state.json` | active session id |
| `.dojo/context.md` | generated startup/handoff context |
| `.dojo/artifacts/*.{ts,js}` | workspace-local artifact plugins |
| `.dojo/commands/*.md` | template source files |
| `.dojo/skills/<skill-id>/SKILL.md` | installed workspace-local skills |
| `.dojo/sessions/<session-id>/state.json` | session state |
| `.agents/commands/*.md` | canonical rendered commands |

## 3. Artifact plugin contract

An artifact plugin is a JavaScript module that exports one default object.

Example:

```js
export default {
  id: 'research',
  dir: '.dojo/sessions/${session_id}/research',
  description: 'Research notes and technical exploration.',

  async renderContext({ dir, helpers }) {
    const files = helpers.listMarkdownFiles(dir);
    if (files.length === 0) return null;

    const lines = ['## Research', ''];
    for (const file of files) {
      lines.push(`- ${helpers.relative(file)}`);
    }
    return lines.join('\n');
  },
};
```

### Required fields

- `id`: stable artifact id used by templates and context ordering
- `dir`: directory template, or `null` for derived artifacts with no fixed directory
- `renderContext(input)`: returns a complete Markdown block or `null`

### Optional fields

- `description`: short text shown when template directives expand

### Built-in artifact ids

Dojo currently ships built-in artifact plugins for:

- `product-requirement`
- `research`
- `tech-design`
- `tasks`
- `workspace-doc`

Workspace-local plugins may override or extend these by adding files under `.dojo/artifacts/`.

## 4. Template syntax

Dojo templates are Markdown files under `.dojo/commands/`.

They should keep metadata minimal and express most structure in the body.

### Placeholders

Supported placeholders:

- `${session_id}`
- `${context_path}`
- `${artifact_dir:<id>}`
- `${artifact_description:<id>}`

Notes:

- `${artifact_dir:<id>}` is the default way to avoid hardcoded paths
- `${artifact_description:<id>}` is useful in read/write blocks or explicit instructions
- `${dojo_current_session_id}` still resolves for compatibility, but `${session_id}` is preferred

### Session blocks

Supported markers:

```md
<!-- DOJO_SESSION_ONLY -->
...
<!-- /DOJO_SESSION_ONLY -->

<!-- DOJO_NO_SESSION_ONLY -->
...
<!-- /DOJO_NO_SESSION_ONLY -->
```

Rules:

- session-only blocks are kept only when a session is active
- no-session blocks are kept only when no session is active
- markers must be balanced and correctly ordered

### Read directive

```md
<dojo_read_block artifacts="research,tasks" />
```

At render time, Dojo expands this into a Markdown block that lists:

- artifact id
- resolved directory
- artifact description

### Write directive

```md
<dojo_write_block artifact="tech-design" />
```

At render time, Dojo expands this into a Markdown block that lists:

- artifact id
- resolved directory
- artifact description

`<dojo_write_block ... />` must reference exactly one artifact id.

## 5. Render behavior

When Dojo materializes a template into `.agents/commands/`, it does this in order:

1. validate template syntax and artifact references
2. apply session/no-session blocks
3. resolve `${session_id}` and compatibility placeholders
4. resolve `${context_path}`
5. resolve `${artifact_dir:<id>}` and `${artifact_description:<id>}`
6. expand `<dojo_read_block ... />` and `<dojo_write_block ... />`
7. write the rendered Markdown command

If a template references an unknown artifact id, rendering fails.

## 6. Context behavior

`.dojo/context.md` is generated from:

- fixed runtime header
- `context.artifacts` order from `.dojo/config.json`
- the loaded artifact plugins
- each plugin's `renderContext()` output

The artifact order is also the plugin call order.

There is no separate summarizer/plugin system anymore.

If something should participate in context generation, it should be an artifact plugin.

## 7. Validation

Dojo provides a runtime-level template validator:

```bash
dojo template lint
dojo template lint dojo-tech-design
dojo template lint .dojo/commands/dojo-tech-design.md
```

The validator checks:

- unknown artifact ids
- malformed `<dojo_read_block ... />` directives
- malformed `<dojo_write_block ... />` directives
- malformed `${artifact_dir:<id>}` placeholders
- malformed `${artifact_description:<id>}` placeholders
- broken session block markers

## 8. Default template example

```md
# Dojo: Technical Design

<dojo_read_block artifacts="product-requirement,research" />

## User input

$ARGUMENTS

<dojo_write_block artifact="tech-design" />

Write the design docs under `${artifact_dir:tech-design}`.
Do not modify product code.
```

## 9. Custom artifact and template example

Artifact plugin:

```js
export default {
  id: 'dev-plan',
  dir: '.dojo/sessions/${session_id}/dev',
  description: 'Development plan docs.',

  async renderContext({ dir, helpers }) {
    const files = helpers.listMarkdownFiles(dir);
    if (files.length === 0) return null;

    const lines = ['## Development Plan', ''];
    for (const file of files) {
      lines.push(`- ${helpers.relative(file)}`);
    }
    return lines.join('\n');
  },
};
```

Template:

```md
<dojo_read_block artifacts="tech-design,tasks" />

## User input

$ARGUMENTS

<dojo_write_block artifact="dev-plan" />

Write the plan under `${artifact_dir:dev-plan}`.
```

## 10. Practical rule

The simplest correct Dojo extension flow is:

1. add or edit an artifact plugin
2. add or edit a template
3. validate with `dojo template lint`
4. regenerate context or start the tool

That is the whole protocol.
