import path from 'node:path';
import { Command } from 'commander';
import { confirm, input } from '@inquirer/prompts';
import type { SessionState, WorkspaceConfig } from '../types.js';
import { readConfig } from '../core/config.js';
import {
  getActiveSession,
  readSessionState,
  sessionExists,
  writeSessionState,
  writeWorkspaceState,
} from '../core/state.js';
import { getSessionDir, findWorkspaceRoot } from '../core/workspace.js';
import { distributeCommands } from '../core/command-distributor.js';
import { generateContext } from '../core/context-generator.js';
import { ensureDir, fileExists, listDirs, readJSON } from '../utils/fs.js';
import { log, printBanner } from '../utils/logger.js';

async function checkAllTasksDone(root: string, sessionId: string): Promise<boolean> {
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

async function nextStatusForLeavingSession(root: string, current: SessionState): Promise<'suspended' | 'completed'> {
  if (current.status !== 'active') {
    return current.status === 'completed' ? 'completed' : 'suspended';
  }

  const allTasksDone = await checkAllTasksDone(root, current.id);
  if (!allTasksDone) {
    return 'suspended';
  }

  const markComplete = await confirm({
    message: `All tasks in session "${current.id}" are done. Mark it completed before switching away?`,
    default: true,
  });

  return markComplete ? 'completed' : 'suspended';
}

function ensureSessionDirectories(root: string, sessionId: string): void {
  const sessionDir = getSessionDir(root, sessionId);
  ensureDir(path.join(sessionDir, 'product-requirements'));
  ensureDir(path.join(sessionDir, 'research'));
  ensureDir(path.join(sessionDir, 'tech-design'));
  ensureDir(path.join(sessionDir, 'tasks'));
}

async function promptSessionState(existing?: SessionState | null): Promise<SessionState> {
  const id = existing
    ? existing.id
    : await input({
      message: 'Session ID (kebab-case):',
      validate: (v: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) || 'Use kebab-case',
    });

  const description = await input({
    message: 'Session description:',
    default: existing?.description,
  });
  const externalLink = await input({
    message: 'External link (optional):',
    default: existing?.external_link ?? '',
  });

  const createdAt = existing?.created_at ?? new Date().toISOString();
  const updatedAt = new Date().toISOString();

  return {
    id,
    description,
    ...(externalLink.trim() ? { external_link: externalLink.trim() } : {}),
    created_at: createdAt,
    updated_at: updatedAt,
    status: existing?.status ?? 'active',
  };
}

async function writeActivationState(
  root: string,
  config: WorkspaceConfig,
  options: {
    nextSession: SessionState | null;
    previousSession: SessionState | null;
    previousStatus?: 'suspended' | 'completed';
  },
): Promise<void> {
  const { nextSession, previousSession, previousStatus } = options;

  if (previousSession && (!nextSession || previousSession.id !== nextSession.id)) {
    writeSessionState(root, previousSession.id, {
      ...previousSession,
      updated_at: new Date().toISOString(),
      status: previousStatus ?? 'suspended',
    });
  }

  if (nextSession) {
    writeSessionState(root, nextSession.id, {
      ...nextSession,
      updated_at: new Date().toISOString(),
      status: 'active',
    });
  }

  writeWorkspaceState(root, {
    active_session: nextSession?.id ?? null,
  });

  await distributeCommands(root, nextSession?.id ?? null, config.agents);
  await generateContext(root, nextSession, config);
}

export function registerSessionCommand(program: Command): void {
  const session = program
    .command('session')
    .description('Dojo work session management');

  const switchToNoSession = async (): Promise<void> => {
    const root = findWorkspaceRoot();
    const config = readConfig(root);
    const previous = getActiveSession(root);
    const nextStatus = previous ? await nextStatusForLeavingSession(root, previous) : undefined;

    await writeActivationState(root, config, {
      nextSession: null,
      previousSession: previous,
      previousStatus: nextStatus,
    });

    log.success('Workspace returned to baseline runtime mode.');
  };

  session
    .command('new')
    .description('Create a new Dojo session')
    .action(async () => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const previous = getActiveSession(root);

      printBanner();
      console.log();

      const nextStatus = previous ? await nextStatusForLeavingSession(root, previous) : undefined;
      const proposed = await promptSessionState();

      if (sessionExists(root, proposed.id)) {
        log.error(`Session "${proposed.id}" already exists. Run: dojo session resume ${proposed.id}`);
        process.exit(1);
      }

      ensureSessionDirectories(root, proposed.id);

      await writeActivationState(root, config, {
        nextSession: proposed,
        previousSession: previous,
        previousStatus: nextStatus,
      });

      log.success(`Session "${proposed.id}" created and active.`);
      log.info('Run dojo start to launch your AI tool.');
    });

  session
    .command('resume <session-id>')
    .description('Resume an existing session')
    .action(async (sessionId: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const previous = getActiveSession(root);

      if (!sessionExists(root, sessionId)) {
        log.error(`Session "${sessionId}" does not exist.`);
        const { listSessions } = await import('../core/state.js');
        const sessions = listSessions(root);
        if (sessions.length > 0) {
          log.info('Available sessions:');
          for (const item of sessions) {
            log.info(`  ${item.id} [${item.status}] — ${item.description}`);
          }
        }
        process.exit(1);
      }

      const nextStatus = previous && previous.id !== sessionId
        ? await nextStatusForLeavingSession(root, previous)
        : undefined;
      const target = readSessionState(root, sessionId);

      ensureSessionDirectories(root, target.id);
      await writeActivationState(root, config, {
        nextSession: target,
        previousSession: previous && previous.id !== target.id ? previous : null,
        previousStatus: nextStatus,
      });

      log.success(`Session "${sessionId}" resumed and active.`);
    });

  session
    .command('none')
    .description('Return the workspace to baseline runtime mode')
    .action(switchToNoSession);

  session
    .command('clear')
    .description('Alias of "dojo session none"')
    .action(switchToNoSession);

  session
    .command('exit')
    .description('Alias of "dojo session none"')
    .action(switchToNoSession);

  session
    .command('update <session-id>')
    .description('Update session metadata')
    .action(async (sessionId: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);

      if (!sessionExists(root, sessionId)) {
        log.error(`Session "${sessionId}" does not exist.`);
        process.exit(1);
      }

      const existing = readSessionState(root, sessionId);
      const updated = await promptSessionState(existing);
      ensureSessionDirectories(root, updated.id);

      const active = getActiveSession(root);
      if (active?.id === sessionId) {
        await writeActivationState(root, config, {
          nextSession: updated,
          previousSession: null,
        });
        log.success(`Session "${sessionId}" updated.`);
        return;
      }

      writeSessionState(root, sessionId, {
        ...updated,
        status: existing.status,
      });
      log.success(`Session "${sessionId}" updated.`);
    });
}
