import path from 'node:path';
import { Command } from 'commander';
import { checkbox, confirm, input } from '@inquirer/prompts';
import type { SessionRepoBinding, SessionState, WorkspaceConfig } from '../types.js';
import { readConfig } from '../core/config.js';
import {
  getActiveSession,
  listSessions,
  readSessionState,
  sessionExists,
  writeSessionState,
  writeWorkspaceState,
} from '../core/state.js';
import { getSessionDir, findWorkspaceRoot, resolveRepoPath } from '../core/workspace.js';
import { getWorkspaceRootBaselineBranch } from '../core/baseline.js';
import { normalizeSessionState } from '../core/target-state.js';
import { planWorkspaceSwitch } from '../core/switch-planner.js';
import { executeSwitchPlan } from '../core/switch-executor.js';
import { distributeCommands } from '../core/command-distributor.js';
import { generateContext } from '../core/context-generator.js';
import { pushBranch } from '../core/git.js';
import { observeWorkspaceState } from '../core/repo-observer.js';
import { ensureDir, fileExists, listDirs, readJSON } from '../utils/fs.js';
import { log, printBanner } from '../utils/logger.js';
import { promptBranchPlan } from './branch-prompts.js';

async function checkAllTasksDone(root: string, sessionId: string): Promise<boolean> {
  const tasksDir = path.join(root, '.dojo', 'sessions', sessionId, 'tasks');
  const tasks = listDirs(tasksDir);
  if (tasks.length === 0) return false;
  for (const task of tasks) {
    const statePath = path.join(tasksDir, task, 'state.json');
    if (!fileExists(statePath)) return false;
    const state = readJSON<{ is_completed: boolean }>(statePath);
    if (!state.is_completed) return false;
  }
  return true;
}

async function nextStatusForLeavingSession(root: string, current: SessionState): Promise<'suspended' | 'completed'> {
  if (current.status !== 'active') {
    return current.status === 'completed' ? 'completed' : 'suspended';
  }

  const allTasksDone = await checkAllTasksDone(root, current.id);
  if (!allTasksDone) {
    return 'suspended';
  }

  const markComplete = await confirm({
    message: `All tasks in session "${current.id}" are done. Mark it completed before switching away?`,
    default: true,
  });

  return markComplete ? 'completed' : 'suspended';
}

function ensureSessionDirectories(root: string, sessionId: string): void {
  const sessionDir = getSessionDir(root, sessionId);
  ensureDir(path.join(sessionDir, 'product-requirements'));
  ensureDir(path.join(sessionDir, 'research'));
  ensureDir(path.join(sessionDir, 'tech-design'));
  ensureDir(path.join(sessionDir, 'tasks'));
}

function toCompatibilityBranchMap(bindings: SessionRepoBinding[]): Record<string, string> {
  return Object.fromEntries(bindings.map((binding) => [binding.repo, binding.target_branch]));
}

