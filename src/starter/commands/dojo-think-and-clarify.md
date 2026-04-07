---
description: Clarify a request before writing code or committing to a plan.
argument-hint: [request / ambiguity / decision]
scope: mixed
---
# Dojo: think and clarify (`dojo-think-and-clarify`)

Before writing code, changing design, or executing a large task, **understand the request** and **project context**, then ask **high-signal** clarifying questions.

## Context (as needed)

- **`AGENTS.md`** — workspace overview
- **`.dojo/context.md`** — session/task state if present
- User text passed to this command: `$ARGUMENTS`

<!-- DOJO_SESSION_ONLY -->
<dojo_read_block artifacts="product-requirement,research,tech-design,tasks" />
<!-- /DOJO_SESSION_ONLY -->

## What to do

1. **Summarize your understanding** in one or two short paragraphs (no essay).
2. **List 3–7 numbered questions** that reduce ambiguity and rework risk. Avoid generic “anything else?” prompts.
3. **Do not** implement features, dump large patches, or make final decisions for the user in this step — if information is missing, **prioritize questions**.

## Output format

- **My understanding**
- **Questions for you** (numbered list)

Use **English**.
