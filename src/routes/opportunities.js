/**
 * /api/opportunities — AI-generated outreach opportunity cards (Signals tab)
 */
const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ── GET /api/opportunities?workspace_id= ─────────────────────────────────────
// Returns active (not dismissed, not handled) opportunities, newest first
router.get('/', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const { rows } = await db.query(`
      SELECT * FROM ai_opportunities
      WHERE workspace_id = $1
        AND dismissed_at IS NULL
        AND handled_at   IS NULL
      ORDER BY priority ASC, created_at DESC
      LIMIT 20
    `, [workspace_id]);
    const { rows: meta } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE dismissed_at IS NULL AND handled_at IS NULL) AS active,
        COUNT(*) FILTER (WHERE handled_at IS NOT NULL)                      AS done,
        MAX(created_at) AS last_generated
      FROM ai_opportunities WHERE workspace_id = $1
    `, [workspace_id]);
    res.json({ items: rows, meta: meta[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/opportunities/:id ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await db.query(
      `UPDATE ai_opportunities SET dismissed_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/opportunities/:id/done ─────────────────────────────────────────
router.post('/:id/done', async (req, res) => {
  try {
    await db.query(
      `UPDATE ai_opportunities SET handled_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/opportunities/generate ─────────────────────────────────────────
// Fetches engagement data → calls Claude AI → saves up to 15 opportunities
router.post('/generate', async (req, res) => {
  const { workspace_id } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

  try {
    // 0. Ensure entity_avatar_url column exists
    await db.query(`ALTER TABLE ai_opportunities ADD COLUMN IF NOT EXISTS entity_avatar_url TEXT`).catch(()=>{});
    await db.query(`ALTER TABLE ai_opportunities ADD COLUMN IF NOT EXISTS contact_id_ref INTEGER`).catch(()=>{});
    await db.query(`ALTER TABLE ai_opportunities ADD COLUMN IF NOT EXISTS thread_id_ref TEXT`).catch(()=>{});
    // 1. Gather all signal data
    const [pvRes, reactRes, campaignRes, listsRes] = await Promise.all([
      // Recent identified profile viewers (last 30 days)
      db.query(`
        SELECT pve.viewer_name, pve.viewer_title, pve.viewer_li_url, pve.viewed_at,
               c.company, c.first_name, c.last_name,
               EXISTS(SELECT 1 FROM list_contacts lc2 WHERE lc2.contact_id=c.id) AS in_list,
               c.invite_sent, c.invite_approved, c.msg_replied
        FROM profile_view_events pve
        LEFT JOIN contacts c ON c.id = pve.contact_id AND c.workspace_id = $1
        WHERE pve.workspace_id = $1
          AND pve.is_anonymous = false
          AND pve.viewed_at >= NOW() - INTERVAL '30 days'
        ORDER BY pve.viewed_at DESC
        LIMIT 60
      `, [workspace_id]),

      // Post reactors
      db.query(`
        SELECT pr.reactor_name, pr.reactor_headline, pr.reactor_url,
               pr.reaction_type, COUNT(*) as cnt,
               c.id as contact_id, c.company,
               EXISTS(SELECT 1 FROM list_contacts lc2 WHERE lc2.contact_id=c.id) AS in_list,
               c.invite_sent, c.invite_approved, c.msg_replied,
               CASE WHEN POSITION(' at ' IN pr.reactor_headline) > 0
                 THEN TRIM(SUBSTRING(pr.reactor_headline FROM POSITION(' at ' IN pr.reactor_headline) + 4))
                 ELSE NULL END AS extracted_company
        FROM post_reactions pr
        LEFT JOIN contacts c ON c.li_profile_url = pr.reactor_url AND c.workspace_id = $1
        WHERE pr.workspace_id = $1
        GROUP BY pr.reactor_name, pr.reactor_headline, pr.reactor_url, pr.reaction_type,
                 c.id, c.company, c.invite_sent, c.invite_approved, c.msg_replied
        ORDER BY cnt DESC
        LIMIT 40
      `, [workspace_id]),

      // Campaign summary
      db.query(`
        SELECT
          COUNT(*) AS total_contacts,
          COUNT(*) FILTER (WHERE invite_sent=true) AS invited,
          COUNT(*) FILTER (WHERE invite_approved=true) AS approved,
          COUNT(*) FILTER (WHERE msg_replied=true) AS replied,
          COUNT(*) FILTER (WHERE positive_reply=true) AS positive
        FROM contacts WHERE workspace_id = $1
      `, [workspace_id]),

      // Lists info
      db.query(`
        SELECT l.name, l.type, COUNT(lc.contact_id) as member_count
        FROM lists l
        LEFT JOIN list_contacts lc ON lc.list_id = l.id
        WHERE l.workspace_id = $1
        GROUP BY l.id, l.name, l.type
      `, [workspace_id]),
    ]);

    const viewers   = pvRes.rows;
    const reactors  = reactRes.rows;
    const campaign  = campaignRes.rows[0];
    const lists     = listsRes.rows;

    // 2. Build context for Claude
    const context = {
      workspace_id,
      campaign_stats: campaign,
      lists: lists.map(l => `${l.name} (${l.type}, ${l.member_count} members)`),
      recent_profile_viewers: viewers.slice(0, 30).map(v => ({
        name: v.viewer_name,
        title: v.viewer_title,
        company: v.company || null,
        date: v.viewed_at ? new Date(v.viewed_at).toLocaleDateString('en-GB') : null,
        in_list: v.in_list,
        already_messaged: v.invite_sent || false,
        already_replied: v.msg_replied || false,
        li_url: v.viewer_li_url || null,
      })),
      post_reactors: reactors.slice(0, 25).map(r => ({
        name: r.reactor_name,
        headline: r.reactor_headline?.slice(0, 80),
        company: r.company || r.extracted_company || null,
        reaction_count: parseInt(r.cnt) || 1,
        in_list: r.in_list,
        already_messaged: r.invite_sent || false,
        li_url: r.reactor_url || null,
      })),
    };

    // 2b. Build contact lookup: li_url → { contact_id, avatar_url, thread_id }
    const liUrls = [
      ...viewers.map(v => v.viewer_li_url).filter(Boolean),
      ...reactors.map(r => r.reactor_url).filter(Boolean),
    ];
    const contactLookup = {};
    if (liUrls.length > 0) {
      const { rows: contactRows } = await db.query(`
        SELECT c.id, c.li_profile_url, c.provider_id,
               it.thread_id
        FROM contacts c
        LEFT JOIN inbox_threads it ON it.contact_id = c.id AND it.workspace_id = c.workspace_id
        WHERE c.workspace_id = $1
          AND c.li_profile_url = ANY($2::text[])
        ORDER BY it.last_message_at DESC NULLS LAST
      `, [workspace_id, liUrls]);
      contactRows.forEach(r => {
        if (!contactLookup[r.li_profile_url]) {
          contactLookup[r.li_profile_url] = {
            contact_id: r.id,
            thread_id: r.thread_id || null,
          };
        }
      });
    }

    // 3. Call Claude API
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

    const systemPrompt = `You are a B2B outreach intelligence engine for a LinkedIn outreach automation platform.
Your job is to analyze inbound engagement signals and identify the BEST outreach opportunities.
Focus on signals that indicate genuine interest or strong fit.

IMPORTANT RULES:
- Generate 8-15 opportunity cards maximum
- Prioritize: 1) people who did MULTIPLE actions (viewed + liked), 2) people from target companies, 3) high engagement
- Each card must have a clear, specific, actionable reason
- Suggested actions can include outreach to people NOT in the system (e.g. "reach out to [name] via LinkedIn")
- Be concise — descriptions max 2 sentences
- Return ONLY valid JSON, no markdown, no explanation

Output format: JSON array of objects:
[{
  "type": "hot_lead"|"multi_signal"|"company_spike"|"post_engagement"|"reconnect"|"cold_outreach",
  "priority": 1-10 (1=highest),
  "title": "short headline (max 8 words)",
  "description": "why this is an opportunity (1-2 sentences)",
  "action_label": "specific action to take (max 10 words)",
  "personal_msg": "personalized LinkedIn invite/message for this specific person (2-3 sentences, friendly, specific to their role/signals, no generic templates)",
  "entity_name": "person or company name",
  "entity_li_url": "linkedin URL or null",
  "company": "company name or null"
}]`;

    const userMsg = `Analyze this engagement data and generate outreach opportunity cards:\n\n${JSON.stringify(context, null, 2)}`;

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
    }).then(r => r.json());

    const rawText = aiResp.content?.[0]?.text || '[]';
    const clean   = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const opps    = JSON.parse(clean);

    if (!Array.isArray(opps)) throw new Error('AI returned invalid format');

    // 4. Clear old opportunities for this workspace, insert new ones
    await db.query(
      `DELETE FROM ai_opportunities WHERE workspace_id = $1`,
      [workspace_id]
    );

    // Build connection-status map: li_profile_url → { invite_approved }
    const { rows: connRows } = await db.query(
      `SELECT li_profile_url, invite_approved FROM contacts WHERE workspace_id=$1 AND li_profile_url IS NOT NULL`,
      [workspace_id]
    ).catch(() => ({ rows: [] }));
    const connMap = {};
    for (const r of connRows) connMap[r.li_profile_url] = r;

    const inserted = [];
    for (const opp of opps.slice(0, 15)) {
      const liUrl      = opp.entity_li_url || null;
      const conn       = liUrl ? (connMap[liUrl] || null) : null;
      const isConnected = !!(conn?.invite_approved);
      const personalMsg = opp.personal_msg || null;

      const { rows } = await db.query(`
        INSERT INTO ai_opportunities
          (workspace_id, type, priority, title, description, action_label,
           entity_name, entity_li_url, company, raw_data, is_connected, personal_msg)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id
      `, [
        workspace_id,
        opp.type || 'cold_outreach',
        Math.min(10, Math.max(1, parseInt(opp.priority) || 5)),
        opp.title || '',
        opp.description || '',
        opp.action_label || '',
        opp.entity_name || null,
        liUrl,
        opp.company || null,
        JSON.stringify({ source: 'ai_generate', viewer_count: viewers.length, reactor_count: reactors.length }),
        isConnected,
        personalMsg,
      ]);
      inserted.push(rows[0].id);
    }

    res.json({ success: true, generated: inserted.length });
  } catch(e) {
    console.error('[opportunities/generate]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

// ── POST /api/opportunities/personal-campaign ─────────────────────────────────
// Creates a personal campaign from a set of signal-driven contacts
router.post('/personal-campaign', async (req, res) => {
  const { workspace_id, campaign_name, contacts } = req.body;
  // contacts: [{ entity_name, entity_li_url, company, opp_id, personal_msg }]
  if (!workspace_id || !contacts?.length) {
    return res.status(400).json({ error: 'workspace_id and contacts required' });
  }
  try {
    // Get workspace account
    const { rows: accts } = await db.query(
      `SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1`, [workspace_id]
    );
    const accountId = accts[0]?.account_id || null;

    // Create campaign
    const name = campaign_name || `Personal Campaign – ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}`;
    const { rows: camp } = await db.query(`
      INSERT INTO campaigns (workspace_id, account_id, name, status, audience_type, settings)
      VALUES ($1, $2, $3, 'draft', 'personal', $4) RETURNING id
    `, [workspace_id, accountId, name, JSON.stringify({ type: 'personal' })]);
    const campaignId = camp[0].id;

    // Insert personal campaign contacts
    for (const c of contacts) {
      await db.query(`
        INSERT INTO personal_campaign_contacts
          (campaign_id, workspace_id, entity_name, entity_li_url, company, opp_id, personal_msg)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [campaignId, workspace_id, c.entity_name||null, c.entity_li_url||null,
          c.company||null, c.opp_id||null, c.personal_msg||'']);
    }

    res.json({ success: true, campaign_id: campaignId, name });
  } catch(e) {
    console.error('[personal-campaign]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/opportunities/personal-campaigns?workspace_id= ──────────────────
router.get('/personal-campaigns', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    const { rows } = await db.query(`
      SELECT c.id, c.name, c.status, c.created_at,
             COUNT(pcc.id) AS total,
             COUNT(pcc.id) FILTER (WHERE pcc.status='pending')  AS pending,
             COUNT(pcc.id) FILTER (WHERE pcc.status='approved') AS approved,
             COUNT(pcc.id) FILTER (WHERE pcc.status='sent')     AS sent
      FROM campaigns c
      LEFT JOIN personal_campaign_contacts pcc ON pcc.campaign_id = c.id
      WHERE c.workspace_id = $1 AND c.audience_type = 'personal'
      GROUP BY c.id ORDER BY c.created_at DESC
    `, [workspace_id]);
    res.json({ campaigns: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/opportunities/personal-campaigns/:id/contacts ───────────────────
router.get('/personal-campaigns/:id/contacts', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT * FROM personal_campaign_contacts
      WHERE campaign_id = $1 ORDER BY created_at ASC
    `, [req.params.id]);
    res.json({ contacts: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/opportunities/personal-campaigns/:id/contacts/:cid ──────────────
// Update message or status
router.put('/personal-campaigns/:id/contacts/:cid', async (req, res) => {
  const { personal_msg, status } = req.body;
  try {
    const updates = [];
    const vals = [];
    let i = 1;
    if (personal_msg !== undefined) { updates.push(`personal_msg=$${i++}`); vals.push(personal_msg); }
    if (status !== undefined) { updates.push(`status=$${i++}`); vals.push(status); }
    if (status === 'approved') { updates.push(`approved_at=NOW()`); }
    if (!updates.length) return res.json({ success: true });
    vals.push(req.params.cid);
    await db.query(`UPDATE personal_campaign_contacts SET ${updates.join(',')} WHERE id=$${i}`, vals);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/opportunities/personal-campaigns/:id/contacts/:cid/send ────────
router.post('/personal-campaigns/:id/contacts/:cid/send', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT pcc.*, c.workspace_id FROM personal_campaign_contacts pcc
       JOIN campaigns c ON c.id = pcc.campaign_id
       WHERE pcc.id = $1`, [req.params.cid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contact not found' });
    const pcc = rows[0];

    const { rows: accts } = await db.query(
      `SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1`, [pcc.workspace_id]
    );
    if (!accts.length) return res.status(400).json({ error: 'No LinkedIn account connected' });

    const { startDirectMessage } = require('../unipile');
    const result = await startDirectMessage(accts[0].account_id, pcc.entity_li_url, pcc.personal_msg);
    if (result?.error) throw new Error(result.error);

    await db.query(
      `UPDATE personal_campaign_contacts SET status='sent', sent_at=NOW() WHERE id=$1`,
      [pcc.id]
    );
    res.json({ success: true });
  } catch(e) {
    console.error('[personal-campaign/send]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/opportunities/generate-single-msg ───────────────────────────────
// Quickly generate a single personalized LinkedIn message for one contact
router.post('/generate-single-msg', async (req, res) => {
  const { workspace_id, name, title, company } = req.body;
  try {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.json({ msg: `Hi ${(name||'').split(' ')[0]}, I noticed you viewed our profile and wanted to connect.` });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role:'user', content:
          `Write a short, warm, personalized LinkedIn connection message (2-3 sentences max) to: ${name||'this person'}, ${title||''}, ${company||''}. They viewed our LinkedIn profile. Be specific to their role. No generic openers. Return only the message text, nothing else.`
        }]
      })
    }).then(r=>r.json());

    const msg = r.content?.[0]?.text?.trim() || `Hi ${(name||'').split(' ')[0]}, I noticed you viewed our profile — would love to connect!`;
    res.json({ msg });
  } catch(e) {
    res.json({ msg: `Hi ${(name||'').split(' ')[0]}, I noticed you viewed our profile and thought we should connect.` });
  }
});
