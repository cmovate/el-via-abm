const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { reExtractAll, enqueue, getStatus } = require('../enrichment');
const { sendInvitation, withdrawInvitation } = require('../unipile');
const { analyzeConversation } = require('../conversationAnalyzer');
const { status: queueStatus }  = require('../conversationQueue');

// GET /api/contacts?workspace_id=&campaign_id=&q=
router.get('/', async (req, res) => {
  try {
    const { workspace_id, campaign_id, q, list_id } = req.query;
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(5000, parseInt(req.query.limit) || 100);
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];
    if (workspace_id) { params.push(workspace_id); conditions.push(`c.workspace_id = $${params.length}`); }
    if (campaign_id)  { params.push(campaign_id);  conditions.push(`c.campaign_id  = $${params.length}`); }
    if (list_id) {
      params.push(parseInt(list_id));
      conditions.push(`EXISTS (SELECT 1 FROM list_contacts lc WHERE lc.contact_id = c.id AND lc.list_id = $${params.length})`);
    }
    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      conditions.push(`(c.first_name ILIKE $${i} OR c.last_name ILIKE $${i} OR c.company ILIKE $${i} OR c.title ILIKE $${i} OR c.email ILIKE $${i})`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows: cnt } = await db.query(
      `SELECT COUNT(*) FROM contacts c ${where}`, params
    );
    const total = parseInt(cnt[0].count);

    // Explicit column list — deliberately excludes engagement_data, profile_data (large JSONB)
    const { rows } = await db.query(
      `SELECT
         c.id, c.first_name, c.last_name, c.company, c.title,
         c.li_profile_url, c.li_company_url, c.email, c.website, c.location,
         c.provider_id, c.member_urn,
         c.already_connected, c.has_chat_history, c.chat_id,
         c.msg_sequence, c.msg_step, c.msg_sequence_started_at, c.msgs_sent_count,
         c.invite_sent, c.invite_approved, c.invite_withdrawn,
         c.invite_sent_at, c.invite_approved_at, c.invite_withdrawn_at,
         c.msg_sent, c.msg_replied, c.positive_reply,
         c.msg_sent_at, c.msg_replied_at, c.positive_reply_at,
         c.engagement_level, c.engagement_scraped_at,
         c.post_likes_sent, c.comment_likes_sent, c.likes_sent_at,
         c.conversation_stage, c.conversation_score, c.conversation_analyzed_at,
         c.connected_via, c.campaign_id, c.target_account_id,
         c.enriched_at, c.created_at,
         camp.name AS campaign_name,
         COALESCE((
           SELECT STRING_AGG(l.name, ', ' ORDER BY l.name)
           FROM list_contacts lc JOIN lists l ON l.id = lc.list_id
           WHERE lc.contact_id = c.id
         ), '') AS list_names
       FROM contacts c
       LEFT JOIN campaigns camp ON camp.id = c.campaign_id
       ${where}
       ORDER BY c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ items: rows, total, page, limit, pages: Math.ceil(total / limit) || 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/contacts/:id/conversation
// Returns the full conversation analysis for a single contact.
router.get('/:id/conversation', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, first_name, last_name,
              conversation_stage, conversation_score,
              conversation_signals, conversation_analyzed_at
       FROM contacts WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contact not found' });
    const r = rows[0];
    const signals = typeof r.conversation_signals === 'string'
      ? JSON.parse(r.conversation_signals || '{}')
      : (r.conversation_signals || {});
    res.json({
      contact_id:   r.id,
      name:         `${r.first_name} ${r.last_name}`,
      stage:        r.conversation_stage,
      score:        r.conversation_score,
      analyzed_at:  r.conversation_analyzed_at,
      ...signals,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/contacts/:id/re-analyze
// Manually trigger conversation analysis for a single contact.
router.post('/:id/re-analyze', async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    const { rows } = await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.chat_id, camp.account_id
       FROM contacts c
       JOIN campaigns camp ON camp.id = c.campaign_id
       WHERE c.id = $1`,
      [contactId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contact not found' });
    const contact = rows[0];
    if (!contact.chat_id)    return res.status(400).json({ error: 'No chat_id ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ contact has not been messaged or replied yet' });
    if (!contact.account_id) return res.status(400).json({ error: 'No account_id ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ campaign missing account' });

    // Run async, return immediately
    analyzeConversation(contactId, contact.account_id, contact.chat_id)
      .then(r => console.log(`[API] Re-analyze done for contact ${contactId}: stage=${r.stage} score=${r.score}`))
      .catch(e => console.error(`[API] Re-analyze error for contact ${contactId}: ${e.message}`));

    res.json({ status: 'started', contact_id: contactId, name: `${contact.first_name} ${contact.last_name}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/contacts/conversation-queue-status
router.get('/conversation-queue-status', (_req, res) => res.json(queueStatus()));

// GET /api/contacts/debug-profile/:id
router.get('/debug-profile/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, first_name, last_name, li_profile_url, profile_data FROM contacts WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contact not found' });
    const row = rows[0];
    const raw = row.profile_data
      ? (typeof row.profile_data === 'string' ? JSON.parse(row.profile_data) : row.profile_data)
      : null;
    function inventory(obj, prefix) {
      prefix = prefix || '';
      const result = {};
      if (!obj || typeof obj !== 'object') return result;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        const fullKey = prefix ? prefix + '.' + k : k;
        if (Array.isArray(v)) {
          result[fullKey] = 'Array(' + v.length + ')';
          if (v.length > 0 && v[0] && typeof v[0] === 'object') Object.assign(result, inventory(v[0], fullKey + '[0]'));
          else if (v.length > 0) result[fullKey + '[0]'] = v[0];
        } else if (v && typeof v === 'object') {
          Object.assign(result, inventory(v, fullKey));
        } else {
          result[fullKey] = v;
        }
      }
      return result;
    }
    res.json({
      contact_id: row.id, stored_name: row.first_name + ' ' + row.last_name,
      li_profile_url: row.li_profile_url, has_profile_data: !!raw,
      field_map: raw ? inventory(raw) : null, raw_profile: raw,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/contacts/re-extract?workspace_id=X
router.post('/re-extract', async (req, res) => {
  try {
    const workspace_id = req.query.workspace_id || req.body.workspace_id;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
    const result = await reExtractAll(workspace_id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/contacts/re-enrich?workspace_id=X&campaign_id=Y
router.post('/re-enrich', async (req, res) => {
  try {
    const workspace_id = req.query.workspace_id || req.body.workspace_id;
    const campaign_id  = req.query.campaign_id  || req.body.campaign_id;
    const limit        = parseInt(req.query.limit || req.body.limit || '50', 10);
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
    const params = [workspace_id];
    let sql = `
      SELECT c.id, c.li_profile_url,
             COALESCE(camp.account_id, ua.account_id) AS account_id
      FROM contacts c
      LEFT JOIN campaigns camp ON camp.id = c.campaign_id
      LEFT JOIN LATERAL (
        SELECT account_id FROM unipile_accounts
        WHERE workspace_id = c.workspace_id LIMIT 1
      ) ua ON true
      WHERE c.workspace_id = $1
        AND c.li_profile_url IS NOT NULL AND c.li_profile_url != ''
        AND c.li_profile_url LIKE '%linkedin.com/in/%'
        AND (c.profile_data IS NULL OR c.profile_data::text = 'null' OR c.profile_data::text = '{}')
    `;
    if (campaign_id) { params.push(campaign_id); sql += ` AND c.campaign_id = $${params.length}`; }
    params.push(limit);
    sql += ` ORDER BY c.created_at ASC LIMIT $${params.length}`;
    const { rows } = await db.query(sql, params);
    let queued = 0;
    for (const row of rows) {
      if (row.account_id && row.li_profile_url) { enqueue(row.id, row.account_id, row.li_profile_url); queued++; }
    }
    res.json({ queued, total_needing_enrich: rows.length, enrichment_status: getStatus() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/contacts/:id/send-invite
router.post('/:id/send-invite', async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    const { rows } = await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.li_profile_url, c.provider_id,
              c.invite_sent, c.invite_approved, c.invite_withdrawn, camp.account_id
       FROM contacts c JOIN campaigns camp ON camp.id = c.campaign_id WHERE c.id = $1`,
      [contactId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contact not found' });
    const contact = rows[0];
    if (!contact.li_profile_url) return res.status(400).json({ error: 'Contact has no LinkedIn URL' });
    if (!contact.provider_id)    return res.status(400).json({ error: 'Contact not enriched yet ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ provider_id missing' });
    if (contact.invite_sent)     return res.status(400).json({ error: 'Invite already sent' });
    await sendInvitation(contact.account_id, contact.provider_id);
    await db.query('UPDATE contacts SET invite_sent = true, invite_sent_at = NOW() WHERE id = $1', [contactId]);
    res.json({ success: true, contact_id: contactId, name: `${contact.first_name} ${contact.last_name}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/contacts/:id/withdraw-invite
router.post('/:id/withdraw-invite', async (req, res) => {
  try {
    const contactId = parseInt(req.params.id, 10);
    const { rows } = await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.li_profile_url, c.provider_id,
              c.invite_sent, c.invite_approved, c.invite_withdrawn, camp.account_id
       FROM contacts c JOIN campaigns camp ON camp.id = c.campaign_id WHERE c.id = $1`,
      [contactId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contact not found' });
    const contact = rows[0];
    if (!contact.invite_sent)     return res.status(400).json({ error: 'No invite sent yet' });
    if (contact.invite_approved)  return res.status(400).json({ error: 'Invite already approved' });
    if (contact.invite_withdrawn) return res.status(400).json({ error: 'Invite already withdrawn' });
    if (!contact.provider_id)     return res.status(400).json({ error: 'Contact not enriched yet' });
    await withdrawInvitation(contact.account_id, contact.provider_id);
    await db.query('UPDATE contacts SET invite_withdrawn = true, invite_withdrawn_at = NOW() WHERE id = $1', [contactId]);
    res.json({ success: true, contact_id: contactId, name: `${contact.first_name} ${contact.last_name}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM contacts WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/contacts (bulk)
router.delete('/', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
    await db.query('DELETE FROM contacts WHERE id = ANY($1)', [ids]);
    res.json({ success: true, deleted: ids.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});



// POST /api/contacts/bulk-update ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ update specific fields on a set of contact IDs
// Body: { workspace_id, ids: [1,2,3], fields: { already_connected: true, msg_sequence: '...', ... } }
router.post('/bulk-update', async (req, res) => {
  try {
    const { workspace_id, ids, fields } = req.body;
    if (!workspace_id || !Array.isArray(ids) || !ids.length || !fields) {
      return res.status(400).json({ error: 'workspace_id, ids[], and fields required' });
    }
    // Allowed fields to update
    const allowed = ['already_connected','has_chat_history','chat_id',
                     'msg_sequence','msg_sequence_started_at','msg_step',
                     'invite_sent','invite_approved','invite_approved_at'];
    const setClauses = [];
    const values = [workspace_id];
    for (const [key, val] of Object.entries(fields)) {
      if (!allowed.includes(key)) continue;
      values.push(val);
      setClauses.push(`${key} = $${values.length}`);
    }
    if (!setClauses.length) return res.status(400).json({ error: 'No valid fields to update' });
    // Placeholders for ids
    const idPlaceholders = ids.map((_, i) => '$' + (values.length + 1 + i)).join(',');
    ids.forEach(id => values.push(id));
    const { rowCount } = await db.query(
      `UPDATE contacts SET ${setClauses.join(', ')} WHERE workspace_id = $1 AND id IN (${idPlaceholders})`,
      values
    );
    res.json({ success: true, updated: rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Trigger engagement scraper manually
router.post('/run-engagement-scraper', async (req, res) => {
  try {
    const { campaign_id } = req.body;
    const engScraper = require('../engagementScraper');
    // run without await â fire and forget so response returns immediately
    engScraper.run(campaign_id || null).then(r => {
      console.log('[Manual trigger] engagement scraper done:', JSON.stringify(r));
    }).catch(e => {
      console.error('[Manual trigger] engagement scraper error:', e.message);
    });
    res.json({ success: true, message: 'Engagement scraper started', campaign_id: campaign_id || 'all' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// POST /api/contacts/bulk-company-follow
// Sends company page follow invitations to up to N random eligible contacts
router.post('/bulk-company-follow', async (req, res) => {
  try {
    const { workspace_id, campaign_id, limit = 100, account_id, company_page_urn } = req.body;
    if (!workspace_id || !account_id || !company_page_urn) {
      return res.status(400).json({ error: 'workspace_id, account_id, company_page_urn required' });
    }

    // Fetch random eligible contacts (have provider_id, not yet invited)
    let query = `
      SELECT id, provider_id, first_name, last_name
      FROM contacts
      WHERE workspace_id = $1
        AND provider_id IS NOT NULL AND provider_id != ''
        AND company_follow_invited = false
    `;
    const params = [workspace_id];
    if (campaign_id) { query += ` AND campaign_id = $${params.length + 1}`; params.push(campaign_id); }
    query += ` ORDER BY RANDOM() LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const { rows: contacts } = await db.query(query, params);
    if (!contacts.length) return res.json({ sent: 0, message: 'No eligible contacts found' });

    // Send in batches of 20 (LinkedIn rate limit safety)
    const BATCH = 20;
    let totalSent = 0;
    const unipile = require('../unipile');

    for (let i = 0; i < contacts.length; i += BATCH) {
      const batch = contacts.slice(i, i + BATCH);
      const memberUrns = batch.map(c => `urn:li:fsd_profile:${c.provider_id}`);
      try {
        await unipile.sendCompanyFollowInvites(account_id, company_page_urn, memberUrns);
        const ids = batch.map(c => c.id);
        await db.query(
          `UPDATE contacts SET company_follow_invited = true, company_follow_invited_at = NOW() WHERE id = ANY($1::int[])`,
          [ids]
        );
        totalSent += batch.length;
        console.log(`[BulkFollow] Batch ${Math.floor(i/BATCH)+1}: sent ${batch.length}, total: ${totalSent}`);
      } catch (e) {
        console.error(`[BulkFollow] Batch error: ${e.message}`);
      }
      // Small delay between batches
      if (i + BATCH < contacts.length) await new Promise(r => setTimeout(r, 1500));
    }

    res.json({ sent: totalSent, total_eligible: contacts.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
