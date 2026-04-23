/**
 * src/routes/enrollments.js
 *
 * Two routers exported:
 *   campaignRouter  — mounted at /api/campaigns  (/:id/enroll, /:id/enrollments)
 *   enrollmentRouter — mounted at /api/enrollments (/:id GET/PATCH, /:id/message)
 */

const express = require('express');
const db      = require('../db');
const unipile = require('../unipile');

// ── Router 1: campaign-scoped ─────────────────────────────────────────────────

const campaignRouter = express.Router();

// POST /api/campaigns/:id/enroll
campaignRouter.post('/:id/enroll', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    if (!wsId) return res.status(400).json({ error: 'workspace_id required' });
    const campId = parseInt(req.params.id);
    const { rows: camps } = await db.query(
      'SELECT * FROM campaigns WHERE id=$1 AND workspace_id=$2', [campId, wsId]);
    if (!camps.length) return res.status(404).json({ error: 'Campaign not found' });
    const campaign = camps[0];
    if (!campaign.list_id) return res.status(400).json({ error: 'Campaign has no list attached' });

    const { rows: listContacts } = await db.query(`
      SELECT c.id, c.already_connected
      FROM list_contacts lc JOIN contacts c ON c.id = lc.contact_id
      WHERE lc.list_id = $1 AND c.workspace_id = $2
    `, [campaign.list_id, wsId]);

    if (!listContacts.length) return res.json({ enrolled: 0, skipped: 0, message: 'No contacts in list' });

    let enrolled = 0, skipped = 0;
    for (const c of listContacts) {
      const initialStatus = c.already_connected ? 'approved' : 'pending';
      const { rowCount } = await db.query(`
        INSERT INTO enrollments (campaign_id, contact_id, status, next_action_at)
        VALUES ($1, $2, $3, NOW()) ON CONFLICT (campaign_id, contact_id) DO NOTHING
      `, [campId, c.id, initialStatus]);
      rowCount > 0 ? enrolled++ : skipped++;
    }
    res.json({ enrolled, skipped, total: listContacts.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/campaigns/:id/enrollments
campaignRouter.get('/:id/enrollments', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    if (!wsId) return res.status(400).json({ error: 'workspace_id required' });
    const campId = parseInt(req.params.id);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    const statusFilter = req.query.status || null;

    const conditions = ['e.campaign_id = $1'];
    const params = [campId];
    if (statusFilter) { params.push(statusFilter); conditions.push(`e.status = $${params.length}`); }
    const where = conditions.join(' AND ');

    const { rows: cnt } = await db.query(`SELECT COUNT(*) FROM enrollments e WHERE ${where}`, params);
    const { rows } = await db.query(`
      SELECT e.id, e.status, e.current_step, e.next_action_at,
             e.invite_sent_at, e.invite_approved_at, e.error_message,
             e.campaign_id, e.contact_id,
             COALESCE(e.chat_id, c.chat_id) AS chat_id,
             c.first_name, c.last_name, c.company, c.title,
             c.li_profile_url, c.already_connected, c.provider_id,
             (SELECT LEFT(m.content, 200)
              FROM inbox_messages m
              JOIN inbox_threads t ON t.id = m.thread_id
              WHERE t.thread_id = COALESCE(e.chat_id, c.chat_id)
                AND m.direction = 'received'
              ORDER BY m.sent_at DESC LIMIT 1) AS last_reply
      FROM enrollments e JOIN contacts c ON c.id = e.contact_id
      WHERE ${where}
      ORDER BY e.updated_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    res.json({ items: rows, total: parseInt(cnt[0].count), page, limit,
               pages: Math.ceil(parseInt(cnt[0].count) / limit) || 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Router 2: enrollment-scoped ───────────────────────────────────────────────

const enrollmentRouter = express.Router();

// GET /api/enrollments?workspace_id=&campaign_id=&status=&limit=&offset=
enrollmentRouter.get('/', async (req, res) => {
  try {
    const { workspace_id, campaign_id, status, limit = 50, offset = 0 } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    let where = 'WHERE camp.workspace_id = $1';
    const params = [workspace_id];

    if (campaign_id) { params.push(campaign_id); where += ` AND e.campaign_id = $${params.length}`; }
    if (status)      { params.push(status);      where += ` AND e.status = $${params.length}`; }

    params.push(parseInt(limit));  const limitN  = params.length;
    params.push(parseInt(offset)); const offsetN = params.length;

    const { rows } = await db.query(`
      SELECT e.id, e.status, e.current_step, e.next_action_at,
             e.invite_sent_at, e.invite_approved_at, e.error_message,
             e.campaign_id, e.contact_id,
             COALESCE(e.chat_id, c.chat_id) AS chat_id,
             c.first_name, c.last_name, c.company, c.li_profile_url,
             c.title, c.provider_id,
             camp.name AS campaign_name, camp.account_id,
             (SELECT LEFT(m.content, 200)
              FROM inbox_messages m
              JOIN inbox_threads t ON t.id = m.thread_id
              WHERE t.thread_id = COALESCE(e.chat_id, c.chat_id)
                AND m.direction = 'received'
              ORDER BY m.sent_at DESC LIMIT 1) AS last_reply
      FROM enrollments e
      JOIN contacts  c    ON c.id    = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      ${where}
      ORDER BY e.updated_at DESC
      LIMIT $${limitN} OFFSET $${offsetN}
    `, params);

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS n FROM enrollments e JOIN campaigns camp ON camp.id = e.campaign_id ${where.split('LIMIT')[0]}`,
      params.slice(0, -2)
    );

    res.json({ items: rows, total: parseInt(countRows[0]?.n || 0), limit: parseInt(limit), offset: parseInt(offset) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/enrollments/:id
enrollmentRouter.get('/:id', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    if (!wsId) return res.status(400).json({ error: 'workspace_id required' });
    const { rows } = await db.query(`
      SELECT e.*, c.first_name, c.last_name, c.company, c.title,
             c.li_profile_url, c.provider_id, c.already_connected,
             camp.name AS campaign_name, camp.account_id
      FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      WHERE e.id = $1 AND camp.workspace_id = $2
    `, [req.params.id, wsId]);
    if (!rows.length) return res.status(404).json({ error: 'Enrollment not found' });
    const { rows: msgs } = await db.query(
      'SELECT * FROM enrollment_messages WHERE enrollment_id=$1 ORDER BY sent_at ASC',
      [req.params.id]);
    res.json({ ...rows[0], messages: msgs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/enrollments/:id
enrollmentRouter.patch('/:id', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    if (!wsId) return res.status(400).json({ error: 'workspace_id required' });
    const enrollId = parseInt(req.params.id);
    const { rows: enRows } = await db.query(`
      SELECT e.* FROM enrollments e JOIN campaigns camp ON camp.id = e.campaign_id
      WHERE e.id = $1 AND camp.workspace_id = $2
    `, [enrollId, wsId]);
    if (!enRows.length) return res.status(404).json({ error: 'Enrollment not found' });

    const { status, next_action_at } = req.body;
    const sets = ['updated_at = NOW()'], vals = [enrollId];
    const VALID = ['pending','invite_sent','approved','messaged','replied',
                   'positive_reply','withdrawn','done','skipped','error'];
    if (status) {
      if (!VALID.includes(status)) return res.status(400).json({ error: `Invalid status: ${status}` });
      vals.push(status); sets.push(`status = $${vals.length}`);
    }
    if (next_action_at) { vals.push(next_action_at); sets.push(`next_action_at = $${vals.length}`); }

    const { rows: updated } = await db.query(
      `UPDATE enrollments SET ${sets.join(',')} WHERE id = $1 RETURNING *`, vals);
    res.json(updated[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/enrollments/:id/message
enrollmentRouter.post('/:id/message', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    if (!wsId) return res.status(400).json({ error: 'workspace_id required' });
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });
    const enrollId = parseInt(req.params.id);
    const { rows } = await db.query(`
      SELECT e.*, c.provider_id, c.chat_id AS contact_chat_id, camp.account_id
      FROM enrollments e JOIN contacts c ON c.id = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      WHERE e.id = $1 AND camp.workspace_id = $2
    `, [enrollId, wsId]);
    if (!rows.length) return res.status(404).json({ error: 'Enrollment not found' });
    const enr = rows[0];
    const chatId = enr.chat_id || enr.contact_chat_id;
    let msgId = null;
    if (chatId) {
      const r = await unipile.sendMessage(enr.account_id, chatId, text.trim());
      msgId = r?.id || null;
    } else if (enr.provider_id) {
      const r = await unipile.startDirectMessage(enr.account_id, enr.provider_id, text.trim());
      msgId = r?.message_id || null;
      const newChatId = r?.id || r?.chat_id || null;
      if (newChatId)
        await db.query('UPDATE enrollments SET chat_id=$1, updated_at=NOW() WHERE id=$2', [newChatId, enrollId]);
    } else {
      return res.status(400).json({ error: 'No chat_id or provider_id' });
    }
    await db.query(
      `INSERT INTO enrollment_messages (enrollment_id, step_index, variant_label, text, sent_at, unipile_message_id)
       VALUES ($1, -1, 'manual', $2, NOW(), $3)`,
      [enrollId, text.trim(), msgId]);
    res.json({ success: true, unipile_message_id: msgId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { campaignRouter, enrollmentRouter };
