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
    .description('刷新上下文并启动 AI 工具')
    .action(async (tool?: string) => {
      const root = findWorkspaceRoot();
      const config = readConfig(root);
      const session = getActiveSession(root);

      printBanner();
      console.log();

      log.step('刷新上下文...');
      if (session) {
        distributeCommands(root, session.id, config.agents);
        await generateContext(root, session, config);
      } else {
        writeText(path.join(root, DOJO_DIR, 'context.md'), '');
        log.dim('  当前没有活跃会话，context.md 已清空。');
      }

      const targetTool = (tool ?? config.agents[0]) as AgentTool;
      const cmd = config.agent_commands?.[targetTool] ?? TOOL_COMMANDS[targetTool];

      if (!cmd) {
        log.error(`不支持的工具: ${targetTool}`);
        log.info(`支持的工具: ${Object.keys(TOOL_COMMANDS).join(', ')}`);
        process.exit(1);
      }

      log.success(`上下文已刷新。启动 ${targetTool}...`);

      const child = spawn(cmd, [], {
        cwd: root,
        stdio: 'inherit',
        shell: true,
      });

      child.on('error', (err: Error) => {
        log.error(`启动 ${cmd} 失败: ${err.message}`);
        log.info(`请确保 ${cmd} 已安装并在 PATH 中。`);
        process.exit(1);
      });

      child.on('exit', (code: number | null) => {
        process.exit(code ?? 0);
      });
    });
}
