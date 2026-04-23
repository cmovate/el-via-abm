const express = require('express');
const router = express.Router();
const db = require('../db');
const { searchPeopleAdvanced } = require('../unipile');

// POST /api/industry-search
// Searches LinkedIn by title + company IDs (all at once) — much faster than per-company
// Body: { workspace_id, list_id, title, company_ids, cursor }
// Paginates automatically until < 50 results or total_count reached
router.post('/', async function(req, res) {
  try {
    const { workspace_id, list_id, title, keywords, company_ids, industry_ids, min_headcount, cursor } = req.body;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const accRes = await db.query('SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1', [workspace_id]);
    if (!accRes.rows.length) return res.json({ error: 'no account' });
    const accountId = accRes.rows[0].account_id;

    const opts = { limit: 50 };
    if (title) opts.advanced_keywords = { title };
    if (keywords && !title) opts.keywords = keywords;
    if (company_ids && company_ids.length) opts.company = company_ids.map(String);
    if (industry_ids && industry_ids.length) opts.industry = industry_ids.map(String);
    if (cursor) opts.cursor = cursor;

    const result = await searchPeopleAdvanced(accountId, opts);
    let items = result.items || [];
    if (min_headcount) {
      items = items.filter(p => {
        const pos = p.current_positions && p.current_positions[0];
        return pos && pos.company_headcount && pos.company_headcount.min >= min_headcount;
      });
    }

    // Save to list
    let saved = 0;
    if (list_id && items.length) {
      for (const p of items) {
        const url = p.public_profile_url || p.profile_url;
        if (!url) continue;
        const ex = await db.query('SELECT id FROM contacts WHERE workspace_id=$1 AND li_profile_url=$2', [workspace_id, url]);
        let contactId;
        if (ex.rows.length) {
          contactId = ex.rows[0].id;
        } else {
          const company = (p.current_positions && p.current_positions[0] && p.current_positions[0].company) || p.company || '';
          const ins = await db.query(
            'INSERT INTO contacts (workspace_id, li_profile_url, first_name, last_name, headline, company) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id',
            [workspace_id, url, p.first_name||'', p.last_name||'', p.headline||'', company]
          );
          contactId = ins.rows[0] && ins.rows[0].id;
        }
        if (contactId) {
          await db.query('INSERT INTO list_contacts (list_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [list_id, contactId]);
          saved++;
        }
      }
    }

    res.json({
      found: items.length,
      saved,
      next_cursor: result.cursor,
      total_count: result.totalCount,
      items: items.map(p => ({
        url: p.public_profile_url || p.profile_url,
        name: p.name || ((p.first_name||'') + ' ' + (p.last_name||'')).trim(),
        headline: p.headline,
        company: p.current_positions && p.current_positions[0] && p.current_positions[0].company
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
