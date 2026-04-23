const express = require('express');
const router = express.Router();
const db = require('../db');
const { searchPeopleByKeywords } = require('../unipile');
const { enqueue, getStatus } = require('../enrichment');
const { countSentThisMonth } = require('../companyFollowSender');
const engagementScraper = require('../engagementScraper');
const likeSender = require('../likeSender');
const withdrawSender = require('../withdrawSender');

const MAX_MSG_SLOTS = 20;
const BATCH_SIZE = 4;
const BATCH_MAX_PAGES = 3;

async function requireCampaign(req, res, workspaceId) {
  if (!workspaceId) { res.status(400).json({ error: 'workspace_id required' }); return null; }
  const campaignId = parseInt(req.params.id, 10);
  if (isNaN(campaignId)) { res.status(400).json({ error: 'Invalid campaign ID' }); return null; }
  const { rows } = await db.query(
    'SELECT * FROM campaigns WHERE id = $1 AND workspace_id = $2',
    [campaignId, workspaceId]
  );
  if (!rows.length) { res.status(404).json({ error: 'Campaign not found or access denied' }); return null; }
  return rows[0];
}

function extractCompanySlug(url) {
  const match = String(url).match(/linkedin\.com\/company\/([^/?#]+)/);
  return match ? match[1].replace(/\/$/, '').trim() : null;
}

function buildKeywordsQuery(companyUrls, titles, country) {
  const companyNames = [...new Set(
    (companyUrls || []).map(url => {
      const slug = extractCompanySlug(url);
      if (!slug) return null;
      return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }).filter(Boolean)
  )];
  const parts = [];
  if (titles?.length) parts.push(`(${titles.join(' OR ')})`);
  if (companyNames.length) parts.push(`(${companyNames.join(' OR ')})`);
  if (country?.trim()) parts.push(country.trim());
  return parts.join(' ');
}

router.get('/', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
    const { rows } = await db.query(
      `SELECT c.*, (SELECT name FROM lists WHERE id = c.list_id) AS list_name,
        (SELECT name FROM sequences WHERE id = c.sequence_id) AS sequence_name,
        (SELECT COUNT(*) FROM contacts WHERE campaign_id = c.id) AS contact_count,
        (SELECT COUNT(*) FROM enrollments WHERE campaign_id = c.id) AS enrollment_count,
        (SELECT COUNT(*) FROM contacts WHERE campaign_id = c.id AND invite_sent = true) AS invites_sent,
        (SELECT COUNT(*) FROM contacts WHERE campaign_id = c.id AND invite_approved = true) AS invites_approved,
        (SELECT COUNT(*) FROM contacts WHERE campaign_id = c.id AND msg_sent = true) AS messages_sent,
        (SELECT COUNT(*) FROM contacts WHERE campaign_id = c.id AND msg_replied = true) AS messages_replied,
        (SELECT COUNT(*) FROM contacts WHERE campaign_id = c.id AND positive_reply = true) AS positive_replies,
        (SELECT COUNT(*) FROM contacts WHERE campaign_id = c.id AND company_follow_invited = true) AS follow_invited,
        (SELECT COUNT(*) FROM contacts WHERE campaign_id = c.id AND company_follow_confirmed = true) AS follow_confirmed,
        (SELECT COUNT(*) FROM contacts WHERE campaign_id = c.id AND last_profile_view_at IS NOT NULL) AS profile_views,
        (SELECT COALESCE(SUM(post_likes_sent),0) FROM contacts WHERE campaign_id = c.id) AS total_post_likes,
        (SELECT COALESCE(SUM(comment_likes_sent),0) FROM contacts WHERE campaign_id = c.id) AS total_comment_likes
       FROM campaigns c WHERE c.workspace_id = $1 ORDER BY c.created_at DESC`,
      [workspace_id]);
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/enrichment-status', (_req, res) => res.json(getStatus()));

router.get('/company-follow-status', async (req, res) => {
  try {
    const { account_id } = req.query;
    if (!account_id) return res.status(400).json({ error: 'account_id required' });
    const sent = await countSentThisMonth(account_id);
    res.json({ sent_this_month: sent, monthly_limit: 250, remaining: Math.max(0, 250 - sent) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/ab-analytics', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const { rows: overallRows } = await db.query(
      `SELECT COUNT(*) AS total_contacts,
        COUNT(*) FILTER (WHERE already_connected = true) AS already_connected,
        COUNT(*) FILTER (WHERE invite_sent = true) AS invites_sent,
        COUNT(*) FILTER (WHERE invite_approved = true) AS invites_approved,
        COUNT(*) FILTER (WHERE msg_sent = true) AS messages_sent,
        COUNT(*) FILTER (WHERE msg_replied = true) AS messages_replied,
        COUNT(*) FILTER (WHERE positive_reply = true) AS positive_replies,
        COALESCE(SUM(msgs_sent_count), 0) AS total_msgs_sent,
        COUNT(*) FILTER (WHERE provider_id LIKE 'ACo%') AS enriched_count
       FROM contacts WHERE campaign_id = $1 AND workspace_id = $2`,
      [camp.id, wsId]);
    const rawSettings = camp.settings || {};
    const settings = typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings;
    const messages = settings.messages || {};
    const steps = [];
    for (let i = 1; i <= MAX_MSG_SLOTS; i++) {
      const { rows } = await db.query(
        `SELECT COALESCE(msg_${i}_variant, 'A') AS variant,
          COUNT(*) AS sent,
          COUNT(*) FILTER (WHERE msg_replied = true) AS replied
         FROM contacts WHERE campaign_id = $1 AND workspace_id = $2 AND msg_${i}_text IS NOT NULL
         GROUP BY COALESCE(msg_${i}_variant, 'A') ORDER BY COALESCE(msg_${i}_variant, 'A')`,
        [camp.id, wsId]);
      if (rows.length > 0) {
        const allSeqs = [...(messages.new||[]),...(messages.existing_no_history||[]),...(messages.existing_with_history||[])];
        const stepCfg = allSeqs[i-1];
        steps.push({ step: i, delay: stepCfg?.delay, unit: stepCfg?.unit,
          variants: rows.map(r => ({ label: r.variant, sent: parseInt(r.sent),
            replied: parseInt(r.replied),
            rate: parseInt(r.sent) > 0 ? Math.round(parseInt(r.replied) / parseInt(r.sent) * 100) : 0 })) });
      }
    }
    // Get sequence name if attached
    let sequenceName = null;
    if (camp.sequence_id) {
      const { rows: seqRows } = await db.query('SELECT name FROM sequences WHERE id=$1', [camp.sequence_id]);
      sequenceName = seqRows[0]?.name || null;
    }
    res.json({ overall: overallRows[0], campaign_name: camp.name, sequence_name: sequenceName, steps });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/engagement-stats', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const { rows } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE engagement_level = 'un_engaged') AS un_engaged,
        COUNT(*) FILTER (WHERE engagement_level = 'average_engaged') AS average_engaged,
        COUNT(*) FILTER (WHERE engagement_level = 'engaged') AS engaged,
        COUNT(*) FILTER (WHERE engagement_level IN ('average_engaged','engaged')) AS with_content,
        COUNT(*) FILTER (WHERE engagement_level IS NULL AND provider_id IS NOT NULL) AS not_yet_scraped,
        COUNT(*) FILTER (WHERE provider_id IS NULL) AS not_enriched,
        COALESCE(SUM(post_likes_sent),0) AS total_post_likes,
        COALESCE(SUM(comment_likes_sent),0) AS total_comment_likes,
        COUNT(*) FILTER (WHERE post_likes_sent > 0 OR comment_likes_sent > 0) AS contacts_liked,
        COUNT(*) AS total
       FROM contacts WHERE campaign_id = $1 AND workspace_id = $2`,
      [camp.id, wsId]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { workspace_id, account_id, name, audience_type, contacts, settings, list_id, sequence_id } = req.body;
    if (!workspace_id || !name) return res.status(400).json({ error: 'workspace_id and name required' });
    const { rows } = await db.query(
      `INSERT INTO campaigns (workspace_id, account_id, name, audience_type, settings, status, list_id, sequence_id)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7) RETURNING *`,
      [workspace_id, account_id, name, audience_type, JSON.stringify(settings || {}), list_id || null, sequence_id || null]);
    const campaign = rows[0];
    // Ã¢ÂÂÃ¢ÂÂ If list_id provided, copy contacts from the list into this campaign Ã¢ÂÂÃ¢ÂÂ
    if (list_id) {
      await db.query(
        `INSERT INTO contacts (workspace_id, campaign_id, li_profile_url,
            first_name, last_name, company, title)
          SELECT c.workspace_id, $1, c.li_profile_url,
                 c.first_name, c.last_name, c.company, c.title
          FROM list_contacts lc
          JOIN contacts c ON c.id = lc.contact_id
          WHERE lc.list_id = $2
            AND c.workspace_id = $3
            AND NOT EXISTS (
              SELECT 1 FROM contacts c2
              WHERE c2.campaign_id = $1
                AND c2.li_profile_url = c.li_profile_url
                AND c2.workspace_id = $3
            )`,
        [campaign.id, list_id, workspace_id]
      );
    }
    const toEnrich = [];
    if (Array.isArray(contacts) && contacts.length > 0) {
      for (const c of contacts) {
        const { rows: ins } = await db.query(
          `INSERT INTO contacts (campaign_id, workspace_id, first_name, last_name, company, title, li_profile_url, li_company_url, email, website)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, li_profile_url`,
          [campaign.id, workspace_id, c.first_name||'', c.last_name||'', c.company||'',
           c.title||'', c.li_profile_url||c.linkedin_url||'', c.li_company_url||'', c.email||'', c.website||'']);
        const saved = ins[0];
        if (saved?.li_profile_url?.includes('linkedin.com/in/')) toEnrich.push({ id: saved.id, li_profile_url: saved.li_profile_url });
      }
    }
    res.status(201).json({ ...campaign, enrichment_queued: toEnrich.length });
    for (const c of toEnrich) enqueue(c.id, account_id, c.li_profile_url);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/scrape-engagement', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    if (req.body?.force) await db.query(
      'UPDATE contacts SET engagement_level=NULL,engagement_scraped_at=NULL,engagement_data=NULL WHERE campaign_id=$1 AND workspace_id=$2',
      [camp.id, wsId]);
    engagementScraper.run(camp.id).catch(e => console.error('[API] Scrape error:', e.message));
    res.json({ status: 'started', campaign_id: camp.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/reclassify', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const result = await engagementScraper.reclassifyFromExistingData(camp.id);
    engagementScraper.run(camp.id).catch(e => console.error('[API] Post-reclassify error:', e.message));
    res.json({ ...result, scrape_started: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/send-likes', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    likeSender.run(camp.id, { force: !!req.body?.force }).catch(e => console.error('[API] Likes error:', e.message));
    res.json({ status: 'started', campaign_id: camp.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/run-withdraw', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const result = await withdrawSender.run(camp.id);
    res.json({ campaign_id: camp.id, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const { status } = req.body;
    if (!['active','paused'].includes(status)) return res.status(400).json({ error: 'status must be active or paused' });
    const { rows } = await db.query(
      'UPDATE campaigns SET status=$1 WHERE id=$2 AND workspace_id=$3 RETURNING *',
      [status, camp.id, wsId]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/settings', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const { settings } = req.body;
    if (!settings) return res.status(400).json({ error: 'settings required' });
    const { rows } = await db.query(
      'UPDATE campaigns SET settings=$1 WHERE id=$2 AND workspace_id=$3 RETURNING *',
      [JSON.stringify(settings), camp.id, wsId]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE campaign Ã¢ÂÂ optional cascades controlled by query params:
//   ?delete_contacts=true   Ã¢ÂÂ also delete contacts (All Data)
//   ?delete_companies=true  Ã¢ÂÂ also delete campaign_companies (Opportunities link)
router.delete('/:id', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;

    const deleteContacts  = req.query.delete_contacts  === 'true';
    const deleteCompanies = req.query.delete_companies === 'true';

    if (deleteContacts) {
      const { rowCount } = await db.query(
        'DELETE FROM contacts WHERE campaign_id = $1 AND workspace_id = $2', [camp.id, wsId]);
      console.log(`[Campaigns] Deleted ${rowCount} contact(s) for campaign ${camp.id}`);
    }
    if (deleteCompanies) {
      const { rowCount } = await db.query(
        'DELETE FROM campaign_companies WHERE campaign_id = $1', [camp.id]);
      console.log(`[Campaigns] Deleted ${rowCount} campaign_compan(ies) for campaign ${camp.id}`);
    }

    await db.query('DELETE FROM campaigns WHERE id=$1 AND workspace_id=$2', [camp.id, wsId]);
    console.log(`[Campaigns] Deleted campaign ${camp.id} ("${camp.name}") | contacts=${deleteContacts} companies=${deleteCompanies}`);
    res.json({ success: true, deleted_contacts: deleteContacts, deleted_companies: deleteCompanies });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/search-people', async (req, res) => {
  try {
    const { account_id, company_urls, titles, target_country } = req.body;
    if (!account_id || !company_urls?.length) return res.status(400).json({ error: 'account_id and company_urls required' });
    const previewBatch = company_urls.slice(0, BATCH_SIZE);
    const keywords = buildKeywordsQuery(previewBatch, titles || [], target_country || '');
    if (!keywords) return res.json({ items: [], companies: [], keywords_query: '', next_cursor: null, total_batches: 0 });
    const totalBatches = Math.ceil(company_urls.length / BATCH_SIZE);
    console.log(`[Search] Batch 1/${totalBatches} (${previewBatch.length} co${target_country ? ' + '+target_country : ''}): "${keywords.slice(0,120)}"`);
    const { items, cursor, totalCount } = await searchPeopleByKeywords(account_id, keywords, 50);
    res.json({ items, companies: [], keywords_query: keywords, next_cursor: cursor,
      total_count: totalCount, total_companies: company_urls.length, previewed_batches: 1,
      total_batches: totalBatches, has_more_batches: totalBatches > 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const { rows: cnt } = await db.query(
      `SELECT (SELECT COUNT(*) FROM contacts WHERE campaign_id=$1 AND workspace_id=$2) AS contact_count,
              (SELECT COUNT(*) FROM campaign_companies WHERE campaign_id=$1 AND workspace_id=$2) AS company_count`,
      [camp.id, wsId]);
    if (typeof camp.settings === 'string') camp.settings = JSON.parse(camp.settings);
    res.json({ ...camp, ...cnt[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/companies', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const { rows } = await db.query(
      `SELECT id, company_name, company_linkedin_id, li_company_url, contact_count, created_at
       FROM campaign_companies WHERE campaign_id=$1 AND workspace_id=$2 ORDER BY company_name`,
      [camp.id, wsId]);
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/contacts', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    const { rows: cnt } = await db.query('SELECT COUNT(*) FROM contacts WHERE campaign_id=$1 AND workspace_id=$2', [camp.id, wsId]);
    const total = parseInt(cnt[0].count);
    const { rows } = await db.query(
      `SELECT id, first_name, last_name, company, title, li_profile_url,
              invite_sent, invite_approved, already_connected, msg_sent, msg_replied, positive_reply, created_at
       FROM contacts WHERE campaign_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [camp.id, wsId, limit, offset]);
    res.json({ items: rows, total, page, limit, pages: Math.ceil(total / limit) || 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/contacts', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const { contacts } = req.body;
    if (!Array.isArray(contacts) || !contacts.length) return res.status(400).json({ error: 'contacts[] required' });
    let added = 0, skipped = 0;
    const toEnrich = [];
    for (const c of contacts) {
      const url = (c.li_profile_url || '').trim();
      if (!url.includes('linkedin.com/in/')) { skipped++; continue; }
      const { rows: dup } = await db.query(
        'SELECT id FROM contacts WHERE campaign_id=$1 AND workspace_id=$2 AND li_profile_url=$3 LIMIT 1',
        [camp.id, wsId, url]);
      if (dup.length) { skipped++; continue; }
      const { rows: ins } = await db.query(
        `INSERT INTO contacts (campaign_id, workspace_id, first_name, last_name, company, title, li_profile_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [camp.id, wsId, c.first_name||'', c.last_name||'', c.company||'', c.title||'', url]);
      added++;
      if (ins[0]?.id) toEnrich.push({ id: ins[0].id, li_profile_url: url });
    }
    for (const c of toEnrich) enqueue(c.id, camp.account_id, c.li_profile_url);
    res.json({ added, skipped, enrichment_queued: toEnrich.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/contacts/:contactId', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const { rowCount } = await db.query(
      'DELETE FROM contacts WHERE id=$1 AND campaign_id=$2 AND workspace_id=$3',
      [req.params.contactId, camp.id, wsId]);
    if (!rowCount) return res.status(404).json({ error: 'Contact not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function runKeywordsBatchFetch(campaignId, workspaceId, accountId, companyUrls, titles, startBatchIdx, country) {
  const totalBatches = Math.ceil(companyUrls.length / BATCH_SIZE);
  console.log(`[BatchFetch] Campaign ${campaignId}: batches ${startBatchIdx + 1}-${totalBatches}${country ? ' country='+country : ''}`);
  let totalAdded = 0;
  for (let batchIdx = startBatchIdx; batchIdx < totalBatches; batchIdx++) {
    const batch = companyUrls.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
    const keywords = buildKeywordsQuery(batch, titles, country);
    console.log(`[BatchFetch] Campaign ${campaignId}: b${batchIdx+1}/${totalBatches} ÃÂ¢ÃÂÃÂ "${keywords.slice(0,100)}"`);
    let cursor = null, page = 0;
    do {
      page++;
      try {
        const { items, cursor: nextCursor } = await searchPeopleByKeywords(accountId, keywords, 50, cursor);
        cursor = nextCursor;
        for (const p of items) {
          const liUrl = p.public_profile_url || p.li_profile_url || '';
          if (!liUrl.includes('linkedin.com/in/')) continue;
          const { rows: dup } = await db.query(
            'SELECT id FROM contacts WHERE campaign_id=$1 AND workspace_id=$2 AND li_profile_url=$3 LIMIT 1',
            [campaignId, workspaceId, liUrl]);
          if (dup.length) continue;
          const { rows: ins } = await db.query(
            `INSERT INTO contacts (campaign_id, workspace_id, first_name, last_name, company, title, li_profile_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [campaignId, workspaceId, p.first_name||'', p.last_name||'', p.company||'', p.headline||'', liUrl]);
          if (ins[0]?.id) { totalAdded++; enqueue(ins[0].id, accountId, liUrl); }
        }
      } catch (e) { console.error(`[BatchFetch] Campaign ${campaignId} b${batchIdx+1} p${page}:`, e.message); break; }
      if (!cursor) break;
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
    } while (page < BATCH_MAX_PAGES);
    if (batchIdx < totalBatches - 1) await new Promise(r => setTimeout(r, 4000 + Math.random() * 3000));
  }
  console.log(`[BatchFetch] Campaign ${campaignId}: complete ÃÂ¢ÃÂÃÂ ${totalAdded} contacts added`);
}

router.post('/:id/fetch-all-companies', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const settings = typeof camp.settings === 'string' ? JSON.parse(camp.settings) : (camp.settings || {});
    const sc = settings.searchConfig || {};
    const { companyUrls = [], titles = [], targetCountry = '' } = sc;
    if (!companyUrls.length) return res.json({ status: 'nothing_to_fetch', reason: 'no companyUrls in searchConfig' });
    const totalBatches = Math.ceil(companyUrls.length / BATCH_SIZE);
    if (totalBatches <= 1) return res.json({ status: 'nothing_to_fetch', reason: 'preview covered all companies' });
    runKeywordsBatchFetch(camp.id, camp.workspace_id, camp.account_id, companyUrls, titles, 1, targetCountry)
      .catch(e => console.error(`[BatchFetch] Campaign ${camp.id}:`, e.message));
    res.json({ status: 'started', mode: 'batched_keywords', remaining_batches: totalBatches - 1, total_companies: companyUrls.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});



// PATCH /api/campaigns/:id/sequence — attach/detach a sequence
router.patch('/:id/sequence', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const { sequence_id } = req.body;
    const { rows } = await db.query(
      'UPDATE campaigns SET sequence_id=$1 WHERE id=$2 AND workspace_id=$3 RETURNING *',
      [sequence_id || null, camp.id, wsId]
    );
    res.json({ success: true, campaign: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/campaigns/:id/list â attach a list to an existing campaign + bulk-import contacts
router.patch('/:id/list', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const camp = await requireCampaign(req, res, wsId);
    if (!camp) return;
    const { list_id } = req.body;
    if (!list_id) return res.status(400).json({ error: 'list_id required' });

    // 1. Update campaign list_id
    await db.query(
      'UPDATE campaigns SET list_id = $1 WHERE id = $2 AND workspace_id = $3',
      [list_id, camp.id, wsId]
    );

    // 2. Copy contacts from list into this campaign (INSERT per campaign row).
    //    Constraint is now UNIQUE(workspace_id, campaign_id, li_profile_url)
    //    so the same person can exist in multiple campaigns.
    const { rowCount } = await db.query(
      `INSERT INTO contacts
        (workspace_id, campaign_id, li_profile_url,
         first_name, last_name, company, title, provider_id, member_urn,
         already_connected, msg_sequence, msg_sequence_started_at)
       SELECT
         c.workspace_id, $1, c.li_profile_url,
         c.first_name, c.last_name, c.company, c.title, c.provider_id, c.member_urn,
         c.already_connected,
         CASE WHEN c.already_connected = true THEN 'existing_no_history' ELSE NULL END,
         CASE WHEN c.already_connected = true THEN NOW() ELSE NULL END
       FROM list_contacts lc
       JOIN contacts c ON c.id = lc.contact_id
       WHERE lc.list_id = $2
         AND c.workspace_id = $3
       ON CONFLICT (workspace_id, campaign_id, li_profile_url) DO NOTHING`,
      [camp.id, list_id, wsId]
    );

    res.json({ success: true, list_id, contacts_added: rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
