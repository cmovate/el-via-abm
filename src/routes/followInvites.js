/**
 * followInvites.js — Company Page Follow Invites
 *
 * POST /api/follow-invites/parse   — AI parses free text → LinkedIn search params
 * POST /api/follow-invites/search  — LinkedIn search (live) + DB fallback on 429
 * POST /api/follow-invites/send    — SSE stream, sends follow invites one by one
 * GET  /api/follow-invites/stats   — sent_today, total_invited, confirmed_followers
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { sendCompanyFollowInvites } = require('../unipile');

// Build the full LinkedIn member URN needed for company follow invites
function getMemberUrn(contact) {
  let pd = {};
  try { pd = typeof contact.profile_data === 'string' ? JSON.parse(contact.profile_data) : (contact.profile_data || {}); } catch {}
  if (pd.member_urn  && pd.member_urn.startsWith('urn:li:'))  return pd.member_urn;
  if (contact.member_urn && contact.member_urn.startsWith('urn:li:')) return contact.member_urn;
  if (pd.provider_id && pd.provider_id.startsWith('ACo'))     return `urn:li:fsd_profile:${pd.provider_id}`;
  if (contact.provider_id && contact.provider_id.startsWith('ACo')) return `urn:li:fsd_profile:${contact.provider_id}`;
  return null;
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const UNIPILE_DSN       = process.env.UNIPILE_DSN;
const UNIPILE_API_KEY   = process.env.UNIPILE_API_KEY;

// ── GET /stats ────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE c.company_follow_invited = true) AS total_invited,
        COUNT(*) FILTER (WHERE c.company_follow_invited = true
          AND c.company_follow_invited_at >= date_trunc('day', NOW())) AS sent_today,
        COUNT(*) FILTER (WHERE c.company_follow_confirmed = true) AS confirmed_followers
      FROM contacts c
      JOIN campaigns camp ON camp.id = c.campaign_id
      WHERE camp.workspace_id = $1
    `, [workspace_id]);
    res.json({ ok: true, ...rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /parse — AI → LinkedIn search keywords ───────────────────────────────
router.post('/parse', async (req, res) => {
  const { text, workspace_id } = req.body;
  if (!text || !workspace_id) return res.status(400).json({ error: 'text + workspace_id required' });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        system: `Convert a persona description into a LinkedIn people search query string.
Return ONLY valid JSON: { "keywords": string, "title_keywords": string[], "summary": string }
- keywords: LinkedIn search string, e.g. "VP Marketing OR CMO OR Director of Marketing"
- title_keywords: array of individual words/phrases to match against job titles in our DB
- summary: one sentence describing the target (English)`,
        messages: [{ role: 'user', content: `Persona: "${text}"` }],
      }),
    });
    const data = await r.json();
    const raw  = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    const match = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim().match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'AI parse failed' });
    res.json({ ok: true, criteria: JSON.parse(match[0]) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /search — LinkedIn live search + DB fallback ─────────────────────────
router.post('/search', async (req, res) => {
  const { workspace_id, keywords, title_keywords } = req.body;
  if (!workspace_id || !keywords) return res.status(400).json({ error: 'workspace_id + keywords required' });

  try {
    const { rows: accounts } = await db.query(
      `SELECT account_id, display_name, settings FROM unipile_accounts WHERE workspace_id=$1 ORDER BY display_name`,
      [workspace_id]
    );
    if (!accounts.length) return res.json({ ok: true, by_account: [], total: 0, warning: 'No accounts in workspace' });

    // Read workspace company page URN once (new architecture)
    // canSend = true for ALL accounts if workspace has at least one company page configured
    const { rows: wsPages } = await db.query(
      `SELECT company_page_urn FROM workspace_company_pages WHERE workspace_id=$1 LIMIT 1`,
      [workspace_id]
    ).catch(() => ({ rows: [] }));
    const workspaceHasCompanyPage = wsPages.length > 0;

    const byAccount = [];
    let anyLiveSuccess = false;
    let allRateLimited = true;

    for (const acct of accounts) {
      const s = typeof acct.settings === 'string' ? JSON.parse(acct.settings||'{}') : (acct.settings||{});
      // canSend = true if workspace has a page configured (preferred)
      // OR if this specific account has a legacy company_page_urn in settings
      const canSend = workspaceHasCompanyPage || !!s.company_page_urn;

      let contacts = [];
      let source = 'db';
      let searchError = null;
      let totalLinkedIn = 0;

      // ── Attempt 1: Live LinkedIn search ──────────────────────────────────
      if (UNIPILE_DSN && UNIPILE_API_KEY) {
        try {
          const searchResp = await fetch(
            `${UNIPILE_DSN}/api/v1/linkedin/search?account_id=${encodeURIComponent(acct.account_id)}`,
            {
              method: 'POST',
              headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Content-Type': 'application/json', 'accept': 'application/json' },
              body: JSON.stringify({ api: 'classic', category: 'people', keywords, limit: 100 }),
            }
          );

          if (searchResp.ok) {
            const data = await searchResp.json();
            const items = Array.isArray(data?.items) ? data.items : [];
            totalLinkedIn = data?.paging?.total_count || items.length;

            // Check DB for already-invited status
            const liUrls = items.map(p => p.public_profile_url||p.li_url||'').filter(Boolean);
            let invitedSet = new Set(), followingSet = new Set();
            if (liUrls.length) {
              const { rows: dbRows } = await db.query(
                `SELECT c.li_profile_url,
                   (c.company_follow_invited=true) AS invited,
                   (c.company_follow_confirmed=true) AS following
                 FROM contacts c JOIN campaigns camp ON camp.id=c.campaign_id
                 WHERE camp.workspace_id=$1 AND c.li_profile_url=ANY($2)`,
                [workspace_id, liUrls]
              ).catch(()=>({rows:[]}));
              dbRows.forEach(r=>{ if(r.invited) invitedSet.add(r.li_profile_url); if(r.following) followingSet.add(r.li_profile_url); });
            }

            contacts = items.map(p => {
              const liUrl = p.public_profile_url||p.li_url||'';
              const providerId = p.member_id||p.provider_id||
                p.entity_urn?.match(/urn:li:fsd_profile:([^,)]+)/)?.[1]||
                p.urn?.match(/urn:li:member:(\d+)/)?.[1]||null;
              return {
                id: providerId||liUrl,
                first_name: p.first_name||p.firstName||'',
                last_name:  p.last_name||p.lastName||'',
                title:      p.headline||p.title||'',
                company:    p.company||p.current_company?.name||'',
                li_profile_url: liUrl,
                provider_id: providerId,
                account_id: acct.account_id,
                already_invited: invitedSet.has(liUrl),
                already_following: followingSet.has(liUrl),
                is_connected: true,
              };
            }).filter(c=>c.first_name||c.last_name||c.title);

            source = 'linkedin';
            anyLiveSuccess = true;
            allRateLimited = false;

          } else if (searchResp.status === 429) {
            // Rate limited — will fall back to DB
            searchError = 'rate_limited';
          } else {
            searchError = `linkedin_${searchResp.status}`;
            allRateLimited = false;
          }
        } catch(e) {
          searchError = e.message;
          allRateLimited = false;
        }
      }

      // ── Fallback: DB contacts when rate-limited ───────────────────────────
      if (source === 'db') {
        const kws = title_keywords?.length ? title_keywords : keywords.split(/\s+OR\s+/i).map(s=>s.trim());
        const includeParams = kws.map(k=>`%${k}%`);
        const includeConditions = kws.map((_,i)=>`c.title ILIKE $${i+2}`);

        // Get campaign IDs for this account
        const { rows: campRows } = await db.query(
          `SELECT id FROM campaigns WHERE workspace_id=$1 AND account_id=$2 AND status!='deleted'`,
          [workspace_id, acct.account_id]
        );
        const campIds = campRows.map(c=>c.id);

        if (campIds.length && includeConditions.length) {
          const titleFilter = `AND (c.title IS NULL OR c.title='' OR (${includeConditions.join(' OR ')}))`;
          const { rows: dbContacts } = await db.query(
            `SELECT DISTINCT ON (c.li_profile_url)
               c.id, c.first_name, c.last_name, c.title, c.company,
               c.li_profile_url, c.provider_id, c.member_urn, c.profile_data,
               (c.company_follow_invited=true) AS already_invited,
               (c.company_follow_confirmed=true) AS already_following,
               (c.invite_approved=true OR c.already_connected=true) AS is_connected
             FROM contacts c
             WHERE c.campaign_id=ANY($1::int[])
               AND c.li_profile_url IS NOT NULL
               AND (c.member_urn IS NOT NULL OR c.provider_id LIKE 'ACo%')
               AND c.invite_sent=true
               ${titleFilter}
             ORDER BY c.li_profile_url, c.id
             LIMIT 500`,
            [campIds, ...includeParams]
          ).catch(()=>({rows:[]}));

          contacts = dbContacts.map(c=>{
            const memberUrn = getMemberUrn(c);
            return {
              id: memberUrn||c.li_profile_url,
              first_name: c.first_name||'',
              last_name:  c.last_name||'',
              title:      c.title||'',
              company:    c.company||'',
              li_profile_url: c.li_profile_url,
              provider_id: memberUrn,   // ← full urn:li:fsd_profile:ACoXXX
              account_id: acct.account_id,
              already_invited: c.already_invited,
              already_following: c.already_following,
              is_connected: c.is_connected,
            };
          }).filter(c => c.provider_id);  // only keep contacts with valid URN
        }
      }

      await new Promise(r=>setTimeout(r, 300));

      // Resolve company_page_urn: workspace page takes precedence over account setting
      const resolvedPageUrn = wsPages[0]?.company_page_urn || s.company_page_urn || null;

      byAccount.push({
        account_id:   acct.account_id,
        display_name: acct.display_name,
        company_page_urn: resolvedPageUrn,
        can_send:     canSend,
        contacts,
        total_linkedin: totalLinkedIn,
        source,         // 'linkedin' | 'db'
        search_error: searchError,
      });
    }

    const total = byAccount.reduce((s,a)=>s+a.contacts.length, 0);
    const warning = allRateLimited
      ? 'LinkedIn people search is rate-limited right now (your accounts are busy with other automation). Showing results from your local database instead. Try again in a few minutes for live LinkedIn results.'
      : null;

    res.json({ ok: true, by_account: byAccount, total, warning, source: anyLiveSuccess ? 'linkedin' : 'db' });

  } catch(e) {
    console.error('[follow-invites/search]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /send — SSE stream, one by one ───────────────────────────────────────
// Uses workspace-level company_page_urn (not per-account setting)
router.post('/send', async (req, res) => {
  const { workspace_id, invites, company_page_urn: requestedUrn } = req.body;
  if (!workspace_id || !invites?.length) return res.status(400).json({ error: 'workspace_id + invites required' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const emit = (evt, data) => res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);

  let sent = 0, failed = 0;
  try {
    // Resolve which company page URN to use:
    // 1. requestedUrn from frontend (user-selected)
    // 2. workspace default company page
    // 3. first company page in workspace
    // 4. fallback to any account's legacy company_page_urn
    let companyPageUrn = requestedUrn || null;

    if (!companyPageUrn) {
      const { rows: pages } = await db.query(
        `SELECT company_page_urn FROM workspace_company_pages
         WHERE workspace_id=$1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
        [workspace_id]
      );
      if (pages.length) companyPageUrn = pages[0].company_page_urn;
    }

    if (!companyPageUrn) {
      // Legacy fallback: check account settings
      const { rows: accts } = await db.query(
        `SELECT settings->>'company_page_urn' AS urn FROM unipile_accounts
         WHERE workspace_id=$1 AND settings->>'company_page_urn' IS NOT NULL
           AND settings->>'company_page_urn' != '' LIMIT 1`,
        [workspace_id]
      );
      if (accts.length) companyPageUrn = accts[0].urn;
    }

    if (!companyPageUrn) {
      emit('fatal', { error: 'No company page configured. Go to Settings → Company Pages to add one.' });
      return res.end();
    }

    // Get any usable account for sending (any account in workspace works)
    const { rows: accountRows } = await db.query(
      `SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 10`,
      [workspace_id]
    );
    if (!accountRows.length) {
      emit('fatal', { error: 'No LinkedIn accounts in workspace' });
      return res.end();
    }

    // Map account_id → account object for round-robin (distribute load)
    const accountIds = accountRows.map(r => r.account_id);

    emit('start', { total: invites.length, company_page_urn: companyPageUrn });

    for (let i = 0; i < invites.length; i++) {
      const inv = invites[i];
      try {
        if (!inv.provider_id) {
          emit('skip', { id: inv.id, name: inv.name, reason: 'no_provider_id' }); failed++; continue;
        }

        // Try accounts in order — prefer the contact's own account first,
        // then try all others. Some accounts may not be company page admins.
        const orderedAccounts = [
          inv.account_id,
          ...accountIds.filter(id => id !== inv.account_id)
        ].filter(Boolean);

        let lastErr = null;
        let succeeded = false;
        for (const accountId of orderedAccounts) {
          try {
            await sendCompanyFollowInvites(accountId, companyPageUrn, [inv.provider_id]);
            succeeded = true;
            break;
          } catch(e) {
            lastErr = e;
            // Only try next account on 400 (permission/auth error)
            // For other errors (rate limit etc), stop
            if (!e.message?.includes('400')) break;
            await new Promise(r => setTimeout(r, 500));
          }
        }
        if (!succeeded) throw lastErr || new Error('All accounts failed');

        // Mark in DB best-effort
        if (inv.li_profile_url) {
          await db.query(
            `UPDATE contacts SET company_follow_invited=true, company_follow_invited_at=NOW()
             WHERE li_profile_url=$1 AND campaign_id IN (SELECT id FROM campaigns WHERE workspace_id=$2)`,
            [inv.li_profile_url, workspace_id]
          ).catch(()=>{});
        }

        sent++;
        emit('progress', { id: inv.id, name: inv.name, sent, failed, total: invites.length });
        await new Promise(r => setTimeout(r, 2000));

      } catch(e) {
        failed++;
        emit('error', { id: inv.id, name: inv.name, error: e.message });
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    emit('complete', { sent, failed, total: invites.length });
  } catch(e) {
    emit('fatal', { error: e.message });
  }
  res.end();
});


module.exports = router;
