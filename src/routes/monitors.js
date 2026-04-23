const express = require('express');
const router  = express.Router();
const db      = require('../db');
let _ready = false;
async function ensureReady() {
  if (_ready) return;
  await db.query(`CREATE TABLE IF NOT EXISTS search_monitors (
    id           SERIAL PRIMARY KEY,
    workspace_id INT  NOT NULL,
    name         TEXT NOT NULL,
    keywords     TEXT NOT NULL,
    sources      JSONB NOT NULL DEFAULT '["reddit","linkedin"]',
    email        TEXT NOT NULL,
    frequency    TEXT NOT NULL DEFAULT 'daily',
    active       BOOLEAN DEFAULT TRUE,
    last_sent_at  TIMESTAMPTZ,
    last_check_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS monitor_items (
    id           SERIAL PRIMARY KEY,
    monitor_id   INT  NOT NULL REFERENCES search_monitors(id) ON DELETE CASCADE,
    source       TEXT NOT NULL,
    title        TEXT,
    snippet      TEXT,
    author       TEXT,
    author_url   TEXT,
    subreddit    TEXT,
    url          TEXT NOT NULL,
    score        INT  DEFAULT 0,
    comments     INT  DEFAULT 0,
    found_at     TIMESTAMPTZ DEFAULT NOW(),
    emailed      BOOLEAN DEFAULT FALSE,
    UNIQUE(monitor_id, url)
  )`);
  await db.query('CREATE INDEX IF NOT EXISTS monitor_items_monitor ON monitor_items(monitor_id)');
  await db.query('CREATE INDEX IF NOT EXISTS monitor_items_emailed ON monitor_items(emailed, monitor_id)');
  _ready = true;
}

// GET /api/monitors?workspace_id=
router.get('/', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  await ensureReady();
  try {
    const { rows } = await db.query(
      `SELECT id, name, keywords, sources, email, frequency, active, last_sent_at, last_check_at, created_at,
              (SELECT COUNT(*) FROM monitor_items WHERE monitor_id=m.id) as item_count,
              (SELECT COUNT(*) FROM monitor_items WHERE monitor_id=m.id AND emailed=false) as unsent_count
       FROM search_monitors m WHERE workspace_id=$1 ORDER BY created_at DESC`,
      [workspace_id]
    );
    res.json({ monitors: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/monitors
router.post('/', async (req, res) => {
  const { workspace_id, name, keywords, email, frequency, sources } = req.body;
  if (!workspace_id || !keywords || !email) return res.status(400).json({ error: 'workspace_id, keywords, email required' });
  await ensureReady();
  try {
    const monitorName = name || `"${keywords}"`;
    const { rows } = await db.query(
      `INSERT INTO search_monitors (workspace_id, name, keywords, email, frequency, sources)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [workspace_id, monitorName, keywords, email,
       frequency || 'daily',
       JSON.stringify(sources || ['reddit','linkedin'])]
    );
    // Trigger immediate check for this monitor
    setImmediate(async () => {
      try {
        const { fetchNewItems } = require('../monitorScheduler');
        await fetchNewItems(rows[0]);
      } catch(e) {}
    });
    res.json({ monitor: rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/monitors/:id  (pause/resume, change email, frequency)
router.patch('/:id', async (req, res) => {
  const { workspace_id, active, email, frequency } = req.body;
  await ensureReady();
  try {
    const sets = []; const vals = [];
    if (active  !== undefined) { sets.push(`active=$${sets.length+1}`);    vals.push(active); }
    if (email)                 { sets.push(`email=$${sets.length+1}`);     vals.push(email); }
    if (frequency)             { sets.push(`frequency=$${sets.length+1}`); vals.push(frequency); }
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id, workspace_id);
    await db.query(`UPDATE search_monitors SET ${sets.join(',')} WHERE id=$${vals.length-1} AND workspace_id=$${vals.length}`, vals);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/monitors/:id
router.delete('/:id', async (req, res) => {
  const { workspace_id } = req.query;
  await ensureReady();
  try {
    await db.query('DELETE FROM search_monitors WHERE id=$1 AND workspace_id=$2', [req.params.id, workspace_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/monitors/:id/check-now  (manual trigger)
router.post('/:id/check-now', async (req, res) => {
  const { workspace_id } = req.body;
  await ensureReady();
  try {
    const { rows: [monitor] } = await db.query(
      'SELECT * FROM search_monitors WHERE id=$1 AND workspace_id=$2', [req.params.id, workspace_id]
    );
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    const { fetchNewItems } = require('../monitorScheduler');
    const newItems = await fetchNewItems(monitor);
    await db.query('UPDATE search_monitors SET last_check_at=NOW() WHERE id=$1', [monitor.id]);
    res.json({ new_items: newItems.length, ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// GET /api/monitors/items — all saved items across all monitors for a workspace
router.get('/items', async (req, res) => {
  const { workspace_id, source, limit = 50, offset = 0 } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  await ensureReady();
  try {
    const whereClauses = ['mi.monitor_id IN (SELECT id FROM search_monitors WHERE workspace_id=$1)'];
    const vals = [workspace_id];
    if (source && source !== 'all') {
      vals.push(source);
      whereClauses.push(`mi.source = $${vals.length}`);
    }
    const where = whereClauses.join(' AND ');

    const { rows: items } = await db.query(
      `SELECT mi.*, sm.keywords as monitor_keywords, sm.name as monitor_name
       FROM monitor_items mi
       JOIN search_monitors sm ON sm.id = mi.monitor_id
       WHERE ${where}
       ORDER BY mi.found_at DESC
       LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,
      [...vals, parseInt(limit), parseInt(offset)]
    );

    const { rows: [cnt] } = await db.query(
      `SELECT COUNT(*) as total FROM monitor_items mi WHERE ${where}`,
      vals
    );

    // Also include discover_feed items
    const { rows: feedItems } = await db.query(
      `SELECT di.*, df.keywords as monitor_keywords, df.name as monitor_name, 'feed' as feed_type
       FROM discover_items di
       JOIN discover_feeds df ON df.id = di.feed_id
       WHERE df.workspace_id=$1 ${source && source !== 'all' ? `AND di.source=$${vals.length}` : ''}
       ORDER BY di.found_at DESC
       LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,
      [...vals, parseInt(limit), parseInt(offset)]
    );

    res.json({
      items,
      feed_items: feedItems,
      total: parseInt(cnt.total),
      offset: parseInt(offset),
      limit: parseInt(limit),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// DELETE /api/monitors/:id/items — clear all items for a monitor
router.delete('/:id/items', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  await ensureReady();
  try {
    const { rowCount } = await db.query(
      `DELETE FROM monitor_items
       WHERE monitor_id=$1
         AND monitor_id IN (SELECT id FROM search_monitors WHERE workspace_id=$2)`,
      [req.params.id, workspace_id]
    );
    res.json({ ok: true, deleted: rowCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
