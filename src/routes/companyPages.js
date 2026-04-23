/**
 * companyPages.js
 * Workspace-level company page management.
 *
 * GET    /api/company-pages?workspace_id=X     — list configured pages
 * POST   /api/company-pages                    — add page (resolves URN from URL)
 * DELETE /api/company-pages/:id                — remove
 * PATCH  /api/company-pages/:id/default        — set as default
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

let _ready = false;
async function ensureSchema() {
  if (_ready) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS workspace_company_pages (
      id               SERIAL PRIMARY KEY,
      workspace_id     INTEGER NOT NULL,
      name             TEXT NOT NULL,
      li_url           TEXT,
      company_page_urn TEXT NOT NULL,
      is_default       BOOLEAN DEFAULT false,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(workspace_id, company_page_urn)
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_wcp_ws ON workspace_company_pages(workspace_id)`
  );
  // Seed from existing per-account settings (one-time)
  await db.query(`
    INSERT INTO workspace_company_pages (workspace_id, name, li_url, company_page_urn, is_default)
    SELECT DISTINCT ON (workspace_id)
      workspace_id,
      'Company Page' AS name,
      settings->>'company_page_url' AS li_url,
      settings->>'company_page_urn' AS company_page_urn,
      NOT EXISTS(
        SELECT 1 FROM workspace_company_pages wcp2
        WHERE wcp2.workspace_id = unipile_accounts.workspace_id AND wcp2.is_default = true
      ) AS is_default
    FROM unipile_accounts
    WHERE settings->>'company_page_urn' IS NOT NULL
      AND settings->>'company_page_urn' != ''
    ORDER BY workspace_id, created_at ASC
    ON CONFLICT (workspace_id, company_page_urn) DO NOTHING
  `);
  _ready = true;
}

const UNIPILE_DSN     = process.env.UNIPILE_DSN;
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;

// Helper: resolve LinkedIn company URL → URN via Unipile
async function resolveCompanyUrn(slug, accountId) {
  if (!UNIPILE_DSN || !UNIPILE_API_KEY || !accountId) return null;
  try {
    const r = await fetch(
      `${UNIPILE_DSN}/api/v1/users/company%3A${encodeURIComponent(slug)}?account_id=${encodeURIComponent(accountId)}`,
      { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json' } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const id = data?.id || data?.company_id ||
      data?.entity_urn?.match(/(\d+)$/)?.[1] ||
      data?.urn?.match(/(\d+)$/)?.[1];
    return id ? `urn:li:fsd_company:${id}` : null;
  } catch(e) {
    console.warn('[companyPages] resolveUrn failed:', e.message);
    return null;
  }
}

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  await ensureSchema();
  try {
    const { rows } = await db.query(
      `SELECT id, name, li_url, company_page_urn, is_default, created_at
       FROM workspace_company_pages
       WHERE workspace_id = $1
       ORDER BY is_default DESC, created_at ASC`,
      [workspace_id]
    );
    res.json({ ok: true, pages: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST / — add a company page ────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { workspace_id, li_url, name, company_page_urn: directUrn } = req.body;
  if (!workspace_id || (!li_url && !directUrn)) return res.status(400).json({ error: 'workspace_id + li_url (or company_page_urn) required' });

  // If URN provided directly (from discover flow), skip URL resolution
  if (directUrn) {
    try {
      await ensureSchema();
      const pageName = name || 'Company Page';
      const { rows: existing } = await db.query(`SELECT COUNT(*) AS cnt FROM workspace_company_pages WHERE workspace_id=$1`, [workspace_id]);
      const isDefault = parseInt(existing[0].cnt) === 0;
      const { rows } = await db.query(
        `INSERT INTO workspace_company_pages (workspace_id, name, li_url, company_page_urn, is_default)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (workspace_id, company_page_urn) DO UPDATE SET name=EXCLUDED.name, li_url=COALESCE(EXCLUDED.li_url, workspace_company_pages.li_url)
         RETURNING id, name, li_url, company_page_urn, is_default`,
        [workspace_id, pageName, li_url || null, directUrn, isDefault]
      );
      // Backfill accounts
      await db.query(
        `UPDATE unipile_accounts SET settings = settings || jsonb_build_object('company_page_urn',$1::text) WHERE workspace_id=$2`,
        [directUrn, workspace_id]
      ).catch(()=>{});
      return res.json({ ok: true, page: rows[0] });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  await ensureSchema();

  try {
    // Extract slug from URL
    const slugMatch = li_url.match(/linkedin\.com\/company\/([^/?#]+)/i);
    if (!slugMatch) return res.status(400).json({ error: 'Invalid LinkedIn company URL. Expected: https://www.linkedin.com/company/your-company' });
    const slug = slugMatch[1].replace(/\/$/, '');

    // Check if URN already exists as a literal urn:li:fsd_company: value
    let urn = null;
    if (li_url.startsWith('urn:li:')) {
      urn = li_url;
    }

    // Try to resolve URN using any account in the workspace
    if (!urn) {
      const { rows: accts } = await db.query(
        `SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1`,
        [workspace_id]
      );
      if (accts.length) {
        urn = await resolveCompanyUrn(slug, accts[0].account_id);
      }
    }

    // If Unipile can't resolve, try extracting from URL if it's a numeric ID
    if (!urn) {
      const numericMatch = li_url.match(/\/company\/(\d+)/);
      if (numericMatch) urn = `urn:li:fsd_company:${numericMatch[1]}`;
    }

    if (!urn) return res.status(400).json({
      error: 'Could not resolve company URN. Try using the company numeric ID URL (e.g. linkedin.com/company/12345) or paste the URN directly.'
    });

    // Fetch real company name from LinkedIn via Unipile
    let pageName = name;
    if (!pageName && UNIPILE_DSN && UNIPILE_API_KEY) {
      try {
        const { rows: accts } = await db.query(
          `SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1`, [workspace_id]
        );
        if (accts.length) {
          const r = await fetch(
            `${UNIPILE_DSN}/api/v1/linkedin/company/${encodeURIComponent(slug)}?account_id=${encodeURIComponent(accts[0].account_id)}`,
            { headers: { 'X-API-KEY': UNIPILE_API_KEY, accept: 'application/json' } }
          );
          if (r.ok) {
            const d = await r.json();
            pageName = d?.name || d?.localizedName || d?.basicInfo?.name || null;
          }
        }
      } catch(e) {}
    }
    pageName = pageName || slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    // If first page, make it default
    const { rows: existing } = await db.query(
      `SELECT COUNT(*) AS cnt FROM workspace_company_pages WHERE workspace_id=$1`, [workspace_id]
    );
    const isDefault = parseInt(existing[0].cnt) === 0;

    const { rows } = await db.query(
      `INSERT INTO workspace_company_pages (workspace_id, name, li_url, company_page_urn, is_default)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (workspace_id, company_page_urn) DO UPDATE SET name=EXCLUDED.name, li_url=EXCLUDED.li_url
       RETURNING id, name, li_url, company_page_urn, is_default`,
      [workspace_id, pageName, `https://www.linkedin.com/company/${slug}/`, urn, isDefault]
    );

    // Also backfill unipile_accounts for backwards compatibility
    await db.query(
      `UPDATE unipile_accounts SET settings = settings || jsonb_build_object('company_page_urn',$1::text,'company_page_url',$2::text)
       WHERE workspace_id=$3`,
      [urn, `https://www.linkedin.com/company/${slug}/`, workspace_id]
    ).catch(() => {});

    res.json({ ok: true, page: rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /:id — rename / update li_url ──────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const { workspace_id } = req.query;
  const { name, li_url } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  if (!name && !li_url) return res.status(400).json({ error: 'name or li_url required' });
  await ensureSchema();
  try {
    if (name && li_url) {
      await db.query(`UPDATE workspace_company_pages SET name=$1, li_url=$2 WHERE id=$3 AND workspace_id=$4`,
        [name, li_url, req.params.id, workspace_id]);
    } else if (name) {
      await db.query(`UPDATE workspace_company_pages SET name=$1 WHERE id=$2 AND workspace_id=$3`,
        [name, req.params.id, workspace_id]);
    } else {
      await db.query(`UPDATE workspace_company_pages SET li_url=$1 WHERE id=$2 AND workspace_id=$3`,
        [li_url, req.params.id, workspace_id]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /:id ────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  await ensureSchema();
  try {
    await db.query(
      `DELETE FROM workspace_company_pages WHERE id=$1 AND workspace_id=$2`,
      [req.params.id, workspace_id]
    );
    // If we deleted the default, promote the next one
    await db.query(
      `UPDATE workspace_company_pages SET is_default=true
       WHERE workspace_id=$1 AND id=(SELECT id FROM workspace_company_pages WHERE workspace_id=$1 ORDER BY created_at LIMIT 1)
         AND NOT EXISTS(SELECT 1 FROM workspace_company_pages WHERE workspace_id=$1 AND is_default=true)`,
      [workspace_id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /:id/default ─────────────────────────────────────────────────────────
router.patch('/:id/default', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  try {
    await db.query(`UPDATE workspace_company_pages SET is_default=false WHERE workspace_id=$1`, [workspace_id]);
    await db.query(`UPDATE workspace_company_pages SET is_default=true WHERE id=$1 AND workspace_id=$2`, [req.params.id, workspace_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



// ── GET /by-account?account_id=X&workspace_id=Y ─────────────────────────────
// Fetch LinkedIn company pages this account manages, via Unipile.
// Tries multiple strategies; returns what it finds.
router.get('/by-account', async (req, res) => {
  const { account_id, workspace_id } = req.query;
  if (!account_id) return res.status(400).json({ error: 'account_id required' });

  const pages = [];
  const seen  = new Set();
  const addPage = (name, urn, li_url) => {
    if (!urn || seen.has(urn)) return;
    seen.add(urn);
    pages.push({ name: name || null, urn, li_url: li_url || null });
  };

  if (!UNIPILE_DSN || !UNIPILE_API_KEY) {
    return res.json({ ok: true, pages: [], note: 'Unipile not configured' });
  }

  // ── Step 1: LinkedIn voyager ACLs (best source — admin role) ─────────────
  const aclUrl = 'https://www.linkedin.com/voyager/api/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&start=0&count=50';
  try {
    const r = await fetch(`${UNIPILE_DSN}/api/v1/linkedin`, {
      method: 'POST',
      headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ account_id, request_url: aclUrl, method: 'GET', encoding: false }),
    });
    if (r.ok) {
      const data = await r.json();
      const els = data?.elements || data?.items || [];
      for (const el of els) {
        const orgUrn = el.organizationalTarget || el.organization || el.entityUrn || el.urn;
        const id = typeof orgUrn === 'string' ? orgUrn.match(/(\d+)$/)?.[1] : null;
        if (!id) continue;
        const name = el.targetInfo?.localizedName || el.localizedName || el.name || null;
        addPage(name, `urn:li:fsd_company:${id}`, el.targetInfo?.pageUrl || null);
      }
    }
  } catch(e) {}

  // ── Step 2: Unipile profile organizations field ──────────────────────────
  // Unipile's /users/me returns an 'organizations' array with all companies
  // the account is associated with — this is the reliable fallback.
  if (!pages.length) {
    try {
      const r = await fetch(
        `${UNIPILE_DSN}/api/v1/users/me?account_id=${encodeURIComponent(account_id)}`,
        { headers: { 'X-API-KEY': UNIPILE_API_KEY, accept: 'application/json' } }
      );
      if (r.ok) {
        const profile = await r.json();
        const orgs = Array.isArray(profile?.organizations) ? profile.organizations : [];
        for (const org of orgs) {
          const id = org.id || org.organization_id;
          const name = org.name || null;
          if (!id) continue;
          addPage(name, `urn:li:fsd_company:${id}`, `https://www.linkedin.com/company/${id}/`);
        }
      }
    } catch(e) {}
  }

  // ── Step 3: For each found page, resolve name if missing ─────────────────
  const enriched = await Promise.all(pages.map(async (p) => {
    if (p.name) return p;
    // Try to get the company name from Unipile
    const id = p.urn.match(/(\d+)$/)?.[1];
    if (!id) return p;
    try {
      const r = await fetch(
        `${UNIPILE_DSN}/api/v1/linkedin/company/${id}?account_id=${encodeURIComponent(account_id)}`,
        { headers: { 'X-API-KEY': UNIPILE_API_KEY, accept: 'application/json' } }
      );
      if (r.ok) {
        const d = await r.json();
        const name = d?.name || d?.localizedName || null;
        if (name) return { ...p, name };
      }
    } catch(e) {}
    return p;
  }));

  // ── Mark already-added workspace pages (only for display, not to add fake results) ──
  let addedMap = new Map();
  if (workspace_id) {
    await ensureSchema().catch(() => {});
    const { rows } = await db.query(
      `SELECT company_page_urn, name FROM workspace_company_pages WHERE workspace_id=$1`,
      [workspace_id]
    ).catch(() => ({ rows: [] }));
    addedMap = new Map(rows.map(r => [r.company_page_urn, r.name]));
  }

  // Auto-update any pages that are stored with generic name "Company Page"
  // but the API returned a real name
  for (const p of enriched) {
    if (!addedMap.has(p.urn)) continue;
    const storedName = addedMap.get(p.urn);
    const apiName = p.name;
    const isGeneric = !storedName || storedName === 'Company Page' || storedName === 'company page';
    if (isGeneric && apiName && apiName !== 'Company Page') {
      // Silently update the DB name to the real company name
      await db.query(
        `UPDATE workspace_company_pages SET name=$1 WHERE workspace_id=$2 AND company_page_urn=$3`,
        [apiName, workspace_id, p.urn]
      ).catch(() => {});
      addedMap.set(p.urn, apiName);
    }
  }

  res.json({
    ok: true,
    pages: enriched.map(p => {
      const storedName = addedMap.get(p.urn);
      return {
        name:         p.name || storedName || p.urn,
        urn:          p.urn,
        li_url:       p.li_url,
        already_added: addedMap.has(p.urn),
        saved_name:   storedName || null,
      };
    }),
    source: pages.length ? 'linkedin' : 'none',
  });
});

// ── GET /search?q=X&account_id=Y — LinkedIn company search (name or URL) ──────
router.get('/search', async (req, res) => {
  const { q, account_id, workspace_id } = req.query;
  if (!q || !account_id) return res.status(400).json({ error: 'q + account_id required' });

  const results = [];

  if (q.includes('linkedin.com/company/')) {
    // URL → resolve directly
    const slugMatch = q.match(/linkedin\.com\/company\/([^/?#]+)/i);
    if (slugMatch) {
      const slug = slugMatch[1].replace(/\/$/, '');
      try {
        const r = await fetch(
          `${UNIPILE_DSN}/api/v1/linkedin/company/${encodeURIComponent(slug)}?account_id=${encodeURIComponent(account_id)}`,
          { headers: { 'X-API-KEY': UNIPILE_API_KEY, accept: 'application/json' } }
        );
        if (r.ok) {
          const d = await r.json();
          const id = d?.id || d?.company_id || d?.entity_urn?.match(/(\d+)$/)?.[1];
          if (id) results.push({
            name: d?.name || d?.localizedName || slug,
            urn: `urn:li:fsd_company:${id}`,
            li_url: `https://www.linkedin.com/company/${slug}/`,
          });
        }
      } catch(e) {}
    }
  } else {
    // Name search
    try {
      const r = await fetch(
        `${UNIPILE_DSN}/api/v1/linkedin/search?account_id=${encodeURIComponent(account_id)}`,
        {
          method: 'POST',
          headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ api: 'classic', category: 'companies', keywords: q, limit: 15 }),
        }
      );
      if (r.ok) {
        const data = await r.json();
        for (const item of (data?.items || [])) {
          const id = item.id || item.company_id || item.entity_urn?.match(/(\d+)$/)?.[1] || item.entityUrn?.match(/(\d+)$/)?.[1];
          if (!id) continue;
          const name = item.name || item.localizedName || item.companyName;
          if (!name) continue;
          const slug = item.universalName || item.vanityName || id;
          results.push({ name, urn: `urn:li:fsd_company:${id}`, li_url: `https://www.linkedin.com/company/${slug}/` });
        }
      }
    } catch(e) {}
  }

  // Mark already-added
  let added = new Set();
  if (workspace_id) {
    await ensureSchema().catch(() => {});
    const { rows } = await db.query(`SELECT company_page_urn FROM workspace_company_pages WHERE workspace_id=$1`, [workspace_id]).catch(() => ({ rows: [] }));
    added = new Set(rows.map(r => r.company_page_urn));
  }

  res.json({ ok: true, results: results.map(r => ({ ...r, already_added: added.has(r.urn) })) });
});

// ── POST /validate — resolve URL + verify account is associated ───────────────
router.post('/validate', async (req, res) => {
  const { workspace_id, li_url, account_id } = req.body;
  if (!workspace_id || !li_url) return res.status(400).json({ error: 'workspace_id + li_url required' });

  const slugMatch = li_url.match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (!slugMatch) return res.status(400).json({ error: 'Invalid LinkedIn company URL' });
  const slug = slugMatch[1].replace(/\/$/, '');

  if (!UNIPILE_DSN || !UNIPILE_API_KEY) return res.status(500).json({ error: 'Unipile not configured' });

  // Get workspace accounts (or specific account)
  let accountIds = [];
  if (account_id) {
    accountIds = [account_id];
  } else {
    const { rows } = await db.query(
      `SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 ORDER BY display_name`, [workspace_id]
    ).catch(() => ({ rows: [] }));
    accountIds = rows.map(r => r.account_id);
  }
  if (!accountIds.length) return res.status(400).json({ error: 'No accounts in workspace' });

  // Step 1: Resolve URN
  let urn = null, name = null, liUrl = null;
  for (const acctId of accountIds) {
    try {
      const r = await fetch(
        `${UNIPILE_DSN}/api/v1/linkedin/company/${encodeURIComponent(slug)}?account_id=${encodeURIComponent(acctId)}`,
        { headers: { 'X-API-KEY': UNIPILE_API_KEY, accept: 'application/json' } }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const id = d?.id || d?.company_id || d?.entity_urn?.match(/(\d+)$/)?.[1] || d?.urn?.match(/(\d+)$/)?.[1];
      if (!id) continue;
      urn  = `urn:li:fsd_company:${id}`;
      name = d?.name || d?.localizedName || slug;
      liUrl = `https://www.linkedin.com/company/${slug}/`;
      break;
    } catch(e) {}
  }
  if (!urn) return res.json({ ok: false, error: 'Could not find this company on LinkedIn. Check the URL.' });

  // Step 2: Check which accounts are associated (via organizations field)
  const companyId = urn.match(/(\d+)$/)?.[1];
  const canSendByAccount = {};
  for (const acctId of accountIds) {
    try {
      const r = await fetch(
        `${UNIPILE_DSN}/api/v1/users/me?account_id=${encodeURIComponent(acctId)}`,
        { headers: { 'X-API-KEY': UNIPILE_API_KEY, accept: 'application/json' } }
      );
      if (!r.ok) { canSendByAccount[acctId] = false; continue; }
      const profile = await r.json();
      const orgs = Array.isArray(profile?.organizations) ? profile.organizations : [];
      canSendByAccount[acctId] = orgs.some(o => String(o.id) === String(companyId));
    } catch(e) { canSendByAccount[acctId] = false; }
  }
  const canSend = Object.values(canSendByAccount).some(Boolean);

  const { rows: acctRows } = await db.query(
    `SELECT account_id, display_name FROM unipile_accounts WHERE account_id=ANY($1)`, [accountIds]
  ).catch(() => ({ rows: [] }));
  const acctNames = Object.fromEntries(acctRows.map(r => [r.account_id, r.display_name]));

  res.json({
    ok: true, name, urn, li_url: liUrl, can_send: canSend,
    accounts: Object.entries(canSendByAccount).map(([id, ok]) => ({
      account_id: id, display_name: acctNames[id] || id, can_send: ok
    })),
    note: canSend
      ? `✅ Verified — at least one account can send invites for ${name}`
      : `⚠️ None of your accounts is associated with ${name}. Make sure you are a Page Admin on LinkedIn.`
  });
});

module.exports = router;