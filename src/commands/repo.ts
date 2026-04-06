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
    .description('仓库管理');

  repo
    .command('add <source>')
    .description('添加仓库到工作区（克隆 Git URL，或使用 --local 注册本地路径）')
    .option('--local', '将 source 视为本地目录路径（不克隆）')
    .action(async (source: string, opts: { local?: boolean }) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);

      if (!opts.local) {
        let parsedName = parseRepoName(source);
        if (parsedName === 'unknown-repo') {
          parsedName = await input({
            message: '无法从 URL 解析仓库名，请输入名称:',
            validate: (v: string) => (v.trim().length > 0 ? true : '名称不能为空'),
          });
          parsedName = parsedName.trim();
        }
        const name = parsedName;

        const existing = config.repos.find(r => r.name === name);
        if (existing) {
          log.error(`仓库 "${name}" 已存在于工作区。`);
          process.exit(1);
        }

        const type = await select({
          message: `仓库类型 (${name}):`,
          choices: [
            { name: 'biz — 业务仓库', value: 'biz' as RepoType },
            { name: 'dev — 开发工具仓库', value: 'dev' as RepoType },
            { name: 'wiki — 知识库仓库', value: 'wiki' as RepoType },
          ],
        });

        const description = await input({ message: '仓库描述:' });

        const repoPath = `repos/${type}/${name}`;
        const fullPath = path.join(root, repoPath);

        log.step(`克隆仓库到 ${repoPath}...`);
        try {
          await cloneRepo(source, fullPath);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`克隆失败: ${msg}`);
          process.exit(1);
        }

        let defaultBranch: string;
        try {
          defaultBranch = await getCurrentBranch(fullPath);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`无法检测默认分支: ${msg}`);
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
        log.success(`仓库 "${name}" 已添加到工作区。`);
        return;
      }

      const fullPath = path.isAbsolute(source)
        ? path.resolve(source)
        : path.resolve(root, source);

      if (!fileExists(fullPath)) {
        log.error(`路径不存在: ${fullPath}`);
        process.exit(1);
      }
      if (!fileExists(path.join(fullPath, '.git'))) {
        log.error(`不是 Git 仓库（缺少 .git）: ${fullPath}`);
        process.exit(1);
      }

      const name = path.basename(path.resolve(fullPath));
      const gitRef = `local:${fullPath}`;
      const repoPath = repoPathForConfig(root, fullPath);

      const existingLocal = config.repos.find(r => r.name === name);
      if (existingLocal) {
        log.error(`仓库 "${name}" 已存在于工作区。`);
        process.exit(1);
      }

      let defaultBranch: string;
      try {
        defaultBranch = await getCurrentBranch(fullPath);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`无法读取当前分支: ${msg}`);
        process.exit(1);
      }

      const type = await select({
        message: `仓库类型 (${name}):`,
        choices: [
          { name: 'biz — 业务仓库', value: 'biz' as RepoType },
          { name: 'dev — 开发工具仓库', value: 'dev' as RepoType },
          { name: 'wiki — 知识库仓库', value: 'wiki' as RepoType },
        ],
      });

      const description = await input({ message: '仓库描述:' });

      const repoConfig: RepoConfig = {
        name,
        type,
        git: gitRef,
        path: repoPath,
        default_branch: defaultBranch,
        description,
      };

      addRepo(root, repoConfig);
      log.success(`仓库 "${name}" 已添加到工作区。`);
    });

  repo
    .command('remove <name>')
    .description('从工作区移除仓库')
    .action(async (name: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const repoConfig = config.repos.find(r => r.name === name);

      if (!repoConfig) {
        log.error(`仓库 "${name}" 不在工作区中。`);
        process.exit(1);
      }

      if (!repoConfig) {
        return; // already checked above, for TS narrowing
      }

      const shouldDelete = await confirm({
        message: `是否同时删除本地目录 ${repoConfig.path}？`,
        default: false,
      });

      removeRepo(root, name);

      if (shouldDelete) {
        const fullPath = path.join(root, repoConfig.path);
        if (fs.existsSync(fullPath)) {
          fs.rmSync(fullPath, { recursive: true });
          log.step(`已删除 ${repoConfig.path}`);
        }
      }

      log.success(`仓库 "${name}" 已从工作区移除。`);
    });

  repo
    .command('sync [repo-name]')
    .description('同步仓库代码')
    .action(async (repoName?: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);

      const repos = repoName
        ? config.repos.filter(r => r.name === repoName)
        : config.repos;

      if (repos.length === 0) {
        log.warn(repoName ? `仓库 "${repoName}" 未找到。` : '工作区中没有仓库。');
        return;
      }

      for (const repo of repos) {
        const repoPath = path.join(root, repo.path);
        if (!fs.existsSync(repoPath)) {
          log.warn(`${repo.name}: 本地目录不存在，跳过`);
          continue;
        }

        const branch = await getCurrentBranch(repoPath);
        log.step(`${repo.name} (${branch}): 拉取中...`);
        const result = await pullCurrent(repoPath);
        if (result.success) {
          log.success(`${repo.name}: ${result.summary}`);
        } else {
          log.error(`${repo.name}: ${result.summary}`);
        }
      }
    });
}
