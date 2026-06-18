const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const pty = require('node-pty');
const runtime = require('./runtime.cjs');

const terminals = new Map();
let mainWindow = null;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: 'Dojo Desktop',
    backgroundColor: '#111111',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServer = process.env.DOJO_DESKTOP_DEV_SERVER;
  if (devServer) {
    mainWindow.loadURL(devServer);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });
}

function serializeTerminal(instance, ptyProcess) {
  return {
    ...instance,
    pid: ptyProcess?.pid ?? instance.pid ?? null,
    status: ptyProcess ? 'running' : instance.status,
  };
}

function activeTerminalIds(root, sessionId) {
  const ids = new Set();
  for (const terminal of terminals.values()) {
    if (terminal.root === root && terminal.sessionId === sessionId) {
      ids.add(terminal.instanceId);
    }
  }
  return ids;
}

function readInstancesForUi(root, sessionId) {
  const activeIds = activeTerminalIds(root, sessionId);
  const instances = runtime.readInstances(root, sessionId);
  let changed = false;
  const normalized = instances.map((instance) => {
    if (instance.status === 'running' && !activeIds.has(instance.id)) {
      changed = true;
      return {
        ...instance,
        status: 'exited',
        pid: null,
        ended_at: instance.ended_at || runtime.now(),
        exit_reason: 'desktop-restarted',
      };
    }
    return instance;
  });
  if (changed) {
    runtime.writeInstances(root, sessionId, normalized);
  }
  return normalized;
}

function createInstanceRecord(root, sessionId, input, commandSpec) {
  const id = input.id || runtime.createId(input.kind === 'codex' ? 'codex' : 'term');
  const instance = {
    id,
    title: input.title || (input.kind === 'codex' ? 'Codex' : commandSpec.label),
    kind: input.kind,
    dojo_session_id: sessionId,
    parent_instance_id: input.parent_instance_id || null,
    cwd: input.cwd || root,
    command: commandSpec.label || [commandSpec.command, ...commandSpec.args].join(' '),
    pid: null,
    status: 'idle',
    exit_code: null,
    exit_signal: null,
    ended_at: null,
    exit_reason: null,
    last_error: null,
    codex_session_id: input.codex_session_id || null,
    codex_session_source: input.codex_session_id ? input.codex_session_source || 'fork' : 'unknown',
    created_at: runtime.now(),
    updated_at: runtime.now(),
    transcript_path: runtime.transcriptPath(root, sessionId, id),
  };
  return runtime.upsertInstance(root, sessionId, instance);
}

