/**
 * Admin Analytics Route
 *
 * GET /api/admin/filter-options
 *   Returns distinct countries (from contacts.location) and companies
 *   (from contacts.company) for the autocomplete filters.
 *
 * GET /api/admin/analytics?from=&to=&country=&company=
 *   Cross-workspace analytics filtered by date range AND optionally by
 *   contact country (location ILIKE) and/or company (company ILIKE).
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/admin/filter-options
// Returns distinct values to populate the autocomplete dropdowns.
router.get('/filter-options', async (req, res) => {
  try {
    const [locRes, compRes] = await Promise.all([
      db.query(`
        SELECT DISTINCT TRIM(location) AS value
        FROM contacts
        WHERE location IS NOT NULL AND TRIM(location) != ''
        ORDER BY value
        LIMIT 300
      `),
      db.query(`
        SELECT DISTINCT TRIM(company) AS value
        FROM contacts
        WHERE company IS NOT NULL AND TRIM(company) != ''
        ORDER BY value
        LIMIT 500
      `),
    ]);
    res.json({
      countries: locRes.rows.map(r => r.value).filter(Boolean),
      companies: compRes.rows.map(r => r.value).filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&country=&company=
router.get('/analytics', async (req, res) => {
  try {
    const from        = req.query.from         || null;
    const to          = req.query.to           || null;
    const country     = req.query.country      || null;
    const company     = req.query.company      || null;
    const workspace_id = req.query.workspace_id ? parseInt(req.query.workspace_id) : null;

    // $1=from, $2=to, $3=country, $4=company, $5=workspace_id
    const p = [from, to, country, company, workspace_id];

    const inv  = `ct.invite_sent    = true AND ($1::date IS NULL OR ct.invite_sent_at    >= $1::date) AND ($2::date IS NULL OR ct.invite_sent_at    < $2::date + interval '1 day')`;
    const appr = `ct.invite_approved= true AND ($1::date IS NULL OR ct.invite_approved_at>= $1::date) AND ($2::date IS NULL OR ct.invite_approved_at< $2::date + interval '1 day')`;
    const msgs = `ct.msg_sent       = true AND ($1::date IS NULL OR ct.msg_sent_at        >= $1::date) AND ($2::date IS NULL OR ct.msg_sent_at        < $2::date + interval '1 day')`;
    const repl = `ct.msg_replied    = true AND ($1::date IS NULL OR ct.msg_replied_at     >= $1::date) AND ($2::date IS NULL OR ct.msg_replied_at     < $2::date + interval '1 day')`;
    const pos  = `ct.positive_reply = true AND ($1::date IS NULL OR ct.positive_reply_at  >= $1::date) AND ($2::date IS NULL OR ct.positive_reply_at  < $2::date + interval '1 day')`;
    const added= `($1::date IS NULL OR ct.created_at >= $1::date) AND ($2::date IS NULL OR ct.created_at < $2::date + interval '1 day')`;

    // workspace_id filter ($5)
    const wsFilter = `($5::int IS NULL OR c.workspace_id = $5::int)`;

    // Contacts subquery — also filtered by workspace when provided
    const ctJoin = `
      LEFT JOIN (
        SELECT * FROM contacts
        WHERE ($3::text IS NULL OR location ILIKE '%' || $3 || '%')
          AND ($4::text IS NULL OR company  ILIKE '%' || $4 || '%')
          AND ($5::int  IS NULL OR workspace_id = $5::int)
      ) ct ON ct.campaign_id = c.id
    `;

    // 1. Per-workspace
    const { rows: byWorkspace } = await db.query(`
      SELECT
        w.id   AS workspace_id,
        w.name AS workspace_name,
        COUNT(DISTINCT c.id)                                     AS campaign_count,
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'active') AS active_campaigns,
        COUNT(ct.id) FILTER (WHERE ${added})                    AS contacts_added,
        COUNT(ct.id) FILTER (WHERE ${inv})                      AS invites_sent,
        COUNT(ct.id) FILTER (WHERE ${appr})                     AS invites_approved,
        COUNT(ct.id) FILTER (WHERE ${msgs})                     AS messages_sent,
        COUNT(ct.id) FILTER (WHERE ${repl})                     AS messages_replied,
        COUNT(ct.id) FILTER (WHERE ${pos})                      AS positive_replies
      FROM workspaces w
      LEFT JOIN campaigns c ON c.workspace_id = w.id AND ${wsFilter}
      ${ctJoin}
      WHERE ($5::int IS NULL OR w.id = $5::int)
      GROUP BY w.id, w.name
      ORDER BY (COUNT(ct.id) FILTER (WHERE ${inv})) DESC NULLS LAST
    `, p);

    // 2. Per Unipile account
    const { rows: byAccount } = await db.query(`
      SELECT
        c.account_id,
        COALESCE(ua.display_name, c.account_id) AS account_name,
        COALESCE(w.name, '?')                   AS workspace_name,
        COUNT(DISTINCT c.id)                                     AS campaign_count,
        COUNT(ct.id) FILTER (WHERE ${added})                    AS contacts_added,
        COUNT(ct.id) FILTER (WHERE ${inv})                      AS invites_sent,
        COUNT(ct.id) FILTER (WHERE ${appr})                     AS invites_approved,
        COUNT(ct.id) FILTER (WHERE ${msgs})                     AS messages_sent,
        COUNT(ct.id) FILTER (WHERE ${repl})                     AS messages_replied,
        COUNT(ct.id) FILTER (WHERE ${pos})                      AS positive_replies
      FROM campaigns c
      LEFT JOIN workspaces       w  ON w.id          = c.workspace_id
      LEFT JOIN unipile_accounts ua ON ua.account_id = c.account_id AND ua.workspace_id = c.workspace_id
      ${ctJoin}
      WHERE c.account_id IS NOT NULL AND ${wsFilter}
      GROUP BY c.account_id, ua.display_name, w.name
      ORDER BY (COUNT(ct.id) FILTER (WHERE ${inv})) DESC NULLS LAST
    `, p);

    // 3. All campaigns
    const { rows: byCampaign } = await db.query(`
      SELECT
        c.id, c.name AS campaign_name, c.status,
        c.account_id, c.workspace_id, c.created_at,
        w.name                                  AS workspace_name,
        COALESCE(ua.display_name, c.account_id) AS account_name,
        COUNT(ct.id) FILTER (WHERE ${added})    AS contacts_added,
        COUNT(ct.id) FILTER (WHERE ${inv})      AS invites_sent,
        COUNT(ct.id) FILTER (WHERE ${appr})     AS invites_approved,
        COUNT(ct.id) FILTER (WHERE ${msgs})     AS messages_sent,
        COUNT(ct.id) FILTER (WHERE ${repl})     AS messages_replied,
        COUNT(ct.id) FILTER (WHERE ${pos})      AS positive_replies
      FROM campaigns c
      LEFT JOIN workspaces       w  ON w.id          = c.workspace_id
      LEFT JOIN unipile_accounts ua ON ua.account_id = c.account_id AND ua.workspace_id = c.workspace_id
      ${ctJoin}
      WHERE ${wsFilter}
      GROUP BY c.id, c.name, c.status, c.account_id, c.workspace_id, c.created_at, w.name, ua.display_name
      ORDER BY c.created_at DESC
    `, p);

    // 4. Daily timeline filtered by country/company as well.
    // $1/$2 = effectiveFrom/To, $3/$4 = country/company
    const effectiveFrom = from || (() => { const d = new Date(); d.setDate(d.getDate()-29); return d.toISOString().slice(0,10); })();
    const effectiveTo   = to   || new Date().toISOString().slice(0,10);
    const tp = [effectiveFrom, effectiveTo, country, company, workspace_id];

    const ctFilter = `($3::text IS NULL OR location ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR company  ILIKE '%' || $4 || '%')
        AND ($5::int  IS NULL OR workspace_id = $5::int)`;

    const { rows: timeline } = await db.query(`
      WITH ds AS (
        SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS d
      ),
      inv  AS (SELECT invite_sent_at::date    AS d, COUNT(*) AS cnt FROM contacts WHERE invite_sent_at::date    BETWEEN $1::date AND $2::date AND ${ctFilter} GROUP BY 1),
      appr AS (SELECT invite_approved_at::date AS d, COUNT(*) AS cnt FROM contacts WHERE invite_approved_at::date BETWEEN $1::date AND $2::date AND ${ctFilter} GROUP BY 1),
      msgs AS (SELECT msg_sent_at::date       AS d, COUNT(*) AS cnt FROM contacts WHERE msg_sent_at::date       BETWEEN $1::date AND $2::date AND ${ctFilter} GROUP BY 1),
      repl AS (SELECT msg_replied_at::date    AS d, COUNT(*) AS cnt FROM contacts WHERE msg_replied_at::date    BETWEEN $1::date AND $2::date AND ${ctFilter} GROUP BY 1),
      pos  AS (SELECT positive_reply_at::date  AS d, COUNT(*) AS cnt FROM contacts WHERE positive_reply_at::date  BETWEEN $1::date AND $2::date AND ${ctFilter} GROUP BY 1),
      adc  AS (SELECT created_at::date         AS d, COUNT(*) AS cnt FROM contacts WHERE created_at::date         BETWEEN $1::date AND $2::date AND ${ctFilter} GROUP BY 1)
      SELECT
        ds.d::text            AS date,
        COALESCE(inv.cnt,  0) AS invites_sent,
        COALESCE(appr.cnt, 0) AS invites_approved,
        COALESCE(msgs.cnt, 0) AS messages_sent,
        COALESCE(repl.cnt, 0) AS messages_replied,
        COALESCE(pos.cnt,  0) AS positive_replies,
        COALESCE(adc.cnt,  0) AS contacts_added
      FROM ds
      LEFT JOIN inv  ON inv.d  = ds.d
      LEFT JOIN appr ON appr.d = ds.d
      LEFT JOIN msgs ON msgs.d = ds.d
      LEFT JOIN repl ON repl.d = ds.d
      LEFT JOIN pos  ON pos.d  = ds.d
      LEFT JOIN adc  ON adc.d  = ds.d
      ORDER BY ds.d
    `, tp);

    // Global summary
    const summary = byWorkspace.reduce((acc, r) => {
      acc.contacts_added   += parseInt(r.contacts_added)   || 0;
      acc.invites_sent     += parseInt(r.invites_sent)     || 0;
      acc.invites_approved += parseInt(r.invites_approved) || 0;
      acc.messages_sent    += parseInt(r.messages_sent)    || 0;
      acc.messages_replied += parseInt(r.messages_replied) || 0;
      acc.positive_replies += parseInt(r.positive_replies) || 0;
      acc.campaign_count   += parseInt(r.campaign_count)   || 0;
      return acc;
    }, { contacts_added:0, invites_sent:0, invites_approved:0, messages_sent:0, messages_replied:0, positive_replies:0, campaign_count:0 });

    res.json({ summary, by_workspace: byWorkspace, by_account: byAccount, by_campaign: byCampaign, timeline });
  } catch (err) {
    console.error('[Admin] Analytics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/backfill-li-company-url
// Backfill li_company_url on contacts that were saved without it,
// by matching company name against list_companies.
router.post('/backfill-li-company-url', async (req, res) => {
  try {
    const { workspace_id } = req.body;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    // Update contacts that have connected_via but no li_company_url
    // by joining to list_companies on matching company name
    const result = await db.query(
      `UPDATE contacts c
        SET li_company_url = lc.li_company_url
        FROM list_companies lc
        JOIN lists l ON l.id = lc.list_id
        WHERE c.workspace_id = $1
          AND l.workspace_id = $1
          AND c.campaign_id IS NULL
          AND (c.li_company_url IS NULL OR c.li_company_url = '')
          AND (
            LOWER(c.company) = LOWER(lc.company_name)
            OR lc.li_company_url ILIKE '%/' || LOWER(REPLACE(c.company, ' ', '-')) || '%'
          )`,
      [workspace_id]
    );
    res.json({ updated: result.rowCount, workspace_id });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/backfill-names
// Enriches contacts that have no first_name/last_name by calling enrichProfile.
// Runs in background — responds immediately.
router.post('/backfill-names', async (req, res) => {
  try {
    const { workspace_id, limit = 200 } = req.body;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    // Get contacts without names
    const { rows: contacts } = await db.query(
      "SELECT id, li_profile_url FROM contacts WHERE workspace_id=$1 AND campaign_id IS NULL AND (first_name IS NULL OR first_name = '') AND li_profile_url IS NOT NULL AND li_profile_url != '' LIMIT $2",
      [workspace_id, limit]
    );

    // Get one account for enrichment
    const { rows: accounts } = await db.query(
      'SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1',
      [workspace_id]
    );

    if (!accounts.length) return res.json({ error: 'no accounts' });
    const accountId = accounts[0].account_id;

    res.json({ status: 'started', total: contacts.length });

    const { enrichProfile } = require('../unipile');

    (async () => {
      let updated = 0, failed = 0;
      for (const c of contacts) {
        try {
          const data = await enrichProfile(accountId, c.li_profile_url);
          if (data && (data.first_name || data.last_name)) {
            await db.query(
              "UPDATE contacts SET first_name=COALESCE(NULLIF($2,''), first_name), last_name=COALESCE(NULLIF($3,''), last_name) WHERE id=$1",
              [c.id, data.first_name || '', data.last_name || '']
            );
            updated++;
          } else { failed++; }
          await new Promise(r => setTimeout(r, 200));
        } catch(e) {
          failed++;
          console.warn('[backfill-names] err:', e.message);
        }
      }
      console.log('[backfill-names] done: updated=' + updated + ' failed=' + failed + ' / ' + contacts.length);
    })().catch(e => console.error('[backfill-names] bg error:', e.message));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/backfill-names-from-slug
// Extracts first/last name from the LinkedIn URL slug for contacts with missing names.
// e.g. /in/ran-rubinstein-1a2b3c  -> first="Ran" last="Rubinstein"
// Pure Node.js, no external API calls, runs in ~1 second for all contacts.
router.post('/backfill-names-from-slug', async (req, res) => {
  try {
    const { workspace_id } = req.body;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    // Get all contacts without names
    const { rows } = await db.query(
      "SELECT id, li_profile_url FROM contacts WHERE workspace_id=$1 AND campaign_id IS NULL AND (first_name IS NULL OR first_name = '') AND li_profile_url LIKE '%linkedin.com/in/%'",
      [workspace_id]
    );

    if (!rows.length) return res.json({ updated: 0, message: 'No contacts without names' });

    function parseNameFromSlug(url) {
      const m = url.match(/linkedin\.com\/in\/([^/?#]+)/);
      if (!m) return { first: '', last: '' };
      let slug = m[1];
      // Remove numeric/alphanum suffix (LinkedIn ID suffix like -1a2b3c or -123456)
      slug = slug.replace(/-[a-z0-9]{3,12}$/i, '');
      // Remove query string leftovers
      slug = slug.replace(/[?#].*$/, '');
      const parts = slug.split('-').filter(Boolean);
      if (!parts.length) return { first: '', last: '' };
      const capitalize = function(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); };
      const first = capitalize(parts[0]);
      const last  = parts.slice(1).map(capitalize).join(' ');
      return { first, last };
    }

    // Batch update
    let updated = 0;
    for (const c of rows) {
      const { first, last } = parseNameFromSlug(c.li_profile_url);
      if (first) {
        await db.query(
          'UPDATE contacts SET first_name=$2, last_name=$3 WHERE id=$1',
          [c.id, first, last]
        );
        updated++;
      }
    }

    res.json({ updated, total: rows.length, workspace_id });
  } catch(e) {
    console.error('[backfill-names-from-slug]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/test-get-post?workspace_id=X&urn=Y  — also inserts parent post
router.get('/test-get-post', async (req, res) => {
  try {
    const { workspace_id, urn } = req.query;
    const { rows: accs } = await db.query('SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1',[workspace_id]);
    if (!accs.length) return res.json({error:'no accounts'});
    const { getPost } = require('../unipile');
    const raw = await getPost(accs[0].account_id, urn);
    if (!raw) return res.json({error:'no raw data returned'});
    
    const postUrn    = raw.social_id || raw.id || urn;
    const authorName = (raw.author && (raw.author.name ||
                        ((raw.author.first_name||'') + ' ' + (raw.author.last_name||'')).trim())) || 'Unknown';
    const authorTitle = (raw.author && (raw.author.headline || raw.author.occupation)) || '';
    const authorPic   = (raw.author && (raw.author.profile_picture_url || raw.author.picture_url ||
                          (Array.isArray(raw.author.profile_picture) ?
                            raw.author.profile_picture[raw.author.profile_picture.length-1]?.url : null))) || '';
    const authorUrl   = raw.author?.public_identifier
                          ? 'https://www.linkedin.com/in/' + raw.author.public_identifier
                          : (raw.author?.profile_url || '');
    const content     = raw.text || raw.content || '';
    const postedAt    = raw.parsed_datetime || (raw.date && !isNaN(Date.parse(raw.date)) ? new Date(raw.date).toISOString() : null);

    let insertResult = 'skipped';
    try {
      const { rowCount } = await db.query(
        `INSERT INTO linkedin_posts
           (campaign_id,workspace_id,contact_id,post_urn,author_name,author_title,
            author_profile_url,author_avatar_url,content,likes_count,comments_count,shares_count,posted_at)
         VALUES (NULL,$1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (post_urn) DO UPDATE SET
           author_name=EXCLUDED.author_name,
           author_title=EXCLUDED.author_title,
           author_avatar_url=EXCLUDED.author_avatar_url,
           content=EXCLUDED.content`,
        [workspace_id, postUrn, authorName, authorTitle, authorUrl, authorPic,
         content, raw.reaction_counter||0, raw.comment_counter||0, raw.repost_counter||0, postedAt]
      );
      insertResult = 'ok rows=' + rowCount;
    } catch(e2) { insertResult = 'INSERT ERROR: ' + e2.message; }

    res.json({
      postUrn, authorName, authorTitle, authorPic: authorPic?.substring(0,60),
      authorUrl, content: content.substring(0,100), insertResult,
      raw_author_keys: raw.author ? Object.keys(raw.author) : null
    });
  } catch(e) { res.status(500).json({error: e.message}); }
});

// POST /api/admin/enrich-campaign
// Fixes bad li_profile_url (missing https://) and queues all contacts
// without provider_id for enrichment so invitationSender can process them.
router.post('/enrich-campaign', async (req, res) => {
  try {
    const { campaign_id, workspace_id } = req.body;
    if (!campaign_id || !workspace_id) return res.status(400).json({ error: 'campaign_id and workspace_id required' });

    // Step 1: Fix URLs missing https://
    const urlFix = await db.query(
      `UPDATE contacts
         SET li_profile_url = 'https://' || li_profile_url
       WHERE campaign_id = $1
         AND li_profile_url IS NOT NULL
         AND li_profile_url != ''
         AND li_profile_url NOT LIKE 'http%'`,
      [campaign_id]
    );

    // Step 2: Get contacts missing real ACoXXX (includes slugs from seed migration)
    const { rows: contacts } = await db.query(
      `SELECT id, li_profile_url FROM contacts
        WHERE campaign_id = $1
          AND (provider_id IS NULL OR provider_id = '' OR provider_id NOT LIKE 'ACo%')
          AND li_profile_url LIKE '%linkedin.com/in/%'
        ORDER BY id
        LIMIT 2000`,
      [campaign_id]
    );

    // Step 3: Get a workspace account for enrichment
    const { rows: camp } = await db.query('SELECT account_id FROM campaigns WHERE id=$1', [campaign_id]);
    if (!camp.length) return res.json({ error: 'campaign not found' });
    const accountId = camp[0].account_id;

    // Step 4: Enqueue all contacts
    const { enqueue } = require('../enrichment');
    let queued = 0;
    for (const c of contacts) {
      enqueue(c.id, accountId, c.li_profile_url);
      queued++;
    }

    res.json({
      url_fixes: urlFix.rowCount,
      queued_for_enrichment: queued,
      total_contacts: contacts.length,
      account_id: accountId
    });
  } catch(e) {
    console.error('[enrich-campaign]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/copy-provider-ids
// Copies provider_id from contacts that already have it to contacts in a
// target campaign that share the same li_profile_url (same person, different campaign).
// Much faster than re-enriching when both campaigns use the same list.
router.post('/copy-provider-ids', async (req, res) => {
  try {
    const { target_campaign_id, workspace_id } = req.body;
    if (!target_campaign_id || !workspace_id)
      return res.status(400).json({ error: 'target_campaign_id and workspace_id required' });

    // UPDATE contacts in the target campaign by joining on normalised URL
    // to any other contact in the same workspace that already has provider_id
    const { rowCount } = await db.query(`
      UPDATE contacts AS t
      SET    provider_id  = src.provider_id,
             member_urn   = src.member_urn,
             profile_data = COALESCE(t.profile_data, src.profile_data)
      FROM   contacts AS src
      WHERE  t.campaign_id  = $1
        AND  t.workspace_id = $2
        AND  (t.provider_id IS NULL OR t.provider_id = '')
        AND  src.workspace_id = $2
        AND  (src.provider_id IS NOT NULL AND src.provider_id <> '')
        AND  LOWER(REGEXP_REPLACE(t.li_profile_url,   '^https?://', '')) =
             LOWER(REGEXP_REPLACE(src.li_profile_url, '^https?://', ''))
    `, [target_campaign_id, workspace_id]);

    // Count remaining contacts still missing provider_id
    const { rows: remaining } = await db.query(`
      SELECT COUNT(*) AS cnt FROM contacts
      WHERE campaign_id = $1
        AND (provider_id IS NULL OR provider_id = '')
    `, [target_campaign_id]);

    res.json({
      copied: rowCount,
      still_missing: parseInt(remaining[0].cnt, 10)
    });
  } catch(e) {
    console.error('[copy-provider-ids]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/register-message-webhooks
// Registers message_received webhooks for all existing accounts that don't have one yet.
// Safe to run multiple times — skips accounts that already have msg_webhook_id.
router.post('/register-message-webhooks', async (req, res) => {
  try {
    // Ensure msg_webhook_id column exists (idempotent migration)
    await db.query(`ALTER TABLE unipile_accounts ADD COLUMN IF NOT EXISTS msg_webhook_id VARCHAR`).catch(()=>{});

    const SERVER_URL = process.env.SERVER_URL || process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` || 'http://localhost:3000';
    const { createMessageWebhook } = require('../unipile');

    const { rows: accounts } = await db.query(
      `SELECT account_id, display_name FROM unipile_accounts WHERE msg_webhook_id IS NULL`
    );

    let registered = 0, failed = 0, errors = [];
    for (const acc of accounts) {
      try {
        const wId = await createMessageWebhook(acc.account_id, SERVER_URL);
        if (wId) {
          await db.query('UPDATE unipile_accounts SET msg_webhook_id=$1 WHERE account_id=$2', [wId, acc.account_id]);
          console.log('[Admin] msg webhook', wId, 'registered for', acc.display_name || acc.account_id);
          registered++;
        }
      } catch(e) {
        console.warn('[Admin] msg webhook FAILED for', acc.account_id, ':', e.message);
        errors.push({ account_id: acc.account_id, error: e.message });
        failed++;
      }
    }
    res.json({ registered, failed, total: accounts.length, errors });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/test-create-msg-webhook?account_id=X — test single account
router.get('/test-create-msg-webhook', async (req, res) => {
  try {
    const { account_id } = req.query;
    if (!account_id) return res.status(400).json({ error: 'account_id required' });
    const SERVER_URL = process.env.SERVER_URL || process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` || 'http://localhost:3000';
    // Call Unipile directly to see raw response
    const { request } = require('../unipile');
    const raw = await request('/api/v1/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        source: 'messaging',
        name: 'msg_received_' + account_id,
        request_url: SERVER_URL + '/api/webhooks/unipile',
        account_ids: [account_id],
        events: ['message_received'],
        format: 'json',
        headers: [{ key: 'x-webhook-secret', value: process.env.WEBHOOK_SECRET || 'elvia-secret' }]
      })
    });
    res.json({ raw_keys: Object.keys(raw || {}), raw: raw, account_id });
  } catch(e) {
    res.status(500).json({ error: e.message, stack: e.stack?.split('\n').slice(0,3).join(' | ') });
  }
});

// POST /api/admin/enrich-inbox-contacts — background enrichment of inbox contacts with empty names
router.post('/enrich-inbox-contacts', async (req, res) => {
  try {
    const workspace_id = req.body?.workspace_id || req.query.workspace_id;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
    
    // Respond immediately — run in background
    res.json({ status: 'started', workspace_id });
    
    (async () => {
      const { enrichProfile } = require('../unipile');
      const { rows: contacts } = await db.query(
        `SELECT DISTINCT c.id, c.li_profile_url, t.account_id
         FROM contacts c
         JOIN inbox_threads t ON t.contact_id = c.id
         WHERE c.workspace_id = $1
           AND (c.first_name IS NULL OR c.first_name = '')
           AND c.li_profile_url IS NOT NULL AND c.li_profile_url != ''
         LIMIT 150`,
        [workspace_id]
      );
      let enriched = 0;
      for (const c of contacts) {
        try {
          const profile = await enrichProfile(c.account_id, c.li_profile_url);
          if (profile && (profile.first_name || profile.full_name)) {
            const nameParts = (profile.full_name || '').split(' ');
            const fn  = profile.first_name || nameParts[0] || '';
            const ln  = profile.last_name  || nameParts.slice(1).join(' ') || '';
            const ttl = profile.headline || profile.title || null;
            const pid = profile.provider_id || profile.id || null;
            await db.query(
              'UPDATE contacts SET first_name=$1,last_name=$2,title=$3,provider_id=COALESCE(provider_id,$4) WHERE id=$5',
              [fn, ln, ttl, pid, c.id]
            );
            enriched++;
          }
          await new Promise(r => setTimeout(r, 700));
        } catch(e) { console.warn('[Admin] enrich contact', c.id, ':', e.message); }
      }
      console.log('[Admin] enrich-inbox-contacts done: '+enriched+'/'+contacts.length+' enriched for ws '+workspace_id);
    })().catch(function(e){ console.error('[Admin] enrich background error:', e.message); });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/debug-messages?account_id=X&chat_id=Y — raw Unipile messages structure
router.get('/debug-messages', async (req, res) => {
  try {
    const { account_id, chat_id } = req.query;
    if (!account_id || !chat_id) return res.status(400).json({ error: 'account_id and chat_id required' });
    const { request } = require('../unipile');
    const data = await request('/api/v1/chats/' + encodeURIComponent(chat_id) + '/messages?account_id=' + encodeURIComponent(account_id) + '&limit=5');
    const items = (data?.items || []).slice(0, 3);
    res.json({ 
      count: items.length,
      fields: items[0] ? Object.keys(items[0]) : [],
      samples: items.map(function(m) {
        return { 
          id: m.id, 
          from_me: m.from_me, 
          is_sender: m.is_sender,
          sender_type: m.sender_type,
          is_me: m.is_me,
          role: m.role,
          sender: m.sender ? { id: m.sender.attendee_provider_id, name: m.sender.attendee_name } : null,
          text_preview: (m.text || m.body || '').substring(0,40)
        };
      })
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/fix-message-directions — fixes direction for all existing messages
router.post('/fix-message-directions', async (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  res.json({ status: 'started', workspace_id });
  try {
    const { rows: threads } = await db.query(
      'SELECT t.id, t.thread_id, t.account_id FROM inbox_threads t WHERE t.workspace_id = $1 ORDER BY t.updated_at DESC',
      [workspace_id]
    );
    const DSN = process.env.UNIPILE_DSN;
    const KEY = process.env.UNIPILE_API_KEY;
    let fixed = 0;
    for (const thread of threads) {
      try {
        const r = await fetch(
          DSN+'/api/v1/chats/'+encodeURIComponent(thread.thread_id)+'/messages?account_id='+encodeURIComponent(thread.account_id)+'&limit=20',
          { headers: { 'X-API-KEY': KEY, 'accept': 'application/json' } }
        );
        if (!r.ok) continue;
        const data = await r.json();
        const msgs = Array.isArray(data?.items) ? data.items : [];
        for (const msg of msgs) {
          if (!msg.id) continue;
          const dir = (msg.is_sender === 1 || msg.is_sender === true) ? 'sent' : 'received';
          await db.query(
            'UPDATE inbox_messages SET direction=$1 WHERE thread_id=$2 AND unipile_msg_id=$3',
            [dir, thread.id, msg.id]
          );
        }
        fixed++;
        await new Promise(r=>setTimeout(r,150));
      } catch(e) {}
    }
    console.log('[Admin] fix-message-directions: fixed', fixed, '/', threads.length, 'threads for ws', workspace_id);
  } catch(e) { console.error('[Admin] fix-message-directions error:', e.message); }
});

// POST /api/admin/sync-opp-contacts-to-inbox
// Finds all opportunities contacts with provider_id, fetches their Unipile chat, 
// creates inbox thread + syncs 20 messages for each.
router.post('/sync-opp-contacts-to-inbox', async (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  res.json({ status: 'started', workspace_id });

  try {
    const DSN = process.env.UNIPILE_DSN;
    const KEY = process.env.UNIPILE_API_KEY;

    // Get all accounts in workspace
    const { rows: accounts } = await db.query(
      'SELECT account_id FROM unipile_accounts WHERE workspace_id = $1', [workspace_id]
    );

    // Get all opportunity contacts with provider_id
    const { rows: contacts } = await db.query(
      `SELECT DISTINCT c.id, c.first_name, c.last_name, c.provider_id, c.li_profile_url, c.campaign_id
       FROM contacts c
       INNER JOIN campaigns camp ON camp.id = c.campaign_id
       WHERE camp.workspace_id = $1
         AND c.provider_id IS NOT NULL AND c.provider_id != ''
         AND NOT EXISTS (SELECT 1 FROM inbox_threads it WHERE it.contact_id = c.id)`,
      [workspace_id]
    );

    console.log('[Admin] sync-opp-contacts: found', contacts.length, 'contacts without inbox thread');
    let synced = 0;

    for (const contact of contacts) {
      // Find the account for this contact's campaign
      const { rows: campAcc } = await db.query(
        'SELECT account_id FROM campaigns WHERE id = $1', [contact.campaign_id]
      );
      const accountId = campAcc[0]?.account_id || accounts[0]?.account_id;
      if (!accountId) continue;

      try {
        // Find chat with this contact on Unipile
        const chatRes = await fetch(
          `${DSN}/api/v1/chats?account_id=${encodeURIComponent(accountId)}&limit=50`,
          { headers: { 'X-API-KEY': KEY, 'accept': 'application/json' } }
        );
        if (!chatRes.ok) continue;
        const chatData = await chatRes.json();
        const chats = Array.isArray(chatData?.items) ? chatData.items : [];

        // Find chat matching this contact's provider_id
        const chat = chats.find(function(c) {
          return c.attendee_provider_id === contact.provider_id;
        });
        if (!chat) continue;

        const chatId = chat.id;

        // Upsert inbox thread
        const { rows: threadRows } = await db.query(
          `INSERT INTO inbox_threads (campaign_id, workspace_id, contact_id, account_id, thread_id, updated_at)
           VALUES ($1,$2,$3,$4,$5,NOW())
           ON CONFLICT (thread_id) DO UPDATE SET updated_at=NOW()
           RETURNING id`,
          [contact.campaign_id, workspace_id, contact.id, accountId, chatId]
        );
        const threadDbId = threadRows[0]?.id;
        if (!threadDbId) continue;

        // Sync last 20 messages
        const msgRes = await fetch(
          `${DSN}/api/v1/chats/${encodeURIComponent(chatId)}/messages?account_id=${encodeURIComponent(accountId)}&limit=20`,
          { headers: { 'X-API-KEY': KEY, 'accept': 'application/json' } }
        );
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          const msgs = Array.isArray(msgData?.items) ? msgData.items.reverse() : [];
          let lastMsg = null;
          for (const msg of msgs) {
            if (!msg.id) continue;
            const dir = (msg.is_sender === 1 || msg.is_sender === true) ? 'sent' : 'received';
            const content = msg.text || msg.body || '';
            const sentAt  = msg.timestamp || msg.created_at || null;
            await db.query(
              `INSERT INTO inbox_messages (thread_id, unipile_msg_id, direction, content, sent_at)
               VALUES ($1,$2,$3,$4,$5) ON CONFLICT (unipile_msg_id) DO NOTHING`,
              [threadDbId, msg.id, dir, content, sentAt]
            );
            lastMsg = { content: content.slice(0,120), sentAt };
          }
          if (lastMsg) {
            await db.query(
              'UPDATE inbox_threads SET last_message_at=$1, last_message_preview=$2, updated_at=NOW() WHERE id=$3',
              [lastMsg.sentAt, lastMsg.content, threadDbId]
            );
          }
        }
        synced++;
        await new Promise(r => setTimeout(r, 300));
      } catch(e) { console.warn('[Admin] sync-opp contact', contact.id, e.message); }
    }
    console.log('[Admin] sync-opp-contacts-to-inbox: synced', synced, '/', contacts.length, 'for ws', workspace_id);
  } catch(e) { console.error('[Admin] sync-opp-contacts-to-inbox error:', e.message); }
});

// POST /api/admin/run-migration — runs schema_migration.sql statements
router.post('/run-migration', async (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'sql required' });
  try {
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    const results = [];
    for (const stmt of statements) {
      try {
        const result = await db.query(stmt);
        results.push({ stmt: stmt.substring(0, 60), ok: true, rows: result.rows, rowCount: result.rowCount });
      } catch(e) {
        results.push({ stmt: stmt.substring(0, 60), ok: false, err: e.message });
      }
    }
    res.json({ results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/bulk-insert-contacts — insert multiple contacts at once
router.post('/bulk-insert-contacts', async (req, res) => {
  const { contacts, list_id, workspace_id } = req.body;
  if (!contacts || !Array.isArray(contacts)) return res.status(400).json({ error: 'contacts array required' });
  try {
    let inserted = 0, skipped = 0;
    for (const c of contacts) {
      // Dedup: prefer li_profile_url match, fall back to name+company
      let existing = [];
      const liUrl = (c.li_profile_url || '').trim().toLowerCase().replace(/\/$/, '');
      if (liUrl.includes('linkedin.com/in/')) {
        const res2 = await db.query(
          'SELECT id FROM contacts WHERE workspace_id=$1 AND LOWER(li_profile_url)=$2 LIMIT 1',
          [workspace_id, liUrl]
        );
        existing = res2.rows;
      }
      if (!existing.length && (c.first_name || c.last_name)) {
        const res2 = await db.query(
          'SELECT id FROM contacts WHERE workspace_id=$1 AND LOWER(TRIM(first_name))=LOWER(TRIM($2)) AND LOWER(TRIM(last_name))=LOWER(TRIM($3)) AND LOWER(TRIM(company))=LOWER(TRIM($4)) LIMIT 1',
          [workspace_id, c.first_name||'', c.last_name||'', c.company||'']
        );
        existing = res2.rows;
      }
      let contactId;
      if (existing.length > 0) {
        contactId = existing[0].id;
        await db.query(
          `UPDATE contacts SET
            title=COALESCE(NULLIF($1,''),title),
            li_profile_url=COALESCE(NULLIF($2,''),li_profile_url),
            website=COALESCE(NULLIF($3,''),website),
            location=COALESCE(NULLIF($4,''),location)
            WHERE id=$5`,
          [c.title||'', liUrl||'', c.website||'', c.location||'', contactId]
        );
        skipped++;
      } else {
        const { rows: ins } = await db.query(
          `INSERT INTO contacts
            (workspace_id, first_name, last_name, company, title, li_profile_url, website, location)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [workspace_id, c.first_name||'', c.last_name||'', c.company||'', c.title||'',
           liUrl||'', c.website||'', c.location||'']
        );
        contactId = ins[0].id;
        inserted++;
      }
      // Add to list
      if (list_id && contactId) {
        await db.query(
          'INSERT INTO list_contacts (list_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [list_id, contactId]
        );
      }
    }
    res.json({ inserted, skipped, total: contacts.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
// GET /api/admin/enrich-list?list_id=23&workspace_id=4
// Trigger background enrichment for all contacts in a list (no POST body needed)
router.get('/enrich-list', async (req, res) => {
  const { list_id, workspace_id } = req.query;
  if (!list_id || !workspace_id) return res.status(400).json({ error: 'list_id and workspace_id required' });
  try {
    // Get contacts in this list that have a LinkedIn URL but no provider_id yet
    const { rows: contacts } = await db.query(`
      SELECT c.id, c.li_profile_url, c.provider_id
      FROM contacts c
      JOIN list_contacts lc ON lc.contact_id = c.id
      WHERE lc.list_id = $1
        AND c.workspace_id = $2
        AND c.li_profile_url IS NOT NULL
        AND c.li_profile_url LIKE '%linkedin.com/in/%'
      ORDER BY c.id
    `, [list_id, workspace_id]);

    // Get first available account in workspace
    const { rows: accounts } = await db.query(`
      SELECT DISTINCT ua.account_id
      FROM campaigns c
      JOIN unipile_accounts ua ON ua.account_id = c.account_id
      WHERE c.workspace_id = $1
      LIMIT 1
    `, [workspace_id]);

    // Fall back to any account linked to workspace via campaigns
    const { rows: campAccounts } = await db.query(`
      SELECT DISTINCT account_id FROM campaigns WHERE workspace_id = $1 LIMIT 1
    `, [workspace_id]);

    const accountId = (accounts[0] || campAccounts[0])?.account_id;
    if (!accountId) return res.status(400).json({ error: 'No Unipile account found for workspace' });

    const { enqueue } = require('../enrichment');
    let queued = 0, already = 0;
    for (const c of contacts) {
      if (c.provider_id) { already++; continue; }
      enqueue(c.id, accountId, c.li_profile_url);
      queued++;
    }

    res.json({
      total_in_list: contacts.length,
      queued_for_enrichment: queued,
      already_enriched: already,
      account_id: accountId
    });
  } catch(e) {
    console.error('[enrich-list GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

// POST /api/admin/enroll-campaigns — enroll contacts from multiple campaigns into enrollments
// Body: { campaign_ids: [14,15,16,17], workspace_id: 1 }
router.post('/enroll-campaigns', async (req, res) => {
  const { campaign_ids, workspace_id } = req.body;
  if (!Array.isArray(campaign_ids) || !workspace_id)
    return res.status(400).json({ error: 'campaign_ids[] and workspace_id required' });
  try {
    const results = [];
    for (const campId of campaign_ids) {
      const { rows: camp } = await db.query(
        'SELECT id, list_id FROM campaigns WHERE id=$1 AND workspace_id=$2',
        [campId, workspace_id]
      );
      if (!camp.length) { results.push({ campaign_id: campId, error: 'not found' }); continue; }
      if (!camp[0].list_id) { results.push({ campaign_id: campId, error: 'no list' }); continue; }

      const { rows: contacts } = await db.query(`
        SELECT c.id, c.already_connected
        FROM list_contacts lc
        JOIN contacts c ON c.id = lc.contact_id
        WHERE lc.list_id = $1 AND c.workspace_id = $2
      `, [camp[0].list_id, workspace_id]);

      let enrolled = 0, skipped = 0;
      for (const c of contacts) {
        const status = c.already_connected ? 'approved' : 'pending';
        const { rowCount } = await db.query(`
          INSERT INTO enrollments (campaign_id, contact_id, status, next_action_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (campaign_id, contact_id) DO NOTHING
        `, [campId, c.id, status]);
        rowCount > 0 ? enrolled++ : skipped++;
      }
      results.push({ campaign_id: campId, enrolled, skipped, total: contacts.length });
    }
    res.json({ results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/re-enrich-slugs — re-queue contacts with slug provider_ids for real enrichment
// Body: { workspace_id: 1 }
router.post('/re-enrich-slugs', async (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const enrichment = require('../enrichment');
    const { rows: contacts } = await db.query(`
      SELECT c.id, c.li_profile_url, camp.account_id
      FROM contacts c
      JOIN campaigns camp ON camp.id = c.campaign_id
      WHERE c.workspace_id = $1
        AND (c.provider_id IS NULL OR c.provider_id = '' OR c.provider_id NOT LIKE 'ACo%')
        AND c.li_profile_url LIKE '%linkedin.com/in/%'
      ORDER BY c.id
      LIMIT 2000
    `, [workspace_id]);

    let queued = 0;
    for (const c of contacts) {
      enrichment.enqueue(c.id, c.account_id, c.li_profile_url);
      queued++;
    }
    res.json({ queued, status: enrichment.getStatus() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/migrate-contacts-to-enrollments
// Migrates existing contacts state to the enrollments table.
// Body: { workspace_id: 1 } — migrates ALL campaigns in workspace
// Maps: invite_sent=true → invite_sent, invite_approved=true → approved,
//       msg_sent=true → messaged, msg_replied=true → replied,
//       positive_reply=true → positive_reply
// Idempotent: ON CONFLICT DO NOTHING
router.post('/migrate-contacts-to-enrollments', async (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    // Determine status from contact flags
    const { rows: contacts } = await db.query(`
      SELECT c.id AS contact_id, c.campaign_id,
             c.invite_sent, c.invite_approved, c.msg_sent, c.msg_replied,
             c.positive_reply, c.already_connected,
             c.invite_sent_at, c.invite_approved_at
      FROM contacts c
      JOIN campaigns camp ON camp.id = c.campaign_id
      WHERE camp.workspace_id = $1
        AND c.campaign_id IS NOT NULL
    `, [workspace_id]);

    let migrated = 0, skipped = 0;
    for (const c of contacts) {
      let status = 'pending';
      if (c.positive_reply)   status = 'positive_reply';
      else if (c.msg_replied)  status = 'replied';
      else if (c.msg_sent)     status = 'messaged';
      else if (c.invite_approved || c.already_connected) status = 'approved';
      else if (c.invite_sent)  status = 'invite_sent';

      const { rowCount } = await db.query(`
        INSERT INTO enrollments (campaign_id, contact_id, status, next_action_at,
                                 invite_sent_at, invite_approved_at)
        VALUES ($1, $2, $3, NOW(), $4, $5)
        ON CONFLICT (campaign_id, contact_id) DO NOTHING
      `, [c.campaign_id, c.contact_id, status,
          c.invite_sent_at || null, c.invite_approved_at || null]);
      rowCount > 0 ? migrated++ : skipped++;
    }
    res.json({ migrated, skipped, total: contacts.length, workspace_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/trigger-job — manually trigger a pg-boss job
// Body: { job: 'enrich-contacts' | 'process-enrollments' | 'compute-scores' }
router.post('/trigger-job', async (req, res) => {
  const { job } = req.body;
  const JOB_HANDLERS = {
    'send-pending-messages':    () => require('../jobs/sendPendingMessages').handler(),
    'enrich-contacts':          () => require('../jobs/enrichContacts').handler(),
    'process-enrollments':      () => require('../jobs/processEnrollments').handler({ data: {} }),
    'compute-scores':           () => require('../jobs/computeScores').handler(),
    'sync-inbox':               () => require('../jobs/syncInbox').handler(),
    'publish-scheduled-posts':  () => require('../jobs/publishScheduledPosts').handler(),
    'withdraw-invites':         () => require('../jobs/withdrawInvites').handler(),
    'sync-target-accounts':     () => require('../jobs/syncTargetAccounts').handler(),
    'sync-opportunities':       () => require('../jobs/syncOpportunities').handler(),
  };
  if (!JOB_HANDLERS[job])
    return res.status(400).json({ error: `Unknown job: ${job}. Allowed: ${Object.keys(JOB_HANDLERS).join(', ')}` });
  try {
    // process-enrollments: always run directly to avoid pg-boss row locking conflicts
    if (job === 'process-enrollments') {
      JOB_HANDLERS[job]().catch(e => console.error(`[Admin] direct job ${job} error:`, e.message));
      return res.json({ triggered: job, method: 'direct', message: `Job "${job}" running directly (preferred for enrollments)` });
    }

    // Other jobs: try pg-boss first, fall back to direct
    try {
      const { triggerJob } = require('../jobs/index');
      await triggerJob(job, {});
      return res.json({ triggered: job, method: 'pg-boss', message: `Job "${job}" queued` });
    } catch (bossErr) {
      console.log(`[Admin] pg-boss send failed (${bossErr.message}), running ${job} directly`);
      JOB_HANDLERS[job]().catch(e => console.error(`[Admin] direct job ${job} error:`, e.message));
      return res.json({ triggered: job, method: 'direct', message: `Job "${job}" running directly`, boss_error: bossErr.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/enrollment-stats?workspace_id=1
// Returns enrollment status breakdown across all campaigns in a workspace
router.get('/enrollment-stats', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const { rows } = await db.query(`
      SELECT
        e.status,
        COUNT(*) AS count,
        c.name AS campaign_name,
        c.id   AS campaign_id
      FROM enrollments e
      JOIN campaigns c ON c.id = e.campaign_id
      WHERE c.workspace_id = $1
      GROUP BY e.status, c.id, c.name
      ORDER BY c.id, e.status
    `, [workspace_id]);

    // Aggregate by status
    const byStatus = {};
    const byCampaign = {};
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + parseInt(r.count);
      if (!byCampaign[r.campaign_id]) byCampaign[r.campaign_id] = { name: r.campaign_name, statuses: {} };
      byCampaign[r.campaign_id].statuses[r.status] = parseInt(r.count);
    }

    const total = Object.values(byStatus).reduce((s,c) => s+c, 0);
    res.json({ by_status: byStatus, by_campaign: Object.values(byCampaign), total, workspace_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/register-signals-webhooks
// Registers ALL 8 LinkedIn event types for the v2 signals webhook handler.
// Idempotent — checks existing webhooks via Unipile API before registering.
// Body: { workspace_id: 1 } — registers for all accounts in workspace
router.post('/register-signals-webhooks', async (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const { request: uRequest } = require('../unipile');
    const SERVER_URL = process.env.SERVER_URL || process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` || 'http://localhost:3000';
    const WEBHOOK_URL = `${SERVER_URL}/api/webhooks/unipile`;
    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'elvia-secret';

    // Each event registered separately — Unipile requires one event per webhook for non-messaging sources
    // source: 'messaging' supports events array; source: 'users'/'posts' needs one event each
    const WEBHOOK_CONFIGS = [
      { source: 'users',     name_suffix: 'new_relation',         events: ['new_relation'] },
      { source: 'users',     name_suffix: 'invitation_received',  events: ['invitation_received'] },
      { source: 'messaging', name_suffix: 'message_received',     events: ['message_received'] },
      { source: 'users',     name_suffix: 'profile_view',         events: ['profile_view'] },
      { source: 'posts',     name_suffix: 'reaction_received',    events: ['reaction_received'] },
      { source: 'posts',     name_suffix: 'comment_received',     events: ['comment_received'] },
      { source: 'posts',     name_suffix: 'post_published',       events: ['post_published'] },
    ];

    const { rows: accounts } = await db.query(
      'SELECT account_id, display_name FROM unipile_accounts WHERE workspace_id = $1',
      [workspace_id]
    );

    // Get existing webhooks from Unipile
    let existingWebhooks = [];
    try {
      const existing = await uRequest('/api/v1/webhooks');
      existingWebhooks = Array.isArray(existing?.items) ? existing.items : [];
    } catch(e) {
      console.warn('[SignalsWebhooks] Could not fetch existing webhooks:', e.message);
    }

    const results = [];
    for (const acc of accounts) {
      for (const cfg of WEBHOOK_CONFIGS) {
        const wName = `${cfg.name_suffix}_${acc.account_id.slice(0,8)}`;

        // Check if already registered
        const alreadyExists = existingWebhooks.some(w =>
          w.name === wName || (w.account_ids?.includes(acc.account_id) && w.source === cfg.source)
        );
        if (alreadyExists) { results.push({ account: acc.display_name, config: cfg.name_suffix, status: 'exists' }); continue; }

        try {
          const data = await uRequest('/api/v1/webhooks', {
            method: 'POST',
            body: JSON.stringify({
              source: cfg.source,
              name: wName,
              request_url: WEBHOOK_URL,
              account_ids: [acc.account_id],
              events: cfg.events,
              format: 'json',
              headers: [
                { key: 'Content-Type',     value: 'application/json' },
                { key: 'X-Webhook-Secret', value: WEBHOOK_SECRET },
              ],
            }),
          });
          const webhookId = data?.webhook_id || data?.id || null;
          results.push({ account: acc.display_name, config: cfg.name_suffix, status: 'registered', webhook_id: webhookId });
        } catch(e) {
          results.push({ account: acc.display_name, config: cfg.name_suffix, status: 'failed', error: e.message });
        }
      }
    }

    const registered = results.filter(r => r.status === 'registered').length;
    const existed    = results.filter(r => r.status === 'exists').length;
    const failed     = results.filter(r => r.status === 'failed').length;
    res.json({ registered, existed, failed, total: results.length, results });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/debug-company-follow?workspace_id=2
// Traces through companyFollowSender logic and shows exactly why follow invites are/aren't sending
router.get('/debug-company-follow', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const report = {};

    // 1. Find accounts with company_page_urn configured
    const { rows: accounts } = await db.query(`
      SELECT ua.account_id, ua.display_name,
             ua.settings->>'company_page_urn' AS company_page_urn,
             ua.settings->>'company_page_url' AS company_page_url,
             ua.settings->>'cf_state'         AS cf_state,
             ua.settings->>'cf_month'         AS cf_month,
             (ua.settings->'limits'->>'company_follow_invites')::int AS daily_limit
      FROM unipile_accounts ua
      WHERE ua.workspace_id = $1
    `, [workspace_id]);
    report.accounts = accounts;

    // 2. Find eligible campaigns (follow_company enabled)
    const { rows: campaigns } = await db.query(`
      SELECT c.id, c.name,
             (c.settings->'engagement'->>'follow_company')::boolean AS follow_company_enabled,
             c.status
      FROM campaigns c
      WHERE c.workspace_id = $1
      ORDER BY c.id
    `, [workspace_id]);
    report.campaigns = campaigns;

    // 3. For each account, check pending contacts
    for (const acc of accounts) {
      const { rows: pending } = await db.query(`
        SELECT COUNT(*) AS total_pending
        FROM contacts c
        JOIN campaigns camp ON camp.id = c.campaign_id
        WHERE camp.account_id = $1
          AND camp.workspace_id = $2
          AND camp.status = 'active'
          AND (camp.settings->'engagement'->>'follow_company')::boolean = true
          AND (c.invite_approved = true OR c.already_connected = true)
          AND (c.company_follow_invited = false OR c.company_follow_invited IS NULL)
          AND (c.member_urn IS NOT NULL OR c.provider_id LIKE 'ACo%')
      `, [acc.account_id, workspace_id]);

      const { rows: alreadySent } = await db.query(`
        SELECT COUNT(*) AS total_sent
        FROM contacts c
        JOIN campaigns camp ON camp.id = c.campaign_id
        WHERE camp.account_id = $1
          AND camp.workspace_id = $2
          AND c.company_follow_invited = true
          AND c.company_follow_invited_at >= date_trunc('month', NOW())
      `, [acc.account_id, workspace_id]);

      const { rows: qualified } = await db.query(`
        SELECT COUNT(*) AS connected
        FROM contacts c
        JOIN campaigns camp ON camp.id = c.campaign_id
        WHERE camp.account_id = $1
          AND camp.workspace_id = $2
          AND camp.status = 'active'
          AND (c.invite_approved = true OR c.already_connected = true)
      `, [acc.account_id, workspace_id]);

      acc.pending_follow = parseInt(pending[0]?.total_pending || 0);
      acc.sent_this_month = parseInt(alreadySent[0]?.total_sent || 0);
      acc.connected_contacts = parseInt(qualified[0]?.connected || 0);
      acc.blockers = [];
      if (!acc.company_page_urn) acc.blockers.push('❌ company_page_urn not set');
      if (acc.cf_state === 'waiting_5d') acc.blockers.push('⏳ in waiting_5d state');
      if (acc.cf_state === 'waiting_7d') acc.blockers.push('⏳ in waiting_7d state');
      if (acc.sent_this_month >= 250) acc.blockers.push('❌ monthly limit reached (250)');
      if (acc.pending_follow === 0) acc.blockers.push('❌ 0 pending contacts (all sent or no connected contacts with ACoXXX)');
      if (acc.blockers.length === 0) acc.blockers.push('✅ should be sending');
    }

    res.json({ workspace_id, report });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/reset-company-follow-state
// Resets cf_state to 'normal' for all accounts in a workspace
// Body: { workspace_id: 2 }
router.post('/reset-company-follow-state', async (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const { rows: accounts } = await db.query(
      'SELECT account_id, display_name FROM unipile_accounts WHERE workspace_id = $1',
      [workspace_id]
    );
    for (const acc of accounts) {
      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      await db.query(
        `UPDATE unipile_accounts SET settings = settings || $1::jsonb WHERE account_id = $2`,
        [JSON.stringify({
          cf_state: 'normal',
          cf_state_since: now.toISOString(),
          cf_month: thisMonth,
          cf_drip_date: '',
          cf_drip_sent_today: 0,
        }), acc.account_id]
      );
    }
    res.json({ reset: accounts.length, accounts: accounts.map(a => a.display_name) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/debug-senders?workspace_id=2
// Full diagnostic of all senders for a workspace
router.get('/debug-senders', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const today = new Date().toISOString().slice(0,10);

    // Campaigns + settings summary
    const { rows: campaigns } = await db.query(`
      SELECT id, name, status,
        (settings->'connection'->>'enabled')::boolean AS invite_enabled,
        (settings->'engagement'->>'view_profile')::boolean AS view_profile,
        (settings->'engagement'->>'like_posts')::boolean AS like_posts,
        (settings->'engagement'->>'follow_company')::boolean AS follow_company,
        jsonb_array_length(COALESCE(settings->'messages'->'new', '[]'::jsonb)) AS msgs_new,
        jsonb_array_length(COALESCE(settings->'messages'->'existing_no_history', '[]'::jsonb)) AS msgs_existing,
        sequence_id
      FROM campaigns WHERE workspace_id = $1
    `, [workspace_id]);

    // Contact readiness stats
    const { rows: stats } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE provider_id LIKE 'ACo%') AS enriched,
        COUNT(*) FILTER (WHERE provider_id NOT LIKE 'ACo%' OR provider_id IS NULL) AS not_enriched,
        COUNT(*) FILTER (WHERE invite_sent = true) AS invited,
        COUNT(*) FILTER (WHERE invite_approved = true) AS approved,
        COUNT(*) FILTER (WHERE already_connected = true) AS already_connected,
        COUNT(*) FILTER (WHERE company_follow_invited = true) AS follow_invited,
        COUNT(*) FILTER (WHERE msg_sent = true) AS messaged,
        COUNT(*) FILTER (WHERE msg_sequence IS NOT NULL) AS has_msg_sequence,
        COUNT(*) FILTER (WHERE msg_scheduled_send_at IS NOT NULL AND msg_scheduled_send_at <= NOW()) AS ready_to_msg
      FROM contacts c
      JOIN campaigns camp ON camp.id = c.campaign_id
      WHERE camp.workspace_id = $1
    `, [workspace_id]);

    // Today's actions per account
    const { rows: todayActions } = await db.query(`
      SELECT ua.display_name,
        COUNT(*) FILTER (WHERE c.invite_sent_at >= CURRENT_DATE) AS invites_today,
        COUNT(*) FILTER (WHERE c.invite_approved_at >= CURRENT_DATE) AS approved_today,
        COUNT(*) FILTER (WHERE c.msg_sent_at >= CURRENT_DATE) AS msgs_today,
        COUNT(*) FILTER (WHERE c.company_follow_invited_at >= CURRENT_DATE) AS follows_today
      FROM contacts c
      JOIN campaigns camp ON camp.id = c.campaign_id
      JOIN unipile_accounts ua ON ua.account_id = camp.account_id AND ua.workspace_id = camp.workspace_id
      WHERE camp.workspace_id = $1
      GROUP BY ua.display_name
    `, [workspace_id]);

    res.json({ workspace_id, campaigns, contact_stats: stats[0], today_actions: todayActions });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/fix-company-follow — resolve URN + reset cf_state for all workspaces
// Safe to run multiple times (idempotent)
router.post('/fix-company-follow', async (req, res) => {
  try {
    const { getCompanyProfile } = require('../unipile');
    const results = { urn_resolved: 0, urn_failed: 0, state_reset: 0 };

    // 1. Resolve URN for all accounts with URL but no URN
    const { rows: accounts } = await db.query(`
      SELECT account_id, display_name,
             settings->>'company_page_url' AS url
      FROM unipile_accounts
      WHERE settings->>'company_page_url' IS NOT NULL
        AND settings->>'company_page_url' != ''
        AND (settings->>'company_page_urn' IS NULL OR settings->>'company_page_urn' = '')
    `);

    for (const acc of accounts) {
      try {
        const urlMatch = acc.url.match(/linkedin\.com\/company\/([^/?#]+)/);
        if (!urlMatch) { results.urn_failed++; continue; }
        const profile = await getCompanyProfile(acc.account_id, urlMatch[1]).catch(() => null);
        const id = profile?.id || profile?.company_id || profile?.entity_urn?.match(/(\d+)$/)?.[1] || profile?.urn?.match(/(\d+)$/)?.[1];
        if (id) {
          const urn = `urn:li:fsd_company:${id}`;
          await db.query(
            `UPDATE unipile_accounts SET settings = settings || jsonb_build_object('company_page_urn', $2) WHERE account_id = $1`,
            [acc.account_id, urn]
          );
          results.urn_resolved++;
          console.log(`[FixCompanyFollow] ${acc.display_name}: URN = ${urn}`);
        } else {
          results.urn_failed++;
        }
      } catch (e) { results.urn_failed++; }
    }

    // 2. Reset stuck cf_state
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const { rowCount } = await db.query(`
      UPDATE unipile_accounts
      SET settings = settings
        || jsonb_build_object('cf_state', 'normal', 'cf_state_since', $1::text, 'cf_month', $2::text)
      WHERE (settings->>'cf_state' IN ('waiting_5d', 'waiting_7d'))
         OR (settings->>'cf_month' IS NULL)
         OR (settings->>'cf_month' != $2)
    `, [now.toISOString(), thisMonth]);
    results.state_reset = rowCount;

    // 3. Show current status
    const { rows: status } = await db.query(`
      SELECT account_id, display_name,
             settings->>'company_page_urn' AS urn,
             settings->>'cf_state'         AS cf_state,
             settings->>'cf_month'         AS cf_month
      FROM unipile_accounts
      WHERE settings->>'company_page_url' IS NOT NULL
        AND settings->>'company_page_url' != ''
      ORDER BY display_name
    `);

    res.json({ results, accounts_with_company_url: status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/set-company-page-url
// Sets company_page_url (and auto-resolves URN) for all accounts in a workspace
// Body: { workspace_id: <id>, company_page_url: 'https://www.linkedin.com/company/<slug>' }
router.post('/set-company-page-url', async (req, res) => {
  const { workspace_id, company_page_url } = req.body;
  if (!workspace_id || !company_page_url)
    return res.status(400).json({ error: 'workspace_id and company_page_url required' });

  const urlMatch = company_page_url.match(/linkedin\.com\/company\/([^/?#]+)/);
  if (!urlMatch) return res.status(400).json({ error: 'Invalid LinkedIn company URL' });
  const slug = urlMatch[1];

  try {
    const { getCompanyProfile } = require('../unipile');

    // Get all accounts for this workspace
    const { rows: accounts } = await db.query(
      'SELECT account_id, display_name FROM unipile_accounts WHERE workspace_id = $1',
      [workspace_id]
    );

    // Try to resolve URN using first available account
    let resolvedUrn = null;
    for (const acc of accounts) {
      const profile = await getCompanyProfile(acc.account_id, slug).catch(() => null);
      const id = profile?.id || profile?.company_id ||
        profile?.entity_urn?.match(/(\d+)$/)?.[1] ||
        profile?.urn?.match(/(\d+)$/)?.[1];
      if (id) { resolvedUrn = `urn:li:fsd_company:${id}`; break; }
    }

    // Update all accounts in this workspace
    const results = [];
    for (const acc of accounts) {
      const patch = { company_page_url };
      if (resolvedUrn) patch.company_page_urn = resolvedUrn;
      await db.query(
        `UPDATE unipile_accounts SET settings = settings || $1::jsonb WHERE account_id = $2 AND workspace_id = $3`,
        [JSON.stringify(patch), acc.account_id, workspace_id]
      );
      results.push({ account: acc.display_name, url: company_page_url, urn: resolvedUrn || 'not resolved' });
    }

    res.json({ workspace_id, slug, resolved_urn: resolvedUrn, updated: results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/analyze-replies — retroactively analyze all unanalyzed replied contacts
router.post('/analyze-replies', async (req, res) => {
  const { workspace_id } = req.body;
  try {
    const wsFilter = workspace_id ? `AND c.workspace_id = ${parseInt(workspace_id)}` : '';
    const { rows: contacts } = await db.query(`
      SELECT c.id, c.chat_id,
             ua.account_id
      FROM contacts c
      JOIN campaigns camp ON camp.id = c.campaign_id
      JOIN unipile_accounts ua ON ua.account_id = camp.account_id AND ua.workspace_id = camp.workspace_id
      WHERE c.msg_replied = true
        AND c.chat_id IS NOT NULL
        AND (c.conversation_analyzed_at IS NULL OR c.conversation_stage IS NULL)
        ${wsFilter}
      ORDER BY c.msg_replied_at DESC
      LIMIT 50
    `);

    if (!contacts.length) return res.json({ queued: 0, message: 'All replies already analyzed' });

    const { enqueueReady, processNext, status: qStatus } = require('../conversationQueue');
    let queued = 0;
    for (const c of contacts) {
      enqueueReady(c.id, c.account_id, c.chat_id, null);
      queued++;
    }

    // Kick off up to 3 workers immediately without waiting for poll
    for (let i = 0; i < 3; i++) processNext().catch(() => {});

    // Kick off processing immediately by running processNext for each worker slot
    // (processNext is not exported, but polling runs every 30s — nudge it via start)
    res.json({ queued, message: `Queued ${queued} conversations for analysis`, queue: qStatus() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/env-keys — list which env vars are set (names only, not values)
router.get('/env-keys', (req, res) => {
  const relevant = Object.keys(process.env)
    .filter(k => /API|KEY|SECRET|TOKEN|DSN|URL|PASS|AUTH/i.test(k))
    .sort();
  res.json({ keys: relevant });
});

// GET /api/admin/pg-boss-status
router.get('/pg-boss-status', (req, res) => {
  try {
    const { getBoss, getBossError } = require('../jobs/index');
    const boss = getBoss();
    const err  = getBossError();
    res.json({
      running: !!boss,
      error:   err || null,
      message: boss ? 'pg-boss is running' : `pg-boss not running${err ? ': ' + err : ''}`,
    });
  } catch(e) { res.json({ running: false, error: e.message }); }
});

// GET /api/admin/conv-queue-status
router.get('/conv-queue-status', (req, res) => {
  try {
    const { status } = require('../conversationQueue');
    res.json(status());
  } catch(e) { res.json({ error: e.message }); }
});

// POST /api/admin/run-job-sync — run a job synchronously and return the result
router.post('/run-job-sync', async (req, res) => {
  const { job } = req.body;
  const HANDLERS = {
    'process-enrollments': () => require('../jobs/processEnrollments').handler({ data: {} }),
    'enrich-contacts':     () => require('../jobs/enrichContacts').handler(),
    'compute-scores':      () => require('../jobs/computeScores').handler(),
    'sync-target-accounts':() => require('../jobs/syncTargetAccounts').handler(),
    'sync-opportunities':  () => require('../jobs/syncOpportunities').handler(),
  };
  if (!HANDLERS[job]) return res.status(400).json({ error: `Unknown job: ${job}` });
  try {
    const result = await HANDLERS[job]();
    res.json({ ok: true, result: result || 'completed (no return value)' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, stack: err.stack?.split('\n').slice(0,5) });
  }
});

// GET /api/admin/enroll-debug — show what processEnrollments would find
router.get('/enroll-debug', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT e.id, e.status, e.current_step, e.next_action_at,
             camp.id AS camp_id, camp.status AS camp_status,
             camp.sequence_id, camp.settings->'hours' AS hours,
             c.provider_id, c.chat_id
      FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      WHERE camp.status = 'active'
        AND e.status NOT IN ('done','withdrawn','skipped','error','positive_reply','replied')
        AND e.next_action_at <= NOW()
      ORDER BY e.next_action_at ASC
      LIMIT 10
    `);
    res.json({ count: rows.length, rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/process-one-enrollment — process a single enrollment synchronously
router.post('/process-one-enrollment', async (req, res) => {
  const { enrollment_id } = req.body;
  try {
    const { rows } = await db.query(`
      SELECT e.*, c.id AS c_id, c.first_name, c.last_name, c.company, c.title,
             c.li_profile_url, c.provider_id, c.chat_id, c.already_connected,
             camp.account_id, camp.settings, camp.sequence_id, camp.invite_note,
             camp.status AS camp_status
      FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      WHERE e.id = $1
    `, [enrollment_id]);

    if (!rows.length) return res.status(404).json({ error: 'not found' });
    const row = rows[0];

    const enrollment = { ...row, campaign_id: row.campaign_id };
    const contact = { id: row.c_id, first_name: row.first_name, last_name: row.last_name, company: row.company, title: row.title, li_profile_url: row.li_profile_url, provider_id: row.provider_id, chat_id: row.chat_id, already_connected: row.already_connected };
    const campaign = { id: row.campaign_id, account_id: row.account_id, sequence_id: row.sequence_id, invite_note: row.invite_note, settings: typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings || {}) };

    // Load sequence
    let sequence = null;
    if (campaign.sequence_id) {
      const { rows: sr } = await db.query(`SELECT s.*, json_agg(ss.* ORDER BY ss.step_index) AS steps FROM sequences s LEFT JOIN sequence_steps ss ON ss.sequence_id = s.id WHERE s.id = $1 GROUP BY s.id`, [campaign.sequence_id]);
      if (sr.length) sequence = { ...sr[0], steps: sr[0].steps.filter(Boolean) };
    }

    // Check what getFirstMessage would return
    const msgStep = sequence?.steps?.filter(s => s.type === 'message' || s.type === 'send_message').sort((a,b) => a.step_index - b.step_index)[0];

    return res.json({
      enrollment: { id: enrollment.id, status: enrollment.status, current_step: enrollment.current_step },
      campaign: { id: campaign.id, sequence_id: campaign.sequence_id },
      sequence_steps: sequence?.steps?.map(s => ({ type: s.type, idx: s.step_index, variants: s.variants?.length })),
      first_message_step: msgStep ? { type: msgStep.type, delay: msgStep.delay_days, variants: msgStep.variants?.length } : null,
      contact: { has_provider: !!contact.provider_id, has_chat: !!contact.chat_id },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/send-pending-messages — directly send first message to approved enrollments
router.post('/send-pending-messages', async (req, res) => {
  const { workspace_id, dry_run = false } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

  try {
    const { rows } = await db.query(`
      SELECT e.id, e.contact_id, e.campaign_id, e.invite_approved_at,
             c.first_name, c.last_name, c.company, c.title, c.provider_id, c.chat_id,
             camp.account_id, camp.sequence_id
      FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      WHERE camp.workspace_id = $1
        AND e.status = 'approved'
        AND e.current_step = -1
        AND camp.sequence_id IS NOT NULL
      ORDER BY e.next_action_at ASC
      LIMIT 20
    `, [workspace_id]);

    const results = [];

    for (const row of rows) {
      // Load sequence message step
      const { rows: steps } = await db.query(
        `SELECT * FROM sequence_steps WHERE sequence_id=$1 AND type='message' ORDER BY step_index ASC LIMIT 1`,
        [row.sequence_id]
      );
      if (!steps.length) {
        results.push({ id: row.id, skip: 'no message step' });
        continue;
      }

      const step = steps[0];
      const variants = step.variants || [];
      const variant = variants[0];
      if (!variant?.text?.trim()) {
        results.push({ id: row.id, skip: 'no message text' });
        continue;
      }

      const text = variant.text
        .replace(/\{\{first_name\}\}/g, row.first_name || '')
        .replace(/\{\{last_name\}\}/g,  row.last_name  || '')
        .replace(/\{\{company\}\}/g,    row.company    || '')
        .replace(/\{\{title\}\}/g,      row.title      || '');

      if (dry_run) {
        results.push({ id: row.id, name: row.first_name, text: text.slice(0, 60), action: 'would_send' });
        continue;
      }

      try {
        const unipile = require('../unipile');
        let chatId = row.chat_id;
        if (!chatId && row.provider_id) {
          const result = await unipile.startDirectMessage(row.account_id, row.provider_id, text);
          chatId = result?.id || result?.chat_id || null;
        } else if (chatId) {
          await unipile.sendMessage(row.account_id, chatId, text);
        } else {
          results.push({ id: row.id, skip: 'no chat_id or provider_id' });
          continue;
        }

        // Update enrollment
        await db.query(
          `UPDATE enrollments SET status='messaged', current_step=1, chat_id=$2, next_action_at=NOW()+'999 days'::interval, updated_at=NOW() WHERE id=$1`,
          [row.id, chatId]
        );
        if (chatId) await db.query('UPDATE contacts SET chat_id=$1 WHERE id=$2 AND chat_id IS NULL', [chatId, row.contact_id]);

        results.push({ id: row.id, name: row.first_name, sent: true });
      } catch(e) {
        results.push({ id: row.id, name: row.first_name, error: e.message });
        await db.query(`UPDATE enrollments SET status='error', error_message=$2, updated_at=NOW() WHERE id=$1`, [row.id, e.message]);
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    res.json({ processed: results.length, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/delete-sent-messages — delete messages sent to workspace contacts via Unipile
router.post('/delete-sent-messages', async (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const { rows } = await db.query(`
      SELECT e.id, e.chat_id, camp.account_id, c.first_name
      FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      WHERE camp.workspace_id = $1
        AND e.status = 'messaged'
        AND e.chat_id IS NOT NULL
    `, [workspace_id]);

    const unipile = require('../unipile');
    const results = [];

    for (const row of rows) {
      try {
        // Get messages from this chat to find the one we sent
        const msgs = await unipile.getChatMessages(row.account_id, row.chat_id, 10);
        // Find outbound messages (sent by us) — most recent first
        const outbound = msgs.filter(m => m.is_sender || m.sender_id === row.account_id || m.direction === 'SENDING');
        if (!outbound.length) {
          results.push({ id: row.id, name: row.first_name, skip: 'no outbound messages found' });
          continue;
        }
        // Delete the most recent outbound message
        const msgToDelete = outbound[outbound.length - 1];
        await unipile.deleteMessage(row.account_id, msgToDelete.id);
        results.push({ id: row.id, name: row.first_name, deleted: true, msg_id: msgToDelete.id });
      } catch(e) {
        results.push({ id: row.id, name: row.first_name, error: e.message });
      }
      await new Promise(r => setTimeout(r, 500));
    }

    res.json({ total: rows.length, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/delete-sent-messages-fast — faster deletion using inbox_messages table
router.post('/delete-sent-messages-fast', async (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    // Get message IDs from inbox_messages (stored when syncInbox ran)
    const { rows } = await db.query(`
      SELECT DISTINCT im.message_id, im.account_id, c.first_name
      FROM inbox_messages im
      JOIN inbox_threads it ON it.thread_id = im.thread_id
      JOIN enrollments e ON e.chat_id::text = it.thread_id::text
      JOIN campaigns camp ON camp.id = e.campaign_id
      JOIN contacts c ON c.id = e.contact_id
      WHERE camp.workspace_id = $1
        AND e.status = 'messaged'
        AND im.direction = 'sent'
        AND im.sent_at > NOW() - INTERVAL '3 hours'
    `, [workspace_id]);

    const unipile = require('../unipile');
    const results = [];

    for (const row of rows) {
      try {
        await unipile.deleteMessage(row.account_id, row.message_id);
        results.push({ name: row.first_name, deleted: true, msg_id: row.message_id });
      } catch(e) {
        results.push({ name: row.first_name, error: e.message, msg_id: row.message_id });
      }
      await new Promise(r => setTimeout(r, 300));
    }

    res.json({ found: rows.length, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/delete-messages-by-account — delete messages for a specific account
router.post('/delete-messages-by-account', async (req, res) => {
  const { workspace_id, account_name } = req.body;
  if (!workspace_id || !account_name) return res.status(400).json({ error: 'workspace_id and account_name required' });
  try {
    const { rows } = await db.query(`
      SELECT e.id, e.chat_id, camp.account_id, c.first_name, c.last_name
      FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      JOIN unipile_accounts ua ON ua.account_id = camp.account_id AND ua.workspace_id = camp.workspace_id
      WHERE camp.workspace_id = $1
        AND ua.display_name ILIKE $2
        AND e.status = 'messaged'
        AND e.chat_id IS NOT NULL
      ORDER BY c.first_name
    `, [workspace_id, `%${account_name}%`]);

    const unipile = require('../unipile');
    const results = [];

    for (const row of rows) {
      try {
        // Get messages from chat
        const msgs = await unipile.getChatMessages(row.account_id, row.chat_id, 20);
        // Find outbound messages — Unipile uses is_sender=1 or from_me/is_me flags
        const outbound = msgs.filter(m =>
          m.is_sender === 1 || m.is_sender === true ||
          m.from_me === true || m.is_me === true ||
          m.sender?.is_me === true
        );
        if (!outbound.length) {
          results.push({ name: `${row.first_name} ${row.last_name}`, skip: 'no outbound msg found', msgs_count: msgs.length });
          continue;
        }
        // Delete each outbound message
        let deletedCount = 0;
        for (const msg of outbound) {
          try {
            await unipile.deleteMessage(row.account_id, msg.id);
            deletedCount++;
            await new Promise(r => setTimeout(r, 200));
          } catch(de) {
            // ignore individual delete errors
          }
        }
        results.push({ name: `${row.first_name} ${row.last_name}`, deleted: deletedCount });
      } catch(e) {
        results.push({ name: `${row.first_name} ${row.last_name}`, error: e.message });
      }
      await new Promise(r => setTimeout(r, 800));
    }

    res.json({ account: account_name, total: rows.length, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/detach-sequence — remove sequence from campaigns
router.post('/detach-sequence', async (req, res) => {
  const { campaign_ids, workspace_id } = req.body;
  if (!campaign_ids || !workspace_id) return res.status(400).json({ error: 'campaign_ids + workspace_id required' });
  try {
    const ids = Array.isArray(campaign_ids) ? campaign_ids : [campaign_ids];
    const { rowCount } = await db.query(
      `UPDATE campaigns SET sequence_id = NULL WHERE id = ANY($1) AND workspace_id = $2`,
      [ids, workspace_id]
    );
    res.json({ updated: rowCount, campaign_ids: ids });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/sync-opportunities-test — alternating accounts per company
router.post('/sync-opportunities-test', async (req, res) => {
  const { workspace_id, company_linkedin_ids } = req.body;
  if (!workspace_id || !company_linkedin_ids?.length)
    return res.status(400).json({ error: 'workspace_id and company_linkedin_ids required' });
  try {
    const unipile = require('../unipile');
    const { rows: accounts } = await db.query(
      `SELECT account_id, display_name FROM unipile_accounts WHERE workspace_id=$1 ORDER BY id`,
      [workspace_id]
    );
    if (!accounts.length) return res.status(400).json({ error: 'no accounts' });

    // Fetch company names
    const { rows: compRows } = await db.query(
      `SELECT company_linkedin_id, company_name FROM list_companies WHERE workspace_id=$1 AND company_linkedin_id=ANY($2) LIMIT 100`,
      [workspace_id, company_linkedin_ids]
    );
    const nameMap = {};
    for (const r of compRows) nameMap[r.company_linkedin_id] = r.company_name;

    const results = [];
    for (let i = 0; i < company_linkedin_ids.length; i++) {
      const companyId = company_linkedin_ids[i];
      const account   = accounts[i % accounts.length]; // alternate
      try {
        const data = await unipile._request(
          '/api/v1/linkedin/search?account_id=' + encodeURIComponent(account.account_id),
          {
            method: 'POST',
            body: JSON.stringify({
              api: 'classic', category: 'people',
              filters: { currentCompany: [String(companyId)], network_distance: ['DISTANCE_1'] },
              limit: 50
            })
          }
        );
        const people = data?.items || [];
        for (const p of people) {
          const acoId = p.id?.startsWith('ACo') ? p.id : null;
          const slug  = p.public_identifier || p.identifier;
          if (!slug && !acoId) continue;
          const liUrl = `https://www.linkedin.com/in/${slug || acoId}`;
          const fn = p.first_name||p.firstName||'';
          const ln = p.last_name||p.lastName||'';
          const tt = p.headline||p.title||'';
          await db.query(`
            INSERT INTO opportunity_contacts (workspace_id,company_linkedin_id,company_name,li_profile_url,provider_id,aco_id,first_name,last_name,title,connected_via_account_id,connected_via_name,last_seen_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
            ON CONFLICT (workspace_id,li_profile_url,connected_via_account_id)
            DO UPDATE SET last_seen_at=NOW(),
              aco_id=COALESCE(NULLIF(EXCLUDED.aco_id,''),opportunity_contacts.aco_id),
              title=COALESCE(NULLIF(EXCLUDED.title,''),opportunity_contacts.title),
              first_name=COALESCE(NULLIF(EXCLUDED.first_name,''),opportunity_contacts.first_name),
              last_name=COALESCE(NULLIF(EXCLUDED.last_name,''),opportunity_contacts.last_name)
          `, [workspace_id, String(companyId), nameMap[companyId]||'',
              liUrl, slug, acoId, fn, ln, tt,
              account.account_id, account.display_name]);
          // Also upsert to main contacts table (campaign_id=NULL, never enrolled)
          await db.query(`
            INSERT INTO contacts (workspace_id,campaign_id,first_name,last_name,title,company,li_profile_url,provider_id,already_connected)
            VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,true)
            ON CONFLICT (workspace_id,li_profile_url) DO UPDATE SET
              first_name=COALESCE(NULLIF(EXCLUDED.first_name,''),contacts.first_name),
              last_name=COALESCE(NULLIF(EXCLUDED.last_name,''),contacts.last_name),
              title=COALESCE(NULLIF(EXCLUDED.title,''),contacts.title),
              company=COALESCE(NULLIF(EXCLUDED.company,''),contacts.company),
              already_connected=true
          `, [workspace_id,fn,ln,tt,nameMap[companyId]||'',liUrl,slug||acoId]);
        }
        results.push({ company: nameMap[companyId]||companyId, account: account.display_name, found: people.length });
        await new Promise(r => setTimeout(r, 1500));
      } catch(e) {
        results.push({ company: nameMap[companyId]||companyId, account: account.display_name, error: e.message });
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    res.json({ results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/test-search-first-degree — debug raw Unipile response
router.post('/test-search-first-degree', async (req, res) => {
  const { workspace_id, company_linkedin_id } = req.body;
  try {
    const { rows: accts } = await db.query(
      `SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1`, [workspace_id]
    );
    if (!accts.length) return res.status(400).json({ error: 'no accounts' });
    const people = await require('../unipile').searchFirstDegreeAtCompany(accts[0].account_id, company_linkedin_id, 3);
    res.json({ count: people.length, sample: people[0] || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/test-relations — test Unipile relations endpoint
router.post('/test-relations', async (req, res) => {
  const { workspace_id } = req.body;
  try {
    const { rows: accts } = await db.query(
      `SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1`, [workspace_id]
    );
    if (!accts.length) return res.status(400).json({ error: 'no accounts' });
    const unipile = require('../unipile');
    // Try Unipile's relations endpoint
    // Probe Unipile API — list all available endpoints
    const probes = [
      `/api/v1/linkedin/search?account_id=${encodeURIComponent(accts[0].account_id)}`,
      `/api/v1/linkedin?account_id=${encodeURIComponent(accts[0].account_id)}`,
      `/api/v1/accounts/${encodeURIComponent(accts[0].account_id)}/connections?limit=3`,
      `/api/v1/connections?account_id=${encodeURIComponent(accts[0].account_id)}&limit=3`,
      `/api/v1/linkedin/connections?account_id=${encodeURIComponent(accts[0].account_id)}&limit=3`,
    ];
    const results = {};
    for (const ep of probes) {
      try {
        const d = await unipile._request(ep);
        results[ep.split('?')[0]] = d?.items ? `items[${d.items.length}] keys=${Object.keys(d.items[0]||{}).slice(0,5).join(',')}` : JSON.stringify(d).slice(0,100);
      } catch(e) {
        results[ep.split('?')[0]] = e.message.slice(0,60);
      }
    }
    res.json(results);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/enrich-opportunity-contacts — fill aco_id via enrichProfile for contacts missing it
router.post('/enrich-opportunity-contacts', async (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  res.json({ status: 'started' });
  // Run in background
  (async () => {
    const unipile = require('../unipile');
    const { rows: contacts } = await db.query(`
      SELECT oc.id, oc.li_profile_url, oc.connected_via_account_id
      FROM opportunity_contacts oc
      WHERE oc.workspace_id=$1 AND (oc.aco_id IS NULL OR oc.aco_id='')
      LIMIT 20
    `, [workspace_id]);
    for (const c of contacts) {
      try {
        const enriched = await unipile.enrichProfile(c.connected_via_account_id, c.li_profile_url);
        const acoId = enriched?.provider_id?.startsWith('ACo') ? enriched.provider_id : null;
        if (acoId) {
          await db.query(`UPDATE opportunity_contacts SET aco_id=$1 WHERE id=$2`, [acoId, c.id]);
          console.log(`[EnrichOpp] ${c.li_profile_url} → ${acoId}`);
        }
        await new Promise(r => setTimeout(r, 1000));
      } catch(e) {
        console.warn(`[EnrichOpp] ${c.li_profile_url}: ${e.message}`);
      }
    }
  })();
});

// POST /api/admin/get-aco-id — resolve ACoXXX for a LinkedIn profile URL
router.post('/get-aco-id', async (req, res) => {
  const { workspace_id, li_profile_url } = req.body;
  try {
    const { rows: accts } = await db.query(
      `SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1`, [workspace_id]
    );
    const unipile = require('../unipile');
    const enriched = await unipile.enrichProfile(accts[0].account_id, li_profile_url);
    res.json({ provider_id: enriched?.provider_id, raw: enriched });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Advanced Analytics Endpoints ────────────────────────────────────────────

// GET /api/admin/analytics/journey?workspace_id=
// Average days between each funnel stage
router.get('/analytics/journey', async (req, res) => {
  const ws = parseInt(req.query.workspace_id) || null;
  const wsFilter = ws ? 'AND campaign_id IN (SELECT id FROM campaigns WHERE workspace_id=$1)' : '';
  const p = ws ? [ws] : [];
  try {
    const { rows } = await db.query(`
      SELECT
        ROUND(AVG(EXTRACT(EPOCH FROM (invite_approved_at - invite_sent_at))/86400)::numeric, 1) AS days_invite_to_approve,
        ROUND(AVG(EXTRACT(EPOCH FROM (msg_sent_at - invite_approved_at))/86400)::numeric, 1)   AS days_approve_to_message,
        ROUND(AVG(EXTRACT(EPOCH FROM (msg_replied_at - msg_sent_at))/86400)::numeric, 1)        AS days_message_to_reply,
        COUNT(*) FILTER (WHERE invite_sent = true)     AS total_invited,
        COUNT(*) FILTER (WHERE invite_approved = true) AS total_approved,
        COUNT(*) FILTER (WHERE msg_sent = true)        AS total_messaged,
        COUNT(*) FILTER (WHERE msg_replied = true)     AS total_replied
      FROM contacts
      WHERE invite_sent_at IS NOT NULL
        ${ws ? 'AND workspace_id = $1' : ''}
    `, p);
    // Best day of week for approvals and replies
    const { rows: dayRows } = await db.query(`
      SELECT
        TO_CHAR(invite_approved_at, 'Dy') AS day,
        EXTRACT(DOW FROM invite_approved_at) AS dow,
        COUNT(*) AS approvals,
        COUNT(*) FILTER (WHERE msg_replied_at IS NOT NULL) AS replies
      FROM contacts
      WHERE invite_approved_at IS NOT NULL
        ${ws ? 'AND workspace_id = $1' : ''}
      GROUP BY day, dow ORDER BY dow
    `, p);
    res.json({ journey: rows[0], by_day: dayRows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/analytics/velocity?workspace_id=
// Week-over-week change for each KPI
router.get('/analytics/velocity', async (req, res) => {
  const ws = parseInt(req.query.workspace_id) || null;
  const wsFilter = ws ? 'AND workspace_id = $1' : '';
  const p = ws ? [ws] : [];
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE invite_sent_at >= NOW()-'7 days'::interval)     AS inv_this_week,
        COUNT(*) FILTER (WHERE invite_sent_at BETWEEN NOW()-'14 days'::interval AND NOW()-'7 days'::interval) AS inv_last_week,
        COUNT(*) FILTER (WHERE invite_approved_at >= NOW()-'7 days'::interval)  AS apr_this_week,
        COUNT(*) FILTER (WHERE invite_approved_at BETWEEN NOW()-'14 days'::interval AND NOW()-'7 days'::interval) AS apr_last_week,
        COUNT(*) FILTER (WHERE msg_sent_at >= NOW()-'7 days'::interval)         AS msg_this_week,
        COUNT(*) FILTER (WHERE msg_sent_at BETWEEN NOW()-'14 days'::interval AND NOW()-'7 days'::interval)        AS msg_last_week,
        COUNT(*) FILTER (WHERE msg_replied_at >= NOW()-'7 days'::interval)      AS rep_this_week,
        COUNT(*) FILTER (WHERE msg_replied_at BETWEEN NOW()-'14 days'::interval AND NOW()-'7 days'::interval)     AS rep_last_week
      FROM contacts
      WHERE 1=1 ${wsFilter}
    `, p);
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/analytics/stale?workspace_id=
// Stale pipeline — contacts pending too long
router.get('/analytics/stale', async (req, res) => {
  const ws = parseInt(req.query.workspace_id) || null;
  const wsFilter = ws ? 'AND c.workspace_id = $1' : '';
  const p = ws ? [ws] : [];
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE e.status='pending' AND e.created_at < NOW()-'14 days'::interval) AS stale_14d,
        COUNT(*) FILTER (WHERE e.status='pending' AND e.created_at < NOW()-'30 days'::interval) AS stale_30d,
        COUNT(*) FILTER (WHERE e.status='pending' AND e.created_at < NOW()-'60 days'::interval) AS stale_60d,
        COUNT(*) FILTER (WHERE e.status='pending')                                               AS total_pending,
        COUNT(*) FILTER (WHERE e.status='invite_sent' AND e.updated_at < NOW()-'14 days'::interval) AS stuck_invited
      FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id
      WHERE 1=1 ${wsFilter}
    `, p);
    // Project future conversions
    const { rows: rates } = await db.query(`
      SELECT
        CASE WHEN COUNT(*) FILTER (WHERE invite_sent=true) > 0
          THEN ROUND(COUNT(*) FILTER (WHERE invite_approved=true)::numeric / 
               COUNT(*) FILTER (WHERE invite_sent=true) * 100, 1) END AS approval_rate,
        CASE WHEN COUNT(*) FILTER (WHERE msg_sent=true) > 0
          THEN ROUND(COUNT(*) FILTER (WHERE msg_replied=true)::numeric / 
               COUNT(*) FILTER (WHERE msg_sent=true) * 100, 1) END AS reply_rate
      FROM contacts
      WHERE 1=1 ${wsFilter}
    `, p);
    res.json({ stale: rows[0], rates: rates[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/analytics/insights — AI-generated insights via Claude
router.post('/analytics/insights', async (req, res) => {
  const { data, workspace } = req.body;
  try {
    const https = require('https');
    const msgBody = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: `You are a B2B marketing analyst specializing in LinkedIn outreach for Israeli tech companies. Analyze campaign data and provide 5 sharp, actionable insights in plain text. Each insight should be on its own line, starting with an emoji (🟢 for positive, 🟡 for attention, 🔴 for urgent, 🎯 for action). Be specific, use the numbers, and focus on what to DO next. Keep each insight under 2 sentences. No headers or markdown. Just the 5 insight lines.`,
      messages: [{ role: 'user', content: `Analyze this LinkedIn outreach data for ${workspace || 'this workspace'}:\n\n${data}` }]
    });

    const result = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(msgBody) }
      }, (res2) => {
        let d = '';
        res2.on('data', c => d += c);
        res2.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
      });
      r.on('error', reject);
      r.write(msgBody);
      r.end();
    });

    res.json({ insights: result.content?.[0]?.text || '' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/classify-replies — retroactively classify existing 'replied' enrollments
router.post('/classify-replies', async (req, res) => {
  const { workspace_id, limit = 50 } = req.body;
  res.json({ status: 'started', workspace_id });

  (async () => {
    const https = require('https');
    const unipile = require('../unipile');

    // Get all 'replied' enrollments without positive_reply classification
    const wsFilter = workspace_id ? 'AND camp.workspace_id = $1' : '';
    const p = workspace_id ? [workspace_id] : [];
    const limitClause = `LIMIT ${parseInt(limit)||50}`;

    const { rows: enrollments } = await db.query(`
      SELECT
        e.id AS enrollment_id,
        c.chat_id,
        c.first_name, c.last_name,
        camp.account_id,
        camp.workspace_id
      FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      WHERE e.status = 'replied'
        AND (c.positive_reply IS NULL OR c.positive_reply = false)
        ${wsFilter}
      ORDER BY e.updated_at DESC
      ${limitClause}
    `, p);

    console.log(`[ClassifyReplies] Processing ${enrollments.length} replied enrollments`);
    let classified = 0;

    for (const enr of enrollments) {
      try {
        // Get last message from contact
        let messageText = '';
        if (enr.chat_id) {
          const { rows: msgs } = await db.query(`
            SELECT m.content AS body
            FROM inbox_messages m
            JOIN inbox_threads t ON t.id = m.thread_id
            WHERE t.thread_id = $1 AND m.direction = 'received'
            ORDER BY m.sent_at DESC LIMIT 1
          `, [enr.chat_id]);
          messageText = msgs[0]?.body || '';
        }

        if (!messageText || messageText.trim().length < 3) continue;

        // Call AI
        const body = JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          system: `Classify LinkedIn replies as POSITIVE (interested, wants call/demo, says yes) or NOT_POSITIVE (rejection, auto-reply, not interested). Reply ONLY: POSITIVE or NOT_POSITIVE`,
          messages: [{ role: 'user', content: `LinkedIn reply: "${messageText.slice(0, 500)}"` }]
        });

        const result = await new Promise((resolve, reject) => {
          const r = https.request({
            hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) }
          }, (res2) => {
            let d = ''; res2.on('data', c => d += c);
            res2.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
          });
          r.on('error', reject);
          r.write(body); r.end();
        });

        const verdict = result.content?.[0]?.text?.trim().toUpperCase();

        if (verdict === 'POSITIVE') {
          await db.query(`UPDATE enrollments SET status='positive_reply', updated_at=NOW() WHERE id=$1 AND status='replied'`, [enr.enrollment_id]);
          await db.query(`UPDATE contacts SET positive_reply=true, positive_reply_at=NOW(), conversation_stage='positive' WHERE id=(SELECT contact_id FROM enrollments WHERE id=$1)`, [enr.enrollment_id]);
          classified++;
          console.log(`[ClassifyReplies] ✅ ${enr.first_name} ${enr.last_name}: POSITIVE`);
        }

        await new Promise(r => setTimeout(r, 300)); // rate limit
      } catch(e) {
        console.warn(`[ClassifyReplies] enrollment #${enr.enrollment_id}: ${e.message}`);
      }
    }

    console.log(`[ClassifyReplies] Done — ${classified}/${enrollments.length} positive`);
  })();
});

// POST /api/admin/debug-webhook-register — test different webhook formats
router.post('/debug-webhook-register', async (req, res) => {
  const { workspace_id, source, events, extra } = req.body;
  const { request: uRequest } = require('../unipile');
  const SERVER_URL = process.env.SERVER_URL || process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` || 'http://localhost:3000';
  const WEBHOOK_URL = `${SERVER_URL}/api/webhooks/unipile`;
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'elvia-secret';

  const { rows: accounts } = await db.query(
    'SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1', [workspace_id]
  );
  if (!accounts.length) return res.status(400).json({ error: 'no accounts' });

  const body = {
    source,
    name: `debug_${source}_${Date.now()}`,
    request_url: WEBHOOK_URL,
    account_ids: [accounts[0].account_id],
    format: 'json',
    headers: [{ key: 'x-webhook-secret', value: WEBHOOK_SECRET }],
    ...(events ? { events } : {}),
    ...(extra || {}),
  };
  try {
    const data = await uRequest('/api/v1/webhooks', { method: 'POST', body: JSON.stringify(body) });
    res.json({ ok: true, data, body_sent: body });
  } catch(e) {
    res.json({ ok: false, error: e.message, body_sent: body });
  }
});

// GET /api/admin/debug-unipile?workspace_id=&path=  — probe Unipile endpoints
router.get('/debug-unipile', async (req, res) => {
  const { workspace_id, path: uPath } = req.query;
  if (!workspace_id || !uPath) return res.status(400).json({ error: 'workspace_id and path required' });
  const { rows } = await db.query('SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1', [workspace_id]);
  if (!rows.length) return res.status(400).json({ error: 'no account' });
  const { request: uRequest } = require('../unipile');
  try {
    const sep = uPath.includes('?') ? '&' : '?';
    const data = await uRequest(`${uPath}${sep}account_id=${rows[0].account_id}`);
    res.json({ ok: true, path: uPath, keys: Object.keys(data || {}), sample: JSON.stringify(data).slice(0, 500) });
  } catch(e) { res.json({ ok: false, path: uPath, error: e.message.slice(0,200) }); }
});

// POST /api/admin/run-sync-signals — trigger syncSignals, synchronous with detailed output
router.post('/run-sync-signals', async (req, res) => {
  const { request: uRequest } = require('../unipile');
  const https = require('https');
  const wsId = parseInt(req.body?.workspace_id) || 2;
  const dryRun = req.body?.dry_run === true;

  const logs = [];
  const log = (msg) => { logs.push(msg); console.log(msg); };

  try {
    const { rows: accounts } = await db.query(
      `SELECT ua.account_id, ua.display_name, ua.workspace_id, w.name AS workspace_name
       FROM unipile_accounts ua JOIN workspaces w ON w.id = ua.workspace_id
       WHERE ua.workspace_id = $1`, [wsId]
    );
    log(`[SyncSignals] ${accounts.length} accounts in ws${wsId}`);

    let totalSaved = 0;
    const results = [];

    for (const acc of accounts) {
      const chatsData = await uRequest(`/api/v1/chats?account_id=${acc.account_id}&limit=100`);
      const chats = chatsData?.items || [];
      log(`[SyncSignals] ${acc.display_name}: ${chats.length} chats`);

      for (const chat of chats) {
        if (chat.type !== 0) continue;
        const pid = chat.attendee_provider_id;
        if (!pid) continue;

        const msgsData = await uRequest(`/api/v1/chats/${chat.id}/messages?account_id=${acc.account_id}&limit=3`).catch(()=>null);
        const msgs = msgsData?.items || [];
        if (!msgs.length) continue;

        const last = msgs[0];
        const fromThem = last.is_sender === 0 || last.is_sender === false;
        if (!fromThem) continue;

        const msgText = (last.text || '').trim();
        if (!msgText) continue;

        const ts = new Date(last.timestamp || chat.timestamp || Date.now()).getTime();
        const ageDays = Math.round((Date.now() - ts) / 86400000);
        if (ageDays > 30) { log(`skip: old (${ageDays}d)`); continue; }

        // Check duplicate
        const { rows: dup } = await db.query(
          `SELECT id FROM signals WHERE workspace_id=$1 AND actor_provider_id=$2
           AND created_at > NOW() - INTERVAL '30 days' LIMIT 1`,
          [acc.workspace_id, pid]
        );
        if (dup.length) { log(`skip: dup for ${pid.slice(0,15)}`); continue; }

        // Known contact?
        const { rows: known } = await db.query(
          `SELECT c.id, c.first_name, c.last_name, c.title, c.company, c.li_profile_url
           FROM contacts c JOIN enrollments e ON e.contact_id = c.id
           JOIN campaigns camp ON camp.id = e.campaign_id
           WHERE camp.workspace_id=$1 AND c.provider_id=$2 LIMIT 1`,
          [acc.workspace_id, pid]
        );
        const kc = known[0] || null;

        const person = kc ? {
          name: [kc.first_name, kc.last_name].filter(Boolean).join(' '),
          title: kc.title, company: kc.company,
          li_url: kc.li_profile_url || `https://www.linkedin.com/in/${pid}`,
        } : { li_url: `https://www.linkedin.com/in/${pid}`, provider_id: pid };

        // AI score
        let score = null;
        if (process.env.ANTHROPIC_API_KEY) {
          const body = JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 150,
            system: 'Analyze LinkedIn inbound signal for B2B. Return JSON only: {"priority":"HOT"|"WARM"|"COLD","action":"reply_now"|"add_to_campaign"|"ignore","reason":"one sentence","fit_score":1}. HOT=decision maker initiated. WARM=relevant unclear intent. COLD=spam.',
            messages: [{ role:'user', content:`Person: ${JSON.stringify(person)}\nMessage: "${msgText.slice(0,300)}"` }]
          });
          try {
            const aiRes = await new Promise((resolve, reject) => {
              const r = https.request({ hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
                headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body)}
              }, (res2) => { let d=''; res2.on('data',c=>d+=c); res2.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); });
              r.on('error',reject); r.write(body); r.end();
            });
            score = JSON.parse((aiRes.content?.[0]?.text||'').trim());
          } catch(e) { log(`AI error: ${e.message}`); }
        }

        const entry = {
          account: acc.display_name, chat_id: chat.id,
          name: person.name || pid.slice(0,15),
          text: msgText.slice(0,80), age_days: ageDays,
          known: !!kc, priority: score?.priority || null,
          reason: score?.reason || null, saved: false
        };

        if (!dryRun) {
          await db.query(
            `INSERT INTO signals (workspace_id,type,actor_contact_id,actor_provider_id,actor_name,
             actor_li_url,actor_headline,subject_li_account_id,content,raw_data,is_known,
             ai_priority,ai_action,ai_reason,ai_fit_score,occurred_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())`,
            [acc.workspace_id, kc ? 'inbound_message' : 'unsolicited_message',
             kc?.id || null, pid, person.name || null, person.li_url || null,
             person.title || null, acc.account_id, msgText.slice(0,500),
             JSON.stringify({chat_id:chat.id,score,person}), !!kc,
             score?.priority||null, score?.action||null, score?.reason||null,
             typeof score?.fit_score==='number'?score.fit_score:null]
          );
          entry.saved = true;
          totalSaved++;
          log(`✅ SAVED: ${entry.name} → ${entry.priority||'unscored'}`);
        } else {
          entry.saved = 'dry_run';
          log(`🔍 WOULD SAVE: ${entry.name} → ${entry.priority||'unscored'}`);
        }
        results.push(entry);
        await new Promise(r => setTimeout(r, 300));
      }
    }
    log(`[SyncSignals] Done — ${totalSaved} saved, ${results.length} found`);
    res.json({ ok: true, dry_run: dryRun, saved: totalSaved, found: results.length, results, logs });
  } catch(e) {
    log(`ERROR: ${e.message}`);
    res.json({ ok: false, error: e.message, logs });
  }
});

// GET /api/admin/debug-sync-signals — dry run syncSignals to see what it finds
router.get('/debug-sync-signals', async (req, res) => {
  const { request } = require('../unipile');
  const { getAccountInfo } = require('../unipile');

  const { rows: accs } = await db.query(
    `SELECT account_id, display_name, workspace_id FROM unipile_accounts WHERE workspace_id=$1`,
    [req.query.workspace_id || 2]
  );
  if (!accs.length) return res.json({ error: 'no accounts' });

  const results = [];
  for (const acc of accs) {
    try {
      const chatsData = await request(`/api/v1/chats?account_id=${acc.account_id}&limit=20`);
      const chats = chatsData?.items || [];

      let chatSamples = [];
      for (const chat of chats.slice(0,5)) {
        if (chat.type !== 0) continue;
        const msgsData = await request(`/api/v1/chats/${chat.id}/messages?account_id=${acc.account_id}&limit=3`);
        const msgs = msgsData?.items || [];
        const mostRecent = msgs[0];
        chatSamples.push({
          chat_id: chat.id,
          attendee_provider_id: chat.attendee_provider_id?.slice(0,20),
          msg_count: msgs.length,
          most_recent_is_sender: mostRecent?.is_sender,
          most_recent_text: mostRecent?.text?.slice(0,60),
          last_from_them: mostRecent?.is_sender === 0,
        });
      }
      results.push({ account: acc.display_name, total_chats: chats.length, samples: chatSamples });
    } catch(e) {
      results.push({ account: acc.display_name, error: e.message });
    }
  }
  res.json(results);
});

// POST /api/admin/classify-signals — AI-score all unclassified signals
router.post('/classify-signals', async (req, res) => {
  const { workspace_id, limit = 50 } = req.body;
  res.json({ status: 'started' });
  (async () => {
    const https = require('https');
    const wsFilter = workspace_id ? 'AND workspace_id = $1' : '';
    const p = workspace_id ? [workspace_id] : [];
    const { rows } = await db.query(
      `SELECT id, actor_name, actor_headline, content, type,
              LEFT(actor_li_url,80) as li_url
       FROM signals
       WHERE ai_priority IS NULL AND content IS NOT NULL
         ${wsFilter}
       ORDER BY created_at DESC LIMIT ${parseInt(limit)||50}`,
      p
    );
    console.log(`[ClassifySignals] ${rows.length} unscored signals`);
    let done = 0;
    for (const sig of rows) {
      const person = { name: sig.actor_name, title: sig.actor_headline, li_url: sig.li_url };
      const body = JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 120,
        system: 'B2B LinkedIn signal classifier. Return JSON only: {"priority":"HOT"|"WARM"|"COLD","action":"reply_now"|"add_to_campaign"|"ignore","reason":"one sentence","fit_score":1}. HOT=decision maker who wrote to us first with clear interest. WARM=relevant professional, some intent. COLD=reaction/generic/spam.',
        messages: [{ role:'user', content:`Person: ${JSON.stringify(person)}\nMessage: "${(sig.content||'').slice(0,300)}"` }]
      });
      try {
        const result = await new Promise((resolve, reject) => {
          const r = https.request({ hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
            headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body)}
          }, (res2) => { let d=''; res2.on('data',c=>d+=c); res2.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); });
          r.on('error',reject); r.write(body); r.end();
        });
        const rawText = (result.content?.[0]?.text||'{}').trim().replace(/```json|```/g,'').trim();
        const score = JSON.parse(rawText);
        await db.query(
          `UPDATE signals SET ai_priority=$1, ai_action=$2, ai_reason=$3, ai_fit_score=$4 WHERE id=$5`,
          [score.priority||null, score.action||null, score.reason||null,
           typeof score.fit_score==='number'?score.fit_score:null, sig.id]
        );
        if (score.priority) {
          console.log(`[ClassifySignals] ${sig.actor_name}: ${score.priority} — ${score.reason?.slice(0,60)}`);
          done++;
        }
      } catch(e) { console.warn(`[ClassifySignals] ${sig.id}: ${e.message}`); }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`[ClassifySignals] Done — ${done}/${rows.length} classified`);
  })();
});

// GET /api/admin/classify-signals/status — sync classify one signal and return result
router.get('/classify-signals/test', async (req, res) => {
  const https = require('https');
  const wsId = parseInt(req.query.workspace_id) || 2;
  const { rows } = await db.query(
    `SELECT id, actor_name, actor_headline, content, type, actor_li_url
     FROM signals WHERE workspace_id=$1 AND ai_priority IS NULL AND content IS NOT NULL
     LIMIT 1`, [wsId]
  );
  if (!rows.length) return res.json({ msg: 'no unscored signals' });
  const sig = rows[0];
  const person = { name: sig.actor_name, title: sig.actor_headline };
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001', max_tokens: 120,
    system: 'B2B LinkedIn classifier. Return JSON only (no markdown): {"priority":"HOT"|"WARM"|"COLD","action":"reply_now"|"add_to_campaign"|"ignore","reason":"one sentence","fit_score":5}',
    messages: [{ role:'user', content:`Person: ${JSON.stringify(person)}\nMessage: "${(sig.content||'').slice(0,300)}"` }]
  });
  try {
    const result = await new Promise((resolve, reject) => {
      const r = https.request({ hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body)}
      }, (res2) => { let d=''; res2.on('data',c=>d+=c); res2.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); });
      r.on('error',reject); r.write(body); r.end();
    });
    const rawText = (result.content?.[0]?.text||'{}').trim().replace(/```json|```/g,'').trim();
    const score = JSON.parse(rawText);
    // Update DB
    await db.query(`UPDATE signals SET ai_priority=$1,ai_action=$2,ai_reason=$3,ai_fit_score=$4 WHERE id=$5`,
      [score.priority||null, score.action||null, score.reason||null,
       typeof score.fit_score==='number'?score.fit_score:null, sig.id]);
    res.json({ signal: sig, raw_response: result.content?.[0]?.text, score, updated: true });
  } catch(e) { res.json({ error: e.message, signal: sig }); }
});

// GET /api/admin/analytics/engagement?workspace_id=
router.get('/analytics/engagement', async (req, res) => {
  const wsId = parseInt(req.query.workspace_id);
  if (!wsId) return res.status(400).json({ error: 'workspace_id required' });
  try {
    // First non-inbound list for this workspace
    const { rows: lists } = await db.query(
      `SELECT id, name FROM lists WHERE workspace_id=$1 AND name NOT ILIKE '%inbound%' ORDER BY id LIMIT 2`,
      [wsId]
    );
    const listIds = lists.map(l => l.id);

    // Profile views — from contacts.profile_view_count
    const { rows: pvRows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE profile_view_count > 0)                    AS total_viewers,
        COALESCE(SUM(profile_view_count), 0)                              AS total_views,
        COUNT(*) FILTER (WHERE last_profile_view_at > NOW()-INTERVAL '30 days'
          AND profile_view_count > 0)                                     AS last_30d_viewers
      FROM contacts WHERE workspace_id=$1
    `, [wsId]);

    // Profile views per list — uses list_contacts.viewed_our_profile flag
    const { rows: lcViewRows } = await db.query(`
      SELECT l.id, l.name,
        COUNT(*) FILTER (WHERE lc.viewed_our_profile=true) AS viewed,
        COUNT(*)                                            AS total,
        ROUND(COUNT(*) FILTER (WHERE lc.viewed_our_profile=true) * 100.0 / NULLIF(COUNT(*),0), 1) AS pct
      FROM lists l JOIN list_contacts lc ON lc.list_id=l.id
      WHERE l.workspace_id=$1 GROUP BY l.id, l.name ORDER BY l.id
    `, [wsId]);

    // Total "from list" via viewed_our_profile
    const fromList1Views = lcViewRows
      .filter(r => listIds.includes(r.id))
      .reduce((s,r) => s + parseInt(r.viewed||0), 0);

    // Post reactions per account
    const { rows: reactRows } = await db.query(`
      SELECT ua.display_name AS account_name, pr.reaction_type,
        COUNT(*) AS total, COUNT(DISTINCT pr.reactor_id) AS unique_people
      FROM post_reactions pr
      JOIN unipile_accounts ua ON ua.account_id=pr.account_id AND ua.workspace_id=$1
      WHERE pr.workspace_id=$1
      GROUP BY ua.display_name, pr.reaction_type ORDER BY total DESC
    `, [wsId]);

    // Reactions from List 1 — try provider_id match first, then name match
    const { rows: reactListRows } = await db.query(`
      SELECT
        COUNT(DISTINCT pr.reactor_id) AS from_list1_people,
        COUNT(*)                      AS from_list1_reactions
      FROM post_reactions pr
      WHERE pr.workspace_id=$1
        AND (
          -- Match by provider_id
          EXISTS (
            SELECT 1 FROM contacts c
            JOIN list_contacts lc ON lc.contact_id=c.id AND lc.list_id=ANY($2::int[])
            WHERE c.provider_id=pr.reactor_id AND c.workspace_id=$1
          )
          OR
          -- Match by name (first+last matching reactor_name)
          EXISTS (
            SELECT 1 FROM contacts c
            JOIN list_contacts lc ON lc.contact_id=c.id AND lc.list_id=ANY($2::int[])
            WHERE c.workspace_id=$1
              AND LOWER(TRIM(c.first_name||' '||c.last_name)) = LOWER(TRIM(pr.reactor_name))
          )
        )
    `, [wsId, listIds.length ? listIds : [0]]);

    // Top engagers
    const { rows: topRows } = await db.query(`
      SELECT
        pr.reactor_name AS name,
        pr.reactor_headline AS headline,
        pr.reactor_url AS li_url,
        COUNT(*) AS reactions,
        MAX(pr.scraped_at) AS last_seen,
        CASE WHEN EXISTS (
          SELECT 1 FROM contacts c
          JOIN list_contacts lc ON lc.contact_id=c.id AND lc.list_id=ANY($2::int[])
          WHERE c.workspace_id=$1 AND (
            c.provider_id=pr.reactor_id OR
            LOWER(TRIM(c.first_name||' '||c.last_name))=LOWER(TRIM(pr.reactor_name))
          )
        ) THEN true ELSE false END AS in_list1
      FROM post_reactions pr
      WHERE pr.workspace_id=$1
      GROUP BY pr.reactor_name, pr.reactor_headline, pr.reactor_url, pr.reactor_id
      ORDER BY reactions DESC LIMIT 20
    `, [wsId, listIds.length ? listIds : [0]]);

    // Recent profile viewers — from contacts with profile_view_count > 0
    const { rows: recentViewers } = await db.query(`
      SELECT c.first_name||' '||c.last_name AS name,
             c.title, c.company, c.li_profile_url,
             c.profile_view_count, c.last_profile_view_at,
             EXISTS(
               SELECT 1 FROM list_contacts lc
               WHERE lc.contact_id=c.id AND lc.list_id=ANY($2::int[])
             ) AS in_list1
      FROM contacts c
      WHERE c.workspace_id=$1 AND c.profile_view_count > 0
      ORDER BY c.last_profile_view_at DESC NULLS LAST, c.profile_view_count DESC
      LIMIT 20
    `, [wsId, listIds.length ? listIds : [0]]);

    // Recent viewers from list_contacts.viewed_our_profile
    const { rows: listViewers } = await db.query(`
      SELECT c.first_name||' '||c.last_name AS name,
             c.title, c.company, c.li_profile_url,
             lc.viewed_our_profile_at,
             l.name AS list_name
      FROM list_contacts lc
      JOIN contacts c ON c.id=lc.contact_id
      JOIN lists l ON l.id=lc.list_id
      WHERE l.workspace_id=$1 AND lc.viewed_our_profile=true
      ORDER BY lc.viewed_our_profile_at DESC NULLS LAST
      LIMIT 20
    `, [wsId]);

    res.json({
      lists, list_views: lcViewRows,
      profile_views: { ...pvRows[0], from_list1_viewers: fromList1Views },
      reactions: reactRows,
      reactions_list1: reactListRows[0] || {},
      top_engagers: topRows,
      recent_viewers: recentViewers,
      list_viewers: listViewers,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/classify-signals/status — sync classify one signal and return result
router.get('/classify-signals/test', async (req, res) => {
  const https = require('https');
  const wsId = parseInt(req.query.workspace_id) || 2;
  const { rows } = await db.query(
    `SELECT id, actor_name, actor_headline, content, type, actor_li_url
     FROM signals WHERE workspace_id=$1 AND ai_priority IS NULL AND content IS NOT NULL
     LIMIT 1`, [wsId]
  );
  if (!rows.length) return res.json({ msg: 'no unscored signals' });
  const sig = rows[0];
  const person = { name: sig.actor_name, title: sig.actor_headline };
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001', max_tokens: 120,
    system: 'B2B LinkedIn classifier. Return JSON only (no markdown): {"priority":"HOT"|"WARM"|"COLD","action":"reply_now"|"add_to_campaign"|"ignore","reason":"one sentence","fit_score":5}',
    messages: [{ role:'user', content:`Person: ${JSON.stringify(person)}\nMessage: "${(sig.content||'').slice(0,300)}"` }]
  });
  try {
    const result = await new Promise((resolve, reject) => {
      const r = https.request({ hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body)}
      }, (res2) => { let d=''; res2.on('data',c=>d+=c); res2.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); });
      r.on('error',reject); r.write(body); r.end();
    });
    const rawText = (result.content?.[0]?.text||'{}').trim().replace(/```json|```/g,'').trim();
    const score = JSON.parse(rawText);
    // Update DB
    await db.query(`UPDATE signals SET ai_priority=$1,ai_action=$2,ai_reason=$3,ai_fit_score=$4 WHERE id=$5`,
      [score.priority||null, score.action||null, score.reason||null,
       typeof score.fit_score==='number'?score.fit_score:null, sig.id]);
    res.json({ signal: sig, raw_response: result.content?.[0]?.text, score, updated: true });
  } catch(e) { res.json({ error: e.message, signal: sig }); }
});

// GET /api/admin/analytics/engagement?workspace_id=
router.get('/analytics/engagement', async (req, res) => {
  const wsId = parseInt(req.query.workspace_id);
  if (!wsId) return res.status(400).json({ error: 'workspace_id required' });
  try {
    // ── Get List 1 (first non-Inbound list for this workspace) ──
    const { rows: lists } = await db.query(
      `SELECT id, name FROM lists WHERE workspace_id=$1 AND name NOT ILIKE '%inbound%' ORDER BY id LIMIT 2`,
      [wsId]
    );
    const listIds = lists.map(l => l.id);
    const listIdsStr = listIds.length ? listIds.join(',') : '0';

    // ── Profile views (contacts who viewed our profiles) ──
    const { rows: pvRows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE c.profile_view_count > 0)                         AS total_viewers,
        COALESCE(SUM(c.profile_view_count), 0)                                   AS total_views,
        COUNT(*) FILTER (WHERE c.last_profile_view_at > NOW()-INTERVAL '30 days'
          AND c.profile_view_count > 0)                                           AS last_30d_viewers
      FROM contacts c
      WHERE c.workspace_id=$1
    `, [wsId]);

    // ── Profile views from list_contacts.viewed_our_profile ──
    const { rows: lcViewRows } = await db.query(`
      SELECT l.name, l.id,
        COUNT(*) FILTER (WHERE lc.viewed_our_profile=true) AS viewed,
        COUNT(*)                                            AS total
      FROM lists l
      JOIN list_contacts lc ON lc.list_id=l.id
      WHERE l.workspace_id=$1
      GROUP BY l.id, l.name ORDER BY l.id
    `, [wsId]);

    // ── Post reactions per account ──
    const { rows: reactRows } = await db.query(`
      SELECT
        ua.display_name                     AS account_name,
        pr.reaction_type,
        COUNT(*)                            AS total,
        COUNT(DISTINCT pr.reactor_id)       AS unique_people
      FROM post_reactions pr
      JOIN unipile_accounts ua ON ua.account_id=pr.account_id AND ua.workspace_id=$1
      WHERE pr.workspace_id=$1
      GROUP BY ua.display_name, pr.reaction_type
      ORDER BY total DESC
    `, [wsId]);

    // ── Reactions from List 1 (via contact provider_id match) ──
    const { rows: reactListRows } = await db.query(`
      SELECT
        COUNT(DISTINCT pr.reactor_id) AS from_list1_people,
        COUNT(*)                      AS from_list1_reactions
      FROM post_reactions pr
      JOIN contacts c ON c.provider_id=pr.reactor_id AND c.workspace_id=$1
      WHERE pr.workspace_id=$1
        AND EXISTS (SELECT 1 FROM list_contacts lc WHERE lc.contact_id=c.id AND lc.list_id=ANY($2::int[]))
    `, [wsId, listIds.length ? listIds : [0]]);

    // ── Top engagers (reactions + profile views combined) ──
    const { rows: topRows } = await db.query(`
      SELECT
        COALESCE(pr.reactor_name, c.first_name||' '||c.last_name) AS name,
        COALESCE(pr.reactor_headline, c.title)                     AS headline,
        pr.reactor_url                                             AS li_url,
        COUNT(*)                                                   AS reactions,
        MAX(pr.scraped_at)                                         AS last_seen,
        CASE WHEN EXISTS (
          SELECT 1 FROM contacts cc
          JOIN list_contacts lc ON lc.contact_id=cc.id AND lc.list_id=ANY($2::int[])
          WHERE cc.provider_id=pr.reactor_id AND cc.workspace_id=$1
        ) THEN true ELSE false END                                 AS in_list1
      FROM post_reactions pr
      LEFT JOIN contacts c ON c.provider_id=pr.reactor_id AND c.workspace_id=$1
      WHERE pr.workspace_id=$1
      GROUP BY pr.reactor_name, pr.reactor_headline, pr.reactor_url,
               pr.reactor_id, c.first_name, c.last_name, c.title
      ORDER BY reactions DESC
      LIMIT 20
    `, [wsId, listIds.length ? listIds : [0]]);

    // ── Recent profile viewers from list 1 (via list_contacts.viewed_our_profile) ──
    const { rows: recentViewers } = await db.query(`
      SELECT c.first_name||' '||c.last_name AS name,
             c.title, c.company, c.li_profile_url,
             COALESCE(c.profile_view_count, 1) AS profile_view_count,
             COALESCE(lc.viewed_our_profile_at, c.last_profile_view_at) AS last_profile_view_at
      FROM list_contacts lc
      JOIN contacts c ON c.id = lc.contact_id
      WHERE lc.list_id = ANY($2::int[])
        AND lc.viewed_our_profile = true
      ORDER BY lc.viewed_our_profile_at DESC NULLS LAST
      LIMIT 15
    `, [wsId, listIds.length ? listIds : [0]]);

    res.json({
      lists,
      profile_views:    pvRows[0] || {},
      list_views:       lcViewRows,
      reactions:        reactRows,
      reactions_list1:  reactListRows[0] || {},
      top_engagers:     topRows,
      recent_viewers:   recentViewers,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/analytics/health?workspace_id=
// Returns data quality warnings + correct metrics from contacts table
router.get('/analytics/health', async (req, res) => {
  const wsId = parseInt(req.query.workspace_id);
  if (!wsId) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const { rows } = await db.query(`
      SELECT
        -- Correct cumulative approval rate (contacts table, not pipeline snapshot)
        COUNT(*) FILTER (WHERE invite_sent=true)      AS ever_invited,
        COUNT(*) FILTER (WHERE invite_approved=true)  AS ever_approved,
        COUNT(*) FILTER (WHERE msg_sent=true)         AS ever_messaged,
        COUNT(*) FILTER (WHERE msg_replied=true)      AS ever_replied,
        COUNT(*) FILTER (WHERE positive_reply=true)   AS ever_positive,
        -- Data quality issues
        COUNT(*) FILTER (WHERE msg_sent=true AND (invite_approved IS NULL OR invite_approved=false))
                                                      AS messaged_without_approved,
        ROUND(
          COUNT(*) FILTER (WHERE invite_approved=true)::numeric /
          NULLIF(COUNT(*) FILTER (WHERE invite_sent=true),0)*100, 1
        ) AS real_approval_rate
      FROM contacts WHERE workspace_id=$1
    `, [wsId]);

    // Check enrollment vs contacts reply discrepancy
    const { rows: enrollRows } = await db.query(`
      SELECT COUNT(*) AS enroll_replied
      FROM enrollments e
      JOIN campaigns c ON c.id=e.campaign_id
      WHERE c.workspace_id=$1 AND e.status IN ('replied','positive_reply','done')
    `, [wsId]);

    const data = rows[0];
    const enrollReplied = parseInt(enrollRows[0]?.enroll_replied || 0);
    const contactsReplied = parseInt(data.ever_replied || 0);
    const replyGap = contactsReplied - enrollReplied;

    res.json({
      real_approval_rate:        parseFloat(data.real_approval_rate || 0),
      ever_invited:              parseInt(data.ever_invited || 0),
      ever_approved:             parseInt(data.ever_approved || 0),
      ever_messaged:             parseInt(data.ever_messaged || 0),
      ever_replied:              parseInt(data.ever_replied || 0),
      ever_positive:             parseInt(data.ever_positive || 0),
      direct_connections:        parseInt(data.messaged_without_approved || 0),
      replies_in_enrollments:    enrollReplied,
      replies_in_contacts:       contactsReplied,
      reply_gap:                 replyGap,
      warnings: [
        ...(parseInt(data.messaged_without_approved) > 0 ? [{
          type: 'info',
          msg: `${data.messaged_without_approved} direct connections bypassed invite step — inflates messages/approved ratio`
        }] : []),
        ...(replyGap > 0 ? [{
          type: 'warn',
          msg: `${replyGap} contacts replied but enrollment status not updated — reply count may be understated`
        }] : []),
      ]
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
