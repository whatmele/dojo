#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

(async () => {
  const root = process.env.DOJO_WORKSPACE_ROOT;
  const sessionId = process.env.DOJO_SESSION_ID;
  const instanceId = process.env.DOJO_INSTANCE_ID;
  if (!root || !sessionId) return;

  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  const event = {
    ...payload,
    dojo_instance_id: instanceId || payload.dojo_instance_id || null,
    observed_at: new Date().toISOString(),
  };
  const eventsPath = path.join(root, '.dojo', 'desktop', 'sessions', sessionId, 'events.jsonl');
  ensureDir(path.dirname(eventsPath));
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
})();
