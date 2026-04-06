import { Command } from 'commander';
import path from 'node:path';
import { input, checkbox, confirm, select } from '@inquirer/prompts';
import type { SessionState } from '../types.js';
import { findWorkspaceRoot } from '../core/workspace.js';
import { readConfig } from '../core/config.js';
import {
  readWorkspaceState, writeWorkspaceState,
  getActiveSession, readSessionState, writeSessionState,
  sessionExists, listSessions,
} from '../core/state.js';
import { checkWorkspaceClean, getSessionDir } from '../core/workspace.js';
import { createBranch, createBranchFrom, pushBranch, checkoutBranch, listBranches } from '../core/git.js';
import { generateContext } from '../core/context-generator.js';
import { distributeCommands } from '../core/command-distributor.js';
import { ensureDir } from '../utils/fs.js';
import { log, printBanner } from '../utils/logger.js';

async function suspendCurrentSession(root: string): Promise<void> {
  const current = getActiveSession(root);
  if (!current) return;

  const allTasksDone = await checkAllTasksDone(root, current.id);
  if (allTasksDone && current.status === 'active') {
    const markComplete = await confirm({
      message: `All tasks in session "${current.id}" are done. Mark it completed?`,
      default: true,
    });
    if (markComplete) {
      current.status = 'completed';
      writeSessionState(root, current.id, current);
      log.success(`Session "${current.id}" marked completed.`);
      return;
    }
  }

  if (current.status === 'active') {
    current.status = 'suspended';
    writeSessionState(root, current.id, current);
    log.step(`Session "${current.id}" suspended.`);
  }
}