async function promptSessionState(
  root: string,
  config: WorkspaceConfig,
  options: {
    existing?: SessionState | null;
  } = {},
): Promise<SessionState> {
  const existing = options.existing ? normalizeSessionState(options.existing, config) : null;

  const id = existing
    ? existing.id
    : await input({
      message: 'Session ID (kebab-case):',
      validate: (v: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) || 'Use kebab-case',
    });

  const description = await input({
    message: 'Session description:',
    default: existing?.description,
  });
  const externalLink = await input({
    message: 'External link (optional):',
    default: existing?.external_link ?? '',
  });

  const rootBranchPlan = await promptBranchPlan('Workspace root', {
    repoPath: root,
    defaultCreatedTarget: existing?.workspace_root?.target_branch ?? `feature/${id}`,
    defaultExistingTarget: existing?.workspace_root?.target_branch ?? getWorkspaceRootBaselineBranch(config),
    defaultBase: existing?.workspace_root?.base_branch ?? getWorkspaceRootBaselineBranch(config),
    defaultSource: existing?.workspace_root?.branch_source ?? 'created',
  });

  const selectedRepos = await checkbox({
    message: 'Repositories in this session:',
    choices: config.repos.map((repo) => ({
      name: `${repo.name} (${repo.type})`,
      value: repo.name,
      checked: Boolean(existing?.repos?.some((binding) => binding.repo === repo.name)),
    })),
  });

  const repos: SessionRepoBinding[] = [];
  for (const repoName of selectedRepos) {
    const repo = config.repos.find((item) => item.name === repoName);
    if (!repo) continue;
    const existingBinding = existing?.repos?.find((binding) => binding.repo === repoName);
    const branchPlan = await promptBranchPlan(`Repo ${repoName}`, {
      repoPath: resolveRepoPath(root, repo.path),
      defaultCreatedTarget: existingBinding?.target_branch ?? `feature/${id}`,
      defaultExistingTarget: existingBinding?.target_branch ?? repo.default_branch,
      defaultBase: existingBinding?.base_branch ?? repo.default_branch,
      defaultSource: existingBinding?.branch_source ?? 'created',
    });
    repos.push({
      repo: repoName,
      path_snapshot: repo.path,
      ...branchPlan,
    });
  }

  const createdAt = existing?.created_at ?? new Date().toISOString();
  const updatedAt = new Date().toISOString();

  return {
    id,
    description,
    ...(externalLink.trim() ? { external_link: externalLink.trim() } : {}),
    created_at: createdAt,
    updated_at: updatedAt,
    status: existing?.status ?? 'active',
    workspace_root: rootBranchPlan,
    repos,
    workspace_branch: rootBranchPlan.target_branch,
    repo_branches: toCompatibilityBranchMap(repos),
  };
}

function summarizePushError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => !/^fatal:/i.test(line) && !/^error:/i.test(line))
    ?? (error instanceof Error ? error.message : String(error));

  if (/does not appear to be a git repository|无法读取远程仓库|Could not read from remote repository/i.test(message)) {
    return 'remote "origin" is unavailable or not configured';
  }

  if (/set[- ]upstream|have no upstream/i.test(message)) {
    return 'upstream branch is not configured';
  }

  return message;
}

function describeObservedIssue(label: string, issue: string): string {
  switch (issue) {
    case 'missing repo path':
      return `${label}: repo path is missing on disk`;
    case 'not a git repository':
      return `${label}: path exists but is not a Git repository`;
    case 'detached HEAD':
      return `${label}: HEAD is detached`;
    case 'uncommitted changes':
      return `${label}: uncommitted changes`;
    default:
      return `${label}: ${issue}`;
  }
}

async function ensureWorkspaceReadyForSwitch(root: string, config: WorkspaceConfig): Promise<void> {
  const observed = await observeWorkspaceState(root, config);
  const issues: string[] = [];

  const collect = (label: string, item: typeof observed.root): void => {
    if (!item.exists) {
      issues.push(describeObservedIssue(label, 'missing repo path'));
      return;
    }
    if (!item.is_git_repo) {
      issues.push(describeObservedIssue(label, 'not a git repository'));
      return;
    }
    if (item.detached) {
      issues.push(describeObservedIssue(label, 'detached HEAD'));
      return;
    }
    if (item.dirty) {
      issues.push(describeObservedIssue(label, 'uncommitted changes'));
    }
  };

  collect('workspace-root', observed.root);
  for (const repo of config.repos) {
    collect(repo.name, observed.repos[repo.name]);
  }

  if (issues.length === 0) {
    return;
  }

  log.error('Workspace is not ready to switch sessions yet.');
  for (const issue of issues) {
    log.error(`  - ${issue}`);
  }
  log.info('Recover first: commit, stash, or discard local changes; re-clone missing repos; and exit detached HEAD before switching.');
  process.exit(1);
}

function printPlanIssues(plan: Awaited<ReturnType<typeof planWorkspaceSwitch>>): void {
  log.error('Workspace switch blocked.');
  for (const issue of plan.blocking_issues) {
    log.error(`  - ${issue}`);
  }
  if (plan.warnings.length > 0) {
    for (const warning of plan.warnings) {
      log.warn(`  - ${warning}`);
    }
  }
  log.info('Fix the blocking branches above, then rerun the command. Existing mode requires the branch to exist; create mode requires a new branch name.');
}

