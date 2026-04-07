import { Command } from 'commander';
import { log } from '../utils/logger.js';

interface CompletionCommandSpec {
  token: string;
  usage?: string;
  description: string;
  children: CompletionCommandSpec[];
}

function sanitizeDescription(value: string | undefined): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/'/g, "\\'");
}

function describeCommand(command: Command): string {
  const usage = command.usage();
  const description = sanitizeDescription(command.description());
  if (usage && usage !== command.name()) {
    return description ? `${description} (${usage})` : usage;
  }
  return description;
}

function collectCommandSpecs(command: Command): CompletionCommandSpec[] {
  return command.commands
    .filter(child => !child.name().startsWith('help'))
    .map(child => ({
      token: child.name(),
      usage: child.usage(),
      description: describeCommand(child),
      children: collectCommandSpecs(child),
    }));
}

function renderZshSpecs(varName: string, specs: CompletionCommandSpec[]): string[] {
  const lines: string[] = [];
  lines.push(`  local -a ${varName}`);
  lines.push(`  ${varName}=(`);
  for (const spec of specs) {
    lines.push(`    '${spec.token}:${spec.description}'`);
  }
  lines.push('  )');
  return lines;
}

export function renderZshCompletion(program: Command): string {
  const specs = collectCommandSpecs(program);
  const lines: string[] = [];
  lines.push('#compdef dojo');
  lines.push('');
  lines.push('_dojo() {');
  lines.push('  local context state state_descr line');
  lines.push('  typeset -A opt_args');
  lines.push(...renderZshSpecs('top_level_commands', specs));
  lines.push('');
  lines.push("  _arguments -C '1:command:->command' '2:subcommand:->subcommand' '*::args:_files'");
  lines.push('');
  lines.push('  case $state in');
  lines.push('    command)');
  lines.push("      _describe -t commands 'dojo commands' top_level_commands");
  lines.push('      return');
  lines.push('      ;;');
  lines.push('    subcommand)');
  lines.push('      case $words[2] in');

  for (const spec of specs.filter(item => item.children.length > 0)) {
    const varName = `${spec.token.replace(/[^a-zA-Z0-9]+/g, '_')}_subcommands`;
    lines.push(`        (${spec.token})`);
    lines.push(...renderZshSpecs(varName, spec.children));
    lines.push(`          _describe -t commands '${spec.token} commands' ${varName}`);
    lines.push('          return');
    lines.push('          ;;');
  }

  lines.push('      esac');
  lines.push('      ;;');
  lines.push('  esac');
  lines.push('}');
  lines.push('');
  lines.push('_dojo "$@"');
  lines.push('');
  return lines.join('\n');
}

export function renderBashCompletion(program: Command): string {
  const specs = collectCommandSpecs(program);
  const topLevel = specs.map(spec => spec.token).join(' ');
  const lines: string[] = [];
  lines.push('_dojo_completion() {');
  lines.push('  local cur prev');
  lines.push('  cur="${COMP_WORDS[COMP_CWORD]}"');
  lines.push('  prev="${COMP_WORDS[COMP_CWORD-1]}"');
  lines.push('');
  lines.push('  case "${COMP_WORDS[1]}" in');
  for (const spec of specs.filter(item => item.children.length > 0)) {
    const children = spec.children.map(child => child.token).join(' ');
    lines.push(`    ${spec.token})`);
    lines.push(`      COMPREPLY=( $(compgen -W "${children}" -- "$cur") )`);
    lines.push('      return 0');
    lines.push('      ;;');
  }
  lines.push('  esac');
  lines.push('');
  lines.push(`  COMPREPLY=( $(compgen -W "${topLevel}" -- "$cur") )`);
  lines.push('  return 0');
  lines.push('}');
  lines.push('');
  lines.push('complete -F _dojo_completion dojo');
  lines.push('');
  return lines.join('\n');
}

export function registerCompletionCommand(program: Command): void {
  program
    .command('completion <shell>')
    .description('Print shell completion script for zsh or bash')
    .action((shell: string) => {
      const normalized = shell.trim().toLowerCase();
      if (normalized === 'zsh') {
        process.stdout.write(renderZshCompletion(program));
        return;
      }
      if (normalized === 'bash') {
        process.stdout.write(renderBashCompletion(program));
        return;
      }
      log.error(`Unsupported shell: ${shell}`);
      process.exit(1);
    });
}
