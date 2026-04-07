---
name: dojo-template-authoring
description: Use when creating, updating, linting, or debugging Dojo command templates or artifact plugins. Applies to `.dojo/commands/*.md`, `.dojo/artifacts/*.{ts,js}`, and the `dojo template lint` workflow.
---

# Dojo Template Authoring

Use this skill when you need to:

- create a new Dojo command template
- migrate an old template to the current syntax
- add or modify an artifact plugin
- decide which artifact id a template should read or write
- fix `dojo template lint` failures

## First inspect

1. `.dojo/config.json`
2. `.dojo/commands/`
3. `.dojo/artifacts/`
4. `.dojo/context.md` if session behavior matters
5. the closest existing template and artifact plugin

## Runtime model

Dojo uses four core concepts:

1. `session`
2. `artifact plugin`
3. `template`
4. `context`

Important rules:

- artifact behavior lives in `.dojo/artifacts/*.{ts,js}`
- template behavior lives in `.dojo/commands/*.md`
- templates keep frontmatter minimal and tool-facing
- artifact ids are the stable contract between templates and runtime

## Template frontmatter

Keep frontmatter small. The built-in commands use it for tool UX and validation:

- `description`
- `argument-hint`
- `scope`

Do not recreate the old large `reads` / `writes` metadata blocks. Artifact references belong in the template body through Dojo directives and placeholders.

## Template syntax

Supported placeholders:

- `${session_id}`
- `${context_path}`
- `${artifact_dir:<id>}`
- `${artifact_description:<id>}`

Supported session blocks:

- `<!-- DOJO_SESSION_ONLY -->`
- `<!-- DOJO_NO_SESSION_ONLY -->`

Supported directives:

- `<dojo_read_block artifacts="research,tasks" />`
- `<dojo_write_block artifact="tech-design" />`

Rules:

- keep `$ARGUMENTS` untouched
- prefer `${artifact_dir:<id>}` over hardcoded session paths
- use `<dojo_write_block ... />` for the primary output artifact
- use `<dojo_read_block ... />` when the template should show resolved input artifacts explicitly

## Artifact plugin contract

Each artifact plugin exports a default object:

```ts
export default {
  id: 'research',
  scope: 'session',
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

Rules:

- `id` must be unique
- `scope` should be `workspace`, `session`, or `mixed`
- `dir` is a template string or `null` for derived artifacts
- `description` should explain what the artifact contains
- `renderContext()` must return a complete markdown block or `null`

## Choosing the right artifact id

Prefer an existing artifact id when the output naturally fits:

- `product-requirement`
- `research`
- `tech-design`
- `tasks`
- `workspace-doc`

Add a new artifact plugin only when the output does not fit an existing id cleanly.

## Authoring workflow

1. Decide whether an existing artifact id already fits.
2. If not, add or update `.dojo/artifacts/<id>.ts` (or `.js` if you really need plain JavaScript).
3. Add or update `.dojo/commands/<command>.md`.
4. Use Dojo placeholders and directives instead of hardcoded session paths.
5. Run `dojo template lint` before finishing.
6. If you changed starter templates, check that rendered output contains no unresolved Dojo syntax.

## TypeScript authoring

Artifact plugins can be written directly in TypeScript.

- default scaffold: `dojo artifact create <id>`
- generated type helpers: `.dojo/types/dojo-artifact-plugin.d.ts`
- fallback JavaScript scaffold: `dojo artifact create <id> --js`

## Skill sync

Dojo materializes workspace skills into `.agents/skills/<slug>/SKILL.md` and symlinks supported tool skill directories such as `.claude/skills/<slug>/SKILL.md`.

The TypeScript path is preferred because it makes the plugin contract and helper methods visible while you author.

## Validation

Run:

- `dojo template lint`
- `dojo template lint dojo-my-command.md`
- `dojo template lint .dojo/commands/dojo-my-command.md`

Lint should catch:

- unknown artifact ids
- malformed read/write directives
- malformed artifact placeholders
- broken session block markers

## Done checklist

- template references only known artifact ids
- template uses current directive syntax
- template leaves `$ARGUMENTS` unchanged
- session-only and no-session behavior are intentional
- artifact plugin returns a complete markdown block or `null`
- `dojo template lint` passes
