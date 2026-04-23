/**
 * Company Followers Scraper
 *
 * âââ SCRAPE MODES âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
 *
 * LEARNING (days 0â7):  Full scrape 3Ã/day.
 * INCREMENTAL:           Only top N pages, stops early if all known.
 * FULL:                  All pages once/day.
 *
 * Company ID read from unipile_accounts.settings.company_page_urn.
 *
 * âââ AFTER EVERY SCRAPE ââââââââââââââââââââââââââââââââââââââââââââââââââââ
 *   - Upserts followers into company_followers (first_seen_at set once)
 *   - Marks company_follow_confirmed=true + company_follow_confirmed_at=NOW()
 *     for contacts whose profile_url matches a scraped follower
 */

const db = require('./db');

const UNIPILE_DSN     = process.env.UNIPILE_DSN;
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;

const BATCH_LIMIT           = 100;
const PAGE_DELAY_MS         = 4000;
const LEARNING_DAYS         = 7;
const LEARNING_INTERVAL_MS  = 30 * 60 * 1000;   // 30 minutes
const FULL_INTERVAL_MS      = 30 * 60 * 1000;   // 30 minutes
const INCREMENTAL_PAGES     = 3;
const INCREMENTAL_THRESHOLD = 50;

let isScraping = false;
let lastScrapeResult = null;
let scheduleTimer = null;

function start() {
  console.log('[FollowerScraper] Starting...');
  runScrape();
  scheduleNext();
}

function getStatus() {
  return { is_scraping: isScraping, last_result: lastScrapeResult };
}

async function scheduleNext() {
  clearTimeout(scheduleTimer);
  let intervalMs = LEARNING_INTERVAL_MS;
  try {
    const { rows } = await db.query(
      `SELECT settings FROM unipile_accounts WHERE settings->>'company_page_urn' IS NOT NULL LIMIT 1`
    );
    const mode = rows[0]?.settings?.cf_scrape_mode || 'learning';
    intervalMs = mode === 'learning' ? LEARNING_INTERVAL_MS : FULL_INTERVAL_MS;
  } catch (_) {}
  console.log(`[FollowerScraper] Next scrape in ${(intervalMs/3600000).toFixed(1)}h`);
  scheduleTimer = setTimeout(async () => { await runScrape(); scheduleNext(); }, intervalMs);
}

async function runScrape(forcedAccountId) {
  const watchdog = require('./watchdog');
  watchdog.tick('followerScraper');
  if (isScraping) return { skipped: true };
  isScraping = true;
  const startTime = Date.now();

  try {
    let accountId = forcedAccountId;
    let accountSettings = {};

    if (!accountId) {
      const { rows } = await db.query(
        `SELECT account_id, settings FROM unipile_accounts
         WHERE settings->>'company_page_urn' IS NOT NULL
           AND settings->>'company_page_urn' != ''
         LIMIT 1`
      );
      if (!rows.length) {
        console.log('[FollowerScraper] No account with company_page_urn â skipping');
        isScraping = false;
        return { skipped: true, reason: 'no_company_page_urn' };
      }
      accountId       = rows[0].account_id;
      accountSettings = rows[0].settings || {};
    } else {
      const { rows } = await db.query(
        'SELECT settings FROM unipile_accounts WHERE account_id = $1', [accountId]
      );
      accountSettings = rows[0]?.settings || {};
    }

    // Extract company numeric ID from company_page_urn
    const companyPageUrn = accountSettings.company_page_urn || '';
    const companyIdMatch = companyPageUrn.match(/(\d+)$/);
    if (!companyIdMatch) throw new Error(`Cannot extract company ID from: "${companyPageUrn}"`);
    const COMPANY_ID = companyIdMatch[1];
    console.log(`[FollowerScraper] Company ID: ${COMPANY_ID}, account: ${accountId}`);

    // Determine mode
    let mode = accountSettings.cf_scrape_mode || 'learning';
    const learningStart = accountSettings.cf_scrape_learning_start
      ? new Date(accountSettings.cf_scrape_learning_start) : null;

    if (!learningStart) {
      mode = 'learning';
      await patchSettings(accountId, {
        cf_scrape_mode: 'learning',
        cf_scrape_learning_start: new Date().toISOString(),
      });
    }

    if (mode === 'learning' && learningStart) {
      const days = (Date.now() - learningStart) / (1000 * 60 * 60 * 24);
      if (days >= LEARNING_DAYS) {
        mode = await evaluateAndSwitchMode(accountId, learningStart);
      }
    }

    console.log(`[FollowerScraper] Mode: ${mode}`);

    const followers = await fetchFollowers(accountId, COMPANY_ID, mode);

    // Upsert followers
    let newFollowers = 0;
    for (let i = 0; i < followers.length; i++) {
      const f = followers[i];
      const profileUrl = normalizeUrl(f.profile_url || '');
      const followerId = f.id || f.urn || null;
      if (!followerId) continue;
      const res = await db.query(
        `INSERT INTO company_followers
           (account_id, follower_id, follower_urn, name, headline, profile_url,
            first_seen_at, first_seen_position, scraped_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,NOW())
         ON CONFLICT (account_id, follower_id) DO UPDATE SET
           name=EXCLUDED.name, headline=EXCLUDED.headline,
           profile_url=EXCLUDED.profile_url, scraped_at=NOW()
         RETURNING (xmax = 0) AS inserted`,
        [accountId, followerId, f.urn||null, f.name||'', f.headline||'', profileUrl, i]
      );
      if (res.rows[0]?.inserted) newFollowers++;
    }

    // Cross-reference: mark confirmed + set timestamp
    const { rowCount: confirmed } = await db.query(
      `UPDATE contacts c
       SET company_follow_confirmed = true,
           company_follow_confirmed_at = NOW()
       FROM campaigns camp, company_followers cf
       WHERE camp.id = c.campaign_id
         AND cf.account_id = camp.account_id
         AND (
           lower(cf.profile_url) = lower(c.li_profile_url)
           OR cf.profile_url ILIKE '%' || split_part(c.li_profile_url, '/in/', 2) || '%'
         )
         AND c.company_follow_invited = true
         AND (c.company_follow_confirmed = false OR c.company_follow_confirmed IS NULL)`
    );

    await patchSettings(accountId, { cf_scrape_last_run: new Date().toISOString() });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    lastScrapeResult = {
      scraped_at: new Date().toISOString(), mode, company_id: COMPANY_ID,
      total_fetched: followers.length, new_followers: newFollowers,
      newly_confirmed: confirmed, elapsed_seconds: parseFloat(elapsed),
    };
    console.log(`[FollowerScraper] Done (${mode}) in ${elapsed}s â ${followers.length} fetched, ${newFollowers} new, ${confirmed} confirmed`);
    return lastScrapeResult;

  } catch (err) {
    console.error('[FollowerScraper] Error:', err.message);
    lastScrapeResult = { error: err.message, scraped_at: new Date().toISOString() };
    return lastScrapeResult;
  } finally {
    isScraping = false;
  }
}

