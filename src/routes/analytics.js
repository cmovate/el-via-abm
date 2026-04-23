/**
 * Analytics Share Token Routes
 *
 * POST /api/analytics/share-token  — create/get a share token for workspace+campaign
 * GET  /api/analytics/token/:token — resolve token → workspace_id + campaign_id
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const crypto  = require('crypto');

// Ensure table exists (runs on first request if not migrated yet)
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS analytics_share_tokens (
      id          SERIAL PRIMARY KEY,
      token       TEXT UNIQUE NOT NULL,
      workspace_id INTEGER NOT NULL,
      campaign_id  INTEGER NOT NULL,
      campaign_name TEXT,
      created_at  TIMESTAMP DEFAULT NOW(),
      revoked     BOOLEAN DEFAULT FALSE
    )
  `);
  tableReady = true;
}

// POST /api/analytics/share-token
// Body: { workspace_id, campaign_id }
router.post('/share-token', async (req, res) => {
  try {
    await ensureTable();
    const { workspace_id, campaign_id } = req.body;
    if (!workspace_id || !campaign_id) return res.status(400).json({ error: 'workspace_id and campaign_id required' });

    // Check if a non-revoked token already exists for this ws+campaign
    const { rows: existing } = await db.query(
      'SELECT token FROM analytics_share_tokens WHERE workspace_id=$1 AND campaign_id=$2 AND revoked=false ORDER BY created_at DESC LIMIT 1',
      [workspace_id, campaign_id]
    );
    if (existing.length) return res.json({ token: existing[0].token });

    // Get campaign name
    const { rows: camps } = await db.query('SELECT name FROM campaigns WHERE id=$1', [campaign_id]);
    const campaignName = camps[0]?.name || ('Campaign ' + campaign_id);

    // Generate new token
    const token = crypto.randomBytes(24).toString('hex');
    await db.query(
      'INSERT INTO analytics_share_tokens (token, workspace_id, campaign_id, campaign_name) VALUES ($1,$2,$3,$4)',
      [token, workspace_id, campaign_id, campaignName]
    );
    res.json({ token, campaign_name: campaignName });
  } catch (e) {
    console.error('[AnalyticsShare] share-token error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/analytics/token/:token
router.get('/token/:token', async (req, res) => {
  try {
    await ensureTable();
    const { token } = req.params;
    const { rows } = await db.query(
      'SELECT workspace_id, campaign_id, campaign_name FROM analytics_share_tokens WHERE token=$1 AND revoked=false LIMIT 1',
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Token not found or expired' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/analytics/token/:token — revoke
router.delete('/token/:token', async (req, res) => {
  try {
    await ensureTable();
    await db.query('UPDATE analytics_share_tokens SET revoked=true WHERE token=$1', [req.params.token]);
    res.json({ revoked: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
