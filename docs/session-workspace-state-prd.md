# Dojo Session and Workspace State PRD

## 1. Purpose

This document defines the new Dojo product model for workspace state, repository state, session switching, and no-session behavior.

This document is the source of truth for the new design.

Constraints for this design:

- do not consider legacy compatibility
- workspace root must support session branches
- automatic branch push remains enabled, but push failure must not break local session activation
- Dojo must support both `active session` and `no session`
- `no session` means the workspace returns to its baseline branch state

## 2. Product Thesis

Dojo is a workspace runtime for AI coding.

Its most critical job is not template rendering. Its most critical job is to make the workspace state trustworthy:

- users must know which work item is active
- users must know which repositories belong to that work item
- each repository may use a different branch for the same session
- switching must be blocked when the workspace is unsafe to switch
- users must be able to return to a clean no-session state

The product must optimize for:

- flexibility in repo participation
- strict safety in branch switching
- clear observability of actual workspace state
- deterministic recovery of prior work

## 3. Core User Problems

Current pain points this redesign must remove:

1. a session can only be understood indirectly through generated context and stored branch names
2. users cannot clearly see whether the actual repo state matches the session definition
3. session switching may partially succeed and still look successful
4. workspace root branch behavior is not clearly defined for real documentation/code changes
5. users cannot explicitly return to a trusted no-session state
6. repos not involved in the current session can become hidden drift or accidental carry-over from another session

## 4. Design Principles

### 4.1 Trust Before Convenience

Dojo must refuse to switch if the workspace is not safe to switch.

Examples:

- uncommitted changes
- missing repo path
- detached HEAD
- missing target branch
- repo state drift that makes the requested transition ambiguous

### 4.2 Session Scope Is Explicit

A session only binds the repos it cares about.

Different repos in one session may use different target branches.

### 4.3 Unbound Repos Must Still Be Deterministic

Even when a session only binds a subset of repos, the workspace must still converge to one deterministic state.

Therefore:

- bound repos switch to their session target branches
- unbound repos switch to their baseline branches
- workspace root switches to the session root branch when a session is active
- workspace root switches to the baseline branch in no-session mode

This avoids mixed leftovers from a previously active session.

### 4.4 No-Session Is a First-Class State

Dojo must not force the user to always operate inside a session.

There must be a clear workspace state where:

- no session is active
- workspace root is on the baseline branch
- all registered repos are on their baseline branches
- AI tools can still be launched
- generated commands still work in their no-session forms

## 5. Key Concepts

### 5.1 Workspace Baseline

The baseline state is the branch layout when no session is active.

It includes:

- workspace root baseline branch, default `main`
- each repo baseline branch, from repo config `default_branch`

### 5.2 No-Session State

No-session means:

- `active_session = null`
- workspace root is on its baseline branch
- all registered repos are on their baseline branches
- Dojo still supports `dojo start`

This is the default neutral state of the workspace.

### 5.3 Session

A session represents one work item.

A session owns:

- metadata
- root branch for the workspace repo
- an explicit set of repo bindings
- artifact directories under `.dojo/sessions/<session-id>/`

### 5.4 Repo Binding

A repo binding is a session-local declaration:

- which repo participates
- which branch that repo should be on for this session
- whether that branch is newly created or expected to already exist

Repo binding is explicit. Absence of binding means the repo returns to baseline when the session is active.

## 6. User-Facing Behavior

### 6.1 `dojo session new`

This command creates a new session definition and activates it.

Required behavior:

1. gather session metadata
2. choose participating repos
3. choose a target branch per participating repo
4. choose or infer the workspace root branch for the session
5. run strict preflight
6. create local branches where requested
7. switch root and repos into the new session state
8. write session state and workspace state only after local switch succeeds
9. regenerate commands and context
10. best-effort push root and bound repo branches
11. print push warnings without rolling back the local session

### 6.2 `dojo session resume <session-id>`

This command restores a previously defined session.

Required behavior:

1. run strict preflight
2. verify all required repos and target branches are available
3. switch workspace root to the session root branch
4. switch bound repos to their session target branches
5. switch all unbound repos to baseline branches
6. mark the target session active only after switching succeeds
7. regenerate commands and context

If any required switch fails, the session must not become active.

### 6.3 `dojo session clear`

This command exits the current session and returns the workspace to no-session.

Required behavior:

1. run strict preflight
2. suspend the current session if one is active
3. switch workspace root to the baseline branch
4. switch all registered repos to their baseline branches
5. set `active_session = null`
6. regenerate commands and no-session context

This is the canonical way to return to the non-session working mode.

### 6.4 `dojo session update <session-id>`

This command modifies an existing session definition.

Required behavior:

- add repo bindings
- remove repo bindings
- change target branch for a bound repo
- change root branch for the session

This command is required because session scope must remain flexible after creation.

### 6.5 `dojo session list`

