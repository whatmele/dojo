import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { input, checkbox, confirm, select } from '@inquirer/prompts';
import type { WorkspaceConfig, WorkspaceState, AgentTool, RepoType, RepoConfig } from '../types.js';
import { DOJO_DIR } from '../types.js';
import { writeConfig, addRepo } from '../core/config.js';
import { writeWorkspaceState } from '../core/state.js';
import { initRepo, addAndCommit, cloneRepo } from '../core/git.js';
import { distributeCommands } from '../core/command-distributor.js';
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

/**
 * 模板与编译产物目录相邻（dist/src/templates）；若未执行完整 build 导致该目录缺失，
 * 则回退到源码树中的 src/templates，避免 .dojo/commands 被静默留空。
 */
function resolveTemplatesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', 'templates'),
    path.resolve(here, '..', '..', '..', 'src', 'templates'),
  ];
  for (const dir of candidates) {
    const agents = path.join(dir, 'AGENTS.md');
    const commandsDir = path.join(dir, 'commands');
    if (fs.existsSync(agents) && fs.existsSync(commandsDir)) {
      const md = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
      if (md.length > 0) return dir;
    }
  }
  throw new Error(
    `未找到 Dojo 命令模板目录（已尝试：\n${candidates.join('\n')}\n请在包根目录执行 npm run build（会拷贝 src/templates 到 dist）。`,
  );
}

/** 由工作区名称生成磁盘目录名（小写、连字符），用于 create 落盘。 */
function suggestedDirNameFromWorkspaceName(workspaceName: string): string {
  const s = workspaceName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'dojo-workspace';
}

/** 禁止 `.` / `..` 等会解析到当前目录或上级目录的片段，避免 init 写到错误路径。 */
function safeWorkspaceDirSegment(workspaceName: string): string {
  const segment = suggestedDirNameFromWorkspaceName(workspaceName);
  if (segment === '.' || segment === '..' || segment.includes(path.sep)) {
    return 'dojo-workspace';
  }
  return segment;
}

async function promptWorkspaceProfile(defaultName: string): Promise<{ name: string; description: string }> {
  const name = await input({ message: '工作区名称:', default: defaultName });
  const description = await input({ message: '工作区描述:' });
  return { name, description };
}

async function promptAgentPreferences(): Promise<{
  agents: AgentTool[];
  agent_commands?: Partial<Record<AgentTool, string>>;
}> {
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

  return { agents, ...(agent_commands ? { agent_commands } : {}) };
}

async function applyInit(
  root: string,
  name: string,
  description: string,
  agents: AgentTool[],
  agent_commands?: Partial<Record<AgentTool, string>>,
): Promise<void> {
  log.step('创建目录结构...');
  ensureDir(root);
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
  const templatesDir = resolveTemplatesDir();
  const commandsTemplateDir = path.join(templatesDir, 'commands');
  const targetCommandsDir = path.join(dojoDir, 'commands');

  const templateFiles = fs.readdirSync(commandsTemplateDir).filter(f => f.endsWith('.md'));
  if (templateFiles.length === 0) {
    throw new Error(`命令模板目录为空: ${commandsTemplateDir}`);
  }
  for (const file of templateFiles) {
    const content = readText(path.join(commandsTemplateDir, file));
    writeText(path.join(targetCommandsDir, file), content);
  }

  let agentsMdTemplate = readText(path.join(templatesDir, 'AGENTS.md'));
  agentsMdTemplate = agentsMdTemplate
    .replace('{{workspace_name}}', name)
    .replace('{{workspace_description}}', description || '（请在此处填写工作区概述）');
  writeText(path.join(root, 'AGENTS.md'), agentsMdTemplate);

  const gitignoreContent = readText(path.join(templatesDir, 'gitignore'));
  writeText(path.join(root, '.gitignore'), gitignoreContent);

  distributeCommands(root, null, agents);

  log.step('初始化 Git 仓库...');
  if (!fileExists(path.join(root, '.git'))) {
    await initRepo(root);
  }
  await addAndCommit(root, 'chore: init dojo workspace');
}

