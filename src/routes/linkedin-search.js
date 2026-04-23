// src/routes/linkedin-search.js
// Bulk LinkedIn search + import contacts into a list

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { request: unipileRequest } = require('../unipile');

// Helper: run one page of LinkedIn search
async function searchPage(accountId, keywords, industries, cursor) {
  const body = {
    api: 'classic',
    category: 'people',
    keywords: keywords,
  };
  if (industries && industries.length) body.industry = industries;

  const params = new URLSearchParams({ account_id: accountId, limit: '50' });
  if (cursor) params.set('cursor', cursor);

  return unipileRequest(`/api/v1/linkedin/search?${params}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// GET /api/linkedin/search-params — get industry / location IDs
router.get('/search-params', async (req, res) => {
  try {
    const { account_id, type = 'INDUSTRY' } = req.query;
    if (!account_id) return res.status(400).json({ error: 'account_id required' });
    const params = new URLSearchParams({ account_id, type });
    const data = await unipileRequest(`/api/v1/linkedin/search/parameters?${params}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/linkedin/bulk-search-import
// Body: { workspace_id, account_id, title_keywords, industries[], list_name, limit }
router.post('/bulk-search-import', async (req, res) => {
  const { workspace_id, account_id, title_keywords, industries, list_name, limit = 1000, cursor = null } = req.body;
  if (!workspace_id || !account_id || !title_keywords)
    return res.status(400).json({ error: 'workspace_id, account_id, title_keywords required' });

  // Create or find list
  let listId;
  let imported = 0;
  const { rows: existing } = await db.query(
    `SELECT id FROM lists WHERE workspace_id=$1 AND name=$2 LIMIT 1`,
    [workspace_id, list_name || title_keywords]
  );
  if (existing.length) {
    listId = existing[0].id;
  } else {
    const { rows: created } = await db.query(
      `INSERT INTO lists (workspace_id, name, description, created_at) VALUES ($1,$2,$3,NOW()) RETURNING id`,
      [workspace_id, list_name || title_keywords, `Imported from LinkedIn search: ${title_keywords}`]
    );
    listId = created[0].id;
  }

  // Paginate search





  res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });

  try {
    do {
      page++;
      let data;
      try {
        data = await searchPage(account_id, title_keywords, industries || [], cursor);
      } catch(e) {
        errors.push(`Page ${page}: ${e.message}`);
        break;
      }

      const items = data?.items || [];
      total += items.length;
      cursor = data?.paging?.cursor || null;

      for (const person of items) {
        try {
          const providerId    = person.id || person.member_urn;
          const liUrl         = person.public_profile_url || person.profile_url;
          const firstName     = person.first_name || '';
          const lastName      = person.last_name  || '';
          const headline      = person.headline   || '';
          const alreadyConn   = person.network_distance === 'FIRST_DEGREE';

          if (!providerId && !liUrl) continue;

          // Check if contact exists, insert if not
          const { rows: exists } = await db.query(
            `SELECT id FROM contacts WHERE workspace_id=$1 AND (provider_id=$2 OR (li_profile_url IS NOT NULL AND li_profile_url=$3)) LIMIT 1`,
            [workspace_id, providerId || '', liUrl || '']
          );
          let contactId;
          if (exists.length) {
            contactId = exists[0].id;
            await db.query(
              `UPDATE contacts SET first_name=$1, last_name=$2, headline=$3, already_connected=$4 WHERE id=$5`,
              [firstName, lastName, headline, alreadyConn, contactId]
            );
          } else {
            const { rows: ins } = await db.query(`
              INSERT INTO contacts (workspace_id, first_name, last_name, headline, li_profile_url, provider_id, already_connected, source, created_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,'linkedin_search',NOW()) RETURNING id
            `, [workspace_id, firstName, lastName, headline, liUrl || null, providerId || null, alreadyConn]);
            contactId = ins[0]?.id;
          }
          if (contactId && listId) {
            await db.query(`
              INSERT INTO list_contacts (list_id, contact_id, added_at)
              VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING
            `, [listId, contactId]);
          }
          imported++;
        } catch(e) {
          // skip individual contact errors
        }
      }

      // Stream progress
      res.write(JSON.stringify({ page, items: items.length, imported, cursor: !!cursor }) + '\n');

      if (items.length === 0 || imported >= limit) break;
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 800));

    } while (cursor && imported < limit);

  } catch(e) {
    errors.push(e.message);
  }

  res.end(JSON.stringify({ done: true, imported, total, list_id: listId, errors }));
});

