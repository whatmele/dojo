# Dojo Session and Workspace State Technical Design

## 1. Scope

This document defines the implementation plan for the new session/workspace state model.

This design assumes:

- no legacy migration work is required
- workspace root participates in session switching
- no-session is a first-class runtime state
- switching must be fail-closed
- automatic push after session creation remains enabled and best-effort

## 2. Final Design Decisions

### 2.1 Baseline Model

The workspace always has a deterministic baseline:

- workspace root baseline branch, default `main`
- each repo baseline branch from `RepoConfig.default_branch`

### 2.2 No-Session Model

No-session is represented as:

- `workspaceState.active_session = null`

Expected no-session state:

- workspace root on baseline branch
- all registered repos on baseline branch

### 2.3 Active Session Model

An active session defines:

- one root branch for the workspace repo
- zero or more repo bindings

Derived rule:

- bound repos => session target branch
- unbound repos => baseline branch

This rule makes every session resolve to a complete workspace target state.

## 3. Data Model

### 3.1 Workspace Config

`WorkspaceConfig` should be extended with runtime settings:

```ts
export interface WorkspaceConfig {
  workspace: {
    name: string;
    description: string;
  };
  agents: AgentTool[];
  agent_commands?: Partial<Record<AgentTool, string>>;
  repos: RepoConfig[];
  context?: ContextConfig;
  runtime?: RuntimeConfig;
}

export interface RuntimeConfig {
  workspace_root?: {
    default_branch: string; // default: main
  };
  switch_guard?: {
    clean_policy: 'all-registered';
  };
  remote?: {
    auto_push_on_session_create: boolean; // default: true
  };
}
```

Why:

- root baseline branch must be explicit
- clean policy must be explicit
- auto-push behavior must be explicit

### 3.2 Repo Config

Existing repo config remains structurally valid:

```ts
export interface RepoConfig {
  name: string;
  type: RepoType;
  git: string;
  path: string;
  default_branch: string;
  description: string;
}
```

### 3.3 Workspace State

Workspace state remains simple:

```ts
export interface WorkspaceState {
  active_session: string | null;
}
```

### 3.4 Session State

Replace the current branch map model with explicit bindings:

```ts
export interface SessionState {
  id: string;
  description: string;
  external_link?: string;
  created_at: string;
  updated_at: string;
  status: 'active' | 'suspended' | 'completed';
  workspace_root: SessionWorkspaceRootBinding;
  repos: SessionRepoBinding[];
}

export interface SessionWorkspaceRootBinding {
  target_branch: string;
  base_branch: string;
  branch_source: 'existing' | 'created';
}

export interface SessionRepoBinding {
  repo: string;
  path_snapshot: string;
  target_branch: string;
  base_branch: string;
  branch_source: 'existing' | 'created';
}
```

Key point:

- `repos` is explicit session scope
- repo binding stores enough information for diagnosis and recreation
- `updated_at` supports status display and future tooling

## 4. Derived Target State

Introduce a unified computed target state for both session and no-session.

```ts
export interface WorkspaceTargetState {
  mode: 'session' | 'no-session';
  session_id: string | null;
  root: {
    expected_branch: string;
  };
  repos: Array<{
    repo: string;
    path: string;
    expected_branch: string;
    source: 'session' | 'baseline';
  }>;
}
```

### 4.1 Target State Resolution

For `mode = no-session`:

- root expected branch = `runtime.workspace_root.default_branch ?? 'main'`
- each repo expected branch = `repo.default_branch`

For `mode = session`:

- root expected branch = `session.workspace_root.target_branch`
- if repo is bound in `session.repos`, expected branch = binding.target_branch
- otherwise expected branch = repo.default_branch

This single resolver must be used by:

- `session resume`
- `session clear`
- `status`
- `session status`
- `start`
- context generation

## 5. Observed State Model

Introduce read-only git observation structures.

```ts
export interface ObservedGitState {
  exists: boolean;
  is_git_repo: boolean;
  current_branch: string | null;
  dirty: boolean;
  detached: boolean;
  has_upstream: boolean | null;
}

export interface ObservedWorkspaceState {
  root: ObservedGitState;
  repos: Record<string, ObservedGitState>;
}
```

Observation rules:

- `exists = false` if path is missing
- `is_git_repo = false` if path exists but has no git data
- `current_branch = null` on failure or detached HEAD
- `dirty = true` if status is not clean
- `has_upstream` is optional but useful for push warnings

## 6. Reconciliation Model

Reconciliation compares target state with observed state.

```ts
export type ReconcileStatus =
  | 'aligned'
  | 'branch-mismatch'
  | 'dirty'
  | 'missing-repo'
  | 'missing-branch'
  | 'not-git'
  | 'detached-head';

export interface ReconciledItem {
  name: string;
  expected_branch: string;
  current_branch: string | null;
  dirty: boolean;
  status: ReconcileStatus;
}

export interface WorkspaceReconciliation {
  mode: 'session' | 'no-session';
  session_id: string | null;
  overall: 'aligned' | 'drifted' | 'blocked';
  root: ReconciledItem;
  repos: ReconciledItem[];
  blocking_issues: string[];
}
```

