/**
 * Followers routes
 *
 * POST /api/followers/scrape          — trigger manual scrape
 * GET  /api/followers/status          — scrape status + last result
 * GET  /api/followers?workspace_id=   — list scraped followers for workspace
 * GET  /api/followers/stats?account_id= — confirmed follow stats
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { runScrape, getStatus } = require('../followerScraper');

// POST /api/followers/scrape
router.post('/scrape', async (req, res) => {
  const { account_id } = req.body;
  // Non-blocking — scrape runs in background
  runScrape(account_id).catch(e => console.error('[FollowerRoute] Scrape error:', e.message));
  res.json({ started: true, message: 'Scrape started in background' });
});

// GET /api/followers/status
router.get('/status', (_req, res) => {
  res.json(getStatus());
});

// GET /api/followers/stats?account_id=
router.get('/stats', async (req, res) => {
  try {
    const { account_id } = req.query;
    if (!account_id) return res.status(400).json({ error: 'account_id required' });

    const { rows } = await db.query(
      `SELECT
        COUNT(*)                                                          AS total_followers,
        (SELECT COUNT(*) FROM contacts c
         JOIN campaigns camp ON camp.id = c.campaign_id
         WHERE camp.account_id = $1
           AND c.company_follow_invited = true)                          AS total_invited,
        (SELECT COUNT(*) FROM contacts c
         JOIN campaigns camp ON camp.id = c.campaign_id
         WHERE camp.account_id = $1
           AND c.company_follow_confirmed = true)                        AS total_confirmed
       FROM company_followers
       WHERE account_id = $1`,
      [account_id]
    );
    const r = rows[0];
    res.json({
      total_followers:  parseInt(r.total_followers),
      total_invited:    parseInt(r.total_invited),
      total_confirmed:  parseInt(r.total_confirmed),
      conversion_rate:  r.total_invited > 0
        ? Math.round(r.total_confirmed / r.total_invited * 100) + '%'
        : '0%',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/followers?workspace_id=&page=&search=
router.get('/', async (req, res) => {
  try {
    const { workspace_id, page = 1, search = '' } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const offset = (parseInt(page) - 1) * 100;
    const like   = `%${search}%`;

    const { rows } = await db.query(
      `SELECT cf.*, c.id AS contact_id, c.invite_approved,
              c.company_follow_invited, c.company_follow_confirmed
       FROM company_followers cf
       JOIN unipile_accounts ua ON ua.account_id = cf.account_id
       LEFT JOIN contacts c ON (
         lower(c.li_profile_url) = lower(cf.profile_url)
         OR cf.profile_url ILIKE '%' || split_part(c.li_profile_url, '/in/', 2) || '%'
       )
       WHERE ua.workspace_id = $1
         AND ($2 = '' OR cf.name ILIKE $3 OR cf.headline ILIKE $3)
       ORDER BY cf.scraped_at DESC
       LIMIT 100 OFFSET $4`,
      [workspace_id, search, like, offset]
    );
    res.json({ items: rows, page: parseInt(page) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
