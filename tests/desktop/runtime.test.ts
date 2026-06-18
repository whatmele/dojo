import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { runInputPipeline } from '../../desktop/renderer/src/lib/inputPipeline';
import type { TerminalInstance } from '../../desktop/renderer/src/types';

const require = createRequire(import.meta.url);
const runtime = require('../../desktop/electron/runtime.cjs');

const tempRoots: string[] = [];

function tempWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-desktop-test-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('desktop runtime', () => {
  it('initializes a minimal dojo workspace and creates a session', () => {
    const root = tempWorkspace();

    runtime.initializeWorkspace(root);
    const session = runtime.createSession(root, {
      id: 'desktop-mvp',
      description: 'Desktop MVP',
    });

    expect(session.id).toBe('desktop-mvp');
    expect(fs.existsSync(path.join(root, '.dojo', 'config.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.dojo', 'sessions', 'desktop-mvp', 'state.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.dojo', 'desktop', 'sessions', 'desktop-mvp', 'instances.json'))).toBe(true);
  });

  it('persists instance records and transcript output', () => {
    const root = tempWorkspace();
    runtime.initializeWorkspace(root);
    runtime.createSession(root, { id: 'session-a', description: 'Session A' });

    runtime.upsertInstance(root, 'session-a', {
      id: 'codex_a',
      title: 'Codex A',
      kind: 'codex',
      dojo_session_id: 'session-a',
      parent_instance_id: null,
      cwd: root,
      command: 'codex --cd .',
      pid: 123,
      status: 'running',
      codex_session_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      transcript_path: runtime.transcriptPath(root, 'session-a', 'codex_a'),
    });
    runtime.appendTranscript(root, 'session-a', 'codex_a', 'hello\n');

    const instances = runtime.readInstances(root, 'session-a');
    expect(instances).toHaveLength(1);
    expect(instances[0].title).toBe('Codex A');
    expect(runtime.readTranscript(root, 'session-a', 'codex_a')).toBe('hello\n');
  });

  it('generates codex new, fork, and resume commands', () => {
    const fresh = runtime.commandForInstance('codex', { cwd: '/tmp/work', mode: 'new' });
    expect(path.basename(fresh.command)).toMatch(/^(zsh|bash|fish|sh)$/);
    expect(fresh.args[0]).toBe('-ilc');
    expect(fresh.args[1]).toContain('"$codex_bin" \'-c\' \'check_for_update_on_startup=false\' \'--cd\' \'/tmp/work\'');
    expect(fresh.args[1]).toContain('codex_bin="$(command -v codex || true)"');
    expect(fresh.args[1]).toContain('codex was not found in this shell PATH');
    expect(fresh.label).toBe('codex --cd /tmp/work');

    const forked = runtime.commandForInstance('codex', { cwd: '/tmp/work', mode: 'fork', codexSessionId: 'abc' });
    expect(forked.args[1]).toContain('"$codex_bin" \'-c\' \'check_for_update_on_startup=false\' \'fork\' \'abc\' \'--cd\' \'/tmp/work\'');
    expect(forked.label).toBe('codex fork abc --cd /tmp/work');

    const resumed = runtime.commandForInstance('codex', { cwd: '/tmp/work', mode: 'resume', codexSessionId: 'abc' });
    expect(resumed.args[1]).toContain('"$codex_bin" \'-c\' \'check_for_update_on_startup=false\' \'resume\' \'abc\' \'--cd\' \'/tmp/work\'');
    expect(resumed.label).toBe('codex resume abc --cd /tmp/work');
  });

  it('generates a login shell command for maintenance terminals', () => {
    const shell = runtime.commandForInstance('shell', { cwd: '/tmp/work' });
    expect(path.basename(shell.command)).toMatch(/^(zsh|bash|fish|sh)$/);
    expect(shell.args).toEqual(['-l']);
  });

  it('normalizes terminal locale away from unsupported C.UTF-8', () => {
    const env = runtime.terminalEnv({ LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' });
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.LC_ALL).toBeUndefined();
  });

  it('formats an exit footer for closed codex conversations', () => {
    const footer = runtime.formatExitFooter({ kind: 'codex' }, { exitCode: 130, signal: 2 });
    expect(footer).toContain('Codex conversation ended');
    expect(footer).toContain('Exit code: 130');
    expect(footer).toContain('Restart');
  });
});

describe('composer input pipeline', () => {
  const current = {
    id: 'term_1',
    kind: 'shell',
  } as TerminalInstance;

  it('passes normal text through to the terminal', () => {
    expect(runInputPipeline('pwd', current)).toEqual({ kind: 'send', payload: 'pwd\r' });
  });

  it('intercepts desktop slash commands', () => {
    expect(runInputPipeline('/new-shell', current)).toEqual({ kind: 'command', command: 'new-shell' });
    expect(runInputPipeline('/new-codex', current)).toEqual({ kind: 'command', command: 'new-codex' });
    expect(runInputPipeline('/fork', current)).toEqual({ kind: 'command', command: 'fork' });
    expect(runInputPipeline('/canvas', current)).toEqual({ kind: 'command', command: 'canvas' });
  });
});
