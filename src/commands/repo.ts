import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { select, input, confirm } from '@inquirer/prompts';
import type { RepoType, RepoConfig } from '../types.js';
import { findWorkspaceRoot, resolveRepoPath } from '../core/workspace.js';
import { readConfig, addRepo, removeRepo } from '../core/config.js';
import {
  alignRepoToExistingBranch,
  cloneRepo,
  fetchRemote,
  getCurrentBranch,
  pullCurrent,
  stagePathsAndCommit,
} from '../core/git.js';
import { getActiveSession, listSessions } from '../core/state.js';
import { normalizeSessionState } from '../core/target-state.js';
import { fileExists } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import { promptBranchName } from './branch-prompts.js';

function parseRepoName(gitUrl: string): string {
  const match = gitUrl.match(/\/([^/]+?)(?:\.git)?$/);
  return match ? match[1] : 'unknown-repo';
}

/** Path stored in config: relative to workspace when inside it, else absolute. */
function repoPathForConfig(root: string, absRepoPath: string): string {
  const rel = path.relative(root, absRepoPath);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel;
  }
  return absRepoPath;
}

async function autoCommitWorkspaceConfig(root: string, message: string): Promise<void> {
  try {
    await stagePathsAndCommit(root, ['.dojo/config.json'], message);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn(`Workspace config changed, but Dojo could not auto-commit .dojo/config.json: ${detail}`);
    log.warn('Run `git status` and commit the workspace config before switching sessions.');
  }
}

