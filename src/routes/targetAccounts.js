/**
 * src/routes/targetAccounts.js
 *
 * Target Accounts — companies as ABM entities.
 *
 * GET  /api/target-accounts?workspace_id=&sort=engagement_score_7d&list_id=
 * GET  /api/target-accounts/:id
 * POST /api/target-accounts               (manual create)
 * PATCH /api/target-accounts/:id
 * DELETE /api/target-accounts/:id
 * GET  /api/target-accounts/:id/contacts  — people at this company
 * GET  /api/target-accounts/:id/signals   — signals from this company
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/target-accounts?workspace_id=&sort=&list_id=
router.get('/', async (req, res) => {
  try {
    const { workspace_id, sort = 'engagement_score_7d', list_id, search } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    const conds  = ['ta.workspace_id = $1'];
    const params = [workspace_id];

    if (search) {
      params.push(`%${search}%`);
      conds.push(`(ta.name ILIKE $${params.length} OR ta.industry ILIKE $${params.length} OR ta.website ILIKE $${params.length})`);
    }

    if (list_id) {
      params.push(list_id);
      conds.push(`ta.id IN (
        SELECT DISTINCT c.target_account_id FROM contacts c
        JOIN list_contacts lc ON lc.contact_id = c.id
        WHERE lc.list_id = $${params.length} AND c.target_account_id IS NOT NULL
      )`);
    }

    const sortCol = ['engagement_score', 'engagement_score_7d', 'name', 'created_at']
      .includes(sort) ? sort : 'engagement_score_7d';

    const { rows: total } = await db.query(
      `SELECT COUNT(*) FROM target_accounts ta WHERE ${conds.join(' AND ')}`, params
    );

    const { rows } = await db.query(`
      SELECT
        ta.*,
        (SELECT COUNT(*) FROM contacts WHERE target_account_id = ta.id)         AS contacts_count,
        (SELECT COUNT(*) FROM enrollments e JOIN contacts c ON c.id = e.contact_id
         WHERE c.target_account_id = ta.id AND e.status NOT IN ('withdrawn','skipped','done')) AS active_enrollments,
        (SELECT MAX(occurred_at) FROM signals WHERE actor_target_account_id = ta.id) AS last_signal_at
      FROM target_accounts ta
      WHERE ${conds.join(' AND ')}
      ORDER BY ta.${sortCol} DESC NULLS LAST
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    res.json({
      items: rows,
      total: parseInt(total[0].count),
      page, limit,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/target-accounts/:id
router.get('/:id', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    const ta = await requireTA(req, res, workspace_id);
    if (!ta) return;

    const { rows: contacts } = await db.query(
      `SELECT id, first_name, last_name, title, li_profile_url, already_connected,
              engagement_score, last_signal_at
       FROM contacts WHERE target_account_id = $1 ORDER BY already_connected DESC, engagement_score DESC LIMIT 20`,
      [ta.id]
    );

    const { rows: signals } = await db.query(
      `SELECT id, type, actor_name, actor_li_url, content, occurred_at
       FROM signals WHERE actor_target_account_id = $1
       ORDER BY occurred_at DESC LIMIT 10`,
      [ta.id]
    );

    res.json({ ...ta, contacts, signals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/target-accounts
router.post('/', async (req, res) => {
  try {
    const { workspace_id, name, li_company_url, li_company_id, website, industry, company_size } = req.body;
    if (!workspace_id || !name?.trim())
      return res.status(400).json({ error: 'workspace_id and name required' });

    const { rows } = await db.query(`
      INSERT INTO target_accounts (workspace_id, name, li_company_url, li_company_id, website, industry, company_size)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [workspace_id, name.trim(), li_company_url||null, li_company_id||null,
        website||null, industry||null, company_size||null]);

    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/target-accounts/:id
router.patch('/:id', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const ta   = await requireTA(req, res, wsId);
    if (!ta) return;

    const fields = ['name','li_company_url','li_company_id','website','industry','company_size'];
    const sets = [], vals = [ta.id];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        vals.push(req.body[f] || null);
        sets.push(`${f} = $${vals.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    const { rows } = await db.query(
      `UPDATE target_accounts SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/target-accounts/:id
router.delete('/:id', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    const ta   = await requireTA(req, res, wsId);
    if (!ta) return;
    await db.query('DELETE FROM target_accounts WHERE id=$1', [ta.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/target-accounts/:id/contacts
router.get('/:id/contacts', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    const ta = await requireTA(req, res, workspace_id);
    if (!ta) return;
    const { rows } = await db.query(
      `SELECT id, first_name, last_name, title, li_profile_url,
              already_connected, engagement_score, enriched_at
       FROM contacts WHERE target_account_id=$1 ORDER BY already_connected DESC, engagement_score DESC`,
      [ta.id]
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/target-accounts/:id/signals
router.get('/:id/signals', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    const ta = await requireTA(req, res, workspace_id);
    if (!ta) return;
    const { rows } = await db.query(
      `SELECT * FROM signals WHERE actor_target_account_id=$1 ORDER BY occurred_at DESC LIMIT 50`,
      [ta.id]
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Helpers ──────────────────────────────────────────────────────────────────
async function requireTA(req, res, workspaceId) {
  if (!workspaceId) { res.status(400).json({ error: 'workspace_id required' }); return null; }
  const { rows } = await db.query(
    'SELECT * FROM target_accounts WHERE id=$1 AND workspace_id=$2',
    [req.params.id, workspaceId]
  );
  if (!rows.length) { res.status(404).json({ error: 'Target account not found' }); return null; }
  return rows[0];
}

module.exports = router;
