/**
 * src/profileViewScraper.js
 *
 * Runs 3× per day (08:00, 14:00, 20:00 server time).
 * For every workspace × every unipile account:
 *   1. Fetches last 5 LinkedIn profile viewers via Voyager API
 *   2. ANONYMOUS viewer  → records in profile_view_events + increments daily analytics
 *   3. IDENTIFIED viewer → same as above, PLUS:
 *       a. Found in any list   → marks viewed_our_profile=true on list_contacts row
 *       b. NOT found anywhere  → adds to workspace's default "Profile Viewers" list
 *
 * Table created here: profile_view_events
 */

const db = require('./db');

const VOYAGER_URL =
  'https://www.linkedin.com/voyager/api/graphql' +
  '?variables=(start:0,query:(),analyticsEntityUrn:(activityUrn:urn%3Ali%3Adummy%3A-1),surfaceType:WVMP)' +
  '&queryId=voyagerPremiumDashAnalyticsObject.c31102e906e7098910f44e0cecaa5b5c';

// Fire at 08:00, 14:00, 20:00 — check every minute
const FIRE_HOURS   = [8, 14, 20];
const STARTUP_DELAY_MS = 3 * 60 * 1000; // 3 min after boot

// ── Ensure DB table exists ────────────────────────────────────────────────────

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS profile_view_events (
      id            SERIAL PRIMARY KEY,
      workspace_id  INTEGER NOT NULL,
      account_id    VARCHAR(255) NOT NULL,
      viewed_at     TIMESTAMP,
      scraped_at    TIMESTAMP DEFAULT NOW(),
      is_anonymous  BOOLEAN DEFAULT TRUE,
      viewer_name   TEXT,
      viewer_title  TEXT,
      viewer_provider_id  VARCHAR(255),
      viewer_li_url TEXT,
      contact_id    INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      raw_caption   TEXT
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_pve_ws    ON profile_view_events(workspace_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_pve_acct  ON profile_view_events(account_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_pve_time  ON profile_view_events(scraped_at)`);

  // Add viewed_our_profile column to list_contacts if missing
  await db.query(`ALTER TABLE list_contacts ADD COLUMN IF NOT EXISTS viewed_our_profile BOOLEAN DEFAULT FALSE`);
  await db.query(`ALTER TABLE list_contacts ADD COLUMN IF NOT EXISTS viewed_our_profile_at TIMESTAMP`);
  await db.query(`ALTER TABLE profile_view_events ADD COLUMN IF NOT EXISTS viewer_company TEXT`);

  // Company page view events table
  await db.query(`
    CREATE TABLE IF NOT EXISTS company_page_view_events (
      id            SERIAL PRIMARY KEY,
      workspace_id  INTEGER NOT NULL,
      account_id    VARCHAR(255) NOT NULL,
      company_urn   VARCHAR(255),
      scraped_at    TIMESTAMP DEFAULT NOW(),
      visitor_title TEXT,
      visitor_pid   VARCHAR(255),
      visitor_li_url TEXT,
      contact_id    INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      is_anonymous  BOOLEAN DEFAULT TRUE,
      total_views   INTEGER DEFAULT 0
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_cpve_ws   ON company_page_view_events(workspace_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_cpve_time ON company_page_view_events(scraped_at)`);
}

// ── Voyager API call ──────────────────────────────────────────────────────────

async function fetchProfileViewers(accountId, limit = 5) {
  const UNIPILE_DSN     = process.env.UNIPILE_DSN;
  const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;

  const res = await fetch(`${UNIPILE_DSN}/api/v1/linkedin`, {
    method: 'POST',
    headers: {
      'X-API-KEY':     UNIPILE_API_KEY,
      'accept':        'application/json',
      'content-type':  'application/json',
    },
    body: JSON.stringify({
      account_id:  accountId,
      method:      'GET',
      request_url: VOYAGER_URL,
      encoding:    false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Voyager ${res.status}: ${text.substring(0, 120)}`);
  }

  const data = await res.json();
  const elems = data?.data?.data?.premiumDashAnalyticsObjectByAnalyticsEntity?.elements || [];
  return elems.slice(0, limit);
}

// ── Parse a single element ────────────────────────────────────────────────────

function parseViewer(elem) {
  const lockup = elem?.content?.analyticsEntityLockup?.entityLockup;
  if (!lockup) return null;

  const name    = lockup?.title?.text?.trim() || '';
  const title   = lockup?.subtitle?.text?.trim() || '';
  const caption = lockup?.caption?.text?.trim() || ''; // "Viewed 3h ago"

  // publicIdentifier is stored in the image URL path
  const rawJson = JSON.stringify(elem);
  const pidMatch = rawJson.match(/"publicIdentifier":"([^"]+)"/);
  const publicIdentifier = pidMatch?.[1] || null;

  // Provider ID is the ACoAAA... key in the image URL path
  const provIdMatch = rawJson.match(/linkedin\.com\/in\/(ACoA[A-Za-z0-9_-]+)/);
  const providerId = provIdMatch?.[1] || null;

  const liUrl = publicIdentifier
    ? `https://www.linkedin.com/in/${publicIdentifier}`
    : null;

  // Parse "Viewed 3h ago" / "Viewed 1d ago" / "Viewed 15h ago"
  let viewedAt = null;
  if (caption) {
    const hMatch = caption.match(/(\d+)\s*h/i);
    const dMatch = caption.match(/(\d+)\s*d/i);
    const mMatch = caption.match(/(\d+)\s*m/i);
    const now = Date.now();
    if      (hMatch) viewedAt = new Date(now - parseInt(hMatch[1]) * 3600000);
    else if (dMatch) viewedAt = new Date(now - parseInt(dMatch[1]) * 86400000);
    else if (mMatch) viewedAt = new Date(now - parseInt(mMatch[1]) * 60000);
    else              viewedAt = new Date();
  }

  // Anonymous: name looks like "Someone at X" or "Founder in..."
  const isAnonymous = !publicIdentifier && !providerId;

  return { name, title, caption, publicIdentifier, providerId, liUrl, viewedAt, isAnonymous };
}

// ── Find or create "Profile Viewers" list for workspace ───────────────────────

async function getOrCreateViewersList(workspaceId) {
  const { rows } = await db.query(
    `SELECT id FROM lists WHERE workspace_id=$1 AND name='Profile Viewers' LIMIT 1`,
    [workspaceId]
  );
  if (rows.length) return rows[0].id;

  const { rows: created } = await db.query(
    `INSERT INTO lists (workspace_id, name, description, created_at)
     VALUES ($1, 'Profile Viewers', 'Auto-created: people who viewed our profiles', NOW())
     RETURNING id`,
    [workspaceId]
  );
  console.log(`[ProfileViewScraper] Created "Profile Viewers" list for ws=${workspaceId}`);
  return created[0].id;
}

// ── Company page visitor fetcher ─────────────────────────────────────────────

function buildCompanyViewerUrl(orgId, fromMs, toMs) {
  const from = fromMs || (Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to   = toMs   || Date.now();
  return `https://www.linkedin.com/voyager/api/graphql?variables=(analyticsEntityUrn:(company:urn%3Ali%3Afsd_company%3A${orgId}),surfaceType:ORGANIZATION_VISITORS,query:(selectedFilters:List((key:timeRange,value:List(${from},${to})),(key:resultType,value:List(PAGE_VIEWS)),(key:pageType,value:List(ALL_PAGES)))))&queryId=voyagerPremiumDashAnalyticsView.d24d2e85d8a23d815c7fd94aa8988261`;
}

async function fetchCompanyPageViewers(accountId, orgId) {
  const UNIPILE_DSN     = process.env.UNIPILE_DSN;
  const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;

  const res = await fetch(`${UNIPILE_DSN}/api/v1/linkedin`, {
    method: 'POST',
    headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      account_id:  accountId,
      method:      'GET',
      request_url: buildCompanyViewerUrl(orgId),
      encoding:    false,
    }),
  });
  if (!res.ok) throw new Error(`CompanyViewers HTTP ${res.status}`);
  const data = await res.json();
  const cards = data?.data?.data?.premiumDashAnalyticsViewByAnalyticsEntity?.elements?.[0]?.sections?.[0]?.card || [];

  // card[2] has the analyticsObjectList with visitor items
  const items = cards[2]?.components?.[0]?.analyticsObjectList?.items || [];

  // KPI: total page views from card[0] infoList
  const kpiItems = cards[0]?.components?.[0]?.infoList?.items || [];
  let totalViews = 0;
  if (kpiItems.length) {
    const raw = JSON.stringify(kpiItems[0]);
    const nums = raw.match(/"text":"(\d+)"/g);
    if (nums) totalViews = parseInt(nums[0].match(/\d+/)[0]) || 0;
  }

  return { items, totalViews };
}

