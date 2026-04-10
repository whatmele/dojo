import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { checkbox, select, input, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import type { RepoType, RepoConfig } from '../types.js';
import { findWorkspaceRoot, resolveRepoPath } from '../core/workspace.js';
import { readConfig, addRepo, removeRepo } from '../core/config.js';
import {
  checkoutBranch,
  cloneRepo,
  cloneRepoQuiet,
  fetchAllBranches,
  getRepoStatus,
  pullCurrent,
  resolveRepositoryGitRef,
  stagePathsAndCommit,
} from '../core/git.js';
import { readWorkspaceState, writeWorkspaceState } from '../core/state.js';
import { fileExists } from '../utils/fs.js';
import { log } from '../utils/logger.js';

interface RepoSelectionOptions {
  all?: boolean;
  repo?: string[];
}

function parseRepoName(gitUrl: string): string {
  const match = gitUrl.match(/\/([^/]+?)(?:\.git)?$/);
  return match ? match[1] : 'unknown-repo';
}

function repoPathForConfig(root: string, absRepoPath: string): string {
  const rel = path.relative(root, absRepoPath);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel;
  }
  return absRepoPath;
}

function normalizeRepoNames(values?: string[]): string[] {
  return [...new Set((values ?? []).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))];
}

function cloneSourceForRepo(repo: RepoConfig): string {
  return repo.git.startsWith('local:') ? repo.git.slice('local:'.length) : repo.git;
}

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

function tableWidths(rows: string[][]): number[] {
  return rows[0].map((_, index) => Math.max(...rows.map((row) => row[index].length)));
}

function colorStatusCell(value: string): string {
  const key = value.trim();
  if (['clean', 'ok', 'synced', 'checked out', 'cloned + synced'].includes(key)) return chalk.green(value);
  if (['dirty', 'needs pull', 'pending push', 'diverged'].includes(key)) return chalk.yellow(value);
  if (['missing', 'not-git', 'failed', 'error', 'no main_branch'].includes(key)) return chalk.red(value);
  return value;
}

function formatCell(value: string, width: number, columnIndex: number, statusColumnIndex?: number): string {
  const padded = pad(value, width);
  if (columnIndex !== statusColumnIndex) return padded;
  return colorStatusCell(padded);
}

function printTable(headers: string[], rows: string[][], statusColumnIndex?: number): void {
  const allRows = [headers, ...rows];
  const widths = tableWidths(allRows);
  console.log(chalk.bold(headers.map((cell, index) => pad(cell, widths[index])).join(' | ')));
  console.log(chalk.dim(widths.map((width) => '-'.repeat(width)).join('-|-')));
  for (const row of rows) {
    console.log(row.map((cell, index) => formatCell(cell, widths[index], index, statusColumnIndex)).join(' | '));
  }
}

function oneLine(value: string, maxLength = 140): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

async function autoCommitWorkspaceConfig(root: string, message: string): Promise<void> {
  try {
    await stagePathsAndCommit(root, ['.dojo/config.json'], message);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn(`Workspace config changed, but Dojo could not auto-commit .dojo/config.json: ${detail}`);
    log.warn('Run `git status` if you want to review and commit the updated workspace config.');
  }
}

async function promptMainBranch(): Promise<string | undefined> {
  const mainBranch = await input({
    message: 'Main branch (optional, used by `dojo repo checkout --main`):',
  });
  const value = mainBranch.trim();
  return value || undefined;
}

async function selectRepositories(root: string, options: RepoSelectionOptions): Promise<RepoConfig[]> {
  const config = readConfig(root);
  if (config.repos.length === 0) {
    log.warn('No repositories registered yet. Run `dojo repo add` first.');
    return [];
  }

  const byName = new Map(config.repos.map((repo) => [repo.name, repo]));
  const explicitNames = normalizeRepoNames(options.repo);
  if (options.all) {
    const allNames = config.repos.map((repo) => repo.name);
    const state = readWorkspaceState(root);
    writeWorkspaceState(root, { ...state, last_repo_selection: allNames });
    return config.repos;
  }

  if (explicitNames.length > 0) {
    const missing = explicitNames.filter((name) => !byName.has(name));
    if (missing.length > 0) {
      log.error(`Unknown repo(s): ${missing.join(', ')}`);
      log.info(`Known repos: ${config.repos.map((repo) => repo.name).join(', ')}`);
      process.exit(1);
    }
    const state = readWorkspaceState(root);
    writeWorkspaceState(root, { ...state, last_repo_selection: explicitNames });
    return explicitNames.map((name) => byName.get(name)!);
  }

  const state = readWorkspaceState(root);
  const remembered = (state.last_repo_selection ?? []).filter((name) => byName.has(name));
  const defaultSelection = remembered.length > 0
    ? new Set(remembered)
    : new Set(config.repos.filter((repo) => repo.type === 'biz').map((repo) => repo.name));

  if (defaultSelection.size === 0) {
    for (const repo of config.repos) {
      defaultSelection.add(repo.name);
    }
  }

  const selected = await checkbox({
    message: 'Repositories:',
    choices: config.repos.map((repo) => ({
      name: `${repo.name} (${repo.type}) — ${repo.path}`,
      value: repo.name,
      checked: defaultSelection.has(repo.name),
    })),
  }) as string[];

  if (selected.length === 0) {
    log.warn('No repositories selected.');
    return [];
  }

  writeWorkspaceState(root, { ...state, last_repo_selection: selected });
  return selected.map((name) => byName.get(name)!).filter(Boolean);
}