async function writeActivationState(
  root: string,
  config: WorkspaceConfig,
  options: {
    nextSession: SessionState | null;
    previousSession: SessionState | null;
    previousStatus?: 'suspended' | 'completed';
  },
): Promise<void> {
  const { nextSession, previousSession, previousStatus } = options;

  if (previousSession && (!nextSession || previousSession.id !== nextSession.id)) {
    writeSessionState(root, previousSession.id, {
      ...previousSession,
      updated_at: new Date().toISOString(),
      status: previousStatus ?? 'suspended',
    });
  }

  if (nextSession) {
    writeSessionState(root, nextSession.id, {
      ...nextSession,
      updated_at: new Date().toISOString(),
      status: 'active',
    });
  }

  writeWorkspaceState(root, {
    active_session: nextSession?.id ?? null,
  });

  await distributeCommands(root, nextSession?.id ?? null, config.agents);
  await generateContext(root, nextSession, config);
}

async function pushSessionBranches(
  root: string,
  config: WorkspaceConfig,
  session: SessionState,
): Promise<void> {
  if (config.runtime?.remote?.auto_push_on_session_create === false) {
    return;
  }

  const normalized = normalizeSessionState(session, config);
  const warnings: string[] = [];

  try {
    await pushBranch(root, normalized.workspace_root!.target_branch);
    log.success(`workspace-root: pushed ${normalized.workspace_root!.target_branch}`);
  } catch (error: unknown) {
    warnings.push(`workspace-root: ${summarizePushError(error)}`);
  }

  for (const binding of normalized.repos ?? []) {
    const repo = config.repos.find((item) => item.name === binding.repo);
    if (!repo) continue;
    try {
      await pushBranch(resolveRepoPath(root, repo.path), binding.target_branch);
      log.success(`${binding.repo}: pushed ${binding.target_branch}`);
    } catch (error: unknown) {
      warnings.push(`${binding.repo}: ${summarizePushError(error)}`);
    }
  }

  if (warnings.length > 0) {
    log.warn('Local session is active, but some branches were not pushed:');
    for (const warning of warnings) {
      log.warn(`  - ${warning}`);
    }
  }
}

