/**
 * followerInvites.js
 *
 * API for the "Invite to Follow Company Page" feature.
 *
 * POST /api/follower-invites/parse   — AI parses natural language → structured filters
 * POST /api/follower-invites/search  — query contacts matching filters, grouped by account
 * POST /api/follower-invites/send    — send follow invite to one contact (SSE stream)
 * GET  /api/follower-invites/stats   — how many sent today / total
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { sendCompanyFollowInvites, getMemberUrn } = require('../unipile');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── GET stats ────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE company_follow_invited = true) AS total_invited,
        COUNT(*) FILTER (WHERE company_follow_invited = true
          AND company_follow_invited_at >= date_trunc('day', NOW())) AS sent_today
      FROM contacts
      WHERE workspace_id = $1
    `, [workspace_id]);
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /parse — AI converts text → filters ──────────────────────────────────
router.post('/parse', async (req, res) => {
  const { workspace_id, text } = req.body;
  if (!workspace_id || !text) return res.status(400).json({ error: 'workspace_id + text required' });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: `You are a LinkedIn audience targeting expert. Convert natural language descriptions of target audiences into structured JSON search filters.

Return ONLY valid JSON, no markdown, no prose:
{
  "title_keywords": string[],        // job title keywords to match (e.g. ["CTO","VP Engineering","Head of"])
  "seniority": string[],             // levels: "C-suite","VP","Director","Manager","Senior","Junior","Individual Contributor"
  "industries": string[],            // industry keywords (e.g. ["SaaS","FinTech","Banking"])
  "company_size": string | null,     // "startup","SMB","enterprise","any"
  "exclude_titles": string[],        // titles to exclude
  "summary": string                  // 1-sentence plain English summary of who this targets
}`,
        messages: [{ role: 'user', content: `Parse this audience description:\n\n"${text}"` }],
      }),
    });

    const d = await r.json();
    const txt = (d.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    const json = txt.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const match = json.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'No JSON in AI response' });
    const filters = JSON.parse(match[0]);
    res.json({ filters });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /search — query contacts matching filters ────────────────────────────
router.post('/search', async (req, res) => {
  const { workspace_id, filters, include_already_invited = false } = req.body;
  if (!workspace_id || !filters) return res.status(400).json({ error: 'workspace_id + filters required' });

  try {
    // Get all accounts in workspace with company_page_urn
    const { rows: accounts } = await db.query(`
      SELECT account_id, display_name,
             settings->>'company_page_urn' AS company_page_urn
      FROM unipile_accounts
      WHERE workspace_id = $1
      ORDER BY display_name ASC
    `, [workspace_id]);

    if (!accounts.length) return res.json({ results: [], total: 0 });

    const { title_keywords = [], seniority = [], industries = [], exclude_titles = [] } = filters;

    // Build WHERE clause for title matching
    const titleConds = [];
    const titleParams = [];
    let pIdx = 2; // $1 = workspace_id, $2+ = title params

    if (title_keywords.length) {
      const tConds = title_keywords.map(kw => {
        titleParams.push(`%${kw.toLowerCase()}%`);
        return `LOWER(COALESCE(c.title,'')) LIKE $${pIdx++}`;
      });
      titleConds.push('(' + tConds.join(' OR ') + ')');
    }

    // Seniority keywords map
    const seniorityMap = {
      'C-suite':  ['ceo','cto','coo','cfo','ciso','cpo','cmo','chief'],
      'VP':       ['vp ','vice president','vice-president'],
      'Director': ['director'],
      'Manager':  ['manager'],
      'Senior':   ['senior','sr.','sr ','lead '],
      'Junior':   ['junior','jr.','jr '],
    };
    if (seniority.length) {
      const sConds = [];
      seniority.forEach(lvl => {
        (seniorityMap[lvl] || [lvl.toLowerCase()]).forEach(kw => {
          titleParams.push(`%${kw}%`);
          sConds.push(`LOWER(COALESCE(c.title,'')) LIKE $${pIdx++}`);
        });
      });
      if (sConds.length) titleConds.push('(' + sConds.join(' OR ') + ')');
    }

    // Exclude titles
    const excludeConds = [];
    exclude_titles.forEach(kw => {
      titleParams.push(`%${kw.toLowerCase()}%`);
      excludeConds.push(`LOWER(COALESCE(c.title,'')) NOT LIKE $${pIdx++}`);
    });

    const whereTitle = titleConds.length
      ? `AND (${titleConds.join(' OR ')})`
      : '';
    const whereExclude = excludeConds.length
      ? `AND ${excludeConds.join(' AND ')}`
      : '';
    const whereInvited = include_already_invited
      ? ''
      : 'AND (c.company_follow_invited IS NULL OR c.company_follow_invited = false)';

    // Query all connected contacts (all campaigns for this workspace)
    const allParams = [workspace_id, ...titleParams];
    const { rows: contacts } = await db.query(`
      SELECT DISTINCT
        c.id,
        c.first_name,
        c.last_name,
        c.title,
        c.company,
        c.li_profile_url,
        c.provider_id,
        c.member_urn,
        c.profile_data,
        c.company_follow_invited,
        camp.account_id
      FROM contacts c
      JOIN campaigns camp ON camp.id = c.campaign_id
      WHERE c.workspace_id = $1
        AND c.already_connected = true
        AND (c.member_urn IS NOT NULL OR c.provider_id LIKE 'ACo%')
        AND camp.account_id IS NOT NULL
        ${whereTitle}
        ${whereExclude}
        ${whereInvited}
      ORDER BY c.title ASC
      LIMIT 500
    `, allParams).catch(e => {
      console.error('[FollowerInvites] search query error:', e.message);
      return { rows: [] };
    });

    // Group by account
    const byAccount = {};
    for (const acc of accounts) {
      byAccount[acc.account_id] = {
        account_id: acc.account_id,
        display_name: acc.display_name,
        company_page_urn: acc.company_page_urn || null,
        contacts: [],
      };
    }

    // Also include a catch-all for contacts not matched to any account
    for (const c of contacts) {
      const accountId = c.account_id;
      if (byAccount[accountId]) {
        byAccount[accountId].contacts.push(c);
      } else {
        // Put in first account as fallback
        const firstKey = Object.keys(byAccount)[0];
        if (firstKey) byAccount[firstKey].contacts.push(c);
      }
    }

    // Sort contacts within each account by title
    const results = Object.values(byAccount)
      .filter(a => a.contacts.length > 0)
      .map(a => ({
        ...a,
        contacts: a.contacts.sort((x, y) => (x.title||'').localeCompare(y.title||'')),
      }));

    res.json({ results, total: contacts.length });
  } catch(e) {
    console.error('[FollowerInvites] search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /send — SSE stream, sends invites one by one ────────────────────────
router.post('/send', async (req, res) => {
  const { workspace_id, contact_ids } = req.body;
  if (!workspace_id || !contact_ids?.length) {
    return res.status(400).json({ error: 'workspace_id + contact_ids required' });
  }

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Get contacts with their campaign account_ids + workspace account company_page_urns
    const { rows: contacts } = await db.query(`
      SELECT c.id, c.first_name, c.last_name, c.title, c.company,
             c.provider_id, c.member_urn, c.profile_data,
             camp.account_id,
             ua.settings->>'company_page_urn' AS company_page_urn
      FROM contacts c
      JOIN campaigns camp ON camp.id = c.campaign_id
      JOIN unipile_accounts ua
        ON ua.account_id = camp.account_id
       AND ua.workspace_id = c.workspace_id
      WHERE c.id = ANY($1)
        AND c.workspace_id = $2
        AND ua.settings->>'company_page_urn' IS NOT NULL
        AND ua.settings->>'company_page_urn' != ''
    `, [contact_ids, workspace_id]);

    if (!contacts.length) {
      send('error', { message: 'No contacts found with valid company_page_urn accounts' });
      return res.end();
    }

    send('start', { total: contacts.length });

    let sent = 0, failed = 0;

    for (const contact of contacts) {
      const memberUrn = contact.member_urn || getMemberUrn(contact);
      const name = `${contact.first_name||''} ${contact.last_name||''}`.trim();

      if (!memberUrn) {
        send('skip', { contact_id: contact.id, name, reason: 'no_urn' });
        failed++;
        continue;
      }

      try {
        await sendCompanyFollowInvites(contact.account_id, contact.company_page_urn, [memberUrn]);

        await db.query(
          `UPDATE contacts SET company_follow_invited = true, company_follow_invited_at = NOW() WHERE id = $1`,
          [contact.id]
        );

        sent++;
        send('sent', { contact_id: contact.id, name, title: contact.title, company: contact.company, progress: sent + failed, total: contacts.length });

        // Human-like delay 2-4 seconds
        await sleep(2000 + Math.random() * 2000);

      } catch(err) {
        failed++;
        send('error_contact', { contact_id: contact.id, name, error: err.message });

        // On quota error stop entirely
        if (err.message?.includes('quota') || err.message?.includes('429')) {
          send('quota', { message: `Quota reached after ${sent} invites`, sent, failed });
          break;
        }
        await sleep(3000);
      }
    }

    send('complete', { sent, failed, total: contacts.length });
    res.end();
  } catch(e) {
    send('error', { message: e.message });
    res.end();
  }
});

module.exports = router;
