import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { simpleGit } from 'simple-git';
import { readConfig } from '../core/config.js';
import { getTemplateScope } from '../core/protocol.js';
import {
  getActiveSession,
  listSessions,
  readSessionState,
  sessionExists,
} from '../core/state.js';
import { buildTaskOverview } from '../core/task-overview.js';
import { findWorkspaceRoot, resolveRepoPath } from '../core/workspace.js';
import {
  AGENTS_COMMANDS_DIR,
  AGENTS_SKILLS_DIR,
  AGENT_COMMAND_DIRS,
  AGENT_SKILL_DIRS,
} from '../types.js';
import type { AgentTool, RepoConfig, SessionState } from '../types.js';
import { fileExists, readText } from '../utils/fs.js';
import { log } from '../utils/logger.js';

interface RuntimeInventory {
  sourceCommands: string[];
  visibleCommands: string[];
  materializedCommands: string[];
  sourceSkills: string[];
  materializedSkills: string[];
  commandSurfaceFresh: boolean;
  skillSurfaceFresh: boolean;
  agentSurfaces: string[];
}

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

function columnWidths(rows: string[][]): number[] {
  return rows[0].map((_, columnIndex) => Math.max(...rows.map((row) => row[columnIndex].length)));
}

function renderRow(row: string[], widths: number[], statusColumnIndex?: number): string {
  return row.map((cell, index) => {
    if (index === statusColumnIndex) {
      return colorSessionStatus(cell);
    }
    return pad(cell, widths[index]);
  }).join(' | ');
}

function colorSessionStatus(value: string): string {
  if (value === 'active') return chalk.green(value);
  if (value === 'completed') return chalk.cyan(value);
  if (value === 'suspended') return chalk.yellow(value);
  return value;
}

function friendlyAgentName(agent: AgentTool): string {
  switch (agent) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'cursor':
      return 'Cursor';
    case 'trae':
      return 'Trae';
    default:
      return agent;
  }
}

function listManagedCommandNames(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.startsWith('dojo-') && entry.name.endsWith('.md'))
    .map((entry) => entry.name.replace(/\.md$/, ''))
    .sort();
}

function listSkillNames(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(dirPath, id, 'SKILL.md')))
    .sort();
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((item, index) => item === rightSorted[index]);
}

