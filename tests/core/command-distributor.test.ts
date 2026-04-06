import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { distributeCommands } from '../../src/core/command-distributor.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-test-cmd-'));
  fs.mkdirSync(path.join(tmpDir, '.dojo', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.agents', 'commands'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
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

  it('creates symlink for claude-code', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'test.md'),
      'test content',
    );

    distributeCommands(tmpDir, 'sess-1', ['claude-code']);

    const linkPath = path.join(tmpDir, '.claude', 'commands');
    expect(fs.existsSync(linkPath)).toBe(true);
    const stat = fs.lstatSync(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('updates existing files on re-run', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'cmd.md'),
      'Session: ${dojo_current_session_id}',
    );

    distributeCommands(tmpDir, 'first', ['codex']);
    let result = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'cmd.md'), 'utf-8');
    expect(result).toContain('first');

    distributeCommands(tmpDir, 'second', ['codex']);
    result = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'cmd.md'), 'utf-8');
    expect(result).toContain('second');
    expect(result).not.toContain('first');
  });
});
