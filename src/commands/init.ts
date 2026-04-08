import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { input, checkbox, confirm, select } from '@inquirer/prompts';
import type { WorkspaceConfig, WorkspaceState, AgentTool, RepoType, RepoConfig } from '../types.js';
import { DOJO_DIR, AGENTS_SKILLS_DIR } from '../types.js';
import { writeConfig, addRepo } from '../core/config.js';
import { writeWorkspaceState } from '../core/state.js';
import {
  initRepo,
  addAndCommit,
  cloneRepo,
  stagePathsAndCommit,
} from '../core/git.js';
import { distributeCommands } from '../core/command-distributor.js';
import { isDojoWorkspace } from '../core/workspace.js';
import { TOOL_COMMANDS } from './start.js';
import { ensureDir, writeText, readText, fileExists } from '../utils/fs.js';
import { log, printBanner } from '../utils/logger.js';
import { resolveBuiltInArtifactsDir, resolveBuiltInSkillsDir, resolveBuiltInStarterDir } from '../core/builtins.js';

const AGENT_CHOICES: { name: string; value: AgentTool }[] = [
  { name: 'Claude Code', value: 'claude-code' },
  { name: 'Codex (OpenAI)', value: 'codex' },
  { name: 'Cursor', value: 'cursor' },
  { name: 'Trae', value: 'trae' },
];

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

function safeWorkspaceDirSegment(workspaceName: string): string {
  const segment = suggestedDirNameFromWorkspaceName(workspaceName);
  if (segment === '.' || segment === '..' || segment.includes(path.sep)) {
    return 'dojo-workspace';
  }
  return segment;
}

async function promptWorkspaceProfile(defaultName: string): Promise<{ name: string; description: string }> {
  const name = await input({ message: 'Workspace name:', default: defaultName });
  const description = await input({ message: 'Workspace description:' });
  return { name, description };
}

