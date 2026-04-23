/**
 * inboundSignalsScraper.js
 *
 * Built-in automation for ALL workspaces.
 * Runs 3× per day (09:00, 15:00, 21:00 server time).
 *
 * For every workspace that has a LinkedIn account:
 *   1. Collects inbound signals: profile views + post reactions + post comments
 *   2. Enriches new contacts via Unipile /api/v1/users/:pid
 *   3. Creates "Inbound Signals" list if it doesn't exist
 *   4. Adds enriched contacts to the list
 *
 * The list is ALWAYS ensured on server startup too (empty seed).
 */

const db = require('./db');

const FIRE_HOURS    = [9, 15, 21];
const BATCH_LIMIT   = 15;  // enrichments per workspace per run (rate-limit safe)
const STARTUP_DELAY = 5 * 60 * 1000; // 5 min after boot before first run

const UNIPILE_DSN     = process.env.UNIPILE_DSN;
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;

// ── Ensure "Inbound Signals" list exists for a workspace ─────────────────────
async function ensureInboundList(wsId) {
  const { rows } = await db.query(
    `SELECT id FROM lists WHERE workspace_id=$1 AND name='Inbound Signals' LIMIT 1`, [wsId]
  );
  if (rows.length) return rows[0].id;

  const { rows: ins } = await db.query(
    `INSERT INTO lists (workspace_id, name, type, description)
     VALUES ($1, 'Inbound Signals', 'contacts',
             'Auto-generated: people who engaged with your LinkedIn content')
     ON CONFLICT DO NOTHING RETURNING id`,
    [wsId]
  );
  if (ins.length) {
    console.log(`[InboundSignals] Created "Inbound Signals" list for workspace ${wsId}`);
    return ins[0].id;
  }
  // Race condition — fetch again
  const { rows: r2 } = await db.query(
    `SELECT id FROM lists WHERE workspace_id=$1 AND name='Inbound Signals' LIMIT 1`, [wsId]
  );
  return r2[0]?.id || null;
}

