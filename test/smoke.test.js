const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const net = require('node:net');
    const socket = net.createServer();
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
    socket.on('error', reject);
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited early');
    try {
      const response = await fetch(url + '/healthz');
      if (response.ok) return;
    } catch (error) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server did not start');
}

test('sync API protects data and rejects stale revisions', async t => {
  const port = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'janice-sync-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      SYNC_TOKEN: 'test-token',
      CORS_ORIGINS: 'http://localhost:3000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill('SIGTERM'));
  await waitForServer('http://127.0.0.1:' + port, child);

  const base = 'http://127.0.0.1:' + port;
  const unauthenticated = await fetch(base + '/api/data');
  assert.equal(unauthenticated.status, 401);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token'
  };
  const initial = await fetch(base + '/api/data', { headers });
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).revision, 0);

  const first = await fetch(base + '/api/data', {
    method: 'POST',
    headers,
    body: JSON.stringify({ device: 'test', ts: Date.now(), base_revision: 0, payload: { wb_demo: '"ok"' } })
  });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.revision, 1);

  const invalidPayload = await fetch(base + '/api/data', {
    method: 'POST',
    headers,
    body: JSON.stringify({ device: 'bad-device', ts: Date.now() + 1, base_revision: 1, payload: { wb_demo: 'not-json' } })
  });
  assert.equal(invalidPayload.status, 400);

  const stale = await fetch(base + '/api/data', {
    method: 'POST',
    headers,
    body: JSON.stringify({ device: 'old-device', ts: Date.now() + 1, base_revision: 0, payload: { wb_demo: '"stale"' } })
  });
  assert.equal(stale.status, 409);

  const missingRoute = await fetch(base + '/unknown');
  assert.equal(missingRoute.status, 404);
});
