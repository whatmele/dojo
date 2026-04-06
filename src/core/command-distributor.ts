import path from 'node:path';
import fs from 'node:fs';
import { DOJO_DIR, AGENTS_COMMANDS_DIR, AGENT_COMMAND_DIRS } from '../types.js';
import type { AgentTool } from '../types.js';
import { listFiles, readText, writeText, ensureDir, createSymlink } from '../utils/fs.js';

export function distributeCommands(
  root: string,
  sessionId: string,
  agents: AgentTool[],
): void {
  const sourceDir = path.join(root, DOJO_DIR, 'commands');
  const targetDir = path.join(root, AGENTS_COMMANDS_DIR);

  ensureDir(targetDir);

  const files = listFiles(sourceDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    let content = readText(path.join(sourceDir, file));
    content = content.replace(/\$\{dojo_current_session_id\}/g, sessionId);
    writeText(path.join(targetDir, file), content);
  }

  setupSymlinks(root, agents);
}

export function setupSymlinks(root: string, agents: AgentTool[]): void {
  const targetDir = path.join(root, AGENTS_COMMANDS_DIR);

  for (const agent of agents) {
    const symlinkDir = AGENT_COMMAND_DIRS[agent];
    if (!symlinkDir) continue;
    const linkPath = path.join(root, symlinkDir);
    createSymlink(targetDir, linkPath);
  }
}

export function clearCommands(root: string): void {
  const targetDir = path.join(root, AGENTS_COMMANDS_DIR);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true });
  }
  ensureDir(targetDir);
}
