import chalk from 'chalk';
import { Command } from 'commander';
import { findWorkspaceRoot } from '../core/workspace.js';
import { readConfig } from '../core/config.js';
import { getActiveSession, readSessionState, sessionExists } from '../core/state.js';
import { reconcileWorkspaceState } from '../core/session-reconciler.js';
import { normalizeSessionState } from '../core/target-state.js';
import type { ReconciledItem, WorkspaceConfig, WorkspaceReconciliation } from '../types.js';
import { log } from '../utils/logger.js';

function colorOverall(value: WorkspaceReconciliation['overall']): string {
  if (value === 'aligned') return chalk.green(value);
  if (value === 'drifted') return chalk.yellow(value);
  return chalk.red(value);
}

function colorStatus(value: ReconciledItem['status']): string {
  if (value === 'aligned') return chalk.green(value);
  if (value === 'branch-mismatch') return chalk.yellow(value);
  return chalk.red(value);
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
      return colorStatus(cell as ReconciledItem['status']);
    }
    return pad(cell, widths[index]);
  }).join(' | ');
}

function recoveryHint(
  item: ReconciledItem,
  root: string,
  config: WorkspaceConfig,
  reconciliation: WorkspaceReconciliation,
): string | null {
  const repo = item.name === 'workspace-root'
    ? { path: root, default_branch: reconciliation.root.expected_branch }
    : config.repos.find((candidate) => candidate.name === item.name);
  const pathLabel = item.name === 'workspace-root' ? root : repo?.path ?? item.name;

  switch (item.status) {
    case 'dirty':
      return `${item.name}: run \`git status\` in ${pathLabel}, then commit, stash, or discard changes before switching.`;
    case 'branch-mismatch':
      return reconciliation.session_id
        ? `${item.name}: checkout "${item.expected_branch}" or run \`dojo session resume ${reconciliation.session_id}\` to restore the session layout.${item.dirty ? ' Also clean local changes before switching.' : ''}`
        : `${item.name}: checkout the baseline branch "${item.expected_branch}" or run \`dojo session none\`.${item.dirty ? ' Also clean local changes before switching.' : ''}`;
    case 'missing-repo':
      return `${item.name}: restore the repo at ${pathLabel}, or remove/update the repo binding before switching.`;
    case 'not-git':
      return `${item.name}: ${pathLabel} exists but is not a Git repo. Re-clone or repair it first.`;
    case 'detached-head':
      return `${item.name}: checkout a named branch in ${pathLabel} before starting or switching.`;
    default:
      return null;
  }
}

function printReconciliation(
  label: string,
  root: string,
  config: WorkspaceConfig,
  reconciliation: Awaited<ReturnType<typeof reconcileWorkspaceState>>,
): void {
  const rows = [
    ['Scope', 'Expected', 'Current', 'Dirty', 'Status'],
    [
      'workspace-root',
      reconciliation.root.expected_branch,
      reconciliation.root.current_branch ?? '-',
      reconciliation.root.dirty ? 'yes' : 'no',
      reconciliation.root.status,
    ],
    ...reconciliation.repos.map((item) => [
      item.name,
      item.expected_branch,
      item.current_branch ?? '-',
      item.dirty ? 'yes' : 'no',
      item.status,
    ]),
  ];
  const widths = columnWidths(rows);
  const hints = [
    reconciliation.root,
    ...reconciliation.repos,
  ]
    .map((item) => recoveryHint(item, root, config, reconciliation))
    .filter((hint): hint is string => Boolean(hint));

  log.info(`${label}`);
  log.info(`Mode: ${reconciliation.mode} | Overall: ${colorOverall(reconciliation.overall)}`);
  console.log();

  console.log(chalk.bold(renderRow(rows[0], widths)));
  console.log(chalk.dim(widths.map((width) => '-'.repeat(width)).join('-|-')));
  rows.slice(1).forEach((row) => {
    console.log(renderRow(row, widths, 4));
  });

  if (hints.length > 0) {
    console.log();
    log.warn('How to recover');
    for (const hint of [...new Set(hints)]) {
      log.warn(`  - ${hint}`);
    }
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show current workspace alignment status')
    .action(async () => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const active = getActiveSession(root);
      const normalized = active ? normalizeSessionState(active, config) : null;
      const reconciliation = await reconcileWorkspaceState(root, config, normalized);
      printReconciliation(
        normalized ? `Active session "${normalized.id}"` : 'No active session (baseline mode)',
        root,
        config,
        reconciliation,
      );
    });

  const session = program.commands.find((command) => command.name() === 'session');
  if (!session) return;

  session
    .command('list')
    .description('List sessions and health summaries')
    .action(async () => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const active = getActiveSession(root);
      const { listSessions } = await import('../core/state.js');
      const sessions = listSessions(root);
      if (sessions.length === 0) {
        log.warn('No sessions found.');
        return;
      }
      for (const item of sessions) {
        const normalized = normalizeSessionState(item, config);
        const reconciliation = await reconcileWorkspaceState(root, config, normalized);
        const activeMark = active?.id === item.id ? ' (active)' : '';
        log.info(`${item.id}${activeMark} [${item.status}] repos=${normalized.repos?.length ?? 0} health=${reconciliation.overall} — ${item.description}`);
      }
    });

  session
    .command('status [session-id]')
    .description('Show detailed status for one session or the current active session')
    .action(async (sessionId?: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const target = sessionId
        ? (sessionExists(root, sessionId) ? readSessionState(root, sessionId) : null)
        : getActiveSession(root);

      if (!target) {
        log.error(sessionId ? `Session "${sessionId}" does not exist.` : 'No active session.');
        process.exit(1);
      }

      const normalized = normalizeSessionState(target, config);
      const reconciliation = await reconcileWorkspaceState(root, config, normalized);
      printReconciliation(`Session "${normalized.id}"`, root, config, reconciliation);
    });
}