// ── Ensure schema columns ────────────────────────────────────────────────────
async function ensureColumns() {
  await db.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS viewed_profile  BOOLEAN DEFAULT FALSE`).catch(()=>{});
  await db.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS liked_post      BOOLEAN DEFAULT FALSE`).catch(()=>{});
  await db.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS commented_post  BOOLEAN DEFAULT FALSE`).catch(()=>{});
  await db.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS inbound_signal  BOOLEAN DEFAULT FALSE`).catch(()=>{});
  await db.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enriched_at     TIMESTAMP`).catch(()=>{});
}

// ── Run for one workspace ─────────────────────────────────────────────────────
async function runForWorkspace(wsId, accountId) {
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) return;

  // Collect all unique LinkedIn identifiers from signal tables
  const { rows: toEnrich } = await db.query(`
    SELECT li_url, public_id, signal_type
    FROM (
      SELECT viewer_li_url AS li_url,
             SPLIT_PART(viewer_li_url, '/in/', 2) AS public_id,
             'view' AS signal_type
      FROM profile_view_events
      WHERE workspace_id=$1 AND is_anonymous=false
        AND viewer_li_url IS NOT NULL AND viewer_li_url != ''

      UNION ALL

      SELECT reactor_url AS li_url,
             SPLIT_PART(reactor_url, '/in/', 2) AS public_id,
             'like' AS signal_type
      FROM post_reactions
      WHERE workspace_id=$1
        AND reactor_url IS NOT NULL AND reactor_url != ''

      UNION ALL

      SELECT author_url AS li_url,
             SPLIT_PART(author_url, '/in/', 2) AS public_id,
             'comment' AS signal_type
      FROM post_comments
      WHERE workspace_id=$1
        AND author_url IS NOT NULL AND author_url != ''
    ) raw
    WHERE public_id IS NOT NULL AND public_id != ''
    GROUP BY li_url, public_id, signal_type
  `, [wsId]).catch(() => ({ rows: [] }));

  // Deduplicate by li_url, merge signal types
  const byUrl = {};
  for (const row of toEnrich) {
    const url = (row.li_url || '').split('?')[0].replace(/\/+$/, '');
    const pid = (row.public_id || '').replace(/\/.*/, '').trim();
    if (!pid) continue;
    if (!byUrl[url]) byUrl[url] = { li_url: url, public_id: pid, signals: new Set() };
    byUrl[url].signals.add(row.signal_type);
  }
  const people = Object.values(byUrl);
  if (!people.length) return;

  // Filter to only those not yet enriched
  const needsEnrich = [];
  for (const p of people) {
    const { rows: ex } = await db.query(
      `SELECT id, enriched_at FROM contacts WHERE workspace_id=$1 AND li_profile_url=$2 LIMIT 1`,
      [wsId, p.li_url]
    );
    if (!(ex.length > 0 && ex[0].enriched_at)) {
      needsEnrich.push({ ...p, existingId: ex[0]?.id || null });
    }
  }

  const batch = needsEnrich.slice(0, BATCH_LIMIT);
  let enriched = 0;

  for (const person of batch) {
    try {
      const r = await fetch(
        `${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(person.public_id)}?account_id=${accountId}&linkedin_sections=*_preview&notify=false`,
        { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json' } }
      );
      if (!r.ok) { await new Promise(r => setTimeout(r, 500)); continue; }
      const profile = await r.json();

      const we      = profile.work_experience || [];
      const current = we.find(e => !e.end_date) || we[0];
      const company    = current?.company   || null;
      const title      = current?.position  || null;
      const firstName  = profile.first_name || null;
      const lastName   = profile.last_name  || null;
      const provId     = profile.provider_id || profile.public_identifier || null;
      const signalArr  = [...person.signals];
      const viewedProfile = signalArr.includes('view');
      const likedPost     = signalArr.includes('like');
      const commentedPost = signalArr.includes('comment');

      if (person.existingId) {
        await db.query(`
          UPDATE contacts SET
            first_name   = COALESCE(NULLIF($2,''), first_name),
            last_name    = COALESCE(NULLIF($3,''), last_name),
            title        = COALESCE(NULLIF($4,''), title),
            company      = COALESCE(NULLIF($5,''), company),
            viewed_profile = viewed_profile OR $6,
            liked_post     = liked_post     OR $7,
            commented_post = commented_post OR $8,
            inbound_signal = TRUE,
            enriched_at    = NOW()
          WHERE id=$1
        `, [person.existingId, firstName, lastName, title, company,
            viewedProfile, likedPost, commentedPost]);
      } else {
        await db.query(`
          INSERT INTO contacts
            (workspace_id, first_name, last_name, title, company,
             li_profile_url, provider_id, inbound_signal,
             viewed_profile, liked_post, commented_post, enriched_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9,$10,NOW())
          ON CONFLICT (workspace_id, li_profile_url) DO UPDATE SET
            first_name     = COALESCE(NULLIF($2,''), contacts.first_name),
            last_name      = COALESCE(NULLIF($3,''), contacts.last_name),
            title          = COALESCE(NULLIF($4,''), contacts.title),
            company        = COALESCE(NULLIF($5,''), contacts.company),
            viewed_profile = contacts.viewed_profile OR $8,
            liked_post     = contacts.liked_post     OR $9,
            commented_post = contacts.commented_post OR $10,
            inbound_signal = TRUE,
            enriched_at    = NOW()
        `, [wsId, firstName, lastName, title, company,
            person.li_url, provId, viewedProfile, likedPost, commentedPost]);
      }
      enriched++;
      await new Promise(r => setTimeout(r, 300)); // rate-limit safety
    } catch(e) {
      console.warn(`[InboundSignals] ws=${wsId} enrich error:`, e.message);
    }
  }

  // Add all inbound_signal contacts to the Inbound Signals list
  if (enriched > 0 || people.length > 0) {
    const listId = await ensureInboundList(wsId);
    if (listId) {
      await db.query(`
        INSERT INTO list_contacts (list_id, contact_id)
        SELECT $1, c.id
        FROM contacts c
        WHERE c.workspace_id=$2
          AND c.inbound_signal=TRUE
          AND c.li_profile_url IS NOT NULL
        ON CONFLICT (list_id, contact_id) DO NOTHING
      `, [listId, wsId]).catch(() => {});
    }
  }

  if (enriched > 0) {
    console.log(`[InboundSignals] ws=${wsId}: ${people.length} signals, enriched ${enriched}/${batch.length}`);
  }
}

// ── Scan all workspaces ───────────────────────────────────────────────────────
async function scanAllWorkspaces() {
  try {
    await ensureColumns();

    const { rows: accounts } = await db.query(
      `SELECT DISTINCT workspace_id, account_id FROM unipile_accounts ORDER BY workspace_id`
    );

    for (const { workspace_id, account_id } of accounts) {
      try {
        await runForWorkspace(workspace_id, account_id);
      } catch(e) {
        console.error(`[InboundSignals] ws=${workspace_id} error:`, e.message);
      }
    }
  } catch(e) {
    console.error('[InboundSignals] scanAllWorkspaces error:', e.message);
  }
}

// ── Ensure lists exist on startup (fast path, no enrichment) ─────────────────
async function ensureAllInboundLists() {
  try {
    const { rows: accounts } = await db.query(
      `SELECT DISTINCT workspace_id FROM unipile_accounts`
    );
    for (const { workspace_id } of accounts) {
      await ensureInboundList(workspace_id).catch(() => {});
    }
    console.log(`[InboundSignals] Ensured Inbound Signals lists for ${accounts.length} workspaces`);
  } catch(e) {
    console.error('[InboundSignals] ensureAllInboundLists error:', e.message);
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
function start() {
  // Ensure lists exist quickly on startup
  setTimeout(() => ensureAllInboundLists(), 15000);

  // Run enrichment after startup delay
  setTimeout(() => scanAllWorkspaces(), STARTUP_DELAY);

  // Check every minute whether to fire
  let lastFiredHour = -1;
  setInterval(() => {
    const h = new Date().getHours();
    if (FIRE_HOURS.includes(h) && h !== lastFiredHour) {
      lastFiredHour = h;
      scanAllWorkspaces();
    }
  }, 60 * 1000);

  console.log('[InboundSignals] started — scans at 09:00, 15:00, 21:00 for all workspaces');
}

module.exports = { start, scanAllWorkspaces, ensureAllInboundLists, ensureInboundList };