// POST /api/linkedin/save-contacts — save batch of contacts from client-side LinkedIn search
router.post('/save-contacts', async (req, res) => {
  const { workspace_id, list_name, contacts } = req.body;
  if (!workspace_id || !contacts || !contacts.length)
    return res.status(400).json({ error: 'workspace_id and contacts required' });

  // Create or find list
  let listId = null;
  if (list_name) {
    const { rows: existing } = await db.query(
      `SELECT id FROM lists WHERE workspace_id=$1 AND name=$2 LIMIT 1`, [workspace_id, list_name]
    );
    if (existing.length) {
      listId = existing[0].id;
    } else {
      const { rows: created } = await db.query(
        `INSERT INTO lists (workspace_id, name, description, created_at) VALUES ($1,$2,$3,NOW()) RETURNING id`,
        [workspace_id, list_name, `Imported from LinkedIn search`]
      );
      listId = created[0].id;
    }
  }

  let imported = 0;
  for (const person of contacts) {
    try {
      const providerId  = person.id || person.provider_id || null;
      const liUrl       = person.public_profile_url || person.li_profile_url || null;
      const firstName   = person.first_name || '';
      const lastName    = person.last_name  || '';
      const headline    = person.headline   || '';
      const alreadyConn = person.network_distance === 'FIRST_DEGREE' || person.already_connected || false;

      if (!providerId && !liUrl) continue;

      const { rows: exists } = await db.query(
        `SELECT id FROM contacts WHERE workspace_id=$1 AND (provider_id=$2 OR (li_profile_url IS NOT NULL AND li_profile_url=$3)) LIMIT 1`,
        [workspace_id, providerId || '', liUrl || '']
      );
      let contactId;
      if (exists.length) {
        contactId = exists[0].id;
        await db.query(
          `UPDATE contacts SET first_name=$1, last_name=$2, headline=$3, already_connected=$4 WHERE id=$5`,
          [firstName, lastName, headline, alreadyConn, contactId]
        );
      } else {
        const { rows: ins } = await db.query(
          `INSERT INTO contacts (workspace_id, first_name, last_name, headline, li_profile_url, provider_id, already_connected, source, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'linkedin_search',NOW()) RETURNING id`,
          [workspace_id, firstName, lastName, headline, liUrl || null, providerId || null, alreadyConn]
        );
        contactId = ins[0]?.id;
      }

      if (contactId && listId) {
        await db.query(
          `INSERT INTO list_contacts (list_id, contact_id, added_at) VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING`,
          [listId, contactId]
        );
      }
      imported++;
    } catch(e) { /* skip */ }
  }

  res.json({ ok: true, imported, list_id: listId });
});

// GET /api/linkedin/config — return DSN info for client-side calls
router.get('/config', (req, res) => {
  const dsn = process.env.UNIPILE_DSN || '';
  const key = process.env.UNIPILE_API_KEY || '';
  res.json({ dsn, hasKey: !!key, key: key ? key.slice(0,8) + '...' : null });
});

// POST /api/linkedin/search — proxy to Unipile search (avoids CORS + exposes key)
router.post('/search', async (req, res) => {
  const { account_id, keywords, cursor, limit = 50 } = req.body;
  if (!account_id || !keywords) return res.status(400).json({ error: 'account_id and keywords required' });
  try {
    const body = { api: 'classic', category: 'people', keywords };
    const params = new URLSearchParams({ account_id, limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    const data = await unipileRequest(`/api/v1/linkedin/search?${params}`, {
      method: 'POST', body: JSON.stringify(body),
    });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
