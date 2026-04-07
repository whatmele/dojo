import { Command } from 'commander';
import path from 'node:path';
import { findWorkspaceRoot } from '../core/workspace.js';
import { readConfig } from '../core/config.js';
import {
  validateContextArtifacts,
  validateTemplateContent,
} from '../core/protocol.js';
import { ensureDir, fileExists, listFiles, readText, writeText } from '../utils/fs.js';
import { DOJO_DIR } from '../types.js';
import { log } from '../utils/logger.js';

export interface TemplateLintIssue {
  file: string;
  message: string;
}

export interface TemplateLintResult {
  filesChecked: string[];
  issues: TemplateLintIssue[];
}

export interface TemplateCreateOptions {
  reads?: string[];
  output?: string;
  force?: boolean;
  scope?: 'workspace' | 'session' | 'mixed';
  description?: string;
  argumentHint?: string;
}

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join('/');
}

function resolveTemplateTarget(root: string, target?: string): string[] {
  const commandsDir = path.join(root, DOJO_DIR, 'commands');

  if (!target) {
    return listFiles(commandsDir)
      .filter(file => file.endsWith('.md'))
      .sort()
      .map(file => path.join(commandsDir, file));
  }

  const candidates = [
    path.isAbsolute(target) ? target : path.resolve(process.cwd(), target),
    path.join(root, target),
    path.join(commandsDir, target),
    target.endsWith('.md') ? null : path.join(commandsDir, `${target}.md`),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return [candidate];
    }
  }

  throw new Error(`Template not found: ${target}`);
}

function humanizeSlug(value: string): string {
  return value
    .replace(/^dojo-/, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeTemplateFileName(name: string): string {
  const base = name.trim().endsWith('.md') ? name.trim().slice(0, -3) : name.trim();
  const prefixed = base.startsWith('dojo-') ? base : `dojo-${base}`;
  return `${prefixed}.md`;
}

function buildTemplateScaffold(
  fileName: string,
  options: TemplateCreateOptions,
): string {
  const title = humanizeSlug(fileName);
  const scope = options.scope ?? 'session';
  const description = options.description ?? `Dojo starter template for ${title}.`;
  const argumentHint = options.argumentHint ?? '[describe the task]';
  const lines: string[] = [];
  lines.push('---');
  lines.push(`description: ${JSON.stringify(description)}`);
  lines.push(`argument-hint: ${JSON.stringify(argumentHint)}`);
  lines.push(`scope: ${scope}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Dojo: ${title}`);
  lines.push('');

  if (options.reads && options.reads.length > 0) {
    lines.push(`<dojo_read_block artifacts="${options.reads.join(',')}" />`);
      lines.push('');
  }

  lines.push('## User input');
  lines.push('');
  lines.push('$ARGUMENTS');
  lines.push('');

  if (options.output) {
    lines.push(`<dojo_write_block artifact="${options.output}" />`);
    lines.push('');
    lines.push(`Write outputs under \`${'${artifact_dir:'}${options.output}}\`.`);
    lines.push('');
  }

  lines.push('## Constraints');
  lines.push('');
  lines.push('- Follow the command intent and workspace conventions when deciding whether code changes are appropriate.');
  lines.push('- Keep `$ARGUMENTS` unchanged in the template.');
  lines.push('- Prefer artifact ids and Dojo directives over hardcoded paths.');
  lines.push('');
  lines.push('## Final response');
  lines.push('');
  lines.push('- Summarize what you changed.');
  lines.push('- List important files you created or updated.');
  lines.push('');

  return lines.join('\n');
}

export async function createTemplateScaffold(
  root: string,
  name: string,
  options: TemplateCreateOptions = {},
): Promise<string> {
  const fileName = normalizeTemplateFileName(name);
  const filePath = path.join(root, DOJO_DIR, 'commands', fileName);

  if (fileExists(filePath) && !options.force) {
    throw new Error(`Template already exists: ${normalizeSlashes(path.relative(root, filePath))}`);
  }

  ensureDir(path.dirname(filePath));
  writeText(filePath, buildTemplateScaffold(fileName, options));
  return filePath;
}

export async function lintTemplates(
  root: string,
  target?: string,
): Promise<TemplateLintResult> {
  const config = readConfig(root);
  await validateContextArtifacts(root, config);

  const files = resolveTemplateTarget(root, target);
  const issues: TemplateLintIssue[] = [];

  for (const filePath of files) {
    const content = readText(filePath);
    const messages = await validateTemplateContent(root, content);
    for (const message of messages) {
      issues.push({
        file: normalizeSlashes(path.relative(root, filePath)),
        message,
      });
    }
  }

  return {
    filesChecked: files.map(filePath => normalizeSlashes(path.relative(root, filePath))),
    issues,
  };
}

export function registerTemplateCommand(program: Command): void {
  const template = program
    .command('template')
    .description('Template management');

  template
    .command('create <name>')
    .description('Create a Dojo command template scaffold')
    .option('--reads <artifact-ids>', 'Comma-separated artifact ids for <dojo_read_block ... />')
    .option('--output <artifact-id>', 'Primary output artifact id for <dojo_write_block ... />')
    .option('--scope <scope>', 'Template scope: workspace, session, or mixed')
    .option('--description <text>', 'Frontmatter description used by tools such as Claude Code')
    .option('--argument-hint <text>', 'Frontmatter argument hint used by tools such as Claude Code')
    .option('--force', 'Overwrite an existing template file')
    .action(async (
      name: string,
      opts: {
        reads?: string;
        output?: string;
        scope?: 'workspace' | 'session' | 'mixed';
        description?: string;
        argumentHint?: string;
        force?: boolean;
      },
    ) => {
      const root = findWorkspaceRoot();
      const reads = opts.reads ? opts.reads.split(',').map(part => part.trim()).filter(Boolean) : [];
      const filePath = await createTemplateScaffold(root, name, {
        reads,
        output: opts.output?.trim() || undefined,
        scope: opts.scope,
        description: opts.description,
        argumentHint: opts.argumentHint,
        force: opts.force,
      });
      log.success(`Template scaffold created: ${normalizeSlashes(path.relative(root, filePath))}`);
      log.info('Run `dojo template lint` after editing it.');
    });

  template
    .command('lint [target]')
    .description('Validate Dojo command templates')
    .action(async (target?: string) => {
      const root = findWorkspaceRoot();
      const result = await lintTemplates(root, target);

      if (result.issues.length === 0) {
        log.success(`Validated ${result.filesChecked.length} template${result.filesChecked.length === 1 ? '' : 's'}.`);
        for (const file of result.filesChecked) {
          log.dim(`  ${file}`);
        }
        return;
      }

      log.error(`Found ${result.issues.length} template issue${result.issues.length === 1 ? '' : 's'}:`);
      for (const issue of result.issues) {
        log.error(`  ${issue.file}: ${issue.message}`);
      }
      process.exit(1);
    });
}
