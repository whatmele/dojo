import path from 'node:path';
import fs from 'node:fs';
import {
  DOJO_DIR,
  AGENTS_COMMANDS_DIR,
  AGENTS_SKILLS_DIR,
  AGENT_COMMAND_DIRS,
  AGENT_SKILL_DIRS,
} from '../types.js';
import type { AgentTool, WorkspaceConfig } from '../types.js';
import { listFiles, readText, writeText, ensureDir, createFileSymlink } from '../utils/fs.js';
import { readConfig } from './config.js';
import {
  expandTemplateArtifactSyntax,
  getTemplateScope,
  splitTemplateFrontmatter,
  validateTemplateContent,
} from './protocol.js';

const MARK_SESSION_START = '<!-- DOJO_SESSION_ONLY -->';
const MARK_SESSION_END = '<!-- /DOJO_SESSION_ONLY -->';
const MARK_NOSESSION_START = '<!-- DOJO_NO_SESSION_ONLY -->';
const MARK_NOSESSION_END = '<!-- /DOJO_NO_SESSION_ONLY -->';

function removeTaggedBlock(source: string, start: string, end: string): string {
  let s = source;
  while (true) {
    const a = s.indexOf(start);
    if (a === -1) return s;
    const b = s.indexOf(end, a + start.length);
    if (b === -1) return s;
    s = s.slice(0, a) + s.slice(b + end.length);
  }
}

function unwrapTaggedBlock(source: string, start: string, end: string): string {
  let s = source;
  while (true) {
    const a = s.indexOf(start);
    if (a === -1) return s;
    const b = s.indexOf(end, a + start.length);
    if (b === -1) return s;
    const inner = s.slice(a + start.length, b);
    s = s.slice(0, a) + inner + s.slice(b + end.length);
  }
}

export function applyCommandSessionPlaceholders(
  content: string,
  sessionId: string | null,
  noSessionValue = '',
): string {
  const token = sessionId ?? noSessionValue;
  let out = content
    .replace(/\$\{dojo_current_session_id\}/g, token)
    .replace(/\$\{session_id\}/g, token);

  if (sessionId) {
    out = unwrapTaggedBlock(out, MARK_SESSION_START, MARK_SESSION_END);
    out = removeTaggedBlock(out, MARK_NOSESSION_START, MARK_NOSESSION_END);
  } else {
    out = removeTaggedBlock(out, MARK_SESSION_START, MARK_SESSION_END);
    out = unwrapTaggedBlock(out, MARK_NOSESSION_START, MARK_NOSESSION_END);
  }
  return out;
}

function noSessionBannerForSessionBoundCommands(): string {
  return '> **Dojo**: No active session. Run `dojo session new` first. The segment `no-active-session` in paths is a placeholder only.\n\n';
}

function prependAfterFrontmatter(content: string, prefix: string): string {
  const parts = splitTemplateFrontmatter(content);
  if (!parts.frontmatter) return prefix + content;
  return `${parts.frontmatter}${prefix}${parts.body}`;
}

async function materializeAgentsCommands(
  root: string,
  sessionId: string | null,
  config: WorkspaceConfig,
): Promise<void> {
  const sourceDir = path.join(root, DOJO_DIR, 'commands');
  const targetDir = path.join(root, AGENTS_COMMANDS_DIR);
  ensureDir(targetDir);

  const files = listFiles(sourceDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const source = readText(path.join(sourceDir, file));
    const issues = await validateTemplateContent(root, source);
    if (issues.length > 0) {
      throw new Error(`Invalid template ${file}: ${issues[0]}`);
    }

    const scope = getTemplateScope(source);
    let content = source;
    if (sessionId === null && scope === 'session') {
      content = prependAfterFrontmatter(content, noSessionBannerForSessionBoundCommands());
      content = applyCommandSessionPlaceholders(content, null, 'no-active-session');
      content = await expandTemplateArtifactSyntax(content, root, config, {
        sessionId: null,
        noSessionPlaceholder: 'no-active-session',
      });
    } else {
      content = applyCommandSessionPlaceholders(content, sessionId, sessionId === null ? 'no-active-session' : '');
      content = await expandTemplateArtifactSyntax(content, root, config, {
        sessionId,
        noSessionPlaceholder: sessionId === null ? 'no-active-session' : '',
      });
    }

    writeText(path.join(targetDir, file), content);
  }
}

function migrateLegacyAgentCommandsDir(agentCmdDir: string, agentsCommandsDir: string): void {
  if (!fs.existsSync(agentCmdDir)) return;
  const stat = fs.lstatSync(agentCmdDir);
  if (!stat.isSymbolicLink()) return;
  let resolvedLink: string;
  let resolvedAgents: string;
  try {
    resolvedLink = fs.realpathSync(agentCmdDir);
    resolvedAgents = fs.realpathSync(agentsCommandsDir);
  } catch {
    return;
  }
  if (resolvedLink === resolvedAgents) {
    fs.unlinkSync(agentCmdDir);
  }
}