function inspectRepoDirectory(root: string, repo: RepoConfig): { ok: true; path: string } | { ok: false; state: string; detail: string } {
  const fullPath = resolveRepoPath(root, repo.path);
  if (!fs.existsSync(fullPath)) {
    return { ok: false, state: 'missing', detail: `Directory not found: ${repo.path}` };
  }
  if (!fs.existsSync(path.join(fullPath, '.git'))) {
    return { ok: false, state: 'not-git', detail: `Directory exists but is not a Git repository: ${repo.path}` };
  }
  return { ok: true, path: fullPath };
}

async function ensureRepoDirectoryForSync(root: string, repo: RepoConfig, initMissing: boolean): Promise<{ ok: true; path: string; initialized: boolean } | { ok: false; state: string; detail: string }> {
  const inspected = inspectRepoDirectory(root, repo);
  if (inspected.ok) {
    return { ...inspected, initialized: false };
  }
  if (!initMissing || inspected.state !== 'missing') {
    return inspected;
  }

  const fullPath = resolveRepoPath(root, repo.path);
  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    await cloneRepoQuiet(cloneSourceForRepo(repo), fullPath);
    return { ok: true, path: fullPath, initialized: true };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, state: 'failed', detail: `Clone failed: ${oneLine(detail)}` };
  }
}

function summarizeRepoState(status: Awaited<ReturnType<typeof getRepoStatus>>): string {
  if (status.conflicts > 0) return 'error';
  if (status.ahead > 0 && status.behind > 0) return 'diverged';
  if (status.ahead > 0) return 'pending push';
  if (status.behind > 0) return 'needs pull';
  if (!status.clean) return 'dirty';
  return 'clean';
}

async function showRepoStatus(root: string, options: RepoSelectionOptions): Promise<void> {
  const repos = await selectRepositories(root, options);
  if (repos.length === 0) return;

  const rows: string[][] = [];
  let failed = false;
  for (const repo of repos) {
    const inspected = inspectRepoDirectory(root, repo);
    if (!inspected.ok) {
      failed = true;
      rows.push([repo.name, repo.type, '-', '-', '-', '-', '-', inspected.state, inspected.detail]);
      continue;
    }

    try {
      const status = await getRepoStatus(inspected.path);
      rows.push([
        repo.name,
        repo.type,
        status.branch,
        status.upstream ?? '-',
        status.ahead > 0 ? `yes (+${status.ahead})` : 'no',
        String(status.staged),
        `${status.changed}/${status.untracked}`,
        summarizeRepoState(status),
        status.behind > 0 ? `behind ${status.behind}` : '-',
      ]);
    } catch (error: unknown) {
      failed = true;
      const detail = error instanceof Error ? error.message : String(error);
      rows.push([repo.name, repo.type, '-', '-', '-', '-', '-', 'error', oneLine(detail)]);
    }
  }

  log.info(`Repository status (${repos.length} selected)`);
  printTable(['Repo', 'Type', 'Branch', 'Upstream', 'Push', 'Staged', 'Changed/Untracked', 'State', 'Detail'], rows, 7);
  if (failed) {
    log.warn('Some repositories could not be inspected. Fix the path or run `dojo repo sync --init` for missing cloned repos.');
    process.exitCode = 1;
  }
}

async function syncRepositories(root: string, options: RepoSelectionOptions & { allBranch?: boolean; init?: boolean }): Promise<void> {
  const repos = await selectRepositories(root, options);
  if (repos.length === 0) return;

  const rows: string[][] = [];
  let failed = false;
  for (const repo of repos) {
    const ensured = await ensureRepoDirectoryForSync(root, repo, Boolean(options.init));
    if (!ensured.ok) {
      failed = true;
      rows.push([repo.name, repo.type, '-', ensured.state, ensured.detail]);
      continue;
    }

    try {
      if (options.allBranch) {
        await fetchAllBranches(ensured.path);
      }
      const statusBeforePull = await getRepoStatus(ensured.path);
      const pulled = await pullCurrent(ensured.path);
      if (!pulled.success) {
        failed = true;
        rows.push([repo.name, repo.type, statusBeforePull.branch, 'failed', oneLine(pulled.summary)]);
        continue;
      }
      rows.push([
        repo.name,
        repo.type,
        statusBeforePull.branch,
        ensured.initialized ? 'cloned + synced' : 'synced',
        options.allBranch ? `${pulled.summary}; fetched all remotes` : pulled.summary,
      ]);
    } catch (error: unknown) {
      failed = true;
      const detail = error instanceof Error ? error.message : String(error);
      rows.push([repo.name, repo.type, '-', 'failed', oneLine(detail)]);
    }
  }

  log.info(`Repository sync (${repos.length} selected)`);
  printTable(['Repo', 'Type', 'Branch', 'State', 'Detail'], rows, 3);
  if (failed) {
    log.warn('Some repositories failed to sync. Dojo did not run stash, force, reset, or any recovery action.');
    process.exitCode = 1;
  }
}