async function promptOptionalRepos(root: string): Promise<void> {
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
}

/** 生成可复制的 cd 命令：优先相对路径，含空格时加引号。 */
function formatCdIntoWorkspace(fromCwd: string, workspaceRoot: string): string {
  const rel = path.relative(fromCwd, workspaceRoot);
  const usePath =
    rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : workspaceRoot;
  return /\s/.test(usePath) ? `cd "${usePath.replace(/"/g, '\\"')}"` : `cd ${usePath}`;
}

function printNextSteps(options?: { workspaceRoot: string }): void {
  const cwd = process.cwd();
  console.log();
  log.info('下一步：');
  if (options?.workspaceRoot) {
    const resolvedWs = path.resolve(options.workspaceRoot);
    const resolvedCwd = path.resolve(cwd);
    if (resolvedWs !== resolvedCwd) {
      const cdCmd = formatCdIntoWorkspace(resolvedCwd, resolvedWs);
      log.info(`  ${cdCmd}  — 进入工作区后再执行：`);
    }
  }
  log.info('  dojo session new  — 创建开发会话');
  log.info('  dojo start        — 启动 AI 工具');
}

async function doInit(root: string): Promise<void> {
  if (isDojoWorkspace(root)) {
    log.error(`目录 "${root}" 已经是一个 Dojo 工作区。`);
    process.exit(1);
  }

  printBanner();
  console.log();

  const { name, description } = await promptWorkspaceProfile(path.basename(root));
  const { agents, agent_commands } = await promptAgentPreferences();
  await applyInit(root, name, description, agents, agent_commands);

  const absRoot = path.resolve(root);
  log.success(`工作区 "${name}" 初始化完成！`);
  log.info(`根目录: ${absRoot}（配置在隐藏目录 ${path.join(absRoot, DOJO_DIR)}，请用 ls -a 查看）`);
  console.log();

  await promptOptionalRepos(root);
  printNextSteps({ workspaceRoot: root });
}

/**
 * 与 init 相同的问答顺序；区别：名称无默认值（由用户输入或 CLI 传入）。
 * 磁盘目录在 applyInit 时创建，避免交互中途退出留下无 .dojo 的空文件夹。
 */
async function doCreate(cliNameArg?: string): Promise<void> {
  printBanner();
  console.log();

  let name: string;
  if (cliNameArg?.trim()) {
    name = cliNameArg.trim();
  } else {
    const raw = await input({ message: '工作区名称:' });
    name = raw.trim();
    if (!name) {
      log.error('工作区名称不能为空。');
      process.exit(1);
    }
  }

  const dirSegment = safeWorkspaceDirSegment(name);
  const targetDir = path.resolve(process.cwd(), dirSegment);

  if (isDojoWorkspace(targetDir)) {
    log.error(`目录 "${dirSegment}" 已经是一个 Dojo 工作区。`);
    process.exit(1);
  }

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    log.error(`目录 "${dirSegment}" 已存在且非空。`);
    process.exit(1);
  }

  const description = await input({ message: '工作区描述:' });
  const { agents, agent_commands } = await promptAgentPreferences();
  await applyInit(targetDir, name, description, agents, agent_commands);

  const absTarget = path.resolve(targetDir);
  log.success(`工作区 "${name}" 初始化完成！`);
  log.info(`根目录: ${absTarget}（配置在隐藏目录 ${path.join(absTarget, DOJO_DIR)}，请用 ls -a 查看）`);
  console.log();

  await promptOptionalRepos(targetDir);
  printNextSteps({ workspaceRoot: targetDir });
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('在当前目录初始化 Dojo 工作区')
    .action(async () => {
      await doInit(process.cwd());
    });

  program
    .command('create [name]')
    .description('新建目录并初始化（流程与 init 一致；名称无默认；完成后请 cd 进入子目录）')
    .action(async (name?: string) => {
      await doCreate(name);
    });
}
