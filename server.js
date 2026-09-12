const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const APP_USER = process.env.APP_USER || 'casal';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } })
  : null;

let dbReady = false;
let dbInitPromise = null;

const publicDir = path.join(__dirname, 'public');
const assets = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' }
};

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function authorized(req) {
  if (!APP_PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return false;
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    return safeEqual(user, APP_USER) && safeEqual(pass, APP_PASSWORD);
  } catch {
    return false;
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': type.startsWith('text/html') ? 'no-store' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    ...extra
  });
  res.end(body);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value));
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new Error('Payload muito grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

async function ensureDb() {
  if (!pool) throw new Error('Banco de dados não configurado');
  if (dbReady) return;
  if (!dbInitPromise) {
    dbInitPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS intimacy_entries (
        id BIGSERIAL PRIMARY KEY,
        entry_date DATE NOT NULL,
        period VARCHAR(10) NOT NULL CHECK (period IN ('morning', 'night')),
        self_wanted BOOLEAN NOT NULL DEFAULT FALSE,
        partner_wanted BOOLEAN NOT NULL DEFAULT FALSE,
        happened BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(entry_date, period)
      );
      CREATE INDEX IF NOT EXISTS idx_intimacy_entries_date ON intimacy_entries(entry_date);
    `).then(() => { dbReady = true; }).finally(() => { dbInitPromise = null; });
  }
  return dbInitPromise;
}

async function dbHealthy() {
  try {
    await ensureDb();
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function handleApi(req, res, url) {
  try {
    await ensureDb();

    if (req.method === 'GET' && url.pathname === '/api/entries') {
      const { rows } = await pool.query(`
        SELECT
          to_char(entry_date, 'YYYY-MM-DD') AS date,
          period,
          self_wanted AS "selfWanted",
          partner_wanted AS "partnerWanted",
          happened
        FROM intimacy_entries
        ORDER BY entry_date, CASE WHEN period = 'morning' THEN 0 ELSE 1 END
      `);
      return json(res, 200, rows);
    }

    if (req.method === 'PUT' && url.pathname === '/api/entries') {
      const body = await readJson(req);
      const { date, period, selfWanted, partnerWanted, happened } = body;
      if (!isDate(date) || !['morning', 'night'].includes(period)) {
        return json(res, 400, { error: 'Data ou período inválido.' });
      }
      if (![selfWanted, partnerWanted, happened].every(v => typeof v === 'boolean')) {
        return json(res, 400, { error: 'Os campos de resposta devem ser booleanos.' });
      }
      const { rows } = await pool.query(`
        INSERT INTO intimacy_entries(entry_date, period, self_wanted, partner_wanted, happened)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(entry_date, period) DO UPDATE SET
          self_wanted = EXCLUDED.self_wanted,
          partner_wanted = EXCLUDED.partner_wanted,
          happened = EXCLUDED.happened,
          updated_at = NOW()
        RETURNING to_char(entry_date, 'YYYY-MM-DD') AS date,
                  period,
                  self_wanted AS "selfWanted",
                  partner_wanted AS "partnerWanted",
                  happened
      `, [date, period, selfWanted, partnerWanted, happened]);
      return json(res, 200, rows[0]);
    }

    if (req.method === 'DELETE' && url.pathname === '/api/entries') {
      const date = url.searchParams.get('date');
      const period = url.searchParams.get('period');
      if (!isDate(date) || !['morning', 'night'].includes(period)) {
        return json(res, 400, { error: 'Data ou período inválido.' });
      }
      const result = await pool.query('DELETE FROM intimacy_entries WHERE entry_date = $1 AND period = $2', [date, period]);
      return json(res, 200, { deleted: result.rowCount > 0 });
    }

    return json(res, 404, { error: 'Endpoint não encontrado.' });
  } catch (error) {
    console.error('API error:', error.message);
    return json(res, 500, { error: 'Não foi possível acessar os dados agora.' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    return json(res, 200, { ok: true, database: await dbHealthy() });
  }

  if (!authorized(req)) {
    return send(res, 401, 'Acesso protegido.', 'text/plain; charset=utf-8', {
      'WWW-Authenticate': 'Basic realm="Calendário do Casal", charset="UTF-8"'
    });
  }

  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, res, url);
  }

  const asset = assets[url.pathname];
  if (!asset) return send(res, 404, 'Página não encontrada.', 'text/plain; charset=utf-8');
  try {
    const content = fs.readFileSync(path.join(publicDir, asset.file));
    return send(res, 200, content, asset.type);
  } catch {
    return send(res, 500, 'Erro ao carregar aplicação.', 'text/plain; charset=utf-8');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Calendário do casal ativo na porta ${PORT}`);
  if (!APP_PASSWORD) console.warn('AVISO: APP_PASSWORD não configurada.');
  if (!DATABASE_URL) console.warn('AVISO: DATABASE_URL não configurada.');
  if (DATABASE_URL) ensureDb().catch(err => console.error('Falha inicial do banco:', err.message));
});

process.on('SIGTERM', async () => {
  server.close(async () => {
    if (pool) await pool.end().catch(() => {});
    process.exit(0);
  });
});
