# Dojo Template Authoring Skill

This document explains the real Dojo authoring skill asset.

It is not the skill body itself.

## Canonical skill asset

The real skill lives here in the repo:

- [`src/skills/dojo-template-authoring/SKILL.md`](../src/skills/dojo-template-authoring/SKILL.md)

When `dojo init` creates a workspace, it installs that skill here:

- `.dojo/skills/dojo-template-authoring/SKILL.md`

## What the skill teaches

The skill teaches an AI how to:

- create or update a Dojo template under `.dojo/commands/`
- create or update an artifact plugin under `.dojo/artifacts/`
- choose the right artifact id for a template
- use the current Dojo syntax correctly
- fix `dojo template lint` failures

## Runtime assumptions behind the skill

The skill assumes the simplified runtime model:

1. `session`
2. `artifact plugin`
3. `template`
4. `context`

It does not assume the old `kind / summarizer / pipeline` model.

## How to use it

An AI should read the skill when it needs to:

- author a new template
- migrate an old template to current syntax
- add a custom artifact plugin
- debug template rendering or validation errors

## Current syntax taught by the skill

- `${session_id}`
- `${context_path}`
- `${artifact_dir:<id>}`
- `${artifact_description:<id>}`
- `<!-- DOJO_SESSION_ONLY -->`
- `<!-- DOJO_NO_SESSION_ONLY -->`
- `<dojo_read_block artifacts="..." />`
- `<dojo_write_block artifact="..." />`

## Validation workflow

The skill expects the authoring loop to end with:

```bash
dojo template lint
```

That keeps template authoring and runtime behavior aligned.

## Scaffold helpers

Inside a Dojo workspace, the fastest way to start is:

```bash
dojo template create dojo-my-command --output tech-design --reads research,tasks
dojo artifact create dev-plan --description "Development plan docs."
```

`dojo artifact create` now scaffolds a TypeScript plugin by default and installs type hints into `.dojo/types/dojo-artifact-plugin.d.ts`.

Then edit the generated files and run `dojo template lint`.
