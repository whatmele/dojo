import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerInitCommand } from '../../src/commands/init.js';
import { registerRepoCommand } from '../../src/commands/repo.js';
import { registerSessionCommand } from '../../src/commands/session.js';
import { registerContextCommand } from '../../src/commands/context.js';
import { registerStartCommand } from '../../src/commands/start.js';
import { registerTemplateCommand } from '../../src/commands/template.js';
import { registerArtifactCommand } from '../../src/commands/artifact.js';
import { registerCompletionCommand, renderZshCompletion, renderBashCompletion } from '../../src/commands/completion.js';

function buildProgram(): Command {
  const program = new Command();
  program.name('dojo');
  registerInitCommand(program);
  registerRepoCommand(program);
  registerSessionCommand(program);
  registerContextCommand(program);
  registerStartCommand(program);
  registerTemplateCommand(program);
  registerArtifactCommand(program);
  registerCompletionCommand(program);
  return program;
}

describe('shell completion', () => {
  it('renders zsh completion with top-level and nested command descriptions', () => {
    const script = renderZshCompletion(buildProgram());

    expect(script).toContain('#compdef dojo');
    expect(script).toContain("'session:Development session management ([options] [command])'");
    expect(script).toContain("'new:Create a new dev session ([options])'");
    expect(script).toContain("'template:Template management ([options] [command])'");
    expect(script).toContain("'lint:Validate Dojo command templates ([options] [target])'");
  });

  it('renders bash completion with top-level and nested command names', () => {
    const script = renderBashCompletion(buildProgram());

    expect(script).toContain('complete -F _dojo_completion dojo');
    expect(script).toContain('repo');
    expect(script).toContain('session');
    expect(script).toContain('create');
    expect(script).toContain('lint');
  });
});
