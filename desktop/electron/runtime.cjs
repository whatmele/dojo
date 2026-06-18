const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const DOJO_DIR = '.dojo';
const DESKTOP_DIR = 'desktop';

function now() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isDojoWorkspace(root) {
  return fs.existsSync(path.join(root, DOJO_DIR, 'config.json'));
}

function initializeWorkspace(root) {
  ensureDir(path.join(root, DOJO_DIR, 'sessions'));
  ensureDir(path.join(root, DOJO_DIR, 'commands'));
  ensureDir(path.join(root, DOJO_DIR, 'artifacts'));
  ensureDir(path.join(root, DOJO_DIR, DESKTOP_DIR));

  if (!fs.existsSync(path.join(root, DOJO_DIR, 'config.json'))) {
    writeJSON(path.join(root, DOJO_DIR, 'config.json'), {
      workspace: {
        name: path.basename(root),
        description: 'Dojo Desktop workspace',
      },
      agents: ['codex'],
      agent_commands: {
        codex: 'codex',
      },
      repos: [],
      context: {
        artifacts: ['product-requirement', 'research', 'tech-design', 'tasks', 'workspace-doc'],
      },
    });
  }

  if (!fs.existsSync(path.join(root, DOJO_DIR, 'state.json'))) {
    writeJSON(path.join(root, DOJO_DIR, 'state.json'), { active_session: null });
  }
}

function sessionDir(root, sessionId) {
  return path.join(root, DOJO_DIR, 'sessions', sessionId);
}

function desktopSessionDir(root, sessionId) {
  return path.join(root, DOJO_DIR, DESKTOP_DIR, 'sessions', sessionId);
}

function instancesPath(root, sessionId) {
  return path.join(desktopSessionDir(root, sessionId), 'instances.json');
}

function eventsPath(root, sessionId) {
  return path.join(desktopSessionDir(root, sessionId), 'events.jsonl');
}

function transcriptPath(root, sessionId, instanceId) {
  return path.join(desktopSessionDir(root, sessionId), 'instances', instanceId, 'transcript.log');
}

function ensureSessionLayout(root, sessionId) {
  ensureDir(path.join(sessionDir(root, sessionId), 'product-requirements'));
  ensureDir(path.join(sessionDir(root, sessionId), 'research'));
  ensureDir(path.join(sessionDir(root, sessionId), 'tech-design'));
  ensureDir(path.join(sessionDir(root, sessionId), 'tasks'));
  ensureDir(path.join(desktopSessionDir(root, sessionId), 'instances'));
  if (!fs.existsSync(instancesPath(root, sessionId))) {
    writeJSON(instancesPath(root, sessionId), { instances: [] });
  }
}

function listSessions(root) {
  const rootDir = path.join(root, DOJO_DIR, 'sessions');
  if (!fs.existsSync(rootDir)) return [];
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name, 'state.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => readJSON(filePath, null))
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
}

function readWorkspace(root) {
  initializeWorkspace(root);
  const config = readJSON(path.join(root, DOJO_DIR, 'config.json'), null);
  const state = readJSON(path.join(root, DOJO_DIR, 'state.json'), { active_session: null });
  return {
    root,
    config,
    state,
    sessions: listSessions(root),
  };
}

function createSession(root, input) {
  initializeWorkspace(root);
  const sessionId = input.id || createId('session');
  const state = {
    id: sessionId,
    description: input.description || sessionId,
    created_at: now(),
    updated_at: now(),
    status: 'active',
  };

  ensureSessionLayout(root, sessionId);
  writeJSON(path.join(sessionDir(root, sessionId), 'state.json'), state);
  writeJSON(path.join(root, DOJO_DIR, 'state.json'), { active_session: sessionId });
  return state;
}

function setActiveSession(root, sessionId) {
  const target = path.join(sessionDir(root, sessionId), 'state.json');
  if (!fs.existsSync(target)) {
    throw new Error(`Session does not exist: ${sessionId}`);
  }
  const state = readJSON(target, null);
  writeJSON(target, { ...state, status: 'active', updated_at: now() });
  writeJSON(path.join(root, DOJO_DIR, 'state.json'), { active_session: sessionId });
}

function readInstances(root, sessionId) {
  ensureSessionLayout(root, sessionId);
  return readJSON(instancesPath(root, sessionId), { instances: [] }).instances || [];
}

function writeInstances(root, sessionId, instances) {
  writeJSON(instancesPath(root, sessionId), { instances });
}

function upsertInstance(root, sessionId, instance) {
  const instances = readInstances(root, sessionId);
  const idx = instances.findIndex((item) => item.id === instance.id);
  if (idx >= 0) {
    instances[idx] = { ...instances[idx], ...instance, updated_at: now() };
  } else {
    instances.push({ ...instance, created_at: instance.created_at || now(), updated_at: now() });
  }
  writeInstances(root, sessionId, instances);
  return instances.find((item) => item.id === instance.id);
}

