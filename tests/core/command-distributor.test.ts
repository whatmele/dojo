import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  distributeCommands,
  applyCommandSessionPlaceholders,
} from '../../src/core/command-distributor.js';

let tmpDir: string;

function writeArtifactPlugin(fileName: string, source: string): void {
  const dir = path.join(tmpDir, '.dojo', 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), source);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-test-cmd-'));
  fs.mkdirSync(path.join(tmpDir, '.dojo', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.agents', 'commands'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, '.dojo', 'config.json'),
    JSON.stringify({
      workspace: { name: 'test-ws', description: 'test workspace' },
      agents: ['claude-code'],
      repos: [],
      context: {
        artifacts: ['product-requirement', 'research', 'tech-design', 'tasks'],
      },
    }, null, 2),
  );
  writeArtifactPlugin(
    'custom-doc.js',
    `export default {
      id: 'custom-doc',
      scope: 'session',
      dir: '.dojo/sessions/\${session_id}/custom-doc',
      description: 'Custom documentation output.',
      async renderContext() {
        return '## Custom Doc';
      },
    };`,
  );
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

  it('unwraps NO_SESSION_ONLY when no session', () => {
    const raw = 'a<!-- DOJO_NO_SESSION_ONLY -->N<!-- /DOJO_NO_SESSION_ONLY -->b';
    const out = applyCommandSessionPlaceholders(raw, null);
    expect(out).toBe('aNb');
  });
});

