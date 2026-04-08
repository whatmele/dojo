import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readConfig, writeConfig, addRepo, removeRepo } from '../../src/core/config.js';
import type { WorkspaceConfig, RepoConfig } from '../../src/types.js';

let tmpDir: string;

function setupWorkspace(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-test-'));
  fs.mkdirSync(path.join(tmpDir, '.dojo'), { recursive: true });
  return tmpDir;
}

function writeTestConfig(root: string, config: WorkspaceConfig): void {
  fs.writeFileSync(
    path.join(root, '.dojo', 'config.json'),
    JSON.stringify(config, null, 2),
  );
}

const baseConfig: WorkspaceConfig = {
  workspace: { name: 'test-ws', description: 'test workspace' },
  agents: ['claude-code'],
  repos: [],
};

beforeEach(() => {
  tmpDir = setupWorkspace();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('config', () => {
  it('readConfig returns correct config', () => {
    writeTestConfig(tmpDir, baseConfig);
    const config = readConfig(tmpDir);
    expect(config.workspace.name).toBe('test-ws');
    expect(config.agents).toEqual(['claude-code']);
    expect(config.repos).toEqual([]);
  });

  it('writeConfig then readConfig round-trips', () => {
    writeConfig(tmpDir, baseConfig);
    const config = readConfig(tmpDir);
    expect(config).toEqual(baseConfig);
  });

  it('readConfig throws when file missing', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-test-empty-'));
    fs.mkdirSync(path.join(emptyDir, '.dojo'), { recursive: true });
    expect(() => readConfig(emptyDir)).toThrow();
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('addRepo appends a new repo', () => {
    writeTestConfig(tmpDir, baseConfig);
    const repo: RepoConfig = {
      name: 'svc-a',
      type: 'biz',
      git: 'git@example.com:org/svc-a.git',
      path: 'repos/biz/svc-a',
      description: 'Service A',
    };
    addRepo(tmpDir, repo);
    const config = readConfig(tmpDir);
    expect(config.repos).toHaveLength(1);
    expect(config.repos[0].name).toBe('svc-a');
  });

  it('addRepo throws on duplicate', () => {
    const configWithRepo = {
      ...baseConfig,
      repos: [{
        name: 'svc-a', type: 'biz' as const, git: 'x', path: 'y',
        description: '',
      }],
    };
    writeTestConfig(tmpDir, configWithRepo);
    expect(() => addRepo(tmpDir, configWithRepo.repos[0])).toThrow(/already exists/);
  });

  it('removeRepo removes the repo', () => {
    const configWithRepo = {
      ...baseConfig,
      repos: [{
        name: 'svc-a', type: 'biz' as const, git: 'x', path: 'y',
        description: '',
      }],
    };
    writeTestConfig(tmpDir, configWithRepo);
    removeRepo(tmpDir, 'svc-a');
    const config = readConfig(tmpDir);
    expect(config.repos).toHaveLength(0);
  });

  it('removeRepo throws when not found', () => {
    writeTestConfig(tmpDir, baseConfig);
    expect(() => removeRepo(tmpDir, 'nonexistent')).toThrow(/not found/);
  });
});