function readTranscript(root, sessionId, instanceId) {
  const filePath = transcriptPath(root, sessionId, instanceId);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function appendTranscript(root, sessionId, instanceId, data) {
  const filePath = transcriptPath(root, sessionId, instanceId);
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, data);
}

function formatExitFooter(instance, event) {
  const kind = instance.kind === 'codex' ? 'Codex conversation' : 'Terminal process';
  const exitCode = event?.exitCode ?? instance.exit_code ?? 'unknown';
  const signal = event?.signal ?? instance.exit_signal ?? 'unknown';
  const endedAt = now();
  return [
    '',
    '',
    '────────────────────────────────────────',
    `[Dojo] ${kind} ended.`,
    `[Dojo] Exit code: ${exitCode}`,
    `[Dojo] Signal: ${signal}`,
    `[Dojo] Ended: ${endedAt}`,
    instance.kind === 'codex'
      ? '[Dojo] Use Restart to open a fresh Codex process for this conversation.'
      : '[Dojo] This terminal process is closed.',
    '────────────────────────────────────────',
    '',
  ].join('\r\n');
}

function formatSpawnErrorFooter(instance, error) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    '',
    '',
    '────────────────────────────────────────',
    '[Dojo] Failed to start terminal process.',
    `[Dojo] Command: ${instance.command}`,
    `[Dojo] Error: ${message}`,
    '────────────────────────────────────────',
    '',
  ].join('\r\n');
}