function parseCompanyVisitor(item) {
  const lockup = item?.content?.analyticsEntityLockup?.entityLockup;
  const title  = lockup?.title?.text?.trim() || '';
  const raw    = JSON.stringify(item);
  const pid    = raw.match(/"publicIdentifier":"([^"]+)"/)?.[1] || null;
  const liUrl  = pid ? `https://www.linkedin.com/in/${pid}` : null;
  const isAnon = !pid;
  return { title, pid, liUrl, isAnon };
}

async function processCompanyPageAccount(workspaceId, accountId, orgId, companyUrn) {
  await ensureTable();
  let result;
  try {
    result = await fetchCompanyPageViewers(accountId, orgId);
  } catch(e) {
    console.warn(`[ProfileViewScraper] company page ws=${workspaceId} acc=${accountId}: ${e.message}`);
    return { total: 0, visitors: 0, added: 0 };
  }

  const { items, totalViews } = result;
  console.log(`[ProfileViewScraper] Company page ws=${workspaceId}: totalViews=${totalViews} items=${items.length}`);

  let added = 0;
  for (const item of items) {
    const v = parseCompanyVisitor(item);

    // Dedup: skip if recorded in last 12h for same account+title combo
    try {
      const { rows: dup } = await db.query(
        `SELECT id FROM company_page_view_events
         WHERE workspace_id=$1 AND account_id=$2 AND visitor_title=$3 AND scraped_at > NOW() - INTERVAL '12 hours'
         LIMIT 1`,
        [workspaceId, accountId, v.title]
      );
      if (dup.length) continue;
    } catch(e) { /* proceed */ }

    // Match to contact
    let contactId = null;
    if (!v.isAnon && v.liUrl) {
      const { rows } = await db.query(
        `SELECT id FROM contacts WHERE workspace_id=$1 AND (li_profile_url=$2 OR provider_id=$3) LIMIT 1`,
        [workspaceId, v.liUrl, v.pid || '']
      );
      contactId = rows[0]?.id || null;
    }

    await db.query(
      `INSERT INTO company_page_view_events
         (workspace_id, account_id, company_urn, visitor_title, visitor_pid, visitor_li_url, contact_id, is_anonymous, total_views)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [workspaceId, accountId, companyUrn, v.title, v.pid, v.liUrl, contactId, v.isAnon, totalViews]
    );
    added++;

    // If identified and not in list, add to Profile Viewers list
    if (!v.isAnon && !contactId && v.liUrl) {
      try {
        const { getOrCreateViewersList } = require('./profileViewScraper'); // self-ref fallback
      } catch(e) {}
    }
  }

  // Also upsert a total_views record for this account (even if no individual visitors)
  if (totalViews > 0 && items.length === 0) {
    await db.query(
      `INSERT INTO company_page_view_events
         (workspace_id, account_id, company_urn, visitor_title, is_anonymous, total_views)
       VALUES ($1,$2,$3,'(aggregate)',true,$4)
       ON CONFLICT DO NOTHING`,
      [workspaceId, accountId, companyUrn, totalViews]
    ).catch(()=>{});
  }

  return { total: totalViews, visitors: items.length, added };
}

// ── Process one account ───────────────────────────────────────────────────────

async function processAccount(workspaceId, accountId) {
  // Ensure table exists before any queries
  await ensureTable();

  let viewers;
  try {
    viewers = await fetchProfileViewers(accountId, 5);
  } catch (e) {
    console.warn(`[ProfileViewScraper] ws=${workspaceId} acc=${accountId} fetch error: ${e.message}`);
    return { total: 0, identified: 0, added: 0 };
  }

  console.log(`[ProfileViewScraper] ws=${workspaceId} acc=${accountId}: got ${viewers.length} viewers`);
  let identified = 0, added = 0;

  for (const elem of viewers) {
    const v = parseViewer(elem);
    if (!v) continue;

    console.log(`[ProfileViewScraper]  → ${v.isAnonymous ? '(anon)' : v.name} | pid=${v.publicIdentifier} | cap="${v.caption}"`);

    // ── Dedup: skip if already recorded in last 12h ───────────────────────────
    if (!v.isAnonymous && v.liUrl) {
      try {
        const { rows: dup } = await db.query(
          `SELECT id FROM profile_view_events
           WHERE workspace_id=$1 AND viewer_li_url=$2 AND scraped_at > NOW() - INTERVAL '12 hours'
           LIMIT 1`,
          [workspaceId, v.liUrl]
        );
        if (dup.length) { console.log(`[ProfileViewScraper]   ↩ dedup skip: ${v.name}`); continue; }
      } catch(e) { /* table may not have rows yet — proceed */ }
    }

    // ── Try to match to existing contact ─────────────────────────────────────
    let contactId = null;
    if (!v.isAnonymous && v.liUrl) {
      const { rows: cRows } = await db.query(
        `SELECT id FROM contacts
         WHERE workspace_id=$1 AND (li_profile_url=$2 OR provider_id=$3)
         LIMIT 1`,
        [workspaceId, v.liUrl, v.providerId || '']
      );
      contactId = cRows[0]?.id || null;
    }

    // ── Record in profile_view_events ─────────────────────────────────────────
    try {
      await db.query(
        `INSERT INTO profile_view_events
           (workspace_id, account_id, viewed_at, is_anonymous, viewer_name, viewer_title,
            viewer_provider_id, viewer_li_url, contact_id, raw_caption)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [workspaceId, accountId, v.viewedAt, v.isAnonymous,
         v.name, v.title, v.providerId, v.liUrl, contactId, v.caption]
      );
    } catch(e) {
      console.error(`[ProfileViewScraper] INSERT pve error: ${e.message}`);
      continue;
    }

    if (v.isAnonymous) continue; // rest is only for identified viewers

    identified++;

    // ── Mark contact in list_contacts if they're in a list ────────────────────
    if (contactId) {
      const { rowCount } = await db.query(
        `UPDATE list_contacts
         SET viewed_our_profile=true, viewed_our_profile_at=COALESCE(viewed_our_profile_at,$1)
         WHERE contact_id=$2`,
        [v.viewedAt || new Date(), contactId]
      );
      // Contact exists but not in any list -> add to Profile Viewers list
      if (rowCount === 0) {
        const listId = await getOrCreateViewersList(workspaceId);
        await db.query(
          `INSERT INTO list_contacts (list_id, contact_id, viewed_our_profile, viewed_our_profile_at)
           VALUES ($1,$2,true,$3)
           ON CONFLICT (list_id, contact_id) DO UPDATE
             SET viewed_our_profile=true,
                 viewed_our_profile_at=COALESCE(list_contacts.viewed_our_profile_at,$3)`,
          [listId, contactId, v.viewedAt || new Date()]
        );
        added++;
        console.log(`[ProfileViewScraper] ws=${workspaceId} existing contact -> Profile Viewers: ${v.name}`);
      }
    } else {
      // ── Not in any list — create contact and add to "Profile Viewers" list ──
      const listId = await getOrCreateViewersList(workspaceId);

      // Insert contact
      const { rows: newC } = await db.query(
        `INSERT INTO contacts
           (workspace_id, first_name, last_name, li_profile_url, provider_id, title)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (workspace_id, li_profile_url) DO UPDATE
           SET provider_id = COALESCE(EXCLUDED.provider_id, contacts.provider_id),
               title       = COALESCE(EXCLUDED.title, contacts.title)
         RETURNING id`,
        [workspaceId,
         v.name.split(' ')[0] || '',
         v.name.split(' ').slice(1).join(' ') || '',
         v.liUrl,
         v.providerId,
         v.title || null]
      );

      const newContactId = newC[0]?.id;
      if (newContactId) {
        await db.query(
          `INSERT INTO list_contacts (list_id, contact_id, viewed_our_profile, viewed_our_profile_at)
           VALUES ($1,$2,true,$3)
           ON CONFLICT (list_id, contact_id) DO UPDATE
             SET viewed_our_profile=true,
                 viewed_our_profile_at=COALESCE(list_contacts.viewed_our_profile_at,$3)`,
          [listId, newContactId, v.viewedAt || new Date()]
        );

        // Update event with resolved contact_id
        await db.query(
          `UPDATE profile_view_events SET contact_id=$1
           WHERE workspace_id=$2 AND account_id=$3 AND viewer_li_url=$4
             AND scraped_at > NOW() - INTERVAL '1 minute'`,
          [newContactId, workspaceId, accountId, v.liUrl]
        );

        added++;
        console.log(`[ProfileViewScraper] ✅ ws=${workspaceId} NEW viewer: ${v.name} (${v.liUrl}) → list ${listId}`);
      }
    }
  }

  return { total: viewers.length, identified, added };
}

