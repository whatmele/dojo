import { Command } from 'commander';
import path from 'node:path';
import { findWorkspaceRoot } from '../core/workspace.js';
import { readConfig } from '../core/config.js';
import { getActiveSession } from '../core/state.js';
import { generateContext } from '../core/context-generator.js';
import { distributeCommands } from '../core/command-distributor.js';
import { log } from '../utils/logger.js';

export function registerContextCommand(program: Command): void {
  const context = program
    .command('context')
    .description('Context management');

  context
    .command('reload')
    .description('Reload context and command stubs')
    .action(async () => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const session = getActiveSession(root);

      if (session) {
        log.step(`Reloading context for session "${session.id}"...`);
        await distributeCommands(root, session.id, config.agents);
        await generateContext(root, session, config);
        log.success('Context and command stubs refreshed.');
      } else {
        log.step('No active session — refreshing baseline commands and rebuilding baseline context...');
        await distributeCommands(root, null, config.agents);
        await generateContext(root, null, config);
        log.success('Baseline commands refreshed; baseline context updated.');
      }
    });
}
