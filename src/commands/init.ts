import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { input, checkbox, confirm, select } from '@inquirer/prompts';
import type { WorkspaceConfig, WorkspaceState, AgentTool, RepoType, RepoConfig } from '../types.js';
import { DOJO_DIR } from '../types.js';
import { writeConfig, addRepo } from '../core/config.js';
import { writeWorkspaceState } from '../core/state.js';
import { initRepo, addAndCommit, cloneRepo } from '../core/git.js';
import { setupSymlinks } from '../core/command-distributor.js';
import { isDojoWorkspace } from '../core/workspace.js';
import { TOOL_COMMANDS } from './start.js';
import { ensureDir, writeText, readText, fileExists } from '../utils/fs.js';
import { log, printBanner } from '../utils/logger.js';

const AGENT_CHOICES: { name: string; value: AgentTool }[] = [
  { name: 'Claude Code', value: 'claude-code' },
  { name: 'Codex (OpenAI)', value: 'codex' },
  { name: 'Cursor', value: 'cursor' },
  { name: 'Trae', value: 'trae' },
];

function getTemplatesDir(): string {
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(currentDir, '..', 'templates');
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('初始化 Dojo 工作区')
    .action(async () => {
      const root = process.cwd();

      if (isDojoWorkspace(root)) {
        log.error('当前目录已经是一个 Dojo 工作区。');
        process.exit(1);
      }

      printBanner();
      console.log();

      const name = await input({ message: '工作区名称:', default: path.basename(root) });
      const description = await input({ message: '工作区描述:' });
      const agents = await checkbox({
        message: '选择要适配的 AI 工具:',
        choices: AGENT_CHOICES,
      }) as AgentTool[];

      if (agents.length === 0) {
        log.warn('未选择任何 AI 工具，默认使用 claude-code。');
        agents.push('claude-code');
      }

      let agent_commands: Partial<Record<AgentTool, string>> | undefined;
      const wantCustomCli = await confirm({
        message: '是否为所选工具配置自定义 CLI 启动命令？',
        default: false,
      });
      if (wantCustomCli) {
        const overrides: Partial<Record<AgentTool, string>> = {};
        for (const agent of agents) {
          const def = TOOL_COMMANDS[agent];
          const answer = await input({
            message: `${agent} 启动命令:`,
            default: def,
          });
          if (answer.trim() && answer.trim() !== def) {
            overrides[agent] = answer.trim();
          }
        }
        if (Object.keys(overrides).length > 0) {
          agent_commands = overrides;
        }
      }

      log.step('创建目录结构...');
      const dojoDir = path.join(root, DOJO_DIR);
      ensureDir(path.join(dojoDir, 'sessions'));
      ensureDir(path.join(dojoDir, 'commands'));
      ensureDir(path.join(root, 'docs'));
      ensureDir(path.join(root, 'repos', 'biz'));
      ensureDir(path.join(root, 'repos', 'dev'));
      ensureDir(path.join(root, 'repos', 'wiki'));
      ensureDir(path.join(root, '.agents', 'commands'));

      log.step('写入配置文件...');
      const config: WorkspaceConfig = {
        workspace: { name, description },
        agents,
        ...(agent_commands ? { agent_commands } : {}),
        repos: [],
      };
      writeConfig(root, config);

      const wsState: WorkspaceState = { active_session: null };
      writeWorkspaceState(root, wsState);

      log.step('复制默认模板...');
      const templatesDir = getTemplatesDir();
      const commandsTemplateDir = path.join(templatesDir, 'commands');
      const targetCommandsDir = path.join(dojoDir, 'commands');

      if (fs.existsSync(commandsTemplateDir)) {
        const files = fs.readdirSync(commandsTemplateDir);
        for (const file of files) {
          const content = readText(path.join(commandsTemplateDir, file));
          writeText(path.join(targetCommandsDir, file), content);
        }
      }

      let agentsMdTemplate = readText(path.join(templatesDir, 'AGENTS.md'));
      agentsMdTemplate = agentsMdTemplate
        .replace('{{workspace_name}}', name)
        .replace('{{workspace_description}}', description || '（请在此处填写工作区概述）');
      writeText(path.join(root, 'AGENTS.md'), agentsMdTemplate);

      const gitignoreContent = readText(path.join(templatesDir, 'gitignore'));
      writeText(path.join(root, '.gitignore'), gitignoreContent);

      setupSymlinks(root, agents);

      log.step('初始化 Git 仓库...');
      if (!fileExists(path.join(root, '.git'))) {
        await initRepo(root);
      }
      await addAndCommit(root, 'chore: init dojo workspace');

      log.success(`工作区 "${name}" 初始化完成！`);
      console.log();

      let addMore = await confirm({ message: '是否现在添加仓库？', default: true });

      while (addMore) {
        const gitUrl = await input({ message: '仓库 Git 地址:' });
        const repoName = gitUrl.match(/\/([^/]+?)(?:\.git)?$/)?.[1] ?? 'unknown-repo';

        const repoType = await select({
          message: `仓库类型 (${repoName}):`,
          choices: [
            { name: 'biz — 业务仓库', value: 'biz' as RepoType },
            { name: 'dev — 开发工具仓库', value: 'dev' as RepoType },
            { name: 'wiki — 知识库仓库', value: 'wiki' as RepoType },
          ],
        });

        const repoDesc = await input({ message: '仓库描述:' });
        const repoPath = `repos/${repoType}/${repoName}`;
        const fullPath = path.join(root, repoPath);

        log.step(`克隆 ${repoName}...`);
        try {
          await cloneRepo(gitUrl, fullPath);
          const repoConfig: RepoConfig = {
            name: repoName,
            type: repoType,
            git: gitUrl,
            path: repoPath,
            default_branch: 'main',
            description: repoDesc,
          };
          addRepo(root, repoConfig);
          log.success(`仓库 "${repoName}" 已添加。`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(`克隆失败: ${msg}`);
        }

        console.log();
        addMore = await confirm({ message: '继续添加仓库？', default: false });
      }

      console.log();
      log.info('下一步：');
      log.info('  dojo session new  — 创建开发会话');
      log.info('  dojo start        — 启动 AI 工具');
    });
}