async function checkAllTasksDone(root: string, sessionId: string): Promise<boolean> {
  const { listDirs, fileExists, readJSON } = await import('../utils/fs.js');
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

async function warnIfDirty(root: string): Promise<boolean> {
  const config = readConfig(root);
  const session = getActiveSession(root);
  const { clean, dirtyRepos } = await checkWorkspaceClean(root, session, config);

  if (!clean) {
    log.warn('Uncommitted changes in:');
    for (const r of dirtyRepos) {
      log.warn(`  - ${r}`);
    }
    const proceed = await confirm({
      message: 'Continue anyway?',
      default: false,
    });
    return proceed;
  }
  return true;
}

export function registerSessionCommand(program: Command): void {
  const session = program
    .command('session')
    .description('Development session management');

  session
    .command('new')
    .description('Create a new dev session')
    .option('--force', 'Skip clean-workspace check')
    .action(async (opts: { force?: boolean }) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);

      printBanner();
      console.log();

      if (!opts.force) {
        const proceed = await warnIfDirty(root);
        if (!proceed) return;
      }

      await suspendCurrentSession(root);

      const id = await input({
        message: 'Session ID (kebab-case):',
        validate: (v: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) || 'Use kebab-case',
      });

      if (sessionExists(root, id)) {
        log.error(`Session "${id}" already exists. Run: dojo session resume ${id}`);
        process.exit(1);
      }

      const description = await input({ message: 'Session description:' });
      const externalLink = await input({ message: 'External link (optional):' });

      const repoChoices = config.repos.map(r => ({
        name: `${r.name} (${r.type})`,
        value: r.name,
      }));

      let selectedRepos: string[] = [];
      if (repoChoices.length > 0) {
        selectedRepos = await checkbox({
          message: 'Repositories in this session:',
          choices: repoChoices,
        });
      }

      const branchPattern = await input({
        message: 'New branch name:',
        default: `feature/${id}`,
      });

      // Pick base branch from this repo's branch list
      let baseBranch = 'main';
      try {
        const { current, all } = await listBranches(root);
        if (all.length > 1) {
          baseBranch = await select({
            message: 'Create from which branch?',
            choices: all.map(b => ({
              name: b === current ? `${b} (current)` : b,
              value: b,
            })),
            default: current,
          });
        } else {
          baseBranch = current;
          log.dim(`  Base branch: ${baseBranch}`);
        }
      } catch {
        log.dim(`  Base branch: ${baseBranch} (default)`);
      }

      log.step('Creating branches...');
      const repoBranches: Record<string, string> = {};
      try {
        await createBranchFrom(root, branchPattern, baseBranch);
        log.success(`workspace: created branch ${branchPattern} from ${baseBranch}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`workspace: failed to create branch — ${msg}`);
        process.exit(1);
      }
      for (const repoName of selectedRepos) {
        const repo = config.repos.find(r => r.name === repoName)!;
        const repoPath = path.join(root, repo.path);
        try {
          // Other repos: default to default_branch when it exists
          const repoBase = repo.default_branch ?? baseBranch;
          await createBranchFrom(repoPath, branchPattern, repoBase);
          repoBranches[repoName] = branchPattern;
          log.success(`${repoName}: created branch ${branchPattern} from ${repoBase}`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`${repoName}: failed to create branch — ${msg}`);
          log.error('Stopped creating branches for remaining repos. Fix and retry.');
          process.exit(1);
        }
      }

      // Push branches
      for (const repoName of Object.keys(repoBranches)) {
        const repo = config.repos.find(r => r.name === repoName)!;
        const repoPath = path.join(root, repo.path);
        try {
          await pushBranch(repoPath, branchPattern);
          log.success(`${repoName}: branch pushed`);
        } catch {
          log.warn(`${repoName}: push failed (no remote?), continuing...`);
        }
      }

      log.step('Initializing session directories...');
      const sessionDir = getSessionDir(root, id);
      ensureDir(path.join(sessionDir, 'product-requirements'));
      ensureDir(path.join(sessionDir, 'research'));
      ensureDir(path.join(sessionDir, 'tech-design'));
      ensureDir(path.join(sessionDir, 'tasks'));

      const sessionState: SessionState = {
        id,
        description,
        ...(externalLink ? { external_link: externalLink } : {}),
        created_at: new Date().toISOString(),
        status: 'active',
        workspace_branch: branchPattern,
        repo_branches: repoBranches,
      };
      writeSessionState(root, id, sessionState);
      writeWorkspaceState(root, { active_session: id });

      log.step('Refreshing command stubs and context...');
      distributeCommands(root, id, config.agents);
      await generateContext(root, sessionState, config);

      log.success(`Session "${id}" created and active.`);
      log.info('Run dojo start to launch your AI tool.');
    });

  session
    .command('resume <session-id>')
    .description('Resume an existing session')
    .option('--force', 'Skip clean-workspace check')
    .action(async (sessionId: string, opts: { force?: boolean }) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);

      if (!sessionExists(root, sessionId)) {
        log.error(`Session "${sessionId}" does not exist.`);
        const sessions = listSessions(root);
        if (sessions.length > 0) {
          log.info('Available sessions:');
          for (const s of sessions) {
            log.info(`  ${s.id} [${s.status}] — ${s.description}`);
          }
        }
        process.exit(1);
      }

      if (!opts.force) {
        const proceed = await warnIfDirty(root);
        if (!proceed) return;
      }

      await suspendCurrentSession(root);

      const targetSession = readSessionState(root, sessionId);

      log.step('Checking out branches...');
      if (targetSession.workspace_branch) {
        try {
          await checkoutBranch(root, targetSession.workspace_branch);
          log.success(`workspace: checked out ${targetSession.workspace_branch}`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`workspace: checkout failed — ${msg}`);
        }
      }
      for (const [repoName, branch] of Object.entries(targetSession.repo_branches)) {
        const repo = config.repos.find(r => r.name === repoName);
        if (!repo) {
          log.warn(`Repository "${repoName}" no longer in config, skipping.`);
          continue;
        }
        const repoPath = path.join(root, repo.path);
        try {
          await checkoutBranch(repoPath, branch);
          log.success(`${repoName}: checked out ${branch}`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`${repoName}: checkout failed — ${msg}`);
        }
      }

      targetSession.status = 'active';
      writeSessionState(root, sessionId, targetSession);
      writeWorkspaceState(root, { active_session: sessionId });

      log.step('Refreshing command stubs and context...');
      distributeCommands(root, sessionId, config.agents);
      await generateContext(root, targetSession, config);

      log.success(`Session "${sessionId}" resumed and active.`);
    });
}
