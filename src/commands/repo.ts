import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { select, input, confirm } from '@inquirer/prompts';
import type { RepoType, RepoConfig } from '../types.js';
import { findWorkspaceRoot } from '../core/workspace.js';
import { readConfig, addRepo, removeRepo } from '../core/config.js';
import { cloneRepo, pullCurrent, getCurrentBranch } from '../core/git.js';
import { fileExists } from '../utils/fs.js';
import { log } from '../utils/logger.js';

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

        const repoConfig: RepoConfig = {
          name,
          type,
          git: source,
          path: repoPath,
          default_branch: defaultBranch,
          description,
        };

        addRepo(root, repoConfig);
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
      log.success(`Repository "${name}" added to the workspace.`);
    });

  repo
    .command('remove <name>')
    .description('Remove a repository from the workspace')
    .action(async (name: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const repoConfig = config.repos.find(r => r.name === name);

      if (!repoConfig) {
        log.error(`Repository "${name}" is not in this workspace.`);
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

      if (shouldDelete) {
        const fullPath = path.join(root, repoConfig.path);
        if (fs.existsSync(fullPath)) {
          fs.rmSync(fullPath, { recursive: true });
          log.step(`Deleted ${repoConfig.path}`);
        }
      }

      log.success(`Repository "${name}" removed from the workspace.`);
    });

  repo
    .command('sync [repo-name]')
    .description('Pull latest for one or all repositories')
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
        const repoPath = path.join(root, repo.path);
        if (!fs.existsSync(repoPath)) {
          log.warn(`${repo.name}: local path missing, skipping`);
          continue;
        }

        const branch = await getCurrentBranch(repoPath);
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