function spawnInstance(root, sessionId, input) {
  runtime.ensureSessionLayout(root, sessionId);
  if (input.kind === 'codex') {
    const status = runtime.codexCliStatus();
    if (!status.ok) {
      throw new Error(`${status.reason} Run: ${status.install_command}`);
    }
  }

  const cwd = input.cwd || root;
  const parent = input.parent_instance_id
    ? runtime.readInstances(root, sessionId).find((item) => item.id === input.parent_instance_id)
    : null;

  const codexSessionId = input.codex_session_id || parent?.codex_session_id || null;
  const mode = input.mode || (input.kind === 'codex' && input.parent_instance_id && codexSessionId ? 'fork' : 'new');
  const commandSpec = runtime.commandForInstance(input.kind, { cwd, mode, codexSessionId });
  const instance = createInstanceRecord(root, sessionId, {
    ...input,
    cwd,
    codex_session_id: mode === 'fork' || mode === 'resume' ? codexSessionId : input.codex_session_id || null,
    codex_session_source: mode === 'fork' ? 'fork' : mode === 'resume' ? 'resume' : 'unknown',
  }, commandSpec);

  const env = runtime.terminalEnv({
    DOJO_WORKSPACE_ROOT: root,
    DOJO_SESSION_ID: sessionId,
    DOJO_INSTANCE_ID: instance.id,
  });

  let ptyProcess;
  try {
    runtime.ensurePtySpawnHelperExecutable();
    ptyProcess = pty.spawn(commandSpec.command, commandSpec.args, {
      name: 'xterm-256color',
      cols: input.cols || 100,
      rows: input.rows || 30,
      cwd,
      env,
    });
  } catch (error) {
    const footer = runtime.formatSpawnErrorFooter(instance, error);
    runtime.appendTranscript(root, sessionId, instance.id, footer);
    runtime.upsertInstance(root, sessionId, {
      ...instance,
      status: 'error',
      pid: null,
      ended_at: runtime.now(),
      exit_reason: 'spawn-error',
      last_error: error instanceof Error ? error.message : String(error),
    });
    runtime.appendEvent(root, sessionId, {
      type: 'pty.spawn.error',
      instance_id: instance.id,
      kind: instance.kind,
      command: instance.command,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  terminals.set(instance.id, {
    root,
    sessionId,
    instanceId: instance.id,
    pty: ptyProcess,
  });

  const running = runtime.upsertInstance(root, sessionId, {
    ...instance,
    pid: ptyProcess.pid,
    status: 'running',
    exit_code: null,
    exit_signal: null,
    ended_at: null,
    exit_reason: null,
    last_error: null,
    command: commandSpec.label || [commandSpec.command, ...commandSpec.args].join(' '),
  });

  ptyProcess.onData((data) => {
    runtime.appendTranscript(root, sessionId, instance.id, data);
    send('terminal:data', { instanceId: instance.id, data });
  });

  ptyProcess.onExit((event) => {
    terminals.delete(instance.id);
    const footer = runtime.formatExitFooter(instance, event);
    runtime.appendTranscript(root, sessionId, instance.id, footer);
    send('terminal:data', { instanceId: instance.id, data: footer });
    const updated = runtime.upsertInstance(root, sessionId, {
      id: instance.id,
      status: event.exitCode === 0 ? 'exited' : 'error',
      pid: null,
      exit_code: event.exitCode,
      exit_signal: event.signal,
      ended_at: runtime.now(),
      exit_reason: 'process-exit',
    });
    runtime.appendEvent(root, sessionId, {
      type: 'pty.exit',
      instance_id: instance.id,
      exit_code: event.exitCode,
      signal: event.signal,
    });
    send('terminal:exit', { instanceId: instance.id, event, instance: updated });
  });

  runtime.appendEvent(root, sessionId, {
    type: 'pty.start',
    instance_id: instance.id,
    kind: instance.kind,
    command: running.command,
    spawn_command: commandSpec.command,
    spawn_args: commandSpec.args,
    pid: ptyProcess.pid,
  });

  return serializeTerminal(running, ptyProcess);
}

function wireIpc() {
  ipcMain.handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Open Dojo Workspace',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('workspace:open', async (_event, root) => {
    runtime.initializeWorkspace(root);
    return runtime.readWorkspace(root);
  });

  ipcMain.handle('workspace:read', async (_event, root) => {
    return runtime.readWorkspace(root);
  });

  ipcMain.handle('session:create', async (_event, { root, id, description }) => {
    const session = runtime.createSession(root, { id, description });
    return { session, workspace: runtime.readWorkspace(root), instances: readInstancesForUi(root, session.id) };
  });

  ipcMain.handle('session:activate', async (_event, { root, sessionId }) => {
    runtime.setActiveSession(root, sessionId);
    return { workspace: runtime.readWorkspace(root), instances: readInstancesForUi(root, sessionId) };
  });

  ipcMain.handle('instances:list', async (_event, { root, sessionId }) => {
    return readInstancesForUi(root, sessionId);
  });

  ipcMain.handle('codex:preflight', async () => {
    return runtime.codexCliStatus();
  });

  ipcMain.handle('terminal:create', async (_event, input) => {
    const instance = spawnInstance(input.root, input.sessionId, input);
    return { instance, instances: readInstancesForUi(input.root, input.sessionId) };
  });

  ipcMain.handle('terminal:write', async (_event, { instanceId, data }) => {
    const terminal = terminals.get(instanceId);
    if (!terminal) return { ok: false, reason: 'not-running' };
    terminal.pty.write(data);
    return { ok: true };
  });

  ipcMain.handle('terminal:resize', async (_event, { instanceId, cols, rows }) => {
    const terminal = terminals.get(instanceId);
    if (!terminal) return { ok: false, reason: 'not-running' };
    terminal.pty.resize(cols, rows);
    return { ok: true };
  });

  ipcMain.handle('terminal:kill', async (_event, { instanceId }) => {
    const terminal = terminals.get(instanceId);
    if (!terminal) return { ok: false, reason: 'not-running' };
    terminal.pty.kill();
    return { ok: true };
  });

  ipcMain.handle('terminal:readTranscript', async (_event, { root, sessionId, instanceId }) => {
    return runtime.readTranscript(root, sessionId, instanceId);
  });

  ipcMain.handle('desktop:appendHookEvent', async (_event, { root, sessionId, event }) => {
    runtime.appendEvent(root, sessionId, event);
    if (event?.session_id && event?.dojo_instance_id) {
      runtime.upsertInstance(root, sessionId, {
        id: event.dojo_instance_id,
        codex_session_id: event.session_id,
        codex_session_source: 'hook',
      });
    }
    return { ok: true };
  });
}

app.whenReady().then(() => {
  wireIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const terminal of terminals.values()) {
    terminal.pty.kill();
  }
  terminals.clear();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
