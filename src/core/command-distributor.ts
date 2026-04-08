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
  validateTemplateContent,
} from './protocol.js';

const MARK_SESSION_START = '<!-- DOJO_SESSION_ONLY -->';
const MARK_SESSION_END = '<!-- /DOJO_SESSION_ONLY -->';
const MARK_NOSESSION_START = '<!-- DOJO_NO_SESSION_ONLY -->';
const MARK_NOSESSION_END = '<!-- /DOJO_NO_SESSION_ONLY -->';
const NO_SESSION_PLACEHOLDER = 'baseline';

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

async function materializeAgentsCommands(
  root: string,
  sessionId: string | null,
  config: WorkspaceConfig,
): Promise<void> {
  const sourceDir = path.join(root, DOJO_DIR, 'commands');
  const targetDir = path.join(root, AGENTS_COMMANDS_DIR);
  ensureDir(targetDir);

  const files = listFiles(sourceDir).filter(f => f.endsWith('.md'));
  const expected = new Set<string>();

  for (const file of files) {
    const source = readText(path.join(sourceDir, file));
    const issues = await validateTemplateContent(root, source);
    if (issues.length > 0) {
      throw new Error(`Invalid template ${file}: ${issues[0]}`);
    }

    const scope = getTemplateScope(source);
    if (sessionId === null && scope === 'session') {
      continue;
    }

    let content = source;
    content = applyCommandSessionPlaceholders(content, sessionId, sessionId === null ? NO_SESSION_PLACEHOLDER : '');
    content = await expandTemplateArtifactSyntax(content, root, config, {
      sessionId,
      noSessionPlaceholder: sessionId === null ? NO_SESSION_PLACEHOLDER : '',
    });

    writeText(path.join(targetDir, file), content);
    expected.add(file);
  }

  for (const file of listFiles(targetDir).filter(f => f.startsWith('dojo-') && f.endsWith('.md'))) {
    if (expected.has(file)) continue;
    removePathIfExists(path.join(targetDir, file));
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

function removePathIfExists(targetPath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(targetPath);
  } catch {
    return;
  }
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return;
  }
  fs.unlinkSync(targetPath);
}

function listSkillIds(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(dirPath, id, 'SKILL.md')))
    .sort();
}

function isManagedSkillLink(skillFile: string, agentsSkillsDir: string): boolean {
  if (!fs.existsSync(skillFile)) return false;
  const stat = fs.lstatSync(skillFile);
  if (!stat.isSymbolicLink()) return false;
  try {
    const resolvedFile = fs.realpathSync(skillFile);
    const resolvedAgentsSkillsDir = fs.realpathSync(agentsSkillsDir);
    return resolvedFile.startsWith(`${resolvedAgentsSkillsDir}${path.sep}`);
  } catch {
    return false;
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

    const existing = fs.existsSync(agentCmdDir) ? fs.readdirSync(agentCmdDir) : [];
    for (const name of existing) {
      if (!name.startsWith('dojo-') || !name.endsWith('.md')) continue;
      if (dojoFiles.includes(name)) continue;
      removePathIfExists(path.join(agentCmdDir, name));
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

  const ids = listSkillIds(sourceDir);

  for (const id of ids) {
    const skillFile = path.join(sourceDir, id, 'SKILL.md');
    const legacyFlatFile = path.join(targetDir, `${id}.md`);
    removePathIfExists(legacyFlatFile);
    const targetFile = path.join(targetDir, id, 'SKILL.md');
    writeText(targetFile, readText(skillFile));
  }

}

export function syncAgentDojoSkillFileSymlinks(root: string, agents: AgentTool[]): void {
  const agentsSkillsDir = path.resolve(root, AGENTS_SKILLS_DIR);
  if (!fs.existsSync(agentsSkillsDir)) {
    ensureDir(agentsSkillsDir);
  }

  const skillIds = listSkillIds(agentsSkillsDir);
  const expected = new Set<string>(skillIds);

  for (const agent of agents) {
    const relAgentDir = AGENT_SKILL_DIRS[agent];
    if (!relAgentDir) continue;

    const agentSkillDir = path.join(root, relAgentDir);
    migrateLegacyAgentSkillsDir(agentSkillDir, agentsSkillsDir);
    ensureDir(agentSkillDir);

    if (fs.existsSync(agentSkillDir)) {
      for (const entry of fs.readdirSync(agentSkillDir, { withFileTypes: true })) {
        if (entry.name.endsWith('.md')) {
          removePathIfExists(path.join(agentSkillDir, entry.name));
          continue;
        }
        if (expected.has(entry.name)) continue;
        const skillFile = path.join(agentSkillDir, entry.name, 'SKILL.md');
        if (isManagedSkillLink(skillFile, agentsSkillsDir)) {
          removePathIfExists(path.join(agentSkillDir, entry.name));
        }
      }
    }

    for (const skillId of skillIds) {
      const targetSkillDir = path.join(agentSkillDir, skillId);
      ensureDir(targetSkillDir);
      createFileSymlink(
        path.join(agentsSkillsDir, skillId, 'SKILL.md'),
        path.join(targetSkillDir, 'SKILL.md'),
      );
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
