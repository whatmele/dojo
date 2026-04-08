import chalk from 'chalk';
import { Command } from 'commander';
import { findWorkspaceRoot } from '../core/workspace.js';
import { readConfig } from '../core/config.js';
import { getActiveSession, listSessions, readSessionState, sessionExists } from '../core/state.js';
import { buildTaskOverview } from '../core/task-overview.js';
import type { RepoConfig, SessionState } from '../types.js';
import { log } from '../utils/logger.js';

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

function printRepoTable(repos: RepoConfig[]): void {
  if (repos.length === 0) {
    log.warn('No repositories registered yet.');
    return;
  }

  const rows = [
    ['Repo', 'Type', 'Path', 'Description'],
    ...repos.map((repo) => [
      repo.name,
      repo.type,
      repo.path,
      repo.description?.trim() ? repo.description : '-',
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
    log.warn('No sessions found.');
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
    log.warn('No tasks tracked for the active session yet.');
    return;
  }
  log.info(
    `Tasks: total=${overview.summary.total} ready=${overview.summary.ready} blocked=${overview.summary.blocked} done=${overview.summary.done} untracked=${overview.summary.untracked}`,
  );
  const readyTasks = overview.items.filter((item) => item.dependency_status === 'ready');
  if (readyTasks.length > 0) {
    log.info(`Current actionable tasks: ${readyTasks.map((item) => item.name).join(', ')}`);
  }
}

function printWorkspaceRuntimeOverview(): void {
  const root = findWorkspaceRoot();
  const config = readConfig(root);
  const active = getActiveSession(root);
  const sessions = listSessions(root);

  log.info(`Workspace "${config.workspace.name}"`);
  log.info(`Mode: ${active ? 'session' : 'baseline'}`);
  log.info(`Active session: ${active?.id ?? '-'}`);
  log.info(`Agents: ${config.agents.join(', ')}`);
  log.info(`Registered repos: ${config.repos.length}`);
  log.info(`Sessions: ${sessions.length}`);
  log.info(`Context path: ${root}/.dojo/context.md`);
  if (active) {
    log.info(`Artifact root: ${root}/.dojo/sessions/${active.id}/`);
  }

  console.log();
  log.info('Registered repositories');
  printRepoTable(config.repos);

  if (sessions.length > 0) {
    console.log();
    log.info('Known sessions');
    printSessionTable(sessions, active?.id ?? null);
  }

  if (active) {
    console.log();
    log.info(`Active session "${active.id}"`);
    printTaskSummary(root, active.id);
  }
}

function printSessionDetail(target: SessionState): void {
  const root = findWorkspaceRoot();
  const active = getActiveSession(root);

  log.info(`Session "${target.id}"`);
  log.info(`Status: ${colorSessionStatus(target.status)}`);
  log.info(`Description: ${target.description}`);
  log.info(`Created: ${target.created_at}`);
  log.info(`Updated: ${target.updated_at ?? target.created_at}`);
  log.info(`Artifact root: ${root}/.dojo/sessions/${target.id}/`);
  if (target.external_link) {
    log.info(`Link: ${target.external_link}`);
  }
  log.info(`Active now: ${active?.id === target.id ? 'yes' : 'no'}`);
  console.log();
  printTaskSummary(root, target.id);
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show current runtime overview')
    .action(() => {
      printWorkspaceRuntimeOverview();
    });

  const session = program.commands.find((command) => command.name() === 'session');
  if (!session) return;

  session
    .command('list')
    .description('List Dojo sessions')
    .action(() => {
      const root = findWorkspaceRoot();
      const active = getActiveSession(root);
      const sessions = listSessions(root);
      printSessionTable(sessions, active?.id ?? null);
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