async function fetchFollowers(accountId, companyId, mode) {
  const isIncremental = mode === 'incremental';
  const maxPages = isIncremental ? INCREMENTAL_PAGES : Infinity;
  const followers = [];
  let cursor = null, page = 0;

  do {
    page++;
    const params = new URLSearchParams({ account_id: accountId, user_id: companyId, limit: BATCH_LIMIT });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${UNIPILE_DSN}/api/v1/users/followers?${params}`,
      { headers: { 'X-API-KEY': UNIPILE_API_KEY, accept: 'application/json' } }
    );
    if (!res.ok) throw new Error(`Unipile ${res.status}: ${await res.text()}`);
    const data  = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    followers.push(...items);
    console.log(`[FollowerScraper] Page ${page}: ${items.length} followers`);

    if (isIncremental && items.length > 0) {
      const ids = items.map(f => f.id || f.urn).filter(Boolean);
      if (ids.length) {
        const { rows } = await db.query(
          `SELECT COUNT(*) AS cnt FROM company_followers WHERE account_id=$1 AND follower_id=ANY($2)`,
          [accountId, ids]
        );
        if (parseInt(rows[0].cnt) === ids.length) {
          console.log('[FollowerScraper] All items known â stopping early');
          break;
        }
      }
    }

    cursor = null;
    if (data.cursor) cursor = typeof data.cursor === 'object' ? data.cursor.value : data.cursor;
    if (cursor && items.length > 0 && page < maxPages) await sleep(PAGE_DELAY_MS);
  } while (cursor && page < maxPages && followers.length < 10000);

  return followers;
}

async function evaluateAndSwitchMode(accountId, learningStart) {
  const { rows } = await db.query(
    `SELECT first_seen_position FROM company_followers
     WHERE account_id=$1 AND first_seen_at>$2 AND first_seen_position IS NOT NULL`,
    [accountId, learningStart.toISOString()]
  );
  if (rows.length < 5) {
    await patchSettings(accountId, { cf_scrape_mode: 'full' }); return 'full';
  }
  const positions  = rows.map(r => parseInt(r.first_seen_position));
  const allNearTop = positions.every(p => p < INCREMENTAL_THRESHOLD);
  console.log(`[FollowerScraper] ${rows.length} new. All near top: ${allNearTop}`);
  const newMode = allNearTop ? 'incremental' : 'full';
  await patchSettings(accountId, { cf_scrape_mode: newMode });
  return newMode;
}

async function patchSettings(accountId, patch) {
  const entries = Object.entries(patch);
  if (!entries.length) return;
  // Use jsonb cast to avoid PostgreSQL type-inference issues with parameterized queries
  await db.query(
    `UPDATE unipile_accounts SET settings = settings || $2::jsonb WHERE account_id = $1`,
    [accountId, JSON.stringify(patch)]
  );
}

function normalizeUrl(url) { return (url||'').replace(/\/$/,'').toLowerCase().trim(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { start, runScrape, getStatus };
