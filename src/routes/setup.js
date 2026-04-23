const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

// GET /api/setup/env-status
router.get('/env-status', (req, res) => {
  res.json({
    db:      !!process.env.DATABASE_URL,
    unipile: !!(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY),
    ai:      !!process.env.ANTHROPIC_API_KEY,
  });
});

// POST /api/setup/test-db
router.post('/test-db', async (req, res) => {
  const url = req.body.database_url || process.env.DATABASE_URL;
  if (!url) return res.json({ ok: false, error: 'No database URL' });
  try {
    const { Client } = require('pg');
    const c = new Client({ connectionString: url, connectionTimeoutMillis: 6000 });
    await c.connect();
    const r = await c.query('SELECT version()');
    await c.end();
    res.json({ ok: true, version: r.rows[0]?.version?.match(/PostgreSQL ([\d.]+)/)?.[1] || '' });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// POST /api/setup/test-unipile
router.post('/test-unipile', async (req, res) => {
  const dsn = req.body.unipile_dsn || process.env.UNIPILE_DSN;
  const key = req.body.unipile_api_key || process.env.UNIPILE_API_KEY;
  if (!dsn || !key) return res.json({ ok: false, error: 'Missing credentials' });
  try {
    const r = await fetch(`${dsn}/api/v1/accounts?limit=1`, {
      headers: { 'X-API-KEY': key, accept: 'application/json' }
    });
    if (!r.ok) return res.json({ ok: false, error: `Unipile ${r.status}` });
    const d = await r.json();
    res.json({ ok: true, accounts_count: d?.items?.length ?? 0 });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// POST /api/setup/complete — idempotent, can always run
router.post('/complete', async (req, res) => {
  const { workspace_name } = req.body;
  if (!workspace_name?.trim()) return res.status(400).json({ error: 'workspace_name required' });

  // Resolve credentials: request body → env var
  const db_url    = req.body.database_url     || process.env.DATABASE_URL;
  const uni_dsn   = req.body.unipile_dsn      || process.env.UNIPILE_DSN;
  const uni_key   = req.body.unipile_api_key  || process.env.UNIPILE_API_KEY;
  const anthro    = req.body.anthropic_api_key || process.env.ANTHROPIC_API_KEY;

  if (!db_url || !uni_dsn || !uni_key) {
    return res.status(400).json({ error: 'database_url, unipile_dsn, and unipile_api_key are required' });
  }

  try {
    // 1. Apply to process.env
    process.env.DATABASE_URL    = db_url;
    process.env.UNIPILE_DSN     = uni_dsn;
    process.env.UNIPILE_API_KEY = uni_key;
    if (anthro) process.env.ANTHROPIC_API_KEY = anthro;
    process.env.SETUP_COMPLETE  = 'true';

    // 2. Write .env (only real values, skip Railway template refs)
    const real = v => v && !v.includes('${{') && !v.includes('railway.internal');
    const lines = [
      real(db_url)  ? `DATABASE_URL=${db_url}`         : null,
      real(uni_dsn) ? `UNIPILE_DSN=${uni_dsn}`         : null,
      real(uni_key) ? `UNIPILE_API_KEY=${uni_key}`     : null,
      anthro        ? `ANTHROPIC_API_KEY=${anthro}`    : null,
      `SETUP_COMPLETE=true`,
    ].filter(Boolean);
    try { fs.writeFileSync(path.resolve(process.cwd(), '.env'), lines.join('\n') + '\n'); } catch(e) {}

    // 3. Reinit db pool with real URL
    require('../db').reinit();

    // 4. (schema already initialized by server.js on startup)

    // 5. Create workspace (idempotent via ON CONFLICT)
    const db = require('../db');
    const { rows } = await db.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id, name`,
      [workspace_name.trim()]
    );

    console.log('[Setup] ✅ Done. Workspace:', rows[0]);
    res.json({ ok: true, workspace_id: rows[0].id, workspace_name: rows[0].name });

  } catch(e) {
    console.error('[Setup] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
