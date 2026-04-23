/**
 * Historical Stats Routes
 *
 * GET /api/stats/history?workspace_id=&days=30
 *   Returns daily snapshot data for all campaigns in a workspace.
 *   Used for trend charts and time-based comparisons.
 *
 * GET /api/stats/history?campaign_id=&days=30
 *   Returns daily snapshot data for a single campaign.
 *
 * GET /api/stats/funnel?workspace_id=
 *   Returns current funnel totals across all campaigns.
 *
 * GET /api/stats/followers?account_id=&days=30
 *   Returns daily follower count history for a company page.
 *
 * GET /api/stats/contacts/timeline?campaign_id=
 *   Returns each contact's full event timeline (when each milestone was hit).
 *   Useful for seeing the journey of individual contacts.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ── GET /api/stats/history ─────────────────────────────────────────────────
// Daily snapshots for trend charts
router.get('/history', async (req, res) => {
  try {
    const { workspace_id, campaign_id, days = 30 } = req.query;
    if (!workspace_id && !campaign_id)
      return res.status(400).json({ error: 'workspace_id or campaign_id required' });

    const conditions = [];
    const params     = [];

    if (workspace_id) { params.push(workspace_id); conditions.push(`workspace_id = $${params.length}`); }
    if (campaign_id)  { params.push(campaign_id);  conditions.push(`campaign_id = $${params.length}`); }

    params.push(parseInt(days));
    conditions.push(`snapshot_date >= CURRENT_DATE - ($${params.length} || ' days')::interval`);

    const { rows } = await db.query(
      `SELECT *
       FROM campaign_daily_stats
       WHERE ${conditions.join(' AND ')}
       ORDER BY snapshot_date ASC, campaign_id ASC`,
      params
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/stats/funnel ──────────────────────────────────────────────────
router.get('/funnel', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const { rows } = await db.query(`
      SELECT
        COUNT(*)                                                   AS total_contacts,
        COUNT(*) FILTER (WHERE invite_sent = true)                 AS invites_sent,
        COUNT(*) FILTER (WHERE invite_approved = true)             AS invites_approved,
        COUNT(*) FILTER (WHERE msg_sent = true)                   AS messages_sent,
        COUNT(*) FILTER (WHERE msg_replied = true)                AS messages_replied,
        COUNT(*) FILTER (WHERE positive_reply = true)             AS positive_replies,
        COUNT(*) FILTER (WHERE company_follow_invited = true)     AS follow_invited,
        COUNT(*) FILTER (WHERE company_follow_confirmed = true)   AS follow_confirmed
      FROM contacts
      WHERE workspace_id = $1
    `, [workspace_id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/stats/followers ──────────────────────────────────────────────
router.get('/followers', async (req, res) => {
  try {
    const { account_id, days = 30 } = req.query;
    if (!account_id) return res.status(400).json({ error: 'account_id required' });

    const { rows } = await db.query(
      `SELECT snapshot_date, total_followers
       FROM company_page_daily_stats
       WHERE account_id = $1
         AND snapshot_date >= CURRENT_DATE - ($2 || ' days')::interval
       ORDER BY snapshot_date ASC`,
      [account_id, parseInt(days)]
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/stats/contacts/timeline ───────────────────────────────────────
// Per-contact event timeline — shows when each milestone was reached
router.get('/contacts/timeline', async (req, res) => {
  try {
    const { campaign_id, workspace_id } = req.query;
    if (!campaign_id && !workspace_id)
      return res.status(400).json({ error: 'campaign_id or workspace_id required' });

    const conditions = [];
    const params     = [];
    if (campaign_id)  { params.push(campaign_id);  conditions.push(`c.campaign_id = $${params.length}`); }
    if (workspace_id) { params.push(workspace_id); conditions.push(`c.workspace_id = $${params.length}`); }

    const { rows } = await db.query(`
      SELECT
        c.id, c.first_name, c.last_name, c.company, c.title, c.li_profile_url,
        camp.name AS campaign_name,
        c.created_at                  AS added_at,
        c.invite_sent_at,
        c.invite_approved_at,
        c.msg_sent_at,
        c.msg_replied_at,
        c.positive_reply_at,
        c.company_follow_invited_at,
        c.company_follow_confirmed_at,
        -- Days between each stage (NULL if stage not reached)
        CASE WHEN c.invite_sent_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (c.invite_sent_at - c.created_at)) / 86400
        END AS days_to_invite,
        CASE WHEN c.invite_approved_at IS NOT NULL AND c.invite_sent_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (c.invite_approved_at - c.invite_sent_at)) / 86400
        END AS days_invite_to_approved,
        CASE WHEN c.company_follow_invited_at IS NOT NULL AND c.invite_approved_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (c.company_follow_invited_at - c.invite_approved_at)) / 86400
        END AS days_approved_to_follow_invite
      FROM contacts c
      JOIN campaigns camp ON camp.id = c.campaign_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.created_at DESC
    `, params);

    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
