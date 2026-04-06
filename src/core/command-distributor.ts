import path from 'node:path';
import fs from 'node:fs';
import { DOJO_DIR, AGENTS_COMMANDS_DIR, AGENT_COMMAND_DIRS } from '../types.js';
import type { AgentTool } from '../types.js';
import { listFiles, readText, writeText, ensureDir, createFileSymlink } from '../utils/fs.js';

/** 无会话时仍允许完整语义（不依赖会话目录占位）的模板。 */
const SESSION_OPTIONAL_FILES = new Set(['dojo-gen-doc.md', 'dojo-init-context.md']);

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

/**
 * 替换会话 ID，并按标记剥离/展开「仅会话 / 仅无会话」段落。
 */
export function applyCommandSessionPlaceholders(content: string, sessionId: string | null): string {
  let out = content.replace(/\$\{dojo_current_session_id\}/g, sessionId ?? '');
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
  return (
    '> **Dojo**：当前无活跃会话。请先执行 `dojo session new`；下方出现的 `no-active-session` 仅为占位路径，**不要**当作真实会话目录使用。\n\n'
  );
}

function materializeAgentsCommands(
  root: string,
  sessionId: string | null,
): void {
  const sourceDir = path.join(root, DOJO_DIR, 'commands');
  const targetDir = path.join(root, AGENTS_COMMANDS_DIR);
  ensureDir(targetDir);

  const files = listFiles(sourceDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    let content = readText(path.join(sourceDir, file));

    if (sessionId === null && !SESSION_OPTIONAL_FILES.has(file)) {
      content = noSessionBannerForSessionBoundCommands() + content;
      content = content.replace(/\$\{dojo_current_session_id\}/g, 'no-active-session');
    } else {
      content = content.replace(/\$\{dojo_current_session_id\}/g, sessionId ?? '');
    }

    content = applyCommandSessionPlaceholders(content, sessionId);
    writeText(path.join(targetDir, file), content);
  }
}

/** 将旧版「整个 commands 目录指向 .agents/commands」的目录软链迁移为真实目录。 */
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

/**
 * 仅为 `dojo-*.md` 在 `.claude/commands`、`.trae/commands` 等目录下创建指向 `.agents/commands` 同名文件的软链。
 */
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
      const targetFile = path.join(agentsCommandsDir, file);
      const linkFile = path.join(agentCmdDir, file);
      createFileSymlink(targetFile, linkFile);
    }
  }
}

/**
 * 从 `.dojo/commands` 生成 `.agents/commands`，并按所选 agent 同步 `dojo-*.md` 文件级软链。
 * @param sessionId 活跃会话 id；无会话时传 `null`（会话型命令会得到占位与提示；gen-doc / init-context 走无会话分支）。
 */
export function distributeCommands(
  root: string,
  sessionId: string | null,
  agents: AgentTool[],
): void {
  materializeAgentsCommands(root, sessionId);
  syncAgentDojoFileSymlinks(root, agents);
}