export function registerSessionCommand(program: Command): void {
  const session = program
    .command('session')
    .description('Development session management');

  const switchToNoSession = async (): Promise<void> => {
    const root = findWorkspaceRoot();
    const config = readConfig(root);
    const previous = getActiveSession(root);
    await ensureWorkspaceReadyForSwitch(root, config);
    const nextStatus = previous ? await nextStatusForLeavingSession(root, previous) : undefined;
    const plan = await planWorkspaceSwitch(root, config, null);
    if (plan.blocking_issues.length > 0) {
      printPlanIssues(plan);
      process.exit(1);
    }

    log.step('Switching workspace to no-session baseline...');
    const execution = await executeSwitchPlan(plan);
    if (!execution.success) {
      log.error(`Failed to clear active session: ${execution.error ?? 'unknown error'}`);
      process.exit(1);
    }

    await writeActivationState(root, config, {
      nextSession: null,
      previousSession: previous,
      previousStatus: nextStatus,
    });

    log.success('Workspace returned to no-session baseline mode.');
  };

  session
    .command('new')
    .description('Create a new dev session')
    .option('--force', 'Deprecated: switching is always fail-closed')
    .action(async () => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const previous = getActiveSession(root);

      printBanner();
      console.log();

      await ensureWorkspaceReadyForSwitch(root, config);
      const nextStatus = previous ? await nextStatusForLeavingSession(root, previous) : undefined;
      const proposed = await promptSessionState(root, config);

      if (sessionExists(root, proposed.id)) {
        log.error(`Session "${proposed.id}" already exists. Run: dojo session resume ${proposed.id}`);
        process.exit(1);
      }

      ensureSessionDirectories(root, proposed.id);
      const plan = await planWorkspaceSwitch(root, config, proposed);
      if (plan.blocking_issues.length > 0) {
        printPlanIssues(plan);
        process.exit(1);
      }

      log.step('Switching workspace into the new session...');
      const execution = await executeSwitchPlan(plan);
      if (!execution.success) {
        log.error(`Failed to activate session "${proposed.id}": ${execution.error ?? 'unknown error'}`);
        process.exit(1);
      }

      await writeActivationState(root, config, {
        nextSession: proposed,
        previousSession: previous,
        previousStatus: nextStatus,
      });
      await pushSessionBranches(root, config, proposed);

      log.success(`Session "${proposed.id}" created and active.`);
      log.info('Run dojo start to launch your AI tool.');
    });

  session
    .command('resume <session-id>')
    .description('Resume an existing session')
    .option('--force', 'Deprecated: switching is always fail-closed')
    .action(async (sessionId: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const previous = getActiveSession(root);

      if (!sessionExists(root, sessionId)) {
        log.error(`Session "${sessionId}" does not exist.`);
        const sessions = listSessions(root);
        if (sessions.length > 0) {
          log.info('Available sessions:');
          for (const item of sessions) {
            log.info(`  ${item.id} [${item.status}] — ${item.description}`);
          }
        }
        process.exit(1);
      }

      await ensureWorkspaceReadyForSwitch(root, config);
      const nextStatus = previous && previous.id !== sessionId
        ? await nextStatusForLeavingSession(root, previous)
        : undefined;
      const target = normalizeSessionState(readSessionState(root, sessionId), config);
      const plan = await planWorkspaceSwitch(root, config, target);
      if (plan.blocking_issues.length > 0) {
        printPlanIssues(plan);
        process.exit(1);
      }

      log.step(`Resuming session "${sessionId}"...`);
      const execution = await executeSwitchPlan(plan);
      if (!execution.success) {
        log.error(`Failed to resume session "${sessionId}": ${execution.error ?? 'unknown error'}`);
        process.exit(1);
      }

      await writeActivationState(root, config, {
        nextSession: target,
        previousSession: previous && previous.id !== target.id ? previous : null,
        previousStatus: nextStatus,
      });

      log.success(`Session "${sessionId}" resumed and active.`);
    });

  session
    .command('none')
    .description('Return the workspace to no-session baseline mode')
    .action(switchToNoSession);

  session
    .command('clear')
    .description('Alias of "dojo session none"')
    .action(switchToNoSession);

  session
    .command('exit')
    .description('Alias of "dojo session none"')
    .action(switchToNoSession);

  session
    .command('update <session-id>')
    .description('Update session bindings and branches')
    .action(async (sessionId: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);

      if (!sessionExists(root, sessionId)) {
        log.error(`Session "${sessionId}" does not exist.`);
        process.exit(1);
      }

      const existing = normalizeSessionState(readSessionState(root, sessionId), config);
      const updated = await promptSessionState(root, config, { existing });
      ensureSessionDirectories(root, updated.id);

      const active = getActiveSession(root);
      if (active?.id === sessionId) {
        await ensureWorkspaceReadyForSwitch(root, config);
        const plan = await planWorkspaceSwitch(root, config, updated);
        if (plan.blocking_issues.length > 0) {
          printPlanIssues(plan);
          process.exit(1);
        }

        log.step(`Updating active session "${sessionId}"...`);
        const execution = await executeSwitchPlan(plan);
        if (!execution.success) {
          log.error(`Failed to update active session "${sessionId}": ${execution.error ?? 'unknown error'}`);
          process.exit(1);
        }

        await writeActivationState(root, config, {
          nextSession: updated,
          previousSession: null,
        });
        log.success(`Session "${sessionId}" updated.`);
        return;
      }

      writeSessionState(root, sessionId, {
        ...updated,
        status: existing.status,
      });
      log.success(`Session "${sessionId}" updated.`);
    });
}
