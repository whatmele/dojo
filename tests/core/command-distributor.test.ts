import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  distributeCommands,
  applyCommandSessionPlaceholders,
} from '../../src/core/command-distributor.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-test-cmd-'));
  fs.mkdirSync(path.join(tmpDir, '.dojo', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.agents', 'commands'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('applyCommandSessionPlaceholders', () => {
  it('unwraps SESSION_ONLY when session present', () => {
    const raw = `a<!-- DOJO_SESSION_ONLY -->S${'${dojo_current_session_id}'}<!-- /DOJO_SESSION_ONLY -->b`;
    const out = applyCommandSessionPlaceholders(raw, 'sid');
    expect(out).toBe('aSsidb');
  });

  it('removes SESSION_ONLY when no session', () => {
    const raw = 'a<!-- DOJO_SESSION_ONLY -->S<!-- /DOJO_SESSION_ONLY -->b';
    const out = applyCommandSessionPlaceholders(raw, null);
    expect(out).toBe('ab');
  });
});

describe('distributeCommands', () => {
  it('replaces ${dojo_current_session_id} with actual session ID', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-prd.md'),
      'Output to .dojo/sessions/${dojo_current_session_id}/product-requirements/',
    );

    distributeCommands(tmpDir, 'my-session', ['claude-code']);

    const result = fs.readFileSync(
      path.join(tmpDir, '.agents', 'commands', 'dojo-prd.md'),
      'utf-8',
    );
    expect(result).toContain('my-session');
    expect(result).not.toContain('${dojo_current_session_id}');
  });

  it('preserves $ARGUMENTS unchanged', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-research.md'),
      'Research topic: $ARGUMENTS\nSession: ${dojo_current_session_id}',
    );

    distributeCommands(tmpDir, 'sess-1', ['codex']);

    const result = fs.readFileSync(
      path.join(tmpDir, '.agents', 'commands', 'dojo-research.md'),
      'utf-8',
    );
    expect(result).toContain('$ARGUMENTS');
    expect(result).toContain('sess-1');
  });

  it('creates per-file symlinks for dojo-*.md under .claude/commands', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-test.md'),
      'test content',
    );

    distributeCommands(tmpDir, 'sess-1', ['claude-code']);

    const agentCmdDir = path.join(tmpDir, '.claude', 'commands');
    expect(fs.existsSync(agentCmdDir)).toBe(true);
    expect(fs.lstatSync(agentCmdDir).isSymbolicLink()).toBe(false);

    const linkFile = path.join(agentCmdDir, 'dojo-test.md');
    expect(fs.existsSync(linkFile)).toBe(true);
    expect(fs.lstatSync(linkFile).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(linkFile, 'utf-8')).toContain('test content');
  });

  it('migrates legacy directory symlink to real dir and per-file symlinks', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-prd.md'),
      'x ${dojo_current_session_id}',
    );
    const agentsDir = path.join(tmpDir, '.agents', 'commands');
    const claudeDir = path.join(tmpDir, '.claude', 'commands');
    fs.mkdirSync(path.dirname(claudeDir), { recursive: true });
    fs.symlinkSync(path.resolve(agentsDir), claudeDir, 'dir');

    distributeCommands(tmpDir, 's1', ['claude-code']);

    expect(fs.lstatSync(claudeDir).isSymbolicLink()).toBe(false);
    const lf = path.join(claudeDir, 'dojo-prd.md');
    expect(fs.lstatSync(lf).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(lf, 'utf-8')).toContain('s1');
  });

  it('updates existing files on re-run', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-cmd.md'),
      'Session: ${dojo_current_session_id}',
    );

    distributeCommands(tmpDir, 'first', ['codex']);
    let result = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-cmd.md'), 'utf-8');
    expect(result).toContain('first');

    distributeCommands(tmpDir, 'second', ['codex']);
    result = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-cmd.md'), 'utf-8');
    expect(result).toContain('second');
    expect(result).not.toContain('first');
  });

  it('with null session, strips SESSION_ONLY in dojo-gen-doc.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-gen-doc.md'),
      'A\n<!-- DOJO_SESSION_ONLY -->SESSION\n<!-- /DOJO_SESSION_ONLY -->\nB',
    );

    distributeCommands(tmpDir, null, ['codex']);

    const result = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-gen-doc.md'), 'utf-8');
    expect(result).not.toContain('SESSION');
    expect(result).toContain('A');
    expect(result).toContain('B');
  });

  it('with null session, prepends banner for session-bound dojo-prd.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-prd.md'),
      'path .dojo/sessions/${dojo_current_session_id}/',
    );

    distributeCommands(tmpDir, null, ['codex']);

    const result = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-prd.md'), 'utf-8');
    expect(result).toContain('无活跃会话');
    expect(result).toContain('no-active-session');
  });
});
