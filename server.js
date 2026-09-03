'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_FILE = path.join(DATA_DIR, 'data.json.bak');
const MAX_BODY_BYTES = Math.max(1024, Number(process.env.MAX_BODY_BYTES || 5 * 1024 * 1024));
const SYNC_TOKEN = String(process.env.SYNC_TOKEN || '');
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

function emptyStore() {
  return { version: 1, revision: 0, ts: 0, updatedAt: 0, payload: {} };
}

function normalizeStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid store format');
  }
  const payload = value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
    ? value.payload
    : {};
  return {
    version: 1,
    revision: Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    ts: Number.isFinite(value.ts) && value.ts >= 0 ? value.ts : 0,
    updatedAt: Number.isFinite(value.updatedAt) && value.updatedAt >= 0 ? value.updatedAt : 0,
    payload
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadStore() {
  if (!fs.existsSync(FILE)) return emptyStore();
  try {
    return normalizeStore(readJson(FILE));
  } catch (primaryError) {
    if (fs.existsSync(BACKUP_FILE)) {
      try {
        console.error('Primary data file is invalid; loading the backup.');
        return normalizeStore(readJson(BACKUP_FILE));
      } catch (backupError) {
        throw new Error('Both data.json and data.json.bak are invalid.');
      }
    }
    throw new Error('data.json is invalid and no backup is available.');
  }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(value), 'utf8');
    fs.renameSync(temp, file);
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (error) {}
  }
}

function persistStore(nextStore) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BACKUP_FILE);
  atomicWrite(FILE, nextStore);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be an object');
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!key.startsWith('wb_')) throw new Error('payload contains an invalid key');
    if (typeof value !== 'string') throw new Error('payload values must be JSON strings');
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_BODY_BYTES) {
    throw new Error('payload is too large');
  }
  return payload;
}

function setHeaders(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = req.headers.origin;
  if (!CORS_ORIGINS.length) return;
  if (CORS_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(req, res, statusCode, body) {
  setHeaders(req, res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  return Boolean(SYNC_TOKEN) && req.headers.authorization === 'Bearer ' + SYNC_TOKEN;
}

function authError(req, res) {
  if (!SYNC_TOKEN) {
    return sendJson(req, res, 503, {
      error: 'server_not_configured',
      message: 'Set SYNC_TOKEN before enabling the data API.'
    });
  }
  return sendJson(req, res, 401, { error: 'unauthorized' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
      else tooLarge = true;
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('request body is too large');
        error.statusCode = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

let store = loadStore();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  setHeaders(req, res);

  if (req.method === 'OPTIONS') {
    if (CORS_ORIGINS.length && !CORS_ORIGINS.includes('*') &&
        req.headers.origin && !CORS_ORIGINS.includes(req.headers.origin)) {
      return sendJson(req, res, 403, { error: 'origin_not_allowed' });
    }
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return sendJson(req, res, 200, {
      ok: true,
      revision: store.revision,
      ts: store.ts,
      updatedAt: store.updatedAt
    });
  }

  if (url.pathname !== '/api/data' || !['GET', 'POST'].includes(req.method)) {
    return sendJson(req, res, 404, { error: 'not_found' });
  }

  if (!authorized(req)) return authError(req, res);

  if (req.method === 'GET') {
    res.setHeader('ETag', '"' + store.revision + '"');
    return sendJson(req, res, 200, store);
  }

  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const ts = Number(body.ts);
    const baseRevision = body.base_revision;
    if (!Number.isFinite(ts) || ts <= 0) {
      return sendJson(req, res, 400, { error: 'invalid_ts' });
    }
    const payload = validatePayload(body.payload);
    const hasBaseRevision = baseRevision !== undefined && baseRevision !== null;
    if (hasBaseRevision &&
        (!Number.isInteger(baseRevision) || baseRevision < 0)) {
      return sendJson(req, res, 400, { error: 'invalid_base_revision' });
    }
    if (hasBaseRevision && baseRevision !== store.revision) {
      return sendJson(req, res, 409, {
        error: 'conflict',
        message: 'The server changed after this device last read it.',
        server: store
      });
    }
    if (!hasBaseRevision && ts <= store.ts) {
      return sendJson(req, res, 200, store);
    }

    const nextStore = {
      version: 1,
      revision: store.revision + 1,
      ts,
      updatedAt: Date.now(),
      payload
    };
    persistStore(nextStore);
    store = nextStore;
    res.setHeader('ETag', '"' + store.revision + '"');
    return sendJson(req, res, 200, store);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return sendJson(req, res, statusCode, { error: error.message || 'bad_request' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('Workbench sync server running on port ' + PORT);
    if (!SYNC_TOKEN) console.warn('SYNC_TOKEN is not set; /api/data is disabled.');
  });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}

module.exports = { server, emptyStore, normalizeStore, validatePayload };
