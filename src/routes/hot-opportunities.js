/**
 * Hot Opportunities Route
 *
 * GET  /api/hot-opportunities?workspace_id=&campaign_id=&page=
 *   Paginated list of company news items with AI-drafted outreach messages.
 *
 * GET  /api/hot-opportunities/contacts-osint?workspace_id=&campaign_id=
 *   Contacts enriched with OSINT data (hobbies, conversation starters).
 *
 * POST /api/hot-opportunities/scan-companies
 *   body: { workspace_id, campaign_id? }
 *   Triggers background company news scan via Claude web search.
 *
 * POST /api/hot-opportunities/scan-contacts
 *   body: { workspace_id, campaign_id? }
 *   Triggers background OSINT scan on up to 50 approved contacts.
 *
 * PATCH /api/hot-opportunities/drafts/:id
 *   body: { draft_message }
 *   Update message text for a draft.
 *
 * PATCH /api/hot-opportunities/drafts/:id/status
 *   body: { status }  — 'sent' | 'dismissed'
 *
 * POST /api/hot-opportunities/regenerate-draft
 *   body: { draft_id, workspace_id }
 *   Re-run AI for a single draft.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-20250514';

// ── Claude helpers ─────────────────────────────────────────────────────────

/**
 * Call Claude with the web_search tool enabled.
 * Returns concatenated text blocks from the response.
 */