async function promptAgentPreferences(): Promise<{
  agents: AgentTool[];
  agent_commands?: Partial<Record<AgentTool, string>>;
}> {
  const agents = await checkbox({
    message: 'AI tools to enable:',
    choices: AGENT_CHOICES,
  }) as AgentTool[];

  if (agents.length === 0) {
    log.warn('No AI tool selected; defaulting to claude-code.');
    agents.push('claude-code');
  }

  let agent_commands: Partial<Record<AgentTool, string>> | undefined;
  const wantCustomCli = await confirm({
    message: 'Configure custom CLI commands for the selected tools?',
    default: false,
  });
  if (wantCustomCli) {
    const overrides: Partial<Record<AgentTool, string>> = {};
    for (const agent of agents) {
      const def = TOOL_COMMANDS[agent];
      const answer = await input({
        message: `${agent} CLI command:`,
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
  log.step('Creating directory layout...');
  ensureDir(root);
  const dojoDir = path.join(root, DOJO_DIR);
  ensureDir(path.join(dojoDir, 'artifacts'));
  ensureDir(path.join(dojoDir, 'sessions'));
  ensureDir(path.join(dojoDir, 'commands'));
  ensureDir(path.join(dojoDir, 'skills'));
  ensureDir(path.join(dojoDir, 'types'));
  ensureDir(path.join(root, 'docs'));
  ensureDir(path.join(root, 'repos', 'biz'));
  ensureDir(path.join(root, 'repos', 'dev'));
  ensureDir(path.join(root, 'repos', 'wiki'));
  ensureDir(path.join(root, '.agents', 'commands'));
  ensureDir(path.join(root, AGENTS_SKILLS_DIR));

  log.step('Writing config...');
  const config: WorkspaceConfig = {
    workspace: { name, description },
    agents,
    ...(agent_commands ? { agent_commands } : {}),
    repos: [],
    context: {
      artifacts: ['product-requirement', 'research', 'tech-design', 'tasks', 'workspace-doc'],
    },
  };
  writeConfig(root, config);

  const wsState: WorkspaceState = { active_session: null };
  writeWorkspaceState(root, wsState);

  log.step('Copying starter assets...');
  const starterDir = resolveBuiltInStarterDir();
  const commandsTemplateDir = path.join(starterDir, 'commands');
  const workspaceTemplateDir = path.join(starterDir, 'workspace');
  const typesTemplateDir = path.join(starterDir, 'types');
  const artifactsTemplateDir = resolveBuiltInArtifactsDir();
  const skillsTemplateDir = resolveBuiltInSkillsDir();
  const targetCommandsDir = path.join(dojoDir, 'commands');
  const targetArtifactsDir = path.join(dojoDir, 'artifacts');
  const targetSkillsDir = path.join(dojoDir, 'skills');
  const targetTypesDir = path.join(dojoDir, 'types');

  const templateFiles = fs.readdirSync(commandsTemplateDir).filter((f) => f.endsWith('.md'));
  if (templateFiles.length === 0) {
    throw new Error(`Command template directory is empty: ${commandsTemplateDir}`);
  }
  for (const file of templateFiles) {
    writeText(path.join(targetCommandsDir, file), readText(path.join(commandsTemplateDir, file)));
  }

  if (fs.existsSync(artifactsTemplateDir)) {
    const artifactFiles = fs.readdirSync(artifactsTemplateDir).filter((f) => /\.(js|mjs|ts|mts)$/.test(f));
    for (const file of artifactFiles) {
      writeText(path.join(targetArtifactsDir, file), readText(path.join(artifactsTemplateDir, file)));
    }
  }

  if (fs.existsSync(skillsTemplateDir)) {
    fs.cpSync(skillsTemplateDir, targetSkillsDir, { recursive: true });
  }

  if (fs.existsSync(typesTemplateDir)) {
    fs.cpSync(typesTemplateDir, targetTypesDir, { recursive: true });
  }

  let agentsMdTemplate = readText(path.join(workspaceTemplateDir, 'AGENTS.md'));
  agentsMdTemplate = agentsMdTemplate
    .replace('{{workspace_name}}', name)
    .replace('{{workspace_description}}', description || '(Add a short workspace summary here.)');
  writeText(path.join(root, 'AGENTS.md'), agentsMdTemplate);

  const gitignoreContent = readText(path.join(workspaceTemplateDir, 'gitignore'));
  writeText(path.join(root, '.gitignore'), gitignoreContent);

  await distributeCommands(root, null, agents);

  log.step('Initializing Git repository...');
  if (!fileExists(path.join(root, '.git'))) {
    await initRepo(root);
  }
  await addAndCommit(root, 'chore: init dojo workspace');
}

async function autoCommitWorkspaceConfig(root: string, message: string): Promise<void> {
  try {
    await stagePathsAndCommit(root, ['.dojo/config.json'], message);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn(`Repository was registered, but Dojo could not auto-commit .dojo/config.json: ${detail}`);
    log.warn('Run `git status` if you want to review and commit the updated workspace config.');
  }
}

async function promptOptionalRepos(root: string): Promise<void> {
  let addMore = await confirm({ message: 'Add a Git repository now?', default: true });

  while (addMore) {
    const gitUrl = await input({ message: 'Git remote URL:' });
    const repoName = gitUrl.match(/\/([^/]+?)(?:\.git)?$/)?.[1] ?? 'unknown-repo';

    const repoType = await select({
      message: `Repo type (${repoName}):`,
      choices: [
        { name: 'biz — product / services', value: 'biz' as RepoType },
        { name: 'dev — tooling', value: 'dev' as RepoType },
        { name: 'wiki — knowledge / reference', value: 'wiki' as RepoType },
      ],
    });

    const repoDesc = await input({ message: 'Repository description:' });
    const repoPath = `repos/${repoType}/${repoName}`;
    const fullPath = path.join(root, repoPath);

    log.step(`Cloning ${repoName}...`);
    try {
      await cloneRepo(gitUrl, fullPath);
      const repoConfig: RepoConfig = {
        name: repoName,
        type: repoType,
        git: gitUrl,
        path: repoPath,
        description: repoDesc,
      };
      addRepo(root, repoConfig);
      await autoCommitWorkspaceConfig(root, `chore: register repository ${repoName}`);
      log.success(`Repository "${repoName}" added.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Clone failed: ${msg}`);
    }

    console.log();
    addMore = await confirm({ message: 'Add another repository?', default: false });
  }
}

function formatCdIntoWorkspace(fromCwd: string, workspaceRoot: string): string {
  const rel = path.relative(fromCwd, workspaceRoot);
  const usePath = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : workspaceRoot;
  return /\s/.test(usePath) ? `cd "${usePath.replace(/"/g, '\\"')}"` : `cd ${usePath}`;
}

function printNextSteps(options?: { workspaceRoot: string }): void {
  const cwd = process.cwd();
  console.log();
  log.info('Next steps:');
  if (options?.workspaceRoot) {
    const resolvedWs = path.resolve(options.workspaceRoot);
    const resolvedCwd = path.resolve(cwd);
    if (resolvedWs !== resolvedCwd) {
      const cdCmd = formatCdIntoWorkspace(resolvedCwd, resolvedWs);
      log.info(`  ${cdCmd}  — then run:`);
    }
  }
  log.info('  dojo session new  — create a Dojo work session');
  log.info('  dojo start        — launch your AI tool');
}

async function doInit(root: string): Promise<void> {
  if (isDojoWorkspace(root)) {
    log.error(`"${root}" is already a Dojo workspace.`);
    process.exit(1);
  }

  printBanner();
  console.log();

  const { name, description } = await promptWorkspaceProfile(path.basename(root));
  const { agents, agent_commands } = await promptAgentPreferences();
  await applyInit(root, name, description, agents, agent_commands);

  const absRoot = path.resolve(root);
  log.success(`Workspace "${name}" initialized.`);
  log.info(`Root: ${absRoot} (config in hidden ${path.join(absRoot, DOJO_DIR)} — use ls -a)`);
  console.log();

  await promptOptionalRepos(root);
  printNextSteps({ workspaceRoot: root });
}

async function doCreate(cliNameArg?: string): Promise<void> {
  printBanner();
  console.log();

  let name: string;
  if (cliNameArg?.trim()) {
    name = cliNameArg.trim();
  } else {
    const raw = await input({ message: 'Workspace name:' });
    name = raw.trim();
    if (!name) {
      log.error('Workspace name cannot be empty.');
      process.exit(1);
    }
  }

  const dirSegment = safeWorkspaceDirSegment(name);
  const targetDir = path.resolve(process.cwd(), dirSegment);

  if (isDojoWorkspace(targetDir)) {
    log.error(`"${dirSegment}" is already a Dojo workspace.`);
    process.exit(1);
  }

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    log.error(`"${dirSegment}" already exists and is not empty.`);
    process.exit(1);
  }

  const description = await input({ message: 'Workspace description:' });
  const { agents, agent_commands } = await promptAgentPreferences();
  await applyInit(targetDir, name, description, agents, agent_commands);

  const absTarget = path.resolve(targetDir);
  log.success(`Workspace "${name}" initialized.`);
  log.info(`Root: ${absTarget} (config in hidden ${path.join(absTarget, DOJO_DIR)} — use ls -a)`);
  console.log();

  await promptOptionalRepos(targetDir);
  printNextSteps({ workspaceRoot: targetDir });
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a Dojo workspace in the current directory')
    .action(async () => {
      await doInit(process.cwd());
    });

  program
    .command('create [name]')
    .description('Create a subdirectory and initialize (same flow as init; optional name arg)')
    .action(async (name?: string) => {
      await doCreate(name);
    });
}