async function checkoutRepositories(root: string, branch: string | undefined, options: RepoSelectionOptions & { main?: boolean }): Promise<void> {
  const targetBranch = branch?.trim();
  if (options.main && targetBranch) {
    log.error('Use either `dojo repo checkout <branch>` or `dojo repo checkout --main`, not both.');
    process.exit(1);
  }
  if (!options.main && !targetBranch) {
    log.error('Missing branch name. Use `dojo repo checkout <branch>` or `dojo repo checkout --main`.');
    process.exit(1);
  }

  const repos = await selectRepositories(root, options);
  if (repos.length === 0) return;

  const rows: string[][] = [];
  let failed = false;
  for (const repo of repos) {
    const target = options.main ? repo.main_branch?.trim() : targetBranch;
    if (!target) {
      failed = true;
      rows.push([repo.name, repo.type, '-', 'no main_branch', 'Set `main_branch` in .dojo/config.json or run checkout with an explicit branch.']);
      continue;
    }

    const inspected = inspectRepoDirectory(root, repo);
    if (!inspected.ok) {
      failed = true;
      rows.push([repo.name, repo.type, target, inspected.state, inspected.detail]);
      continue;
    }

    try {
      await checkoutBranch(inspected.path, target);
      rows.push([repo.name, repo.type, target, 'checked out', '-']);
    } catch (error: unknown) {
      failed = true;
      const detail = error instanceof Error ? error.message : String(error);
      rows.push([repo.name, repo.type, target, 'failed', oneLine(detail)]);
    }
  }

  log.info(`Repository checkout (${repos.length} selected)`);
  printTable(['Repo', 'Type', 'Target', 'State', 'Detail'], rows, 3);
  if (failed) {
    log.warn('Some repositories failed to checkout. Dojo did not force, stash, or reset anything.');
    process.exitCode = 1;
  }
}

function addSelectionOptions(command: Command): Command {
  return command
    .option('-r, --repo <name...>', 'Repo name(s) to operate on; comma-separated values are also accepted')
    .option('--all', 'Operate on all registered repositories without prompting');
}

export function registerRepoCommand(program: Command): void {
  const repo = program
    .command('repo')
    .description('Repository registry and lightweight Git helpers');

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

        const existing = config.repos.find((r) => r.name === name);
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
        const mainBranch = await promptMainBranch();

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

        const repoConfig: RepoConfig = {
          name,
          type,
          git: source,
          path: repoPath,
          description,
          ...(mainBranch ? { main_branch: mainBranch } : {}),
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
      const gitRef = await resolveRepositoryGitRef(fullPath);
      const repoPath = repoPathForConfig(root, fullPath);

      const existingLocal = config.repos.find((r) => r.name === name);
      if (existingLocal) {
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
      const mainBranch = await promptMainBranch();

      const repoConfig: RepoConfig = {
        name,
        type,
        git: gitRef,
        path: repoPath,
        description,
        ...(mainBranch ? { main_branch: mainBranch } : {}),
      };

      addRepo(root, repoConfig);
      await autoCommitWorkspaceConfig(root, `chore: register repository ${name}`);
      log.success(`Repository "${name}" added to the workspace.`);
    });

  repo
    .command('remove <name>')
    .description('Remove a repository from the workspace registry')
    .action(async (name: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const repoConfig = config.repos.find((r) => r.name === name);

      if (!repoConfig) {
        log.error(`Repository "${name}" is not in this workspace.`);
        process.exit(1);
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

  addSelectionOptions(
    repo
      .command('status')
      .description('Show git status for selected registered repositories'),
  )
    .action(async (opts: RepoSelectionOptions) => {
      await showRepoStatus(findWorkspaceRoot(), opts);
    });

  addSelectionOptions(
    repo
      .command('sync')
      .description('Run git pull for selected registered repositories')
      .option('--all-branch', 'Fetch all remotes before pulling the current branch')
      .option('--init', 'Clone missing configured repositories before syncing'),
  )
    .action(async (opts: RepoSelectionOptions & { allBranch?: boolean; init?: boolean }) => {
      await syncRepositories(findWorkspaceRoot(), opts);
    });

  addSelectionOptions(
    repo
      .command('checkout [branch]')
      .description('Checkout a branch across selected registered repositories')
      .option('--main', 'Checkout each repository main_branch from .dojo/config.json'),
  )
    .action(async (branch: string | undefined, opts: RepoSelectionOptions & { main?: boolean }) => {
      await checkoutRepositories(findWorkspaceRoot(), branch, opts);
    });
}
