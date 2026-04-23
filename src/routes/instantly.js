const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v2';

async function getKey(workspaceId) {
  const r = await pool.query('SELECT instantly_api_key FROM workspaces WHERE id=$1', [workspaceId]);
  return r.rows[0]?.instantly_api_key || null;
}

function proxyHeaders(key) {
  return { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
}

// ── Ensure instantly_leads table exists ──────────────────────────────────
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS instantly_leads (
      id            TEXT PRIMARY KEY,
      workspace_id  INTEGER NOT NULL,
      campaign_id   TEXT NOT NULL,
      campaign_name TEXT,
      email         TEXT,
      email_lower   TEXT GENERATED ALWAYS AS (LOWER(email)) STORED,
      first_name    TEXT,
      last_name     TEXT,
      name_lower    TEXT GENERATED ALWAYS AS (LOWER(COALESCE(first_name,'') || ' ' || LOWER(COALESCE(last_name,'')))) STORED,
      company_name  TEXT,
      company_domain TEXT,
      job_title     TEXT,
      status        INTEGER,
      lt_interest_status INTEGER,
      email_open_count   INTEGER DEFAULT 0,
      email_reply_count  INTEGER DEFAULT 0,
      email_click_count  INTEGER DEFAULT 0,
      last_contact  TIMESTAMPTZ,
      synced_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_il_workspace ON instantly_leads(workspace_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_il_campaign  ON instantly_leads(campaign_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_il_email     ON instantly_leads(email_lower)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_il_name      ON instantly_leads(name_lower)`);
}

// GET /api/instantly/campaigns
router.get('/campaigns', async (req, res) => {
  try {
    const key = await getKey(req.query.workspace_id || 4);
    if (!key) return res.status(403).json({ error: 'No Instantly key for this workspace' });
    const r = await fetch(`${INSTANTLY_BASE}/campaigns?limit=50`, { headers: proxyHeaders(key) });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/instantly/campaigns/:id/analytics
router.get('/campaigns/:id/analytics', async (req, res) => {
  try {
    const key = await getKey(req.query.workspace_id || 4);
    if (!key) return res.status(403).json({ error: 'No Instantly key for this workspace' });
    const r = await fetch(`${INSTANTLY_BASE}/campaigns/analytics`, { headers: proxyHeaders(key) });
    const d = await r.json();
    const items = Array.isArray(d) ? d : (d.items || d.data || []);
    const campaign = items.find(c => c.campaign_id === req.params.id);
    res.json(campaign || { error: 'Campaign not found', campaign_id: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/instantly/campaigns/:id/leads  — paginated proxy
router.post('/campaigns/:id/leads', async (req, res) => {
  try {
    const key = await getKey(req.query.workspace_id || 4);
    if (!key) return res.status(403).json({ error: 'No Instantly key for this workspace' });
    const body = { campaign_id: req.params.id, limit: req.body.limit || 100 };
    if (req.body.starting_after) body.starting_after = req.body.starting_after;
    const r = await fetch(`${INSTANTLY_BASE}/leads/list`, {
      method: 'POST', headers: proxyHeaders(key), body: JSON.stringify(body)
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/instantly/accounts
router.get('/accounts', async (req, res) => {
  try {
    const key = await getKey(req.query.workspace_id || 4);
    if (!key) return res.status(403).json({ error: 'No Instantly key for this workspace' });
    const r = await fetch(`${INSTANTLY_BASE}/accounts?limit=50`, { headers: proxyHeaders(key) });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/instantly/sync/:campaign_id — pull all leads from Instantly → DB
router.post('/sync/:campaign_id', async (req, res) => {
  const wsId = req.query.workspace_id || req.body.workspace_id || 4;
  try {
    await ensureTable();
    const key = await getKey(wsId);
    if (!key) return res.status(403).json({ error: 'No Instantly key' });

    // Get campaign name
    const campR = await fetch(`${INSTANTLY_BASE}/campaigns/${req.params.campaign_id}`, { headers: proxyHeaders(key) });
    const campData = await campR.json();
    const campaignName = campData.name || req.params.campaign_id;

    let inserted = 0, updated = 0, cursor = null, total = 0;

    while (true) {
      const body = { campaign_id: req.params.campaign_id, limit: 100 };
      if (cursor) body.starting_after = cursor;
      const r = await fetch(`${INSTANTLY_BASE}/leads/list`, {
        method: 'POST', headers: proxyHeaders(key), body: JSON.stringify(body)
      });
      const d = await r.json();
      const items = d.items || [];
      if (!items.length) break;

      for (const l of items) {
        const domain = l.company_domain || (l.email ? l.email.split('@')[1] : null);
        await pool.query(`
          INSERT INTO instantly_leads
            (id, workspace_id, campaign_id, campaign_name, email, first_name, last_name,
             company_name, company_domain, job_title, status, lt_interest_status,
             email_open_count, email_reply_count, email_click_count, last_contact, synced_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
          ON CONFLICT (id) DO UPDATE SET
            lt_interest_status = EXCLUDED.lt_interest_status,
            email_open_count   = EXCLUDED.email_open_count,
            email_reply_count  = EXCLUDED.email_reply_count,
            email_click_count  = EXCLUDED.email_click_count,
            last_contact       = EXCLUDED.last_contact,
            synced_at          = NOW()
        `, [
          l.id, wsId, req.params.campaign_id, campaignName,
          l.email || null, l.first_name || null, l.last_name || null,
          l.company_name || null, domain,
          l.job_title || null, l.status || null, l.lt_interest_status || null,
          l.email_open_count || 0, l.email_reply_count || 0, l.email_click_count || 0,
          l.timestamp_last_contact || null
        ]);
        inserted++;
      }

      total += items.length;
      if (items.length < 100) break;
      cursor = d.next_starting_after || items[items.length - 1].id;
    }

    res.json({ ok: true, campaign: campaignName, synced: total });
  } catch (e) {
    console.error('sync error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/instantly/overlap?workspace_id=4&campaign_id=xxx&list_id=yyy
// Returns contacts that appear in BOTH Instantly campaign AND LinkedIn lists
router.get('/overlap', async (req, res) => {
  const wsId = req.query.workspace_id || 4;
  const campaignId = req.query.campaign_id;
  const listId = req.query.list_id; // optional — filter to specific list

  try {
    await ensureTable();

    const listFilter = listId
      ? `AND lc.list_id = ${parseInt(listId)}`
      : `AND lc.list_id IN (SELECT id FROM lists WHERE workspace_id = ${parseInt(wsId)})`;

    // Email match (high confidence)
    const emailMatches = await pool.query(`
      SELECT
        c.id            AS contact_id,
        c.first_name,
        c.last_name,
        c.company,
        c.title,
        c.li_profile_url,
        c.email         AS li_email,
        il.email        AS instantly_email,
        il.job_title    AS instantly_title,
        il.lt_interest_status,
        il.email_open_count,
        il.email_reply_count,
        il.campaign_name,
        il.last_contact,
        'email'         AS match_type,
        100             AS confidence
      FROM contacts c
      JOIN list_contacts lc ON lc.contact_id = c.id
      JOIN instantly_leads il
        ON LOWER(COALESCE(c.email,'x_no_email_x')) = il.email_lower
        AND il.campaign_id = $1
      WHERE 1=1 ${listFilter}
      AND c.email IS NOT NULL AND c.email <> ''
    `, [campaignId]);

    // Name + domain match (medium confidence)
    const nameMatches = await pool.query(`
      SELECT
        c.id            AS contact_id,
        c.first_name,
        c.last_name,
        c.company,
        c.title,
        c.li_profile_url,
        c.email         AS li_email,
        il.email        AS instantly_email,
        il.job_title    AS instantly_title,
        il.lt_interest_status,
        il.email_open_count,
        il.email_reply_count,
        il.campaign_name,
        il.last_contact,
        'name+domain'   AS match_type,
        75              AS confidence
      FROM contacts c
      JOIN list_contacts lc ON lc.contact_id = c.id
      JOIN instantly_leads il
        ON LOWER(c.first_name) = LOWER(il.first_name)
        AND LOWER(c.last_name)  = LOWER(il.last_name)
        AND il.campaign_id = $1
        AND il.company_domain IS NOT NULL
        AND (
          c.li_profile_url ILIKE '%' || il.company_domain || '%'
          OR LOWER(c.company) ILIKE '%' || SPLIT_PART(il.company_domain,'.',1) || '%'
        )
      WHERE 1=1 ${listFilter}
      AND (c.email IS NULL OR c.email = '' OR LOWER(c.email) <> il.email_lower)
    `, [campaignId]);

    // Name only match (low confidence)
    const nameOnlyMatches = await pool.query(`
      SELECT
        c.id            AS contact_id,
        c.first_name,
        c.last_name,
        c.company,
        c.title,
        c.li_profile_url,
        c.email         AS li_email,
        il.email        AS instantly_email,
        il.job_title    AS instantly_title,
        il.lt_interest_status,
        il.email_open_count,
        il.email_reply_count,
        il.campaign_name,
        il.last_contact,
        'name_only'     AS match_type,
        50              AS confidence
      FROM contacts c
      JOIN list_contacts lc ON lc.contact_id = c.id
      JOIN instantly_leads il
        ON LOWER(c.first_name) = LOWER(il.first_name)
        AND LOWER(c.last_name)  = LOWER(il.last_name)
        AND il.campaign_id = $1
      WHERE 1=1 ${listFilter}
      AND (c.email IS NULL OR c.email = '' OR LOWER(c.email) <> il.email_lower)
      AND NOT (
        il.company_domain IS NOT NULL
        AND (
          c.li_profile_url ILIKE '%' || il.company_domain || '%'
          OR LOWER(c.company) ILIKE '%' || SPLIT_PART(il.company_domain,'.',1) || '%'
        )
      )
    `, [campaignId]);

    // Combine, dedup by contact_id keeping highest confidence
    const seen = new Map();
    const allRows = [...emailMatches.rows, ...nameMatches.rows, ...nameOnlyMatches.rows];
    for (const row of allRows) {
      const existing = seen.get(row.contact_id);
      if (!existing || row.confidence > existing.confidence) {
        seen.set(row.contact_id, row);
      }
    }

    const results = Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);

    // Get list stats
    const listsRes = await pool.query(`
      SELECT l.id, l.name, COUNT(lc.contact_id) as contact_count
      FROM lists l
      JOIN list_contacts lc ON lc.list_id = l.id
      WHERE l.workspace_id = $1
      GROUP BY l.id, l.name
      ORDER BY l.name
    `, [wsId]);

    // Count synced leads
    const syncedRes = await pool.query(
      'SELECT COUNT(*) FROM instantly_leads WHERE campaign_id=$1', [campaignId]
    );

    res.json({
      ok: true,
      campaign_id: campaignId,
      total_overlap: results.length,
      by_confidence: {
        email: results.filter(r => r.match_type === 'email').length,
        name_domain: results.filter(r => r.match_type === 'name+domain').length,
        name_only: results.filter(r => r.match_type === 'name_only').length,
      },
      instantly_leads_synced: parseInt(syncedRes.rows[0].count),
      lists: listsRes.rows,
      matches: results
    });
  } catch (e) {
    console.error('overlap error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/instantly/sync-status/:campaign_id
router.get('/sync-status/:campaign_id', async (req, res) => {
  try {
    await ensureTable();
    const r = await pool.query(
      `SELECT COUNT(*) as count, MAX(synced_at) as last_sync
       FROM instantly_leads WHERE campaign_id=$1`,
      [req.params.campaign_id]
    );
    res.json({ count: parseInt(r.rows[0].count), last_sync: r.rows[0].last_sync });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