Rules:

- `aligned`: everything matches target and is clean
- `drifted`: state exists but does not match target
- `blocked`: switching or start must not proceed

`blocked` should be used for:

- dirty
- missing repo
- detached head
- not-git
- missing required branch during planned switch

## 7. New Core Modules

Add the following modules:

- `src/core/baseline.ts`
  - resolve root baseline branch
  - resolve repo baseline branches
- `src/core/target-state.ts`
  - build `WorkspaceTargetState` from session or no-session
- `src/core/repo-observer.ts`
  - observe current git state for root and repos
- `src/core/session-reconciler.ts`
  - compare target vs observed
- `src/core/switch-planner.ts`
  - produce switch plan and blocking issues
- `src/core/switch-executor.ts`
  - execute checkout/create/push flows and state writes
- `src/core/session-mutator.ts`
  - create/update/clear session definitions

## 8. Command Surface

### 8.1 `dojo session new`

Implementation behavior:

1. collect session metadata
2. collect root branch config
3. collect bound repos and per-repo branch config
4. build switch target state for the new session
5. run `switch-planner`
6. if planner has blocking issues, fail without state mutation
7. create local branches where `branch_source = created`
8. execute switch to target state
9. write session state and set active session
10. regenerate commands and context
11. run best-effort push for root and bound repos
12. print push summary

### 8.2 `dojo session resume <id>`

Implementation behavior:

1. load session state
2. resolve session target state
3. run `switch-planner`
4. fail if any blocking issue exists
5. execute switch
6. update session status to `active`
7. set previous active session to `suspended`
8. write workspace state
9. regenerate commands and context

Important:

- no state write before switch success
- no partial-success activation

### 8.3 `dojo session clear`

Implementation behavior:

1. resolve no-session target state
2. run `switch-planner`
3. fail if blocked
4. execute switch to baseline state
5. suspend current session if needed
6. set `active_session = null`
7. regenerate commands and context in no-session mode

### 8.4 `dojo session update <id>`

Implementation behavior:

- modify session definition only when no branch change is requested
- when branch change is requested and target session is active, use planner/executor
- when branch change is requested and target session is inactive, rewrite definition only

### 8.5 `dojo session list`

Implementation behavior:

- read all sessions
- compute lightweight health summary for each one when feasible
- print compact overview

### 8.6 `dojo session status [id]`

Implementation behavior:

- if `id` omitted, use active session when present
- build target state for requested session
- observe current workspace
- reconcile and print detailed table

### 8.7 `dojo status`

Implementation behavior:

- if active session exists, reconcile against that session target state
- if no active session, reconcile against no-session target state
- print workspace-wide view

### 8.8 `dojo start`

Implementation behavior:

1. detect active session or no-session
2. reconcile current workspace against expected target state
3. fail if overall state is not `aligned`
4. regenerate commands and context
5. launch tool

This makes `start` a guarded entry point instead of a blind launcher.

## 9. Switch Planner

The planner produces a declarative execution plan.

```ts
export type SwitchActionType =
  | 'checkout-existing'
  | 'create-from-base'
  | 'checkout-tracking-remote'
  | 'noop';

export interface SwitchAction {
  scope: 'root' | 'repo';
  repo?: string;
  path: string;
  target_branch: string;
  base_branch?: string;
  action: SwitchActionType;
}

export interface SwitchPlan {
  mode: 'session' | 'no-session';
  session_id: string | null;
  actions: SwitchAction[];
  blocking_issues: string[];
  warnings: string[];
}
```

### 9.1 Planner Rules

The planner must:

- examine root and all registered repos
- reject dirty state anywhere
- reject missing repo path
- reject detached HEAD
- compute target branch for every repo
- decide whether each target requires:
  - checkout existing local branch
  - create from base
  - checkout tracking remote
  - noop

### 9.2 Resume Rules

For session resume:

- local target branch exists => checkout
- local target branch missing but matching remote branch exists => create tracking branch then checkout
- target branch missing everywhere => block

### 9.3 New Session Rules

For session creation:

- bindings marked `created` => branch must be creatable from declared base
- bindings marked `existing` => target branch must already exist locally or remotely
- root branch follows the same rule set

## 10. Switch Executor

The executor consumes `SwitchPlan` and applies it.

### 10.1 Execution Boundary

Correctness boundary:

- local branch creation and checkout
- workspace/session state writes
- command/context regeneration

Non-correctness boundary:

- remote push

### 10.2 Execution Rules

1. validate `blocking_issues.length === 0`
2. snapshot pre-switch branches for rollback
3. execute actions in deterministic order:
   - root first
   - repos in sorted config order
