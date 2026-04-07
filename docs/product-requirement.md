# Dojo — Product Requirement

This PRD describes the current intended product shape for Dojo.

## 1. Product thesis

AI coding tools are good inside one folder and one conversation.
Real delivery work is not.

Teams need:

- multiple repositories in one workspace
- explicit work-item switching
- durable artifacts on disk
- a predictable way to restart or hand off AI work

**Dojo should be the runtime layer for that workflow.**

It should manage:

- workspace state
- session state
- prompt-template rendering
- artifact discovery
- startup/handoff context generation

The built-in prompts are examples of how to use the runtime, not the product boundary.

## 2. Product model

Dojo should be understood through four concepts:

1. `session`
2. `artifact plugin`
3. `template`
4. `context`

### Session

A session owns one work item, including:

- session metadata
- workspace root branch
- participating repo branches
- session artifact directories

### Artifact plugin

An artifact plugin defines one class of output:

- its stable artifact id
- its directory rule
- its description
- how it appears in generated context

### Template

A template is a reusable Markdown command that reads and writes artifact ids through a small Dojo syntax.

### Context

`.dojo/context.md` is generated startup and handoff context. It points the next AI tool at the right session state and artifact locations.

## 3. Primary users

### Cross-repo implementer

Needs one AI workspace across backend, frontend, tooling, and reference repos.

### Tech lead / architect

Needs a coherent loop from requirements through research, design, tasks, implementation, review, and documentation.

### AI workflow owner

Needs a safe way to standardize team prompts without rebuilding workspace/session infrastructure.

## 4. Core product loop

1. initialize a workspace
2. register repos
3. create or resume a session
4. switch the workspace root branch and repo branches together
5. render templates into agent-facing commands
6. run built-in or custom templates
7. write outputs into artifact plugin directories
8. regenerate `.dojo/context.md`
9. continue from state on disk

## 5. Goals

### Workspace management

- track multiple repos in one workspace
- keep repo inventory explicit and reproducible

### Session lifecycle

- create, resume, suspend, and complete sessions
- align workspace root branch and repo branches to the active session

### Protocolized template authoring

- let users create custom templates under `.dojo/commands/`
- let users create custom artifact plugins under `.dojo/artifacts/`
- keep template syntax small and deterministic
- provide a real built-in authoring skill

### Structured AI context

- generate `.dojo/context.md` from canonical state and artifact plugins
- keep context ordered and easy to scan
- treat context as startup/handoff state, not a live mirror

## 6. Non-goals

Dojo is not trying to be:

- an autonomous agent platform
- a replacement for Git hosting or issue tracking
- a vendor-locked prompt system
- a heavyweight workflow engine with dozens of internal concepts

## 7. Required built-ins

The starter layer should continue to ship:

- built-in `dojo-*` command templates
- built-in artifact plugins for the standard outputs
- a real `dojo-template-authoring` skill asset
- a template validation command: `dojo template lint`

## 8. Success criteria

Dojo is succeeding when a user can:

1. start from `dojo init`
2. create a custom artifact plugin
3. create a custom template that references it
4. validate that template
5. regenerate context and continue working

without patching the Dojo runtime itself.
