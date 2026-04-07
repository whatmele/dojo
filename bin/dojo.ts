#!/usr/bin/env node

import { Command } from 'commander';
import { printBanner } from '../src/utils/logger.js';
import { registerInitCommand } from '../src/commands/init.js';
import { registerRepoCommand } from '../src/commands/repo.js';
import { registerSessionCommand } from '../src/commands/session.js';
import { registerContextCommand } from '../src/commands/context.js';
import { registerStartCommand } from '../src/commands/start.js';
import { registerTemplateCommand } from '../src/commands/template.js';
import { registerArtifactCommand } from '../src/commands/artifact.js';
import { registerCompletionCommand } from '../src/commands/completion.js';
import { registerStatusCommand } from '../src/commands/status.js';
import { registerTaskCommand } from '../src/commands/task.js';

const program = new Command();

program
  .name('dojo')
  .description('Agent Workspace CLI — multi-repo workspaces, dev sessions, and AI context')
  .version('0.1.0')
  .hook('preAction', (thisCommand) => {
    if (thisCommand.args.length === 0 && thisCommand === program) {
      printBanner();
    }
  });

program.configureOutput({
  outputError: (str, write) => write(str),
});

registerInitCommand(program);
registerRepoCommand(program);
registerSessionCommand(program);
registerContextCommand(program);
registerStartCommand(program);
registerTemplateCommand(program);
registerArtifactCommand(program);
registerCompletionCommand(program);
registerStatusCommand(program);
registerTaskCommand(program);

if (process.argv.length <= 2) {
  printBanner();
  console.log();
}

function isPromptInterrupt(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  return e.name === 'ExitPromptError' || Boolean(e.message?.includes('force closed'));
}

process.on('uncaughtException', (err) => {
  if (isPromptInterrupt(err)) {
    console.log('\n');
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

program.parseAsync().catch((err) => {
  if (isPromptInterrupt(err)) {
    console.log('\n');
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
