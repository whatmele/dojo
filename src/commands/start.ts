import { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { findWorkspaceRoot } from '../core/workspace.js';
import { readConfig } from '../core/config.js';
import { getActiveSession } from '../core/state.js';
import { generateContext } from '../core/context-generator.js';
import { distributeCommands } from '../core/command-distributor.js';
import { reconcileWorkspaceState } from '../core/session-reconciler.js';
import { normalizeSessionState } from '../core/target-state.js';
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

      const normalized = session ? normalizeSessionState(session, config) : null;
      const reconciliation = await reconcileWorkspaceState(root, config, normalized);
      const nonDirtyBlockingIssues = reconciliation.blocking_issues
        .filter((issue) => !issue.endsWith('uncommitted changes') && !issue.endsWith(': dirty'));
      const hasBranchDrift = [reconciliation.root, ...reconciliation.repos]
        .some((item) => item.status === 'branch-mismatch' || item.status === 'missing-branch');

      if (nonDirtyBlockingIssues.length > 0 || hasBranchDrift) {
        log.error(`Workspace is not aligned for ${normalized ? `session "${normalized.id}"` : 'no-session'} mode.`);
        for (const issue of nonDirtyBlockingIssues) {
          log.error(`  - ${issue}`);
        }
        if (hasBranchDrift) {
          log.error('  - branch layout does not match the expected workspace mode');
        }
        log.info(normalized ? 'Run `dojo session status` to inspect and fix the workspace.' : 'Run `dojo status` to inspect and fix the workspace.');
        process.exit(1);
      }

      log.step('Refreshing context...');
      if (session) {
        await distributeCommands(root, normalized!.id, config.agents);
        await generateContext(root, normalized, config);
      } else {
        await distributeCommands(root, null, config.agents);
        await generateContext(root, null, config);
        log.dim('  No active session — baseline commands synced; baseline context refreshed.');
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
