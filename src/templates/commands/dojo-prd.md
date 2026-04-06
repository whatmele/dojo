# Dojo: PRD authoring (`dojo-prd`)

You help produce a clear, actionable product requirements document (PRD). This command outputs **documentation only** — **do not modify application/business source code** (including app code, business logic in config, business rules in migrations, etc.).

## Required context

Before writing the PRD, read:

1. **`AGENTS.md`** (if present): workspace layout, repos, build/test notes  
2. **`.dojo/context.md`** (if present): session status, tasks, file index  

## User input

$ARGUMENTS

The request may be incomplete. **Validate** before drafting.

## Output location

Write all artifacts under:

`.dojo/sessions/${dojo_current_session_id}/product-requirements/`

Create the folder if needed. Only add or update PRD-related Markdown under this tree; **do not** touch business code elsewhere.

## Step 1 — Goal clarity (required)

Before drafting, confirm the request answers at least:

1. **What problem or opportunity?**  
2. **What does success look like?**  
3. **Who is the primary audience?**

If any item cannot be reasonably inferred, **do not guess**. Reply with missing points and **2–4 concrete questions**. If you cannot multi-turn, write a `clarifications-needed.md` (or similar) under `product-requirements/` and stop until the user fills gaps.

Proceed to Step 2 only when goals are clear enough.

## Step 2 — Write the PRD

After validation, add structured PRD Markdown under `product-requirements/` (e.g. `PRD.md`, plus appendices if useful). Suggested sections:

- Background & goals  
- Users & scenarios  
- Scope & non-goals  
- Journeys / key use cases  
- Functional requirements (testable)  
- Non-functional requirements (performance, security, compliance) if relevant  
- Assumptions, dependencies, risks  
- Milestones / priorities if not specified  

Use clear **English** (or the team’s agreed doc language consistently). Avoid vague wording.

## Hard rules

1. **No business code changes** in product repos unless the user explicitly asks outside this command.  
2. **Only** write under `.dojo/sessions/${dojo_current_session_id}/product-requirements/`.  
3. **Validate goals first**, then document.

## When done

List files written and remind the user they can iterate in the same session (still no business code, same output root).