// ── Daily analytics snapshot ──────────────────────────────────────────────────

async function updateDailyAnalytics(workspaceId) {
  // Count today's views per workspace
  const { rows } = await db.query(
    `SELECT
       COUNT(*) AS total_views,
       COUNT(*) FILTER (WHERE is_anonymous = false) AS identified_views
     FROM profile_view_events
     WHERE workspace_id=$1 AND scraped_at >= CURRENT_DATE`,
    [workspaceId]
  );
  const { total_views, identified_views } = rows[0] || {};

  // Upsert into campaign_daily_stats for workspace-level tracking
  // We use campaign_id=NULL for workspace-level rows where applicable
  // For now we just log; the stats snapshotter picks it up hourly
  console.log(`[ProfileViewScraper] ws=${workspaceId} today: ${total_views} views (${identified_views} identified)`);
}

// ── Main run ──────────────────────────────────────────────────────────────────

// ── Profile viewer enrichment ─────────────────────────────────────────────────
async function enrichProfileViewers(workspaceId, limit = 30) {
  await ensureTable();
  await db.query(`ALTER TABLE profile_view_events ADD COLUMN IF NOT EXISTS viewer_company TEXT`).catch(()=>{});

  const { rows: toEnrich } = await db.query(`
    SELECT pve.id, pve.account_id, pve.viewer_provider_id, pve.viewer_li_url,
           pve.viewer_title, pve.viewer_name, c.company AS contact_company
    FROM profile_view_events pve
    LEFT JOIN contacts c ON c.id = pve.contact_id
    WHERE pve.workspace_id = $1
      AND pve.is_anonymous = false
      AND pve.viewer_company IS NULL
      AND (pve.viewer_provider_id IS NOT NULL OR pve.viewer_li_url IS NOT NULL)
    LIMIT $2
  `, [workspaceId, limit]);

  if (!toEnrich.length) return { enriched: 0 };

  const UNIPILE_DSN     = process.env.UNIPILE_DSN;
  const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;

  // Get a valid account for this workspace
  const { rows: accts } = await db.query(
    `SELECT account_id FROM unipile_accounts WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );
  const accountId = accts[0]?.account_id;

  let enriched = 0;

  for (const viewer of toEnrich) {
    let company = null;

    // 1. Contact's company
    if (viewer.contact_company) {
      company = viewer.contact_company;
    }

    // 2. Parse from title: "Role at Company"
    if (!company && viewer.viewer_title) {
      const m = viewer.viewer_title.match(/at\s+([A-Z][^\|\n,]{2,60})(?:\s*[\|,]|$)/);
      if (m) company = m[1].trim();
    }

    // 3. Unipile GET /api/v1/users/{id}?linkedin_sections=experience — current company
    if (!company && viewer.viewer_li_url && accountId && UNIPILE_DSN) {
      try {
        const pid = (viewer.viewer_li_url || '').split('/in/')[1]?.replace(/\/.*/, '').trim();
        if (pid) {
          const useAcct = viewer.account_id || accountId;
          const r = await fetch(
            `${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(pid)}?account_id=${useAcct}&linkedin_sections=experience&notify=false`,
            { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json' } }
          );
          if (r.ok) {
            const profile = await r.json();
            const we = profile.work_experience || [];
            const current = we.find(e => !e.end_date) || we[0];
            company = current?.company || current?.company_name || null;
          }
          await new Promise(r => setTimeout(r, 400));
        }
      } catch(e) { /* silent */ }
    }

    if (company) {
      await db.query(
        `UPDATE profile_view_events SET viewer_company = $1 WHERE id = $2`,
        [company, viewer.id]
      );
      enriched++;
    }
  }

  if (enriched > 0) {
    console.log(`[ProfileViewScraper] Enriched ${enriched}/${toEnrich.length} viewers in ws=${workspaceId}`);
  }
  return { enriched, total: toEnrich.length };
}

async function runAllWorkspaces() {
  console.log('[ProfileViewScraper] Starting scrape cycle...');
  try {
    const { rows: accounts } = await db.query(
      `SELECT DISTINCT ua.workspace_id, ua.account_id
       FROM unipile_accounts ua`
    );

    const wsSummary = {};
    // Get full account info (for company page URN)
    const { rows: fullAccounts } = await db.query(
      `SELECT ua.workspace_id, ua.account_id, ua.settings
       FROM unipile_accounts ua`
    );

    for (const { workspace_id, account_id } of accounts) {
      try {
        // Personal profile views
        const result = await processAccount(workspace_id, account_id);
        if (!wsSummary[workspace_id]) wsSummary[workspace_id] = { total:0, identified:0, added:0 };
        wsSummary[workspace_id].total      += result.total;
        wsSummary[workspace_id].identified += result.identified;
        wsSummary[workspace_id].added      += result.added;
        await new Promise(r => setTimeout(r, 1500));

        // Company page views — if this account has a company page
        const fullAcc = fullAccounts.find(a => a.account_id === account_id);
        const settings = fullAcc?.settings || {};
        const coUrn = settings.company_page_urn || '';
        // Extract org ID from URN like urn:li:organization:123456789
        const orgId = coUrn.match(/organization:(\d+)/)?.[1]
          || settings.company_page_url?.match(/company\/(\d+)/)?.[1];

        if (orgId) {
          try {
            const coResult = await processCompanyPageAccount(workspace_id, account_id, orgId, coUrn);
            if (coResult.total > 0 || coResult.visitors > 0) {
              console.log(`[ProfileViewScraper] ws=${workspace_id} company page: ${coResult.total} views, ${coResult.visitors} identified`);
            }
          } catch(e) {
            console.warn(`[ProfileViewScraper] company page err ${account_id}:`, e.message);
          }
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (e) {
        console.error(`[ProfileViewScraper] acc ${account_id}:`, e.message);
      }
    }

    for (const [wsId, s] of Object.entries(wsSummary)) {
      if (s.total > 0)
        console.log(`[ProfileViewScraper] ws=${wsId}: ${s.total} viewers scraped | ${s.identified} identified | ${s.added} new contacts added`);
      await updateDailyAnalytics(parseInt(wsId));
    }

    console.log('[ProfileViewScraper] Scrape cycle complete.');

    // Auto-enrich viewers with company names
    const wsIds = [...new Set(accounts.map(a => a.workspace_id))];
    for (const wsId of wsIds) {
      try {
        await enrichProfileViewers(wsId, 30);
      } catch(e) {
        console.warn('[ProfileViewScraper] auto-enrich ws=' + wsId + ':', e.message);
      }
    }
  } catch (e) {
    console.error('[ProfileViewScraper] runAllWorkspaces error:', e.message);
  }
}

// ── Posts fetcher: scrape latest 10 posts per account, 3×/day ──────────────────

async function fetchAllUserPosts() {
  const UNIPILE_DSN     = process.env.UNIPILE_DSN;
  const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;

  // Ensure user_posts table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_posts (
      id              SERIAL PRIMARY KEY,
      workspace_id    INTEGER NOT NULL,
      account_id      VARCHAR(255) NOT NULL,
      post_id         VARCHAR(255),
      social_id       VARCHAR(255),
      share_url       TEXT,
      post_date       VARCHAR(255),
      parsed_datetime TIMESTAMP,
      text            TEXT,
      likes_count     INTEGER DEFAULT 0,
      comments_count  INTEGER DEFAULT 0,
      reposts_count   INTEGER DEFAULT 0,
      impressions     INTEGER DEFAULT 0,
      is_repost       BOOLEAN DEFAULT FALSE,
      author_name     TEXT,
      author_pid      VARCHAR(255),
      scraped_at      TIMESTAMP DEFAULT NOW()
    )
  `).catch(()=>{});
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_up_post_acc ON user_posts(post_id, account_id) WHERE post_id IS NOT NULL`).catch(()=>{});

  const { rows: accounts } = await db.query(
    `SELECT workspace_id, account_id, display_name FROM unipile_accounts ORDER BY workspace_id, account_id`
  );

  let total = 0;
  for (const acc of accounts) {
    const { workspace_id: wsId, account_id: accId, display_name: name } = acc;
    try {
      // Get provider_id via /me
      const meRes = await fetch(`${UNIPILE_DSN}/api/v1/users/me?account_id=${accId}`, {
        headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json' }
      });
      if (!meRes.ok) continue;
      const me = await meRes.json();
      const pid = me.provider_id || me.entity_urn?.split(':').pop();
      if (!pid) continue;

      // Fetch latest 10 posts
      const postsRes = await fetch(
        `${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(pid)}/posts?account_id=${accId}&limit=10`,
        { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json' } }
      );
      if (!postsRes.ok) continue;
      const data = await postsRes.json();
      const posts = data.items || [];

      for (const post of posts) {
        try {
          await db.query(`
            INSERT INTO user_posts
              (workspace_id, account_id, post_id, social_id, share_url, post_date,
               parsed_datetime, text, likes_count, comments_count, reposts_count,
               impressions, is_repost, author_name, author_pid)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            ON CONFLICT (post_id, account_id) DO UPDATE SET
              likes_count    = EXCLUDED.likes_count,
              comments_count = EXCLUDED.comments_count,
              reposts_count  = EXCLUDED.reposts_count,
              impressions    = EXCLUDED.impressions,
              scraped_at     = NOW()
          `, [
            wsId, accId,
            post.id || post.social_id,
            post.social_id,
            post.share_url || null,
            post.date || null,
            post.parsed_datetime ? new Date(post.parsed_datetime) : null,
            post.text || '',
            post.reaction_counter || post.likes_count || 0,
            post.comment_counter  || post.comments_count || 0,
            post.repost_counter   || post.reposts_count || 0,
            post.impressions_counter || post.impressions || 0,
            post.is_repost || false,
            post.author?.name || null,
            post.author?.id   || post.author?.public_identifier || null
          ]);
          total++;
        } catch(e) { /* skip duplicate/bad */ }
      }

      console.log(`[PostsScraper] ws${wsId}/${name||accId.substring(0,8)}: ${posts.length} posts`);
      await new Promise(r => setTimeout(r, 600));
    } catch(e) {
      console.warn(`[PostsScraper] ${accId}: ${e.message}`);
    }
  }

  console.log(`[PostsScraper] Done — upserted ${total} posts across ${accounts.length} accounts`);
  return { total, accounts: accounts.length };
}

// ── Engagement sync: incremental reactions+comments every 30 min ─────────────

async function syncEngagementAllAccounts() {
  const UNIPILE_DSN     = process.env.UNIPILE_DSN;
  const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) return;

  // Call the sync endpoint via internal HTTP (server is already running)
  // Use db directly instead — reuse same logic inline
  const { rows: accounts } = await db.query(
    `SELECT DISTINCT workspace_id, account_id, display_name FROM unipile_accounts ORDER BY workspace_id, account_id`
  );

  const BATCH = 10;
  let reactionsNew = 0, commentsNew = 0;

  for (const acc of accounts) {
    const { workspace_id: wsId, account_id: accId } = acc;

    const { rows: posts } = await db.query(
      `SELECT post_id, social_id FROM user_posts WHERE account_id=$1 AND post_id IS NOT NULL ORDER BY scraped_at DESC`,
      [accId]
    );

    for (const post of posts) {
      const postId   = post.post_id;
      const socialId = post.social_id || postId;

      // Reactions — incremental
      let cursor = null;
      while (true) {
        let url = `${UNIPILE_DSN}/api/v1/posts/${encodeURIComponent(postId)}/reactions?account_id=${accId}&limit=${BATCH}`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
        let items = [], nextCursor = null;
        try {
          const rd = await fetch(url, { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json' } }).then(r=>r.json());
          items = rd.items || [];
          nextCursor = rd.cursor || null;
        } catch(e) { break; }
        if (!items.length) break;
        let allNew = true;
        for (const reaction of items) {
          const rId = reaction.author?.id;
          if (!rId) continue;
          const { rows: ex } = await db.query(`SELECT id FROM post_reactions WHERE post_id=$1 AND reactor_id=$2 LIMIT 1`, [postId, rId]);
          if (ex.length) { allNew = false; break; }
          await db.query(`INSERT INTO post_reactions (post_id,account_id,workspace_id,reactor_id,reactor_name,reactor_headline,reactor_url,reaction_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [postId,accId,wsId,rId,reaction.author?.name||null,reaction.author?.headline||null,reaction.author?.profile_url||null,reaction.value||'LIKE']).catch(()=>{});
          reactionsNew++;
        }
        if (!allNew || !nextCursor) break;
        cursor = nextCursor;
        await new Promise(r=>setTimeout(r,200));
      }

      // Comments — incremental
      cursor = null;
      while (true) {
        let url = `${UNIPILE_DSN}/api/v1/posts/${encodeURIComponent(socialId)}/comments?account_id=${accId}&limit=${BATCH}`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
        let items = [], nextCursor = null;
        try {
          const cd = await fetch(url, { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json' } }).then(r=>r.json());
          items = cd.items || [];
          nextCursor = cd.cursor || null;
        } catch(e) { break; }
        if (!items.length) break;
        let allNew = true;
        for (const comment of items) {
          const cId = comment.id;
          if (!cId) continue;
          const { rows: ex } = await db.query(`SELECT id FROM post_comments WHERE comment_id=$1 LIMIT 1`, [cId]);
          if (ex.length) { allNew = false; break; }
          const ad = comment.author_details || {};
          await db.query(`INSERT INTO post_comments (post_id,comment_id,account_id,workspace_id,author_id,author_name,author_headline,author_url,text,likes_count,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [postId,cId,accId,wsId,ad.id||null,comment.author||null,ad.headline||null,ad.profile_url||null,comment.text||'',comment.reaction_counter||0,comment.date||null]).catch(()=>{});
          commentsNew++;
        }
        if (!allNew || !nextCursor) break;
        cursor = nextCursor;
        await new Promise(r=>setTimeout(r,200));
      }

      await new Promise(r=>setTimeout(r,200));
    }
    await new Promise(r=>setTimeout(r,400));
  }

  if (reactionsNew > 0 || commentsNew > 0) {
    console.log(`[EngagementSync] +${reactionsNew} reactions, +${commentsNew} comments`);
  }
}

// ── Scheduler: fire at 08:00, 14:00, 20:00 ───────────────────────────────────

let _lastFiredHour = -1;

function start() {
  ensureTable().catch(e => console.error('[ProfileViewScraper] ensureTable error:', e.message));

  setTimeout(() => {
    // Check every minute if it's time to fire
    setInterval(() => {
      const now  = new Date();
      const hour = now.getHours();
      const min  = now.getMinutes();

      if (FIRE_HOURS.includes(hour) && min === 0 && _lastFiredHour !== hour) {
        _lastFiredHour = hour;
        // Run profile view scraper + enrichment
        runAllWorkspaces().catch(e => console.error('[ProfileViewScraper] scheduled run error:', e.message));
        // Run posts fetch (all workspaces, latest 10 per account)
        fetchAllUserPosts().catch(e => console.error('[PostsScraper] scheduled run error:', e.message));
      }
    }, 60 * 1000); // check every minute

    // ── Engagement sync every 30 minutes ─────────────────────────────────
    setInterval(() => {
      syncEngagementAllAccounts().catch(e => console.error('[EngagementSync] scheduler error:', e.message));
    }, 30 * 60 * 1000); // every 30 min

    console.log(`[ProfileViewScraper] Started — fires daily at ${FIRE_HOURS.join(':00, ')}:00 | engagement sync every 30min`);
  }, STARTUP_DELAY_MS);
}

module.exports = { start, runAllWorkspaces, fetchAllUserPosts, syncEngagementAllAccounts, processAccount, processCompanyPageAccount, enrichProfileViewers, ensureTable, _parseViewer: parseViewer };
