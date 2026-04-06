import { Command } from 'commander';
import path from 'node:path';
import { findWorkspaceRoot } from '../core/workspace.js';
import { readConfig } from '../core/config.js';
import { getActiveSession } from '../core/state.js';
import { generateContext } from '../core/context-generator.js';
import { distributeCommands } from '../core/command-distributor.js';
import { writeText } from '../utils/fs.js';
import { DOJO_DIR } from '../types.js';
import { log } from '../utils/logger.js';

export function registerContextCommand(program: Command): void {
  const context = program
    .command('context')
    .description('上下文管理');

  context
    .command('reload')
    .description('刷新上下文和 commands')
    .action(async () => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const session = getActiveSession(root);

      if (session) {
        log.step(`刷新会话 "${session.id}" 的上下文...`);
        distributeCommands(root, session.id, config.agents);
        await generateContext(root, session, config);
        log.success('上下文和 commands 已刷新。');
      } else {
        log.step('当前没有活跃会话，刷新无会话版 commands 并清空 context.md...');
        distributeCommands(root, null, config.agents);
        writeText(path.join(root, DOJO_DIR, 'context.md'), '');
        log.success('commands 已刷新，context.md 已清空。');
      }
    });
}
