# Dojo Runtime Test Plan

This document defines the current verification standard for the simplified Dojo runtime.

The runtime under test is the artifact-plugin model:

- `session`
- `artifact plugin`
- `template`
- `context`

## 1. Verification goals

The runtime is considered correct only when all of these are true:

1. artifact plugins can be loaded from built-in and workspace-local locations
2. templates can reference artifact ids without hardcoding session paths
3. `dojo template lint` catches broken syntax and unknown artifact ids
4. command materialization expands Dojo syntax deterministically
5. context generation follows `context.artifacts` order
6. session switching still regenerates the right startup/handoff context

## 2. Test layers

### Config and protocol

Purpose:

- verify config shape and artifact ordering
- verify artifact ids resolve correctly
- verify artifact descriptions and directories come from plugins

Primary coverage:

- `tests/core/protocol-config.test.ts`

### Template lint and syntax validation

Purpose:

- verify malformed directives are rejected
- verify malformed placeholders are rejected
- verify session markers are balanced
- verify single-template lint targeting works

Primary coverage:

- `tests/core/template-lint.test.ts`

### Command materialization

Purpose:

- verify session placeholders resolve correctly
- verify read/write directives expand correctly
- verify unknown artifact ids fail fast
- verify no-session rendering stays understandable

Primary coverage:

- `tests/core/command-distributor.test.ts`
- `tests/core/built-in-templates.test.ts`

### Context generation

Purpose:

- verify the fixed header is stable
- verify artifact plugins render sections in the configured order
- verify built-in and custom artifacts both participate correctly

Primary coverage:

- `tests/core/context-generator.test.ts`
- `tests/core/context-pipeline.test.ts`
- `tests/core/local-plugin.test.ts`

### End to end

Purpose:

- verify the full runtime loop from session state to rendered context
- verify `dojo start` refreshes commands and context before launch
- verify resume behavior restores the right session context

Primary coverage:

- `tests/e2e/protocol-runtime.test.ts`
- `tests/e2e/lifecycle.test.ts`

## 3. Acceptance IDs

| ID | Scenario | Expected result |
|----|----------|-----------------|
| `CFG-*` | config and artifact plugin contract | artifact order and references are valid |
| `LINT-*` | template syntax validation | malformed syntax and unknown ids are caught |
| `CMD-*` | command rendering | rendered output contains no unresolved Dojo syntax |
| `CTX-*` | context generation | header and artifact sections are deterministic |
| `E2E-*` | runtime lifecycle | the end-to-end loop works from disk-backed state |

## 4. Current ship gate

Before shipping runtime changes, all of these should pass:

- `npm test`
- `npx tsc --noEmit`
- `git diff --check`

## 5. Practical standard

A runtime change is done only when:

1. the behavior is documented
2. the behavior is covered by tests
3. the rendered commands and generated context match the documented model