This command lists sessions and their health summaries.

It should show at least:

- session id
- status
- description
- bound repo count
- whether the session is aligned, drifted, or blocked

### 6.6 `dojo session status [session-id]`

This command is the main observability surface.

It should show:

- current active session
- target session metadata
- root expected branch vs current branch
- each repo expected branch vs current branch
- dirty state
- missing repo / missing branch / detached HEAD
- overall health summary

### 6.7 `dojo status`

This command shows the whole workspace state from the current moment, independent of whether the user asks about one session or not.

It should show:

- whether the workspace is in session or no-session mode
- current root branch
- all registered repos
- current branch per repo
- baseline branch per repo
- whether each repo is currently bound by the active session
- whether actual state matches expected state

### 6.8 `dojo start`

This command must work in both session and no-session mode.

Rules:

- if a session is active, Dojo verifies the active session is aligned before starting the tool
- if no session is active, Dojo verifies the workspace is aligned to baseline before starting the tool
- dirty worktrees alone must not block `dojo start`
- branch/layout misalignment must still block `dojo start`, even when the worktree is dirty
- on misalignment, Dojo refuses to start and instructs the user to run `dojo status` or `dojo session status`

## 7. Switching Safety Rules

Switching commands are:

- `dojo session new`
- `dojo session resume`
- `dojo session clear`
- `dojo session update` when it implies branch changes

These commands must block on:

1. uncommitted changes in workspace root
2. uncommitted changes in any registered repo
3. missing registered repo path
4. detached HEAD in workspace root
5. detached HEAD in any registered repo
6. missing required branch for resume
7. impossible branch creation plan

Default policy:

- switching checks all registered repos, not only the switch target subset

This is intentionally strict. The workspace must be safe as a whole before branch switching begins.

## 8. Root Branch Rules

Workspace root is part of session switching.

Why:

- the workspace root contains shared documentation and runtime assets
- users may need to commit root-level docs and Dojo assets as part of a work item
- pushing directly from root baseline to remote is not acceptable for feature work

Therefore:

- active session => root uses the session root branch
- no session => root uses baseline branch, default `main`

## 9. Repo Scope Rules

### 9.1 Bound Repo

A bound repo is a repo explicitly included in the session.

When the session is active, this repo must be on its session target branch.

### 9.2 Unbound Repo

An unbound repo is any registered repo not explicitly included in the session.

When the session is active, this repo must be on its baseline branch.

This rule is required to prevent hidden carry-over from previously active sessions.

## 10. Automatic Push Rules

Automatic push remains enabled during `dojo session new`.

Rules:

1. local session activation is the correctness boundary
2. remote push is best-effort
3. push failure must not roll back a successful local activation
4. Dojo must print a clear warning summary for failed pushes
5. status surfaces should make it obvious when a local branch may not yet have a remote upstream

This keeps the workflow convenient without letting remote connectivity failures block local progress.

## 11. Context and Command Generation

Dojo still generates:

- rendered commands
- `.dojo/context.md`

But the context must now clearly reflect workspace state:

- active session or no-session
- root branch status
- repo branch status
- drift/health summary

In no-session mode, context must not be blank. It should say clearly:

- no active session
- workspace is on baseline branches
- session-bound artifacts are not active

## 12. Repo Management Expectations

Repo management must support session correctness.

Required product rules:

- removing a repo that is still referenced by a session must be blocked
- repo sync operations must not silently disturb active session branches
- users must be able to inspect repo state without guessing

## 13. Non-Goals

This redesign does not aim to:

- support partial or ambiguous switching when the workspace is dirty
- infer session intent from current branch names
- silently auto-heal broken workspace state
- optimize for bypassing safety checks

## 14. Acceptance Criteria

The redesign is successful only if all of these are true:

1. a session can bind only the repos it needs
2. different repos in one session can use different branches
3. switching is blocked whenever the workspace is unsafe
4. no-session is an explicit, usable, startable workspace state
5. workspace root participates in session switching and returns to baseline in no-session
6. a failed repo checkout cannot leave the target session falsely marked active
7. users can always inspect real vs expected state through `dojo status` and `dojo session status`
8. automatic push remains available but push failures only produce warnings

## 15. Example

Workspace baseline:

- root: `main`
- `svc-api`: `main`
- `web-app`: `main`
- `infra`: `master`

Session `user-auth`:

- root -> `feature/user-auth`
- `svc-api` -> `feature/user-auth-api`
- `web-app` -> `feat/login-ui`

When `user-auth` is active:

- root is on `feature/user-auth`
- `svc-api` is on `feature/user-auth-api`
- `web-app` is on `feat/login-ui`
- `infra` is on `master`

When `dojo session clear` runs successfully:

- root returns to `main`
- `svc-api` returns to `main`
- `web-app` returns to `main`
- `infra` returns to `master`
- `active_session = null`
