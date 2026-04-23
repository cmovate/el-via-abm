/**
 * Brand Intelligence API
 * 
 * GET  /api/brand-intelligence?workspace_id=   — get latest analysis
 * POST /api/brand-intelligence/scan             — trigger fresh scan (uses Claude + web_search)
 * GET  /api/brand-intelligence/competitors?workspace_id=  — list competitors
 * POST /api/brand-intelligence/competitors      — add competitor
 * DELETE /api/brand-intelligence/competitors/:id — remove competitor
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ── Schema ───────────────────────────────────────────────────────────────────
let _ready = false;
async function ensureSchema() {
  if (_ready) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS brand_analysis (
      id           SERIAL PRIMARY KEY,
      workspace_id INT NOT NULL,
      company_name TEXT NOT NULL,
      scanned_at   TIMESTAMPTZ DEFAULT NOW(),
      analysis     JSONB NOT NULL,
      UNIQUE(workspace_id)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS brand_competitors (
      id           SERIAL PRIMARY KEY,
      workspace_id INT NOT NULL,
      name         TEXT NOT NULL,
      added_at     TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(workspace_id, name)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS brand_context (
      workspace_id    INT PRIMARY KEY,
      description     TEXT,
      website         TEXT,
      known_competitors TEXT,
      territory       TEXT DEFAULT 'global',
      documents       JSONB DEFAULT '[]',
      website_text    TEXT,
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS brand_competitor_people (
      id           SERIAL PRIMARY KEY,
      workspace_id INT NOT NULL,
      comp_name    TEXT NOT NULL,
      person_name  TEXT NOT NULL,
      title        TEXT,
      li_url       TEXT,
      online_score INT DEFAULT 0,
      sentiment    TEXT DEFAULT 'neutral',
      key_topic    TEXT,
      found_at     TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(workspace_id, comp_name, person_name)
    )
  `);
  _ready = true;
}

// ── GET latest analysis ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  await ensureSchema();
  try {
    const { rows } = await db.query(
      `SELECT * FROM brand_analysis WHERE workspace_id=$1`,
      [workspace_id]
    );
    if (!rows.length) return res.json({ analysis: null });
    res.json({ analysis: rows[0].analysis, scanned_at: rows[0].scanned_at, company_name: rows[0].company_name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET competitors ───────────────────────────────────────────────────────────
router.get('/competitors', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  await ensureSchema();
  try {
    const { rows } = await db.query(
      `SELECT * FROM brand_competitors WHERE workspace_id=$1 ORDER BY added_at ASC`,
      [workspace_id]
    );
    res.json({ competitors: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST add competitor ───────────────────────────────────────────────────────
router.post('/competitors', async (req, res) => {
  const { workspace_id, name } = req.body;
  if (!workspace_id || !name) return res.status(400).json({ error: 'workspace_id + name required' });
  await ensureSchema();
  try {
    const { rows } = await db.query(
      `INSERT INTO brand_competitors (workspace_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *`,
      [workspace_id, name.trim()]
    );
    res.json({ competitor: rows[0] || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE competitor ─────────────────────────────────────────────────────────
router.delete('/competitors/:id', async (req, res) => {
  const { workspace_id } = req.query;
  await ensureSchema();
  try {
    await db.query(`DELETE FROM brand_competitors WHERE id=$1 AND workspace_id=$2`, [req.params.id, workspace_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /scan — AI-powered brand analysis ────────────────────────────────────
router.post('/scan', async (req, res) => {
  const { workspace_id, company_name } = req.body;
  if (!workspace_id || !company_name) return res.status(400).json({ error: 'workspace_id + company_name required' });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  await ensureSchema();

  // Get existing competitors
  const { rows: compRows } = await db.query(
    `SELECT name FROM brand_competitors WHERE workspace_id=$1`, [workspace_id]
  );
  const existingCompetitors = compRows.map(r => r.name);

  // Get account names (people) from workspace
  const { rows: acctRows } = await db.query(
    `SELECT display_name, settings FROM unipile_accounts WHERE workspace_id=$1 LIMIT 5`, [workspace_id]
  );
  const people = acctRows.map(a => a.display_name).filter(Boolean);

  // Get company context
  const { rows: ctxRows } = await db.query(
    `SELECT * FROM brand_context WHERE workspace_id=$1`, [workspace_id]
  );
  const ctx = ctxRows[0] || null;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('status', { message: 'Searching the web for brand mentions...' });

    const systemPrompt = `You are an elite brand intelligence analyst. Research a company's online presence and produce a comprehensive, structured JSON analysis.

CRITICAL: Return ONLY valid JSON. No markdown, no prose outside JSON. The JSON must match this exact schema:

{
  "company_name": string,
  "executive_summary": string (2-3 sharp sentences),
  "brand_health_score": number (0-100),
  "momentum": "rising" | "stable" | "declining",
  "momentum_delta": number (-20 to +20),
  "sentiment": {
    "positive": number (0-100),
    "neutral": number (0-100),
    "negative": number (0-100)
  },
  "narrative_themes": [
    {
      "theme": string,
      "sentiment": "positive" | "neutral" | "negative",
      "strength": number (0-100),
      "evidence": string (1 sentence, NO direct quotes),
      "channel": string
    }
  ],
  "people_reputation": [
    {
      "name": string,
      "title": string,
      "online_presence_score": number (0-100),
      "sentiment": "positive" | "neutral" | "negative",
      "key_topic": string,
      "mentions_estimate": "low" | "medium" | "high",
      "platform": string,
      "li_url": string or null
    }
  ],
  "competitors": [
    {
      "name": string,
      "brand_health_score": number (0-100),
      "sentiment_score": number (0-100),
      "online_strength": number (0-100),
      "key_narrative": string,
      "vs_subject": "stronger" | "weaker" | "comparable",
      "territory_presence": string (where they are strongest),
      "key_people": [
        {
          "name": string,
          "title": string,
          "online_score": number (0-100),
          "sentiment": "positive" | "neutral" | "negative",
          "key_topic": string,
          "platform": string,
          "li_url": string or null
        }
      ]
    }
  ],
  "trend_signals": [
    {
      "signal": string,
      "direction": "positive" | "negative" | "neutral",
      "urgency": "high" | "medium" | "low"
    }
  ],
  "data_sources": string[]
}`;

    // Build context for AI
    const ctxParts = [];
    if (ctx?.description) ctxParts.push(`COMPANY DESCRIPTION:\n${ctx.description}`);
    if (ctx?.website_text) ctxParts.push(`WEBSITE CONTENT:\n${ctx.website_text.slice(0,2000)}`);
    if (ctx?.documents?.length) {
      ctx.documents.forEach(d => ctxParts.push(`DOCUMENT "${d.name}":\n${d.content.slice(0,1500)}`));
    }
    const territory = ctx?.territory || 'global';
    const territoryNote = territory === 'global'
      ? 'Analyze global online presence across all markets.'
      : `Focus on these territories: ${territory}.`;

    // Prefer fresh user-provided list over DB (which may have stale AI-detected ones)
    const freshComps = ctx?.known_competitors
      ? ctx.known_competitors.split(/[,\n]+/).map(s=>s.trim()).filter(Boolean)
      : existingCompetitors;
    const knownCompsList = freshComps.length
      ? `Known competitors to analyze (include ALL of these + find more if relevant): ${freshComps.join(', ')}`
      : 'Identify main competitors from company description and context.';
    const peopleList = people.length ? `Key people at this company: ${people.join(', ')}` : 'Search for key executives at this company.';

    const companyLabel = ctx?.description
      ? `"${company_name}" (${ctx.description.slice(0, 100)})`
      : `"${company_name}"`;
    const userPrompt = `Research and analyze brand intelligence for: ${companyLabel}"

${ctxParts.length ? `--- COMPANY CONTEXT ---\n${ctxParts.join('\n\n')}\n---` : ''}

TERRITORY: ${territoryNote}
${peopleList}
${knownCompsList}

Instructions:
1. Search company name + description for accurate mentions
2. Search each key person individually (LinkedIn, news, X/Twitter)
3. For each competitor: search brand + 2-3 key executives/founders individually
4. Sentiment: reviews on G2, Clutch, Glassdoor, Reddit, news
5. Include territory-specific sources where relevant

Return ONLY the JSON object.`;

    // Call Claude with web_search
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
        }],
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      send('error', { message: 'API error: ' + err.slice(0, 200) });
      return res.end();
    }

    const data = await response.json();
    
    // Extract text from content blocks
    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    const fullText = textBlocks.map(b => b.text).join('');

    // Parse JSON from response
    let analysis;
    try {
      // Try direct parse first
      const cleaned = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      // Find JSON object
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      analysis = JSON.parse(jsonMatch[0]);
    } catch(e) {
      send('error', { message: 'Failed to parse AI response: ' + e.message });
      return res.end();
    }

    // Save to DB
    await db.query(
      `INSERT INTO brand_analysis (workspace_id, company_name, analysis)
       VALUES ($1,$2,$3)
       ON CONFLICT (workspace_id) DO UPDATE SET
         company_name=$2, analysis=$3, scanned_at=NOW()`,
      [workspace_id, company_name, analysis]
    );

    // Auto-save identified competitors + their key people
    for (const comp of (analysis.competitors || [])) {
      if (comp.name) {
        await db.query(
          `INSERT INTO brand_competitors (workspace_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [workspace_id, comp.name]
        ).catch(() => {});
        // Save key people
        for (const p of (comp.key_people || [])) {
          if (p.name) {
            await db.query(
              `INSERT INTO brand_competitor_people
                (workspace_id, comp_name, person_name, title, li_url, online_score, sentiment, key_topic)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (workspace_id, comp_name, person_name) DO UPDATE SET
                 title=$4, li_url=$5, online_score=$6, sentiment=$7, key_topic=$8, found_at=NOW()`,
              [workspace_id, comp.name, p.name, p.title||null, p.li_url||null,
               p.online_score||0, p.sentiment||'neutral', p.key_topic||null]
            ).catch(() => {});
          }
        }
      }
    }

    send('complete', { analysis, scanned_at: new Date().toISOString() });
    res.end();
  } catch(e) {
    console.error('[brand-intelligence] scan error:', e.message);
    send('error', { message: e.message });
    res.end();
  }
});


// ── GET /api/brand-intelligence/context ──────────────────────────────────────
router.get('/context', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  await ensureSchema();
  try {
    const { rows } = await db.query(
      `SELECT * FROM brand_context WHERE workspace_id=$1`, [workspace_id]
    );
    res.json({ context: rows[0] || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/brand-intelligence/context ──────────────────────────────────────
router.post('/context', async (req, res) => {
  const { workspace_id, description, website, known_competitors, territory } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  await ensureSchema();
  try {
    // If website provided, try to fetch its content
    let website_text = null;
    if (website) {
      try {
        const url = website.startsWith('http') ? website : 'https://' + website;
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; brand-intel-bot)' },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const html = await r.text();
          // Strip HTML tags, get text
          website_text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 4000);
        }
      } catch(e) {
        console.warn('[brand-context] website fetch failed:', e.message);
      }
    }

    await db.query(`
      INSERT INTO brand_context (workspace_id, description, website, known_competitors, territory, website_text)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (workspace_id) DO UPDATE SET
        description=$2, website=$3, known_competitors=$4, territory=$5,
        website_text=COALESCE($6, brand_context.website_text), updated_at=NOW()
    `, [workspace_id, description||null, website||null, known_competitors||null, territory||'global', website_text]);

    // If known_competitors provided: clear ALL existing and reseed fresh
    if (known_competitors !== undefined) {
      await db.query(`DELETE FROM brand_competitors WHERE workspace_id=$1`, [workspace_id]);
      if (known_competitors) {
        const names = known_competitors.split(/[,\n]+/).map(s=>s.trim()).filter(Boolean);
        for (const name of names) {
          await db.query(
            `INSERT INTO brand_competitors (workspace_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [workspace_id, name]
          ).catch(()=>{});
        }
      }
    }

    res.json({ ok: true, website_fetched: !!website_text });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/brand-intelligence/context/document ─────────────────────────────
router.post('/context/document', async (req, res) => {
  const { workspace_id, name, content: docContent, type } = req.body;
  if (!workspace_id || !name || !docContent) return res.status(400).json({ error: 'workspace_id, name, content required' });
  await ensureSchema();
  try {
    await db.query(`
      UPDATE brand_context
      SET documents = COALESCE(documents, '[]'::jsonb) || $2::jsonb
      WHERE workspace_id=$1
    `, [workspace_id, JSON.stringify([{ name, content: docContent.slice(0, 3000), type: type||'text', added_at: new Date().toISOString() }])]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/brand-intelligence/context/document/:idx ─────────────────────
router.delete('/context/document/:idx', async (req, res) => {
  const { workspace_id } = req.query;
  const idx = parseInt(req.params.idx);
  await ensureSchema();
  try {
    const { rows } = await db.query(`SELECT documents FROM brand_context WHERE workspace_id=$1`, [workspace_id]);
    if (!rows.length) return res.json({ ok: true });
    const docs = rows[0].documents || [];
    docs.splice(idx, 1);
    await db.query(`UPDATE brand_context SET documents=$2 WHERE workspace_id=$1`, [workspace_id, JSON.stringify(docs)]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