4. if any action fails:
   - attempt rollback to pre-switch branches
   - do not write new active session state
   - do not regenerate context for the failed target
   - return failure summary
5. after all actions succeed:
   - write session/workspace state
   - regenerate commands and context
6. after local activation succeeds:
   - best-effort push root and bound repos when enabled

### 10.3 Rollback Policy

Rollback is best-effort, but Dojo must still guarantee:

- target session is not marked active on failed switch
- context is not regenerated for the failed target

Even if rollback partially fails, the resulting state is surfaced as failed and explicit.

## 11. Push Behavior

Automatic push applies only to `dojo session new` by default.

Suggested implementation:

- push root session branch
- push each bound repo branch
- use `--set-upstream` on first push
- collect failures into a warning summary

Push failure must:

- not revert local branch creation
- not revert active session state
- not block command/context generation

Optional future enhancement:

- include upstream/tracking info in status surfaces

## 12. Context Generation Changes

`context-generator` must stop presenting only declared branch state.

Context header should include:

- mode: session or no-session
- active session id or explicit no-session text
- root expected/current branch and health
- repo summary table with:
  - repo
  - expected branch
  - current branch
  - dirty
  - status

In no-session mode, context should still be generated and should state:

- there is no active session
- workspace baseline is active
- session artifacts are not currently in focus

## 13. Command Distribution Changes

Existing session/no-session template rendering model remains valid.

Changes:

- no-session becomes a normal supported mode, not just an absence path
- mixed/workspace templates continue to render in no-session mode
- session-bound templates are not materialized into agent command directories in no-session mode
- Dojo only cleans up its own `dojo-*` generated command files and managed skill mirrors; user-managed `.agents/*` content must remain untouched

No large protocol changes are required here.

## 14. Repo Command Changes

### 14.1 `dojo repo remove`

Before removal:

- scan all sessions for references to the repo
- reject removal if any active/suspended/completed session still references it
- require explicit session update first

### 14.2 `dojo repo sync`

Current blind pull behavior should be replaced or narrowed.

Recommended behavior:

- `dojo repo fetch [repo]` => safe remote fetch only
- `dojo repo sync [repo]` => fast-forward baseline branch only, only when workspace is in no-session or repo is already on baseline and clean

### 14.3 `dojo repo add`

When the user chooses a repo baseline branch during repo registration:

- the selected branch must already exist locally or remotely
- Dojo must align the repo working tree to that branch immediately
- config state and observed repo branch must match before repo registration completes

The same rule applies to repo registration inside `dojo create` / `dojo init`.

This prevents accidental mutation of active session branches.

## 15. File Impact

Primary files to change:

- `src/types.ts`
- `src/core/state.ts`
- `src/core/workspace.ts`
- `src/core/git.ts`
- `src/core/context-generator.ts`
- `src/commands/session.ts`
- `src/commands/repo.ts`
- `src/commands/start.ts`
- `src/commands/context.ts`
- `bin/dojo.ts`

New files:

- `src/core/baseline.ts`
- `src/core/target-state.ts`
- `src/core/repo-observer.ts`
- `src/core/session-reconciler.ts`
- `src/core/switch-planner.ts`
- `src/core/switch-executor.ts`
- `src/core/session-mutator.ts`
- `src/commands/status.ts`

## 16. Testing Plan

Add new test groups:

- `tests/core/target-state.test.ts`
- `tests/core/repo-observer.test.ts`
- `tests/core/session-reconciler.test.ts`
- `tests/core/switch-planner.test.ts`
- `tests/core/switch-executor.test.ts`
- `tests/commands/session-status.test.ts`
- `tests/commands/status.test.ts`

Required scenarios:

1. no-session target state resolves correctly
2. active session target state resolves correctly
3. unbound repos map to baseline branches
4. dirty root blocks switch
5. dirty unrelated repo blocks switch
6. detached HEAD blocks switch
7. missing repo path blocks switch
8. resume fails when target branch is missing
9. failed switch does not mark target session active
10. successful `session clear` returns all repos to baseline
11. `start` refuses to launch from drifted workspace state
12. auto-push warning does not invalidate successful local session activation

## 17. Implementation Order

Recommended order:

1. state model and baseline resolution
2. observed state and reconciliation
3. `session status` and `dojo status`
4. switch planner
5. switch executor
6. rewrite `session new`, `resume`, `clear`
7. upgrade context generation
8. guard `start`
9. refine repo commands

This order delivers observability before mutation, then makes switching safe, then improves workflow ergonomics.

## 18. Summary

This redesign turns Dojo session management into a strict control plane:

- every workspace mode has one deterministic target branch layout
- every switch is planned before execution
- every important failure blocks activation
- no-session is fully supported
- root-level documentation work is compatible with feature branches
- repo participation stays flexible without sacrificing safety