export function registerRepoCommand(program: Command): void {
  const repo = program
    .command('repo')
    .description('Repository management');

  repo
    .command('add <source>')
    .description('Add a repo (clone Git URL, or use --local for an existing path)')
    .option('--local', 'Treat source as a local directory path (no clone)')
    .action(async (source: string, opts: { local?: boolean }) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);

      if (!opts.local) {
        let parsedName = parseRepoName(source);
        if (parsedName === 'unknown-repo') {
          parsedName = await input({
            message: 'Could not parse repo name from URL; enter a name:',
            validate: (v: string) => (v.trim().length > 0 ? true : 'Name cannot be empty'),
          });
          parsedName = parsedName.trim();
        }
        const name = parsedName;

        const existing = config.repos.find(r => r.name === name);
        if (existing) {
          log.error(`Repository "${name}" is already in this workspace.`);
          process.exit(1);
        }

        const type = await select({
          message: `Repository type (${name}):`,
          choices: [
            { name: 'biz — product / services', value: 'biz' as RepoType },
            { name: 'dev — tooling', value: 'dev' as RepoType },
            { name: 'wiki — knowledge / reference', value: 'wiki' as RepoType },
          ],
        });

        const description = await input({ message: 'Repository description:' });

        const repoPath = `repos/${type}/${name}`;
        const fullPath = path.join(root, repoPath);

        log.step(`Cloning into ${repoPath}...`);
        try {
          await cloneRepo(source, fullPath);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`Clone failed: ${msg}`);
          process.exit(1);
        }

        let defaultBranch: string;
        try {
          defaultBranch = await getCurrentBranch(fullPath);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`Could not detect default branch: ${msg}`);
          process.exit(1);
        }
        defaultBranch = await promptBranchName(`Default branch for ${name}`, {
          defaultValue: defaultBranch,
          repoPath: fullPath,
          requireExisting: true,
          missingMessage: 'Choose an existing local or remote branch for the repository baseline',
        });

        try {
          await alignRepoToExistingBranch(fullPath, defaultBranch);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`Could not align ${name} to baseline branch "${defaultBranch}": ${msg}`);
          process.exit(1);
        }

        const repoConfig: RepoConfig = {
          name,
          type,
          git: source,
          path: repoPath,
          default_branch: defaultBranch,
          description,
        };

        addRepo(root, repoConfig);
        await autoCommitWorkspaceConfig(root, `chore: register repository ${name}`);
        log.success(`Repository "${name}" added to the workspace.`);
        return;
      }

      const fullPath = path.isAbsolute(source)
        ? path.resolve(source)
        : path.resolve(root, source);

      if (!fileExists(fullPath)) {
        log.error(`Path does not exist: ${fullPath}`);
        process.exit(1);
      }
      if (!fileExists(path.join(fullPath, '.git'))) {
        log.error(`Not a Git repository (no .git): ${fullPath}`);
        process.exit(1);
      }

      const name = path.basename(path.resolve(fullPath));
      const gitRef = `local:${fullPath}`;
      const repoPath = repoPathForConfig(root, fullPath);

      const existingLocal = config.repos.find(r => r.name === name);
      if (existingLocal) {
        log.error(`Repository "${name}" is already in this workspace.`);
        process.exit(1);
      }

      let defaultBranch: string;
      try {
        defaultBranch = await getCurrentBranch(fullPath);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`Could not read current branch: ${msg}`);
        process.exit(1);
      }
      defaultBranch = await promptBranchName(`Default branch for ${name}`, {
        defaultValue: defaultBranch,
        repoPath: fullPath,
        requireExisting: true,
        missingMessage: 'Choose an existing local or remote branch for the repository baseline',
      });

      try {
        await alignRepoToExistingBranch(fullPath, defaultBranch);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`Could not align ${name} to baseline branch "${defaultBranch}": ${msg}`);
        process.exit(1);
      }

      const type = await select({
        message: `Repository type (${name}):`,
        choices: [
          { name: 'biz — product / services', value: 'biz' as RepoType },
          { name: 'dev — tooling', value: 'dev' as RepoType },
          { name: 'wiki — knowledge / reference', value: 'wiki' as RepoType },
        ],
      });

      const description = await input({ message: 'Repository description:' });

      const repoConfig: RepoConfig = {
        name,
        type,
        git: gitRef,
        path: repoPath,
        default_branch: defaultBranch,
        description,
      };

      addRepo(root, repoConfig);
      await autoCommitWorkspaceConfig(root, `chore: register repository ${name}`);
      log.success(`Repository "${name}" added to the workspace.`);
    });

  repo
    .command('remove <name>')
    .description('Remove a repository from the workspace')
    .action(async (name: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const repoConfig = config.repos.find(r => r.name === name);
      const referencedBy = listSessions(root)
        .filter((session) => normalizeSessionState(session, config).repos?.some((binding) => binding.repo === name))
        .map((session) => session.id);

      if (!repoConfig) {
        log.error(`Repository "${name}" is not in this workspace.`);
        process.exit(1);
      }

      if (referencedBy.length > 0) {
        log.error(`Repository "${name}" is still referenced by sessions: ${referencedBy.join(', ')}`);
        log.info('Update or remove those session bindings before removing the repo.');
        process.exit(1);
      }

      if (!repoConfig) {
        return; // already checked above, for TS narrowing
      }

      const shouldDelete = await confirm({
        message: `Also delete local directory ${repoConfig.path}?`,
        default: false,
      });

      removeRepo(root, name);
      await autoCommitWorkspaceConfig(root, `chore: remove repository ${name}`);

      if (shouldDelete) {
        const fullPath = resolveRepoPath(root, repoConfig.path);
        if (fs.existsSync(fullPath)) {
          fs.rmSync(fullPath, { recursive: true });
          log.step(`Deleted ${repoConfig.path}`);
        }
      }

      log.success(`Repository "${name}" removed from the workspace.`);
    });

  repo
    .command('fetch [repo-name]')
    .description('Fetch remote refs for one or all repositories')
    .action(async (repoName?: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const repos = repoName
        ? config.repos.filter(r => r.name === repoName)
        : config.repos;

      if (repos.length === 0) {
        log.warn(repoName ? `Repository "${repoName}" not found.` : 'No repositories in this workspace.');
        return;
      }

      for (const repo of repos) {
        const repoPath = resolveRepoPath(root, repo.path);
        if (!fs.existsSync(repoPath)) {
          log.warn(`${repo.name}: local path missing, skipping`);
          continue;
        }
        log.step(`${repo.name}: fetching...`);
        try {
          await fetchRemote(repoPath);
          log.success(`${repo.name}: fetched remote refs`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`${repo.name}: ${msg}`);
        }
      }
    });

  repo
    .command('sync [repo-name]')
    .description('Fast-forward baseline branches only')
    .action(async (repoName?: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const active = getActiveSession(root);
      const activeBindings = active ? normalizeSessionState(active, config).repos ?? [] : [];

      const repos = repoName
        ? config.repos.filter(r => r.name === repoName)
        : config.repos;

      if (repos.length === 0) {
        log.warn(repoName ? `Repository "${repoName}" not found.` : 'No repositories in this workspace.');
        return;
      }

      for (const repo of repos) {
        const repoPath = resolveRepoPath(root, repo.path);
        if (!fs.existsSync(repoPath)) {
          log.warn(`${repo.name}: local path missing, skipping`);
          continue;
        }

        const branch = await getCurrentBranch(repoPath);
        const isBoundByActiveSession = activeBindings.some((binding) => binding.repo === repo.name);
        if (branch !== repo.default_branch) {
          log.error(`${repo.name}: refusing to sync non-baseline branch "${branch}" (baseline: ${repo.default_branch})`);
          continue;
        }
        if (isBoundByActiveSession) {
          log.error(`${repo.name}: refusing to sync because it is bound by active session "${active?.id}"`);
          continue;
        }
        log.step(`${repo.name} (${branch}): pulling...`);
        const result = await pullCurrent(repoPath);
        if (result.success) {
          log.success(`${repo.name}: ${result.summary}`);
        } else {
          log.error(`${repo.name}: ${result.summary}`);
        }
      }
    });
}