describe('distributeCommands', () => {
  it('replaces ${dojo_current_session_id} and ${session_id} with the active session ID', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-prd.md'),
      'Output to .dojo/sessions/${dojo_current_session_id}/product-requirements/\nSession: ${session_id}',
    );

    await distributeCommands(tmpDir, 'my-session', ['claude-code']);

    const result = fs.readFileSync(
      path.join(tmpDir, '.agents', 'commands', 'dojo-prd.md'),
      'utf-8',
    );
    expect(result).toContain('my-session');
    expect(result).not.toContain('${dojo_current_session_id}');
    expect(result).not.toContain('${session_id}');
  });

  it('preserves $ARGUMENTS unchanged', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-research.md'),
      'Research topic: $ARGUMENTS\nSession: ${session_id}',
    );

    await distributeCommands(tmpDir, 'sess-1', ['codex']);

    const result = fs.readFileSync(
      path.join(tmpDir, '.agents', 'commands', 'dojo-research.md'),
      'utf-8',
    );
    expect(result).toContain('$ARGUMENTS');
    expect(result).toContain('sess-1');
  });

  it('creates per-file symlinks for dojo-*.md under .claude/commands', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-test.md'),
      'test content',
    );

    await distributeCommands(tmpDir, 'sess-1', ['claude-code']);

    const agentCmdDir = path.join(tmpDir, '.claude', 'commands');
    expect(fs.existsSync(agentCmdDir)).toBe(true);
    expect(fs.lstatSync(agentCmdDir).isSymbolicLink()).toBe(false);

    const linkFile = path.join(agentCmdDir, 'dojo-test.md');
    expect(fs.existsSync(linkFile)).toBe(true);
    expect(fs.lstatSync(linkFile).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(linkFile, 'utf-8')).toContain('test content');
  });

  it('creates per-skill SKILL.md symlinks under .claude/skills', async () => {
    const skillDir = path.join(tmpDir, '.dojo', 'skills', 'dojo-template-authoring');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: dojo-template-authoring',
        'description: Help write templates.',
        '---',
        '',
        '# Dojo Template Authoring',
      ].join('\n'),
    );

    await distributeCommands(tmpDir, 'sess-1', ['claude-code']);

    const agentsSkillFile = path.join(tmpDir, '.agents', 'skills', 'dojo-template-authoring', 'SKILL.md');
    expect(fs.existsSync(agentsSkillFile)).toBe(true);

    const skillFile = path.join(tmpDir, '.claude', 'skills', 'dojo-template-authoring', 'SKILL.md');
    expect(fs.existsSync(skillFile)).toBe(true);
    expect(fs.lstatSync(skillFile).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(skillFile, 'utf-8')).toContain('Dojo Template Authoring');
  });

  it('migrates a legacy directory symlink to real dir and per-file symlinks', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-prd.md'),
      'x ${session_id}',
    );
    const agentsDir = path.join(tmpDir, '.agents', 'commands');
    const claudeDir = path.join(tmpDir, '.claude', 'commands');
    fs.mkdirSync(path.dirname(claudeDir), { recursive: true });
    fs.symlinkSync(path.resolve(agentsDir), claudeDir, 'dir');

    await distributeCommands(tmpDir, 's1', ['claude-code']);

    expect(fs.lstatSync(claudeDir).isSymbolicLink()).toBe(false);
    const linkFile = path.join(claudeDir, 'dojo-prd.md');
    expect(fs.lstatSync(linkFile).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(linkFile, 'utf-8')).toContain('s1');
  });

  it('migrates legacy flat skill files to per-skill SKILL.md symlinks', async () => {
    const skillDir = path.join(tmpDir, '.dojo', 'skills', 'dojo-template-authoring');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skill\n');

    const legacySkillDir = path.join(tmpDir, '.claude', 'skills');
    fs.mkdirSync(legacySkillDir, { recursive: true });
    fs.writeFileSync(path.join(legacySkillDir, 'dojo-template-authoring.md'), 'legacy');

    await distributeCommands(tmpDir, 'sess-1', ['claude-code']);

    expect(fs.existsSync(path.join(legacySkillDir, 'dojo-template-authoring.md'))).toBe(false);
    const linkFile = path.join(legacySkillDir, 'dojo-template-authoring', 'SKILL.md');
    expect(fs.existsSync(linkFile)).toBe(true);
    expect(fs.lstatSync(linkFile).isSymbolicLink()).toBe(true);
  });

  it('updates existing rendered files on re-run', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-cmd.md'),
      'Session: ${session_id}',
    );

    await distributeCommands(tmpDir, 'first', ['codex']);
    let result = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-cmd.md'), 'utf-8');
    expect(result).toContain('first');

    await distributeCommands(tmpDir, 'second', ['codex']);
    result = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-cmd.md'), 'utf-8');
    expect(result).toContain('second');
    expect(result).not.toContain('first');
  });

  it('with null session, skips session-bound commands entirely', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-prd.md'),
      [
        '---',
        'description: PRD command',
        'argument-hint: [topic]',
        'scope: session',
        '---',
        '',
        'path ${artifact_dir:custom-doc}',
      ].join('\n'),
    );

    await distributeCommands(tmpDir, null, ['codex']);

    expect(fs.existsSync(path.join(tmpDir, '.agents', 'commands', 'dojo-prd.md'))).toBe(false);
  });

  it('uses scope metadata to skip the no-session banner for mixed templates', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-optional.md'),
      [
        '---',
        'description: Optional command',
        'argument-hint: [notes]',
        'scope: mixed',
        '---',
        '',
        'Docs live in ${artifact_dir:custom-doc}',
      ].join('\n'),
    );

    await distributeCommands(tmpDir, null, ['codex']);

    const result = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-optional.md'), 'utf-8');
    expect(result.startsWith('---\n')).toBe(true);
    expect(result).not.toContain('No active session');
    expect(result).toContain('.dojo/sessions/baseline/custom-doc');
  });

  it('removes stale rendered session-bound files when switching back to no-session mode', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-prd.md'),
      [
        '---',
        'description: PRD command',
        'argument-hint: [topic]',
        'scope: session',
        '---',
        '',
        'path ${artifact_dir:custom-doc}',
      ].join('\n'),
    );

    await distributeCommands(tmpDir, 'sess-live', ['codex']);
    expect(fs.existsSync(path.join(tmpDir, '.agents', 'commands', 'dojo-prd.md'))).toBe(true);

    await distributeCommands(tmpDir, null, ['codex']);
    expect(fs.existsSync(path.join(tmpDir, '.agents', 'commands', 'dojo-prd.md'))).toBe(false);
  });

  it('removes stale tool symlinks when a session-scoped command disappears in no-session mode', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-prd.md'),
      [
        '---',
        'description: PRD command',
        'argument-hint: [topic]',
        'scope: session',
        '---',
        '',
        'path ${artifact_dir:custom-doc}',
      ].join('\n'),
    );

    const traeLinkFile = path.join(tmpDir, '.trae', 'commands', 'dojo-prd.md');

    await distributeCommands(tmpDir, 'sess-live', ['trae']);
    expect(fs.lstatSync(traeLinkFile).isSymbolicLink()).toBe(true);

    await distributeCommands(tmpDir, null, ['trae']);

    expect(fs.existsSync(traeLinkFile)).toBe(false);
    expect(() => fs.lstatSync(traeLinkFile)).toThrow();
  });


  it('does not create .trae/skills symlinks because Trae reads .agents/skills directly', async () => {
    const skillDir = path.join(tmpDir, '.dojo', 'skills', 'dojo-template-authoring');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Dojo skill\n');

    await distributeCommands(tmpDir, 'sess-1', ['trae']);

    expect(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'dojo-template-authoring', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.trae', 'skills'))).toBe(false);
  });

  it('does not delete non-dojo command files from .agents/commands', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-prd.md'),
      'Session: ${session_id}',
    );
    fs.writeFileSync(
      path.join(tmpDir, '.agents', 'commands', 'custom-team-command.md'),
      'keep me',
    );

    await distributeCommands(tmpDir, null, ['codex']);

    expect(fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'custom-team-command.md'), 'utf-8')).toBe('keep me');
  });

  it('does not delete non-dojo skills from .agents/skills', async () => {
    const skillDir = path.join(tmpDir, '.dojo', 'skills', 'dojo-template-authoring');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Dojo skill\n');

    const customSkillDir = path.join(tmpDir, '.agents', 'skills', 'team-skill');
    fs.mkdirSync(customSkillDir, { recursive: true });
    fs.writeFileSync(path.join(customSkillDir, 'SKILL.md'), '# Team skill\n');

    await distributeCommands(tmpDir, 'sess-1', ['claude-code']);

    expect(fs.readFileSync(path.join(customSkillDir, 'SKILL.md'), 'utf-8')).toBe('# Team skill\n');
    expect(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'dojo-template-authoring', 'SKILL.md'))).toBe(true);
  });

  it('renders artifact placeholders during distribution', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-custom.md'),
      [
        'Output: ${artifact_dir:custom-doc}',
        'Description: ${artifact_description:custom-doc}',
      ].join('\n'),
    );

    await distributeCommands(tmpDir, 'sess-10', ['codex']);

    const result = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-custom.md'), 'utf-8');
    expect(result).toContain('.dojo/sessions/sess-10/custom-doc');
    expect(result).toContain('Custom documentation output.');
  });

  it('expands dojo read/write directives into readable markdown blocks', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-directives.md'),
      [
        '<dojo_read_block artifacts="research,custom-doc" />',
        '',
        '<dojo_write_block artifact="tech-design" />',
      ].join('\n'),
    );

    await distributeCommands(tmpDir, 'sess-20', ['codex']);

    const result = fs.readFileSync(path.join(tmpDir, '.agents', 'commands', 'dojo-directives.md'), 'utf-8');
    expect(result).toContain('### Available Context');
    expect(result).toContain('`research`');
    expect(result).toContain('.dojo/sessions/sess-20/research');
    expect(result).toContain('`custom-doc`');
    expect(result).toContain('### Output Artifact');
    expect(result).toContain('.dojo/sessions/sess-20/tech-design');
  });

  it('fails fast when a template references an unknown artifact id', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-bad.md'),
      'Output: ${artifact_dir:not-real}',
    );

    await expect(distributeCommands(tmpDir, 'sess-30', ['codex']))
      .rejects.toThrow(/Unknown artifact id referenced in template: not-real/);
  });

  it('fails fast when a template contains malformed Dojo syntax', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.dojo', 'commands', 'dojo-bad-syntax.md'),
      '<dojo_read_block artifacts="research"',
    );

    await expect(distributeCommands(tmpDir, 'sess-31', ['codex']))
      .rejects.toThrow(/Malformed <dojo_read_block \.\.\. \/> directive\./);
  });
});
