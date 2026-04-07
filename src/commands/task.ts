import chalk from 'chalk';
import { Command } from 'commander';
import { findWorkspaceRoot } from '../core/workspace.js';
import { getActiveSession } from '../core/state.js';
import { buildTaskOverview } from '../core/task-overview.js';
import type { TaskOverviewItem } from '../types.js';
import { log } from '../utils/logger.js';

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

function widths(rows: string[][]): number[] {
  return rows[0].map((_, index) => Math.max(...rows.map((row) => row[index].length)));
}

function colorStatus(value: TaskOverviewItem['dependency_status']): string {
  switch (value) {
    case 'done':
      return chalk.green(value);
    case 'ready':
      return chalk.cyan(value);
    case 'blocked':
      return chalk.yellow(value);
    case 'untracked':
      return chalk.magenta(value);
    default:
      return value;
  }
}

function renderRow(row: string[], columnWidths: number[], statusColumn?: number): string {
  return row.map((cell, index) => {
    if (index === statusColumn) {
      return colorStatus(cell as TaskOverviewItem['dependency_status']);
    }
    return pad(cell, columnWidths[index]);
  }).join(' | ');
}

function requireActiveSession(): { root: string; sessionId: string } {
  const root = findWorkspaceRoot();
  const active = getActiveSession(root);
  if (!active) {
    log.error('No active session. Run `dojo session new`, `dojo session resume`, or `dojo session none` as appropriate.');
    process.exit(1);
  }
  return { root, sessionId: active.id };
}

function printTaskOverview(): void {
  const { root, sessionId } = requireActiveSession();
  const overview = buildTaskOverview(root, sessionId);

  if (overview.items.length === 0) {
    log.warn(`Session "${sessionId}" has no tasks yet. Run /dojo-task-decompose first.`);
    return;
  }

  const rows = [
    ['Task', 'Status', 'Done', 'Depends On', 'Description'],
    ...overview.items.map((item) => [
      item.name,
      item.dependency_status,
      item.is_completed ? 'yes' : 'no',
      item.depends_on.length > 0 ? item.depends_on.join(', ') : '-',
      item.description,
    ]),
  ];
  const columnWidths = widths(rows);

  log.info(`Session "${sessionId}" task overview`);
  log.info(`Total=${overview.summary.total} Ready=${overview.summary.ready} Blocked=${overview.summary.blocked} Done=${overview.summary.done} Untracked=${overview.summary.untracked}`);
  console.log();
  console.log(chalk.bold(renderRow(rows[0], columnWidths)));
  console.log(chalk.dim(columnWidths.map((width) => '-'.repeat(width)).join('-|-')));
  for (const row of rows.slice(1)) {
    console.log(renderRow(row, columnWidths, 1));
  }
  console.log();

  const readyTasks = overview.items.filter((item) => item.dependency_status === 'ready');
  if (readyTasks.length > 0) {
    log.info(`Current actionable tasks: ${readyTasks.map((item) => item.name).join(', ')}`);
  } else {
    log.warn('No task is ready right now.');
  }
}

function printSingleTask(taskName: string): void {
  const { root, sessionId } = requireActiveSession();
  const overview = buildTaskOverview(root, sessionId);
  const task = overview.items.find((item) => item.name === taskName);

  if (!task) {
    log.error(`Task "${taskName}" not found in session "${sessionId}".`);
    process.exit(1);
  }

  log.info(`Task "${task.name}"`);
  log.info(`Session: ${sessionId}`);
  log.info(`Status: ${task.dependency_status}`);
  log.info(`Completed: ${task.is_completed ? 'yes' : 'no'}`);
  log.info(`Depends on: ${task.depends_on.length > 0 ? task.depends_on.join(', ') : '-'}`);
  log.info(`Description: ${task.description}`);
  log.info(`Directory: ${task.task_dir}`);
}

export function registerTaskCommand(program: Command): void {
  const task = program
    .command('task')
    .description('Task overview and execution status');

  task
    .command('list')
    .description('Show the active session task overview')
    .action(() => {
      printTaskOverview();
    });

  task
    .command('status [task-name]')
    .description('Show one task status or the full task overview')
    .action((taskName?: string) => {
      if (taskName?.trim()) {
        printSingleTask(taskName.trim());
        return;
      }
      printTaskOverview();
    });
}
