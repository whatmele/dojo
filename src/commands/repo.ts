import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { select, input, confirm } from '@inquirer/prompts';
import type { RepoType, RepoConfig } from '../types.js';
import { findWorkspaceRoot, resolveRepoPath } from '../core/workspace.js';
import { readConfig, addRepo, removeRepo } from '../core/config.js';
import {
  cloneRepo,
  stagePathsAndCommit,
} from '../core/git.js';
import { fileExists } from '../utils/fs.js';
import { log } from '../utils/logger.js';

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

async function autoCommitWorkspaceConfig(root: string, message: string): Promise<void> {
  try {
    await stagePathsAndCommit(root, ['.dojo/config.json'], message);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn(`Workspace config changed, but Dojo could not auto-commit .dojo/config.json: ${detail}`);
    log.warn('Run `git status` if you want to review and commit the updated workspace config.');
  }
}

export function registerRepoCommand(program: Command): void {
  const repo = program
    .command('repo')
    .description('Repository registry management');

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

      const repoConfig: RepoConfig = {
        name,
        type,
        git: gitRef,
        path: repoPath,
        description,
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
}
