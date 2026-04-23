/**
 * /api/companies — Campaign Companies routes
 *
 * Companies are automatically populated from enriched contacts' profile_data.
 * Each row = one unique employer company per campaign.
 */
const express                  = require('express');
const router                   = express.Router();
const db                       = require('../db');
const unipile                  = require('../unipile');          // must be at top
const companyEngagementScraper = require('../companyEngagementScraper');

// GET /api/companies?workspace_id=&campaign_id=
router.get('/', async (req, res) => {
  try {
    const { workspace_id, campaign_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const params = [workspace_id];
    let where = 'WHERE cc.workspace_id = $1';
    if (campaign_id) {
      params.push(campaign_id);
      where += ` AND cc.campaign_id = $${params.length}`;
    }

    const { rows } = await db.query(
      `SELECT cc.*,
              c.name AS campaign_name,
              c.account_id
       FROM campaign_companies cc
       LEFT JOIN campaigns c ON c.id = cc.campaign_id
       ${where}
       ORDER BY cc.company_name ASC`,
      params
    );

    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/companies/stats?workspace_id=&campaign_id=
router.get('/stats', async (req, res) => {
  try {
    const { workspace_id, campaign_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const params = [workspace_id];
    let where = 'WHERE workspace_id = $1';
    if (campaign_id) { params.push(campaign_id); where += ` AND campaign_id = $${params.length}`; }

    const { rows } = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE engagement_level = 'engaged')         AS engaged,
         COUNT(*) FILTER (WHERE engagement_level = 'average_engaged')  AS average_engaged,
         COUNT(*) FILTER (WHERE engagement_level = 'un_engaged')       AS un_engaged,
         COUNT(*) FILTER (WHERE engagement_level IS NULL)              AS not_yet_scraped,
         COUNT(*) FILTER (WHERE engagement_level IN ('engaged','average_engaged')) AS with_content,
         COALESCE(SUM(post_likes_sent), 0)                            AS total_post_likes,
         COUNT(*) FILTER (WHERE post_likes_sent > 0)                  AS companies_liked,
         COUNT(*)                                                       AS total
       FROM campaign_companies ${where}`,
      params
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/companies/scrape-engagement
router.post('/scrape-engagement', async (req, res) => {
  try {
    const workspace_id = req.query.workspace_id || req.body?.workspace_id;
    const campaign_id  = req.query.campaign_id  || req.body?.campaign_id;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    if (req.body?.force) {
      const params = [workspace_id];
      let where = 'WHERE workspace_id = $1';
      if (campaign_id) { params.push(campaign_id); where += ` AND campaign_id = $${params.length}`; }
      await db.query(
        `UPDATE campaign_companies SET engagement_level = NULL, engagement_scraped_at = NULL, engagement_data = NULL ${where}`,
        params
      );
      console.log(`[API] Reset company engagement (workspace=${workspace_id} campaign=${campaign_id||'all'})`);
    }

    const campId = campaign_id ? parseInt(campaign_id, 10) : null;
    companyEngagementScraper.run(campId)
      .then(r => console.log('[API] Company scrape done:', JSON.stringify(r)))
      .catch(e => console.error('[API] Company scrape error:', e.message));

    res.json({ status: 'started', campaign_id: campId || 'all' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/companies/send-likes
router.post('/send-likes', async (req, res) => {
  try {
    const workspace_id = req.query.workspace_id || req.body?.workspace_id;
    const campaign_id  = req.query.campaign_id  || req.body?.campaign_id;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const COOLDOWN_MS    = 3 * 24 * 60 * 60 * 1000;
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const MAX_LIKES = 3;

    const params = [workspace_id, cooldownCutoff];
    let where = `
      WHERE cc.workspace_id = $1
        AND cc.engagement_level IN ('engaged','average_engaged')
        AND cc.company_linkedin_id IS NOT NULL
        AND (cc.likes_sent_at IS NULL OR cc.likes_sent_at < $2)
        AND COALESCE(cc.post_likes_sent, 0) < ${MAX_LIKES}
    `;
    if (campaign_id) { params.push(campaign_id); where += ` AND cc.campaign_id = $${params.length}`; }

    const { rows: companies } = await db.query(
      `SELECT cc.id, cc.company_name, cc.company_linkedin_id,
              cc.post_likes_sent, cc.liked_ids, cc.engagement_data,
              c.account_id
       FROM campaign_companies cc
       JOIN campaigns c ON c.id = cc.campaign_id
       ${where}
       ORDER BY CASE cc.engagement_level WHEN 'engaged' THEN 0 ELSE 1 END, cc.id ASC
       LIMIT 20`,
      params
    );

    if (!companies.length) {
      return res.json({ status: 'no_eligible_companies', liked: 0 });
    }

    res.json({ status: 'started', companies_queued: companies.length });

    // Run async
    (async () => {
      const rand  = (min, max) => min + Math.random() * (max - min);
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      let totalLiked = 0;

      for (const company of companies) {
        try {
          const d = typeof company.engagement_data === 'string'
            ? JSON.parse(company.engagement_data) : (company.engagement_data || {});
          const posts14d = d.posts_14d_data || d.posts || [];

          const alreadyLiked = new Set(Array.isArray(company.liked_ids) ? company.liked_ids : []);
          const alreadySent  = company.post_likes_sent || 0;
          const remaining    = MAX_LIKES - alreadySent;
          if (remaining <= 0) continue;

          const newPosts = posts14d.filter(p => {
            const sid = String(p.social_id || p.id || p.post_id || '');
            return sid && !alreadyLiked.has(sid);
          });

          let liked = 0;
          const newIds = [];
          for (const post of newPosts) {
            if (liked >= remaining) break;
            const sid = String(post.social_id || post.id || post.post_id || '');
            if (!sid) continue;
            try {
              await unipile.likePost(company.account_id, sid);
              newIds.push(sid); liked++;
              console.log(`[API send-likes] 👍 ${company.company_name}`);
              if (liked < remaining) await sleep(rand(5000, 15000));
            } catch (err) {
              console.error(`[API send-likes] ✗ ${company.company_name}: ${err.message}`);
            }
          }

          if (liked > 0) {
            const merged = [...alreadyLiked, ...newIds];
            await db.query(
              `UPDATE campaign_companies
               SET post_likes_sent = COALESCE(post_likes_sent,0) + $1,
                   likes_sent_at   = NOW(),
                   liked_ids       = $2::jsonb
               WHERE id = $3`,
              [liked, JSON.stringify(merged), company.id]
            );
            totalLiked += liked;
          }
        } catch (err) {
          console.error(`[API send-likes] error ${company.company_name}:`, err.message);
        }
        await sleep(rand(10000, 30000));
      }
      console.log(`[API send-likes] Done. Total liked: ${totalLiked}`);
    })();

  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/companies/backfill
// Re-populates campaign_companies from all enriched contacts.
// Uses correct GROUP BY count (not +1 per iteration) to avoid double-counting.
router.post('/backfill', async (req, res) => {
  try {
    const workspace_id = req.query.workspace_id || req.body?.workspace_id;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    // Count contacts per company per campaign in one pass
    const { rows: groups } = await db.query(
      `SELECT
         campaign_id, workspace_id, company, li_company_url,
         profile_data->'work_experience'->0->>'company_id' AS company_linkedin_id,
         profile_data->'work_experience'->0->>'company'    AS company_from_exp,
         COUNT(*) AS contact_count
       FROM contacts
       WHERE workspace_id = $1
         AND profile_data IS NOT NULL
         AND profile_data::text != '{}'
         AND profile_data::text != 'null'
         AND profile_data->'work_experience'->0->>'company_id' IS NOT NULL
         AND campaign_id IS NOT NULL
       GROUP BY campaign_id, workspace_id, company, li_company_url,
                profile_data->'work_experience'->0->>'company_id',
                profile_data->'work_experience'->0->>'company'`,
      [workspace_id]
    );

    console.log(`[Companies backfill] Found ${groups.length} company/campaign pairs`);

    let upserted = 0;
    for (const g of groups) {
      if (!g.company_linkedin_id || !g.campaign_id) continue;
      const name = g.company_from_exp || g.company || '';
      const url  = g.li_company_url || `https://www.linkedin.com/company/${g.company_linkedin_id}`;
      await db.query(
        `INSERT INTO campaign_companies
           (campaign_id, workspace_id, company_name, li_company_url, company_linkedin_id, contact_count)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (campaign_id, company_linkedin_id)
         DO UPDATE SET
           company_name  = EXCLUDED.company_name,
           li_company_url = EXCLUDED.li_company_url,
           contact_count  = EXCLUDED.contact_count`,
        [g.campaign_id, g.workspace_id, name, url, g.company_linkedin_id, parseInt(g.contact_count)]
      );
      upserted++;
    }

    res.json({ companies_upserted: upserted });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
