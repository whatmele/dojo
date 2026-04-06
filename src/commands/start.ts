import { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { findWorkspaceRoot } from '../core/workspace.js';
import { readConfig } from '../core/config.js';
import { getActiveSession } from '../core/state.js';
import { generateContext } from '../core/context-generator.js';
import { distributeCommands } from '../core/command-distributor.js';
import { writeText } from '../utils/fs.js';
import { DOJO_DIR } from '../types.js';
import { log, printBanner } from '../utils/logger.js';
import type { AgentTool } from '../types.js';

export const TOOL_COMMANDS: Record<AgentTool, string> = {
  'claude-code': 'claude',
  'codex': 'codex',
  'cursor': 'cursor',
  'trae': 'trae',
};

export function registerStartCommand(program: Command): void {
  program
    .command('start [tool]')
    .description('Refresh context and start an AI tool')
    .action(async (tool?: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const session = getActiveSession(root);

      printBanner();
      console.log();

      log.step('Refreshing context...');
      if (session) {
        distributeCommands(root, session.id, config.agents);
        await generateContext(root, session, config);
      } else {
        distributeCommands(root, null, config.agents);
        writeText(path.join(root, DOJO_DIR, 'context.md'), '');
        log.dim('  No active session — no-session command stubs synced; context.md cleared.');
      }

      const targetTool = (tool ?? config.agents[0]) as AgentTool;
      const cmd = config.agent_commands?.[targetTool] ?? TOOL_COMMANDS[targetTool];

      if (!cmd) {
        log.error(`Unsupported tool: ${targetTool}`);
        log.info(`Supported tools: ${Object.keys(TOOL_COMMANDS).join(', ')}`);
        process.exit(1);
      }

      log.success(`Context refreshed. Starting ${targetTool}...`);

      const child = spawn(cmd, [], {
        cwd: root,
        stdio: 'inherit',
        shell: true,
      });

      child.on('error', (err: Error) => {
        log.error(`Failed to start ${cmd}: ${err.message}`);
        log.info(`Make sure ${cmd} is installed and on your PATH.`);
        process.exit(1);
      });

      child.on('exit', (code: number | null) => {
        process.exit(code ?? 0);
      });
    });
}
