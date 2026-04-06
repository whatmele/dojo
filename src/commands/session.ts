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
      message: `当前会话 "${current.id}" 的所有任务已完成，是否标记为 completed？`,
      default: true,
    });
    if (markComplete) {
      current.status = 'completed';
      writeSessionState(root, current.id, current);
      log.success(`会话 "${current.id}" 已标记为 completed。`);
      return;
    }
  }

  if (current.status === 'active') {
    current.status = 'suspended';
    writeSessionState(root, current.id, current);
    log.step(`会话 "${current.id}" 已挂起。`);
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
    log.warn('以下仓库有未提交的变更:');
    for (const r of dirtyRepos) {
      log.warn(`  - ${r}`);
    }
    const proceed = await confirm({
      message: '是否继续？',
      default: false,
    });
    return proceed;
  }
  return true;
}

export function registerSessionCommand(program: Command): void {
  const session = program
    .command('session')
    .description('开发会话管理');

  session
    .command('new')
    .description('新建开发会话')
    .option('--force', '跳过工作区干净检查')
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
        message: '会话 ID (kebab-case):',
        validate: (v: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) || '请使用 kebab-case 格式',
      });

      if (sessionExists(root, id)) {
        log.error(`会话 "${id}" 已存在。使用 dojo session resume ${id} 恢复。`);
        process.exit(1);
      }

      const description = await input({ message: '会话描述:' });
      const externalLink = await input({ message: '关联链接 (可选):' });

      const repoChoices = config.repos.map(r => ({
        name: `${r.name} (${r.type})`,
        value: r.name,
      }));

      let selectedRepos: string[] = [];
      if (repoChoices.length > 0) {
        selectedRepos = await checkbox({
          message: '选择参与仓库:',
          choices: repoChoices,
        });
      }

      const branchPattern = await input({
        message: '新分支名:',
        default: `feature/${id}`,
      });

      // 选择基础分支：从工作区仓库的分支列表中选择
      let baseBranch = 'main';
      try {
        const { current, all } = await listBranches(root);
        if (all.length > 1) {
          baseBranch = await select({
            message: '从哪个分支创建？',
            choices: all.map(b => ({
              name: b === current ? `${b} (当前)` : b,
              value: b,
            })),
            default: current,
          });
        } else {
          baseBranch = current;
          log.dim(`  基础分支: ${baseBranch}`);
        }
      } catch {
        log.dim(`  基础分支: ${baseBranch} (默认)`);
      }

      log.step('创建分支...');
      const repoBranches: Record<string, string> = {};
      try {
        await createBranchFrom(root, branchPattern, baseBranch);
        log.success(`workspace: 分支 ${branchPattern} 已创建 (基于 ${baseBranch})`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`workspace: 创建分支失败 — ${msg}`);
        process.exit(1);
      }
      for (const repoName of selectedRepos) {
        const repo = config.repos.find(r => r.name === repoName)!;
        const repoPath = path.join(root, repo.path);
        try {
          // 业务仓库默认从其 default_branch 创建，如果该分支存在的话
          const repoBase = repo.default_branch ?? baseBranch;
          await createBranchFrom(repoPath, branchPattern, repoBase);
          repoBranches[repoName] = branchPattern;
          log.success(`${repoName}: 分支 ${branchPattern} 已创建 (基于 ${repoBase})`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`${repoName}: 创建分支失败 — ${msg}`);
          log.error('停止创建后续仓库的分支。请修复问题后重试。');
          process.exit(1);
        }
      }

      // Push branches
      for (const repoName of Object.keys(repoBranches)) {
        const repo = config.repos.find(r => r.name === repoName)!;
        const repoPath = path.join(root, repo.path);
        try {
          await pushBranch(repoPath, branchPattern);
          log.success(`${repoName}: 分支已推送`);
        } catch {
          log.warn(`${repoName}: 推送分支失败（可能没有远端），继续...`);
        }
      }

      log.step('初始化会话目录...');
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

      log.step('刷新 commands 和 context...');
      distributeCommands(root, id, config.agents);
      await generateContext(root, sessionState, config);

      log.success(`会话 "${id}" 已创建并激活！`);
      log.info('运行 dojo start 启动 AI 工具开始工作。');
    });

  session
    .command('resume <session-id>')
    .description('恢复已有会话')
    .option('--force', '跳过工作区干净检查')
    .action(async (sessionId: string, opts: { force?: boolean }) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);

      if (!sessionExists(root, sessionId)) {
        log.error(`会话 "${sessionId}" 不存在。`);
        const sessions = listSessions(root);
        if (sessions.length > 0) {
          log.info('可用的会话:');
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

      log.step('切换仓库分支...');
      if (targetSession.workspace_branch) {
        try {
          await checkoutBranch(root, targetSession.workspace_branch);
          log.success(`workspace: 切换到 ${targetSession.workspace_branch}`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`workspace: 切换分支失败 — ${msg}`);
        }
      }
      for (const [repoName, branch] of Object.entries(targetSession.repo_branches)) {
        const repo = config.repos.find(r => r.name === repoName);
        if (!repo) {
          log.warn(`仓库 "${repoName}" 已不在工作区配置中，跳过。`);
          continue;
        }
        const repoPath = path.join(root, repo.path);
        try {
          await checkoutBranch(repoPath, branch);
          log.success(`${repoName}: 切换到 ${branch}`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`${repoName}: 切换分支失败 — ${msg}`);
        }
      }

      targetSession.status = 'active';
      writeSessionState(root, sessionId, targetSession);
      writeWorkspaceState(root, { active_session: sessionId });

      log.step('刷新 commands 和 context...');
      distributeCommands(root, sessionId, config.agents);
      await generateContext(root, targetSession, config);

      log.success(`会话 "${sessionId}" 已恢复并激活！`);
    });
}