function previewList(items: string[], limit = 6): string {
  if (items.length === 0) return '-';
  if (items.length <= limit) return items.join(', ');
  return `${items.slice(0, limit).join(', ')} +${items.length - limit} more`;
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function badge(label: string, value: string, background: (content: string) => string): string {
  return background(` ${label} ${value} `);
}

function printTitle(title: string, subtitle?: string): void {
  console.log(chalk.bold.hex('#ff8a3d')('DOJO RUNTIME DASHBOARD'));
  console.log(chalk.bold(title));
  if (subtitle?.trim()) {
    console.log(chalk.dim(subtitle));
  }
}

function printSection(title: string): void {
  console.log();
  console.log(chalk.bold.hex('#ff8a3d')(title.toUpperCase()));
  console.log(chalk.dim('-'.repeat(Math.max(32, title.length + 8))));
}

function printField(label: string, value: string): void {
  console.log(`${chalk.dim(pad(label, 18))}${value}`);
}

function renderStateStrip(values: string[]): void {
  console.log(values.join('  '));
}

function collectRuntimeInventory(root: string, sessionId: string | null, agents: AgentTool[]): RuntimeInventory {
  const commandSourceDir = path.join(root, '.dojo', 'commands');
  const skillSourceDir = path.join(root, '.dojo', 'skills');
  const materializedCommandDir = path.join(root, AGENTS_COMMANDS_DIR);
  const materializedSkillDir = path.join(root, AGENTS_SKILLS_DIR);

  const sourceCommands = fs.existsSync(commandSourceDir)
    ? fs.readdirSync(commandSourceDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
    : [];

  const visibleCommands = sourceCommands
    .filter((fileName) => {
      const scope = getTemplateScope(readText(path.join(commandSourceDir, fileName)));
      return !(sessionId === null && scope === 'session');
    })
    .map((fileName) => fileName.replace(/\.md$/, ''));

  const materializedCommands = listManagedCommandNames(materializedCommandDir);
  const sourceSkills = listSkillNames(skillSourceDir);
  const materializedSkills = listSkillNames(materializedSkillDir);

  const agentSurfaces = agents.map((agent) => {
    const commandMirrorDir = AGENT_COMMAND_DIRS[agent] ? path.join(root, AGENT_COMMAND_DIRS[agent]!) : null;
    const skillMirrorDir = AGENT_SKILL_DIRS[agent] ? path.join(root, AGENT_SKILL_DIRS[agent]!) : null;
    const mirroredCommands = commandMirrorDir ? listManagedCommandNames(commandMirrorDir).length : 0;
    const mirroredSkills = skillMirrorDir ? listSkillNames(skillMirrorDir).length : 0;

    if (agent === 'claude-code') {
      return `${friendlyAgentName(agent)} -> ${plural(mirroredCommands, 'command link')}, ${plural(mirroredSkills, 'skill link')}`;
    }
    if (agent === 'trae') {
      return `${friendlyAgentName(agent)} -> ${plural(mirroredCommands, 'command link')}, skills via ${AGENTS_SKILLS_DIR}`;
    }
    return `${friendlyAgentName(agent)} -> launched via dojo start (reads workspace runtime)`;
  });

  return {
    sourceCommands: sourceCommands.map((fileName) => fileName.replace(/\.md$/, '')),
    visibleCommands,
    materializedCommands,
    sourceSkills,
    materializedSkills,
    commandSurfaceFresh: sameMembers(visibleCommands, materializedCommands),
    skillSurfaceFresh: sameMembers(sourceSkills, materializedSkills),
    agentSurfaces,
  };
}

function printRepoTable(repos: RepoConfig[]): void {
  if (repos.length === 0) {
    console.log(chalk.yellow('  No repositories registered yet.'));
    console.log(chalk.dim('  Tip: run `dojo repo add` to register a workspace repo.'));
    return;
  }

  const rows = [
    ['Repo', 'Type', 'Path', 'Git'],
    ...repos.map((repo) => [
      repo.name,
      repo.type,
      repo.path,
      repo.git,
    ]),
  ];
  const widths = columnWidths(rows);

  console.log(chalk.bold(renderRow(rows[0], widths)));
  console.log(chalk.dim(widths.map((width) => '-'.repeat(width)).join('-|-')));
  for (const row of rows.slice(1)) {
    console.log(renderRow(row, widths));
  }
}

function printSessionTable(sessions: SessionState[], activeId: string | null): void {
  if (sessions.length === 0) {
    console.log(chalk.yellow('  No sessions found yet.'));
    console.log(chalk.dim('  Tip: run `dojo session new` to open your first working thread.'));
    return;
  }

  const rows = [
    ['Session', 'Status', 'Updated', 'Description'],
    ...sessions.map((session) => [
      activeId === session.id ? `${session.id} *` : session.id,
      session.status,
      session.updated_at ?? session.created_at,
      session.description,
    ]),
  ];
  const widths = columnWidths(rows);

  console.log(chalk.bold(renderRow(rows[0], widths)));
  console.log(chalk.dim(widths.map((width) => '-'.repeat(width)).join('-|-')));
  for (const row of rows.slice(1)) {
    console.log(renderRow(row, widths, 1));
  }
}

function printTaskSummary(root: string, sessionId: string): void {
  const overview = buildTaskOverview(root, sessionId);
  if (overview.items.length === 0) {
    console.log(chalk.yellow('  No tasks tracked for this session yet.'));
    console.log(chalk.dim('  Tip: run /dojo-task-decompose to create a task manifest.'));
    return;
  }

  printField(
    'Task pulse',
    `total=${overview.summary.total} ready=${overview.summary.ready} blocked=${overview.summary.blocked} done=${overview.summary.done} untracked=${overview.summary.untracked}`,
  );

  const readyTasks = overview.items.filter((item) => item.dependency_status === 'ready').map((item) => item.name);
  printField('Actionable now', readyTasks.length > 0 ? previewList(readyTasks, 8) : 'No ready task right now');
}

function formatGitCounters(staged: number, changed: number, untracked: number): string {
  const parts: string[] = [];
  if (staged > 0) parts.push(`${staged} staged`);
  if (changed > 0) parts.push(`${changed} changed`);
  if (untracked > 0) parts.push(`${untracked} untracked`);
  return parts.length > 0 ? parts.join(', ') : 'clean';
}

async function printGitStatus(root: string, repos: RepoConfig[]): Promise<void> {
  printSection('Git status');
  if (repos.length === 0) {
    console.log(chalk.yellow('  No repositories registered yet.'));
    console.log(chalk.dim('  Tip: run `dojo repo add` before using `dojo status --git`.'));
    return;
  }

  const rows: string[][] = [['Repo', 'Branch', 'State', 'Summary']];
  for (const repo of repos) {
    const fullPath = resolveRepoPath(root, repo.path);
    if (!fs.existsSync(fullPath)) {
      rows.push([repo.name, '-', chalk.red('missing'), 'repository directory not found']);
      continue;
    }

    try {
      const git = simpleGit(fullPath);
      const status = await git.status();
      const staged = status.staged.length;
      const changed = status.modified.length + status.deleted.length + status.created.length + status.renamed.length;
      const untracked = status.not_added.length;
      rows.push([
        repo.name,
        status.current || 'HEAD',
        status.isClean() ? 'clean' : 'dirty',
        formatGitCounters(staged, changed, untracked),
      ]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push([repo.name, '-', 'error', message]);
    }
  }

  const widths = columnWidths(rows);
  console.log(chalk.bold(renderRow(rows[0], widths)));
  console.log(chalk.dim(widths.map((width) => '-'.repeat(width)).join('-|-')));
  for (const row of rows.slice(1)) {
    const state = row[2] === 'clean'
      ? chalk.green(row[2])
      : row[2] === 'dirty'
        ? chalk.yellow(row[2])
        : chalk.red(row[2]);
    console.log(renderRow([row[0], row[1], state, row[3]], widths));
  }
}

function printSimpleWorkspaceOverview(
  root: string,
  repos: RepoConfig[],
  inventory: RuntimeInventory,
): void {
  printSection('Overview');
  printField(
    'Commands',
    `${plural(inventory.materializedCommands.length, 'command')} (${previewList(inventory.materializedCommands)})`,
  );
  printField(
    'Skills',
    `${plural(inventory.materializedSkills.length, 'skill')} (${previewList(inventory.materializedSkills)})`,
  );
  printField(
    'Repositories',
    `${plural(repos.length, 'repo')} ${repos.length > 0 ? `(${previewList(repos.map((repo) => repo.name))})` : ''}`.trim(),
  );
  printField('Workspace', root);
}

async function printWorkspaceRuntimeOverview(full: boolean, includeGit: boolean): Promise<void> {
  const root = findWorkspaceRoot();
  const config = readConfig(root);
  const active = getActiveSession(root);
  const sessions = listSessions(root);
  const inventory = collectRuntimeInventory(root, active?.id ?? null, config.agents);
  const runtimeFresh = inventory.commandSurfaceFresh && inventory.skillSurfaceFresh;

  printTitle(config.workspace.name, config.workspace.description || 'AI workspace runtime overview');
  console.log();
  renderStateStrip([
    badge('MODE', active ? 'SESSION' : 'BASELINE', active ? chalk.bgGreen.black : chalk.bgBlue.black),
    badge('SESSION', active?.id ?? '-', active ? chalk.bgMagenta.black : chalk.bgWhite.black),
    badge('AGENTS', String(config.agents.length), chalk.bgCyan.black),
    badge('REPOS', String(config.repos.length), chalk.bgYellow.black),
    badge('SESSIONS', String(sessions.length), chalk.bgHex('#f97316').black),
    badge('COMMANDS', `${inventory.visibleCommands.length}/${inventory.sourceCommands.length}`, chalk.bgHex('#a855f7').black),
    badge('SKILLS', `${inventory.materializedSkills.length}/${inventory.sourceSkills.length}`, chalk.bgHex('#fb7185').black),
    badge('RUNTIME', runtimeFresh ? 'FRESH' : 'STALE', runtimeFresh ? chalk.bgGreen.black : chalk.bgRed.white),
  ]);

  if (!full) {
    printSimpleWorkspaceOverview(root, config.repos, inventory);
    if (includeGit) {
      await printGitStatus(root, config.repos);
    }
    return;
  }

  printSection('Workspace');
  printField('Root', root);
  printField('Context', path.join(root, '.dojo', 'context.md'));
  printField('Guide', fileExists(path.join(root, 'AGENTS.md')) ? path.join(root, 'AGENTS.md') : '-');
  printField('Agents', config.agents.map((agent) => friendlyAgentName(agent)).join(', '));
  if (active) {
    printField('Artifact root', path.join(root, '.dojo', 'sessions', active.id));
  } else {
    printField('Artifact root', path.join(root, '.dojo', 'sessions', 'baseline'));
  }
  printField(
    'Session note',
    active
      ? `Session-scoped commands are live for "${active.id}".`
      : 'Baseline mode is active; session-only commands stay parked until you resume a session.',
  );

  printSection('Runtime assets');
  printField(
    'Command templates',
    `${plural(inventory.sourceCommands.length, 'template')} in .dojo/commands`,
  );
  printField(
    'Visible now',
    `${plural(inventory.visibleCommands.length, 'command')} in this mode (${previewList(inventory.visibleCommands)})`,
  );
  printField(
    'Materialized',
    `${plural(inventory.materializedCommands.length, 'command')} in ${AGENTS_COMMANDS_DIR} (${previewList(inventory.materializedCommands)})`,
  );
  printField(
    'Skill packs',
    `${plural(inventory.sourceSkills.length, 'skill')} in .dojo/skills (${previewList(inventory.sourceSkills)})`,
  );
  printField(
    'Skill surface',
    `${plural(inventory.materializedSkills.length, 'skill')} in ${AGENTS_SKILLS_DIR} (${previewList(inventory.materializedSkills)})`,
  );
  printField(
    'Runtime sync',
    runtimeFresh
      ? chalk.green('Fresh - rendered surfaces match the current workspace mode.')
      : chalk.yellow('Needs refresh - run `dojo context reload` or `dojo start`.'),
  );

  if (inventory.agentSurfaces.length > 0) {
    printField('Agent mirrors', inventory.agentSurfaces[0]);
    for (const extra of inventory.agentSurfaces.slice(1)) {
      printField('', extra);
    }
  }

  printSection('Repositories');
  printRepoTable(config.repos);

  printSection('Sessions');
  printSessionTable(sessions, active?.id ?? null);

  if (active) {
    printSection('Work pulse');
    printField('Active session', active.id);
    printField('Description', active.description);
    printTaskSummary(root, active.id);
  }

  if (includeGit) {
    await printGitStatus(root, config.repos);
  }
}

function printSessionDetail(target: SessionState): void {
  const root = findWorkspaceRoot();
  const active = getActiveSession(root);

  printTitle(`Session ${target.id}`, target.description);
  console.log();
  renderStateStrip([
    badge('STATUS', target.status.toUpperCase(), target.status === 'active' ? chalk.bgGreen.black : target.status === 'completed' ? chalk.bgCyan.black : chalk.bgYellow.black),
    badge('ACTIVE NOW', active?.id === target.id ? 'YES' : 'NO', active?.id === target.id ? chalk.bgGreen.black : chalk.bgWhite.black),
  ]);

  printSection('Session details');
  printField('ID', target.id);
  printField('Status', target.status);
  printField('Description', target.description);
  printField('Created', target.created_at);
  printField('Updated', target.updated_at ?? target.created_at);
  printField('Artifact root', path.join(root, '.dojo', 'sessions', target.id));
  if (target.external_link) {
    printField('Link', target.external_link);
  }

  printSection('Work pulse');
  printTaskSummary(root, target.id);
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show current runtime overview')
    .option('--full', 'Show the full runtime dashboard')
    .option('--git', 'Show git status summary for each registered repository')
    .action(async (options: { full?: boolean; git?: boolean }) => {
      await printWorkspaceRuntimeOverview(Boolean(options.full), Boolean(options.git));
    });

  const session = program.commands.find((command) => command.name() === 'session');
  if (!session) return;

  session
    .command('list')
    .description('List Dojo sessions')
    .action(() => {
      const root = findWorkspaceRoot();
      const active = getActiveSession(root);
      printSessionTable(listSessions(root), active?.id ?? null);
    });

  session
    .command('status [session-id]')
    .description('Show one session or the current active session')
    .action((sessionId?: string) => {
      const root = findWorkspaceRoot();
      const target = sessionId
        ? (sessionExists(root, sessionId) ? readSessionState(root, sessionId) : null)
        : getActiveSession(root);

      if (!target) {
        log.error(sessionId ? `Session "${sessionId}" does not exist.` : 'No active session.');
        process.exit(1);
      }

      printSessionDetail(target);
    });
}