function migrateLegacyAgentSkillsDir(agentSkillDir: string, agentsSkillsDir: string): void {
  if (!fs.existsSync(agentSkillDir)) return;
  const stat = fs.lstatSync(agentSkillDir);
  if (!stat.isSymbolicLink()) return;
  let resolvedLink: string;
  let resolvedAgents: string;
  try {
    resolvedLink = fs.realpathSync(agentSkillDir);
    resolvedAgents = fs.realpathSync(agentsSkillsDir);
  } catch {
    return;
  }
  if (resolvedLink === resolvedAgents) {
    fs.unlinkSync(agentSkillDir);
  }
}

export function syncAgentDojoFileSymlinks(root: string, agents: AgentTool[]): void {
  const agentsCommandsDir = path.resolve(root, AGENTS_COMMANDS_DIR);
  if (!fs.existsSync(agentsCommandsDir)) {
    ensureDir(agentsCommandsDir);
  }

  const dojoFiles = listFiles(agentsCommandsDir).filter(f => f.startsWith('dojo-') && f.endsWith('.md'));

  for (const agent of agents) {
    const relAgentDir = AGENT_COMMAND_DIRS[agent];
    if (!relAgentDir) continue;

    const agentCmdDir = path.join(root, relAgentDir);
    migrateLegacyAgentCommandsDir(agentCmdDir, agentsCommandsDir);
    ensureDir(agentCmdDir);

    const existing = fs.existsSync(agentCmdDir) ? listFiles(agentCmdDir) : [];
    for (const name of existing) {
      if (!name.startsWith('dojo-') || !name.endsWith('.md')) continue;
      if (dojoFiles.includes(name)) continue;
      try {
        fs.unlinkSync(path.join(agentCmdDir, name));
      } catch {
        /* ignore */
      }
    }

    for (const file of dojoFiles) {
      createFileSymlink(path.join(agentsCommandsDir, file), path.join(agentCmdDir, file));
    }
  }
}

function materializeAgentsSkills(root: string): void {
  const sourceDir = path.join(root, DOJO_DIR, 'skills');
  const targetDir = path.join(root, AGENTS_SKILLS_DIR);
  ensureDir(targetDir);

  const ids = fs.existsSync(sourceDir)
    ? fs.readdirSync(sourceDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    : [];

  const expected = new Set<string>();
  for (const id of ids) {
    const skillFile = path.join(sourceDir, id, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const targetFile = path.join(targetDir, `${id}.md`);
    writeText(targetFile, readText(skillFile));
    expected.add(`${id}.md`);
  }

  const existing = fs.existsSync(targetDir) ? listFiles(targetDir) : [];
  for (const file of existing) {
    if (!file.endsWith('.md')) continue;
    if (expected.has(file)) continue;
    try {
      fs.unlinkSync(path.join(targetDir, file));
    } catch {
      /* ignore */
    }
  }
}

export function syncAgentDojoSkillFileSymlinks(root: string, agents: AgentTool[]): void {
  const agentsSkillsDir = path.resolve(root, AGENTS_SKILLS_DIR);
  if (!fs.existsSync(agentsSkillsDir)) {
    ensureDir(agentsSkillsDir);
  }

  const skillFiles = listFiles(agentsSkillsDir).filter(f => f.endsWith('.md'));

  for (const agent of agents) {
    const relAgentDir = AGENT_SKILL_DIRS[agent];
    if (!relAgentDir) continue;

    const agentSkillDir = path.join(root, relAgentDir);
    migrateLegacyAgentSkillsDir(agentSkillDir, agentsSkillsDir);
    ensureDir(agentSkillDir);

    const existing = fs.existsSync(agentSkillDir) ? listFiles(agentSkillDir) : [];
    for (const name of existing) {
      if (!name.endsWith('.md')) continue;
      if (skillFiles.includes(name)) continue;
      try {
        fs.unlinkSync(path.join(agentSkillDir, name));
      } catch {
        /* ignore */
      }
    }

    for (const file of skillFiles) {
      createFileSymlink(path.join(agentsSkillsDir, file), path.join(agentSkillDir, file));
    }
  }
}

export async function distributeCommands(
  root: string,
  sessionId: string | null,
  agents: AgentTool[],
): Promise<void> {
  const config = readConfig(root);
  await materializeAgentsCommands(root, sessionId, config);
  materializeAgentsSkills(root);
  syncAgentDojoFileSymlinks(root, agents);
  syncAgentDojoSkillFileSymlinks(root, agents);
}