async function claudeWebSearch(systemPrompt, userPrompt, maxTokens = 2000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

/**
 * Call Claude without tools (message drafting, JSON generation).
 */
async function claudeChat(systemPrompt, userPrompt, maxTokens = 600) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

/** Extract the first JSON object from a string. */
function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// ── Routes ────────────────────────────────────────────────────────────────

/**
 * GET /api/hot-opportunities?workspace_id=&campaign_id=&page=&limit=
 * Returns paginated news items, each with an array of pending drafts + contact info.
 */
router.get('/', async (req, res) => {
  try {
    const { workspace_id, campaign_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const conditions = ['n.workspace_id = $1'];
    const params     = [workspace_id];
    if (campaign_id) {
      conditions.push(`n.campaign_id = $${params.length + 1}`);
      params.push(campaign_id);
    }
    const where = conditions.join(' AND ');

    const { rows: totalRows } = await db.query(
      `SELECT COUNT(*) FROM company_news n WHERE ${where}`, params
    );
    const total = parseInt(totalRows[0].count);

    const { rows: news } = await db.query(
      `SELECT
         n.*,
         COALESCE(
           json_agg(
             json_build_object(
               'draft_id',       d.id,
               'contact_id',     d.contact_id,
               'draft_message',  d.draft_message,
               'status',         d.status,
               'first_name',     c.first_name,
               'last_name',      c.last_name,
               'title',          c.title,
               'company',        c.company,
               'li_profile_url', c.li_profile_url
             )
           ) FILTER (WHERE d.id IS NOT NULL),
           '[]'
         ) AS drafts
       FROM company_news n
       LEFT JOIN opportunity_drafts d ON d.news_id = n.id AND d.status = 'pending'
       LEFT JOIN contacts c ON c.id = d.contact_id
       WHERE ${where}
       GROUP BY n.id
       ORDER BY n.fetched_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({ items: news, total, page, limit, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error('[HotOpp] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/hot-opportunities/contacts-osint?workspace_id=&campaign_id=
 * Returns contacts that have been enriched with OSINT data.
 */
router.get('/contacts-osint', async (req, res) => {
  try {
    const { workspace_id, campaign_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const conditions = ['c.workspace_id = $1', 'c.osint_summary IS NOT NULL'];
    const params     = [workspace_id];
    if (campaign_id) {
      conditions.push(`c.campaign_id = $${params.length + 1}`);
      params.push(campaign_id);
    }
    const where = conditions.join(' AND ');

    const { rows } = await db.query(
      `SELECT id, first_name, last_name, title, company, li_profile_url,
              osint_summary, osint_hobby, osint_reason,
              osint_source_urls, osint_confidence, osint_last_run
       FROM contacts c WHERE ${where}
       ORDER BY osint_confidence DESC NULLS LAST, osint_last_run DESC NULLS LAST
       LIMIT 200`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/hot-opportunities/scan-companies
 * body: { workspace_id, campaign_id? }
 */
router.post('/scan-companies', async (req, res) => {
  try {
    const { workspace_id, campaign_id } = req.body;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
    scanCompanyNews(parseInt(workspace_id), campaign_id ? parseInt(campaign_id) : null)
      .catch(err => console.error('[HotOpp] Company scan crashed:', err.message));
    res.json({ status: 'started', workspace_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/hot-opportunities/scan-contacts
 * body: { workspace_id, campaign_id? }
 */
router.post('/scan-contacts', async (req, res) => {
  try {
    const { workspace_id, campaign_id } = req.body;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
    scanContactOsint(parseInt(workspace_id), campaign_id ? parseInt(campaign_id) : null)
      .catch(err => console.error('[HotOpp] Contact OSINT crashed:', err.message));
    res.json({ status: 'started', workspace_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/hot-opportunities/drafts/:id
 * body: { draft_message }
 */
router.patch('/drafts/:id', async (req, res) => {
  try {
    const { draft_message } = req.body;
    if (!draft_message?.trim()) return res.status(400).json({ error: 'draft_message required' });
    const { rows } = await db.query(
      'UPDATE opportunity_drafts SET draft_message=$1 WHERE id=$2 RETURNING *',
      [draft_message.trim(), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Draft not found' });
    res.json({ success: true, draft: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/hot-opportunities/drafts/:id/status
 * body: { status }  — 'sent' | 'dismissed'
 */
router.patch('/drafts/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['sent', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'status must be "sent" or "dismissed"' });
    }
    const { rows } = await db.query(
      'UPDATE opportunity_drafts SET status=$1 WHERE id=$2 RETURNING id',
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Draft not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/hot-opportunities/regenerate-draft
 * body: { draft_id }
 * Regenerates the AI message for an existing draft.
 */
router.post('/regenerate-draft', async (req, res) => {
  try {
    const { draft_id } = req.body;
    if (!draft_id) return res.status(400).json({ error: 'draft_id required' });

    const { rows } = await db.query(
      `SELECT d.*, n.headline, n.summary, n.url, n.source, n.company_name,
              c.first_name, c.last_name, c.title
       FROM opportunity_drafts d
       JOIN company_news n ON n.id = d.news_id
       JOIN contacts    c ON c.id = d.contact_id
       WHERE d.id = $1`,
      [draft_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Draft not found' });
    const d = rows[0];

    const newMsg = await generateDraftMessage({
      contactName:  `${d.first_name || ''} ${d.last_name || ''}`.trim(),
      contactTitle: d.title,
      company:      d.company_name,
      headline:     d.headline,
      summary:      d.summary,
      source:       d.source,
    });

    await db.query('UPDATE opportunity_drafts SET draft_message=$1 WHERE id=$2', [newMsg, draft_id]);
    res.json({ success: true, draft_message: newMsg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Background job: company news scan ─────────────────────────────────────

// Preferred news sources split by region
const SOURCES_IL  = 'calcalist.co.il OR themarker.com OR globes.co.il OR no-camels.com OR geektime.co.il OR techcrunch.com';
const SOURCES_INT = 'techcrunch.com OR bloomberg.com OR reuters.com OR businessinsider.com OR forbes.com OR wired.com';

async function scanCompanyNews(workspaceId, campaignId) {
  console.log(`[HotOpp] Company news scan started — workspace=${workspaceId} campaign=${campaignId}`);

  const q = campaignId
    ? `SELECT DISTINCT ON (company) company, location, campaign_id
       FROM contacts WHERE workspace_id=$1 AND campaign_id=$2
         AND company IS NOT NULL AND company <> '' LIMIT 30`
    : `SELECT DISTINCT ON (company) company, location, campaign_id
       FROM contacts WHERE workspace_id=$1
         AND company IS NOT NULL AND company <> '' LIMIT 30`;
  const params = campaignId ? [workspaceId, campaignId] : [workspaceId];

  const { rows: companies } = await db.query(q, params);
  console.log(`[HotOpp] Found ${companies.length} unique companies to scan`);

  for (const row of companies) {
    try {
      await scanOneCompany(row.company, row.location, row.campaign_id || campaignId, workspaceId);
    } catch (err) {
      console.warn(`[HotOpp] scanOneCompany failed for "${row.company}":`, err.message);
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  console.log(`[HotOpp] Company news scan complete`);
}

async function scanOneCompany(companyName, location, campaignId, workspaceId) {
  const isIsraeli = location && (
    /israel|tel.?aviv|ישראל/i.test(location)
  );
  const sources     = isIsraeli ? SOURCES_IL : SOURCES_INT;
  const locationHint = location ? ` (${location})` : '';

  const systemPrompt = `You are a business intelligence researcher.
Search for recent news about a company (last 30 days only).
Return ONLY this JSON, no markdown:
{
  "news": [
    {
      "headline": "exact headline from article",
      "url": "full article URL",
      "source": "publication name",
      "published_at": "YYYY-MM-DD or null",
      "summary": "2 sentence summary of the news and its business significance"
    }
  ]
}
Max 3 items. If no relevant news found, return {"news": []}.
Focus on: funding rounds, product launches, hiring announcements, partnerships, leadership changes, revenue milestones.`;

  const userPrompt = `Find recent business news (last 30 days) about: "${companyName}"${locationHint}
Preferred sources: ${sources}
Only include news from the last 30 days. Verify each item is actually about this specific company.`;

  const resultText = await claudeWebSearch(systemPrompt, userPrompt, 1500);
  const parsed     = extractJson(resultText);
  if (!parsed?.news?.length) return;

  for (const item of parsed.news) {
    if (!item.headline || !item.url) continue;

    let newsId;
    try {
      const { rows } = await db.query(
        `INSERT INTO company_news
           (campaign_id, workspace_id, company_name, headline, url, source, published_at, summary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (campaign_id, url) DO UPDATE
           SET headline=$4, summary=$8, fetched_at=NOW()
         RETURNING id`,
        [
          campaignId, workspaceId, companyName,
          item.headline, item.url, item.source || null,
          item.published_at || null, item.summary || null,
        ]
      );
      newsId = rows[0]?.id;
    } catch (e) {
      console.warn('[HotOpp] news insert failed:', e.message);
      continue;
    }
    if (!newsId) continue;

    // Find up to 5 contacts from this company
    const cQ = campaignId
      ? `SELECT id, first_name, last_name, title FROM contacts
         WHERE workspace_id=$1 AND campaign_id=$2 AND company ILIKE $3 LIMIT 5`
      : `SELECT id, first_name, last_name, title FROM contacts
         WHERE workspace_id=$1 AND company ILIKE $2 LIMIT 5`;
    const cP = campaignId
      ? [workspaceId, campaignId, `%${companyName}%`]
      : [workspaceId, `%${companyName}%`];
    const { rows: contacts } = await db.query(cQ, cP);

    for (const contact of contacts) {
      try {
        const draft = await generateDraftMessage({
          contactName:  `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
          contactTitle: contact.title,
          company:      companyName,
          headline:     item.headline,
          summary:      item.summary,
          source:       item.source,
        });
        await db.query(
          `INSERT INTO opportunity_drafts (news_id, contact_id, workspace_id, draft_message)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (news_id, contact_id) DO NOTHING`,
          [newsId, contact.id, workspaceId, draft]
        );
      } catch (e) {
        console.warn(`[HotOpp] Draft gen failed (contact ${contact.id}):`, e.message);
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

async function generateDraftMessage({ contactName, contactTitle, company, headline, summary, source }) {
  const firstName = (contactName || 'there').split(' ')[0];
  const msg = await claudeChat(
    `You are an expert B2B LinkedIn outreach writer.
Rules:
- Start with "Hi [FirstName],"
- Reference the company news naturally, do NOT paste the headline verbatim
- Be concise: 2-3 sentences total, under 280 characters
- End with a brief, open-ended question or observation
- Sound human and genuine, not like a template
- Return ONLY the message text, nothing else`,
    `Contact: ${contactName} (${contactTitle || 'professional'} at ${company})
News headline: ${headline}
News summary: ${summary || ''}
Source: ${source || ''}

Write a LinkedIn message to ${firstName} referencing this news.`,
    400
  );
  return msg.trim();
}

// ── Background job: contact OSINT ─────────────────────────────────────────

async function scanContactOsint(workspaceId, campaignId) {
  console.log(`[HotOpp] Contact OSINT scan started — workspace=${workspaceId}`);

  const q = campaignId
    ? `SELECT id, first_name, last_name, company, title, location FROM contacts
       WHERE workspace_id=$1 AND campaign_id=$2
         AND invite_approved = TRUE
         AND (osint_last_run IS NULL OR osint_last_run < CURRENT_DATE - INTERVAL '30 days')
       ORDER BY osint_last_run ASC NULLS FIRST LIMIT 50`
    : `SELECT id, first_name, last_name, company, title, location FROM contacts
       WHERE workspace_id=$1
         AND invite_approved = TRUE
         AND (osint_last_run IS NULL OR osint_last_run < CURRENT_DATE - INTERVAL '30 days')
       ORDER BY osint_last_run ASC NULLS FIRST LIMIT 50`;
  const params = campaignId ? [workspaceId, campaignId] : [workspaceId];

  const { rows: contacts } = await db.query(q, params);
  console.log(`[HotOpp] OSINT targets: ${contacts.length} contacts`);

  for (const contact of contacts) {
    try {
      await osintOneContact(contact);
    } catch (err) {
      console.warn(`[HotOpp] OSINT failed (contact ${contact.id}):`, err.message);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log(`[HotOpp] Contact OSINT scan complete`);
}

async function osintOneContact(contact) {
  const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
  const company  = contact.company || '';
  const title    = contact.title   || '';
  const location = contact.location || '';

  const systemPrompt = `You are an OSINT researcher performing professional background research for legitimate B2B outreach.
Search for ONLY publicly available, verifiable information about a business professional.
Focus on: professional accomplishments, conference talks, published articles, podcasts, interviews, open-source contributions, volunteering, hobbies mentioned publicly.
NEVER invent or guess information. If nothing specific is found, return low confidence.
Return ONLY this JSON, no markdown:
{
  "summary": "2 sentence summary of verified professional background",
  "hobby": "specific verified hobby or personal interest, or null if not found",
  "reason": "1 specific conversation starter based on something verifiable you found — not generic",
  "confidence": <1-5>,
  "sources": ["url1", "url2"]
}
Confidence: 5=multiple reliable sources, 4=one reliable source, 3=one indirect source, 2=very weak signal, 1=nothing found`;

  const userPrompt = `Research this professional for B2B outreach context:
Name: ${fullName}
Title: ${title}
Company: ${company}
Location: ${location}

Search for:
1. LinkedIn public profile or posts
2. Conference talks, webinars, podcasts they appeared in
3. Published articles, interviews, press mentions
4. Any hobbies or personal interests mentioned publicly (sports, books, volunteering, etc.)
5. Recent professional news or achievements

Only include verified, sourced information.`;

  const resultText = await claudeWebSearch(systemPrompt, userPrompt, 1500);
  const parsed     = extractJson(resultText);
  if (!parsed) return;

  await db.query(
    `UPDATE contacts SET
       osint_summary     = $1,
       osint_hobby       = $2,
       osint_reason      = $3,
       osint_source_urls = $4,
       osint_confidence  = $5,
       osint_last_run    = CURRENT_DATE
     WHERE id = $6`,
    [
      parsed.summary    || null,
      parsed.hobby      || null,
      parsed.reason     || null,
      JSON.stringify(parsed.sources || []),
      parsed.confidence || null,
      contact.id,
    ]
  );
  console.log(`[HotOpp] OSINT done: ${fullName} (confidence=${parsed.confidence})`);
}

module.exports = router;