function appendEvent(root, sessionId, event) {
  const filePath = eventsPath(root, sessionId);
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify({ ...event, observed_at: now() })}\n`);
}

let cachedShellEnv = null;

function parseEnvOutput(output) {
  const env = {};
  for (const line of output.split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      env[line.slice(0, idx)] = line.slice(idx + 1);
    }
  }
  return env;
}

function getShellEnv(options = {}) {
  if (cachedShellEnv && !options.force) return cachedShellEnv;
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const output = childProcess.execFileSync(shell, ['-ilc', 'env'], {
      encoding: 'utf8',
      timeout: 3000,
      env: process.env,
    });
    cachedShellEnv = { ...process.env, ...parseEnvOutput(output) };
  } catch {
    cachedShellEnv = { ...process.env };
  }
  return cachedShellEnv;
}

function terminalEnv(extra = {}) {
  const shellEnv = getShellEnv({ force: true });
  const env = {
    ...shellEnv,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Dojo Desktop',
    ...extra,
  };
  const lang = env.LANG && env.LANG !== 'C.UTF-8' ? env.LANG : 'en_US.UTF-8';
  env.LANG = lang;
  if (env.LC_ALL === 'C.UTF-8') {
    delete env.LC_ALL;
  }
  if (env.LC_CTYPE === 'C.UTF-8') {
    env.LC_CTYPE = lang;
  }
  return {
    ...env,
  };
}

function ensurePtySpawnHelperExecutable() {
  if (process.platform !== 'darwin') return;
  try {
    const packagePath = require.resolve('node-pty/package.json');
    const packageRoot = path.dirname(packagePath);
    const helperPath = path.join(packageRoot, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');
    if (fs.existsSync(helperPath)) {
      fs.chmodSync(helperPath, 0o755);
    }
  } catch {
    // node-pty will surface the real spawn error if the helper still cannot run.
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function codexArgsForMode(options) {
  const cwd = options.cwd;
  const startupUpdateOverride = ['-c', 'check_for_update_on_startup=false'];
  if (options.mode === 'fork' && options.codexSessionId) {
    return [...startupUpdateOverride, 'fork', options.codexSessionId, '--cd', cwd];
  }
  if (options.mode === 'resume' && options.codexSessionId) {
    return [...startupUpdateOverride, 'resume', options.codexSessionId, '--cd', cwd];
  }
  return [...startupUpdateOverride, '--cd', cwd];
}

function codexLabelForMode(options) {
  const cwd = options.cwd;
  if (options.mode === 'fork' && options.codexSessionId) {
    return `codex fork ${options.codexSessionId} --cd ${cwd}`;
  }
  if (options.mode === 'resume' && options.codexSessionId) {
    return `codex resume ${options.codexSessionId} --cd ${cwd}`;
  }
  return `codex --cd ${cwd}`;
}

function safeExecFile(command, args, options = {}) {
  try {
    return {
      ok: true,
      stdout: childProcess.execFileSync(command, args, {
        encoding: 'utf8',
        timeout: 5000,
        ...options,
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stdout: typeof error.stdout === 'string' ? error.stdout.trim() : '',
      stderr: typeof error.stderr === 'string' ? error.stderr.trim() : '',
    };
  }
}

function readGlobalCodexPackage(env) {
  const result = safeExecFile('npm', ['ls', '-g', '@openai/codex', '--depth=0', '--json'], { env });
  if (!result.ok && !result.stdout) {
    return { installed: false, version: null, error: result.stderr || result.error || null };
  }
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    const version = parsed.dependencies?.['@openai/codex']?.version || null;
    return { installed: Boolean(version), version, error: null };
  } catch (error) {
    return {
      installed: false,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function codexCliStatus() {
  const env = terminalEnv();
  const shell = env.SHELL || process.env.SHELL || '/bin/zsh';
  const installCommand = 'npm install -g @openai/codex@latest';
  const npmPackage = readGlobalCodexPackage(env);
  const resolvedResult = safeExecFile(shell, ['-ilc', 'command -v codex || true'], { env });
  const pathValue = resolvedResult.stdout || null;
  const isBundledAppBinary = Boolean(pathValue?.includes('/Applications/Codex.app/Contents/Resources/codex'));

  let version = null;
  let versionError = null;
  if (pathValue) {
    const versionResult = safeExecFile(pathValue, ['--version'], { env });
    if (versionResult.ok) {
      version = versionResult.stdout;
    } else {
      versionError = versionResult.stderr || versionResult.error || null;
    }
  }

  let ok = true;
  let reason = null;
  if (!pathValue) {
    ok = false;
    reason = 'codex was not found in your login shell PATH.';
  } else if (isBundledAppBinary) {
    ok = false;
    reason = 'Dojo Desktop requires the npm-installed Codex CLI, but your shell currently resolves the Codex.app bundled binary.';
  } else if (!npmPackage.installed) {
    ok = false;
    reason = 'The npm package @openai/codex is not installed globally.';
  } else if (!version) {
    ok = false;
    reason = `codex resolved to ${pathValue}, but it failed to run.`;
  }

  return {
    ok,
    reason,
    path: pathValue,
    version,
    version_error: versionError,
    npm_package_installed: npmPackage.installed,
    npm_package_version: npmPackage.version,
    npm_package_error: npmPackage.error,
    install_command: installCommand,
    update_note: 'Dojo Desktop starts Codex with check_for_update_on_startup=false. Run codex update or reinstall @openai/codex in a normal terminal when you want to update.',
  };
}

function buildCodexShellScript(options) {
  const cwd = options.cwd;
  const codexArgs = codexArgsForMode(options).map(shellQuote).join(' ');
  return [
    `cd ${shellQuote(cwd)} || exit $?`,
    'printf "\\r\\n[Dojo] Starting Codex via login shell in %s\\r\\n" "$PWD"',
    'codex_bin="$(command -v codex || true)"',
    'if [ -z "$codex_bin" ]; then',
    '  printf "\\r\\n[Dojo] codex was not found in this shell PATH.\\r\\n"',
    '  printf "[Dojo] PATH: %s\\r\\n" "$PATH"',
    '  printf "[Dojo] Install the npm Codex CLI with: npm install -g @openai/codex@latest\\r\\n"',
    '  exit 127',
    'fi',
    'if ! "$codex_bin" --version >/dev/null 2>&1; then',
    '  printf "\\r\\n[Dojo] codex resolved to %s, but it failed to run.\\r\\n" "$codex_bin"',
    '  printf "[Dojo] This usually means a broken or partial Codex install. Clean or reinstall that binary, then start a new Codex conversation.\\r\\n"',
    '  exit 127',
    'fi',
    'printf "[Dojo] Using Codex binary: %s\\r\\n" "$codex_bin"',
    `"$codex_bin" ${codexArgs}`,
    'code=$?',
    'printf "\\r\\n[Dojo] Codex process returned exit code %s.\\r\\n" "$code"',
    'printf "[Dojo] Use Restart to open a fresh Codex process for this conversation.\\r\\n"',
    'exit "$code"',
  ].join('\n');
}

function commandForInstance(kind, options) {
  const cwd = options.cwd;
  if (kind === 'codex') {
    const shell = process.env.SHELL || os.userInfo().shell || '/bin/zsh';
    return {
      command: shell,
      args: ['-ilc', buildCodexShellScript(options)],
      label: codexLabelForMode(options),
    };
  }

  const shell = process.env.SHELL || os.userInfo().shell || '/bin/zsh';
  return {
    command: shell,
    args: ['-l'],
    label: path.basename(shell),
  };
}

module.exports = {
  createId,
  now,
  isDojoWorkspace,
  initializeWorkspace,
  readWorkspace,
  createSession,
  setActiveSession,
  ensureSessionLayout,
  readInstances,
  writeInstances,
  upsertInstance,
  readTranscript,
  appendTranscript,
  formatExitFooter,
  formatSpawnErrorFooter,
  appendEvent,
  transcriptPath,
  terminalEnv,
  ensurePtySpawnHelperExecutable,
  commandForInstance,
  shellQuote,
  codexCliStatus,
};
