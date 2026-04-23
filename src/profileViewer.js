/**
 * Profile Viewer
 *
 * Working hours are now per-campaign (campaign.settings.hours).
 * Daily limits are per-account (accSettings.limits.profile_views).
 *
 * Rules:
 *   - Each contact viewed at most ONCE EVERY 7 DAYS
 *   - Daily limit: settings.limits.profile_views (default 40)
 *   - Working hours from campaign.settings.hours
 *   - Independent of any other action
 *   - 30-90s random delay between views
 *
 * Scheduled: every 15 minutes.
 */

const db      = require('./db');
const unipile = require('./unipile');
const { DEFAULT_WORKING_HOURS } = require('./constants');

const DEFAULT_DAILY_LIMIT = 40;
const activelySending = new Set();

function start() {
  console.log('[ProfileViewer] Started — checking every 15 minutes');
  run();
  setInterval(run, 15 * 60 * 1000);
}

async function run() {
  const watchdog = require('./watchdog');
  watchdog.tick('profileViewer');
  console.log('[ProfileViewer] Running check...');
  try {
    const { rows: campaigns } = await db.query(`
      SELECT c.id, c.account_id, c.workspace_id, c.settings,
             ua.settings AS account_settings
      FROM campaigns c
      JOIN unipile_accounts ua
        ON  ua.account_id   = c.account_id
        AND ua.workspace_id = c.workspace_id
      WHERE c.status = 'active'
        AND (c.settings->'engagement'->>'view_profile')::boolean = true
    `);

    if (!campaigns.length) {
      console.log('[ProfileViewer] No active campaigns with view_profile enabled');
      return;
    }

    const byKey = {};
    for (const camp of campaigns) {
      const key = `${camp.workspace_id}:${camp.account_id}`;
      if (!byKey[key]) byKey[key] = { accountId: camp.account_id, workspaceId: camp.workspace_id, accountSettings: camp.account_settings, campaigns: [] };
      byKey[key].campaigns.push(camp);
    }

    for (const { accountId, workspaceId, accountSettings, campaigns: accountCampaigns } of Object.values(byKey)) {
      if (activelySending.has(accountId)) {
        console.log(`[ProfileViewer] Account ${accountId} already running, skipping`);
        continue;
      }

      const accSettings = (typeof accountSettings === 'string' ? JSON.parse(accountSettings) : accountSettings) || {};

      const dailyLimit  = accSettings.limits?.profile_views ?? DEFAULT_DAILY_LIMIT;
      const viewedToday = await countViewedToday(accountId, workspaceId);
      let canView       = dailyLimit - viewedToday;

      if (canView <= 0) {
        console.log(`[ProfileViewer] Account ${accountId} reached daily limit (${dailyLimit})`);
        continue;
      }

      console.log(`[ProfileViewer] Account ${accountId}: ${viewedToday}/${dailyLimit} today, can view ${canView} more`);

      for (const campaign of accountCampaigns) {
        if (canView <= 0) break;

        const hours = campaign.settings?.hours || null;
        if (!isWithinWorkingHours(hours)) {
          console.log(`[ProfileViewer] Campaign ${campaign.id} outside working hours`);
          continue;
        }

        const contacts = await getPendingContacts([campaign.id], canView);
        if (!contacts.length) {
          console.log(`[ProfileViewer] Campaign ${campaign.id}: no contacts due for viewing`);
          continue;
        }

        canView -= contacts.length;
        sendBatch(accountId, contacts);
      }
    }
  } catch (err) {
    console.error('[ProfileViewer] Error in run():', err.message);
  }
}

async function sendBatch(accountId, contacts) {
  activelySending.add(accountId);
  console.log(`[ProfileViewer] Batch for ${accountId}: ${contacts.length} contacts`);

  for (const contact of contacts) {
    try {
      const identifier = extractIdentifier(contact.li_profile_url);
      if (!identifier) { console.warn(`[ProfileViewer] No identifier for contact ${contact.id}`); continue; }

      await unipile.viewProfile(accountId, identifier);

      await db.query(
        `UPDATE contacts
         SET last_profile_view_at = NOW(),
             profile_view_count   = COALESCE(profile_view_count, 0) + 1
         WHERE id = $1`,
        [contact.id]
      );

      console.log(`[ProfileViewer] ✓ Viewed ${identifier} (contact ${contact.id}, campaign ${contact.campaign_id})`);
      await sleep(30000 + Math.random() * 60000);
    } catch (err) {
      console.error(`[ProfileViewer] ✗ contact ${contact.id}: ${err.message}`);
    }
  }

  activelySending.delete(accountId);
  console.log(`[ProfileViewer] Batch done for ${accountId}`);
}

async function getPendingContacts(campaignIds, limit) {
  const { rows } = await db.query(`
    SELECT c.id, c.li_profile_url, c.first_name, c.last_name, c.campaign_id
    FROM contacts c
    JOIN campaigns camp ON camp.id = c.campaign_id
    WHERE camp.id = ANY($1)
      AND camp.status = 'active'
      AND (camp.settings->'engagement'->>'view_profile')::boolean = true
      AND c.li_profile_url IS NOT NULL
      AND c.li_profile_url != ''
      AND (
        c.last_profile_view_at IS NULL
        OR c.last_profile_view_at < NOW() - INTERVAL '7 days'
      )
    ORDER BY c.last_profile_view_at ASC NULLS FIRST, c.created_at ASC
    LIMIT $2
  `, [campaignIds, limit]);
  return rows;
}

async function countViewedToday(accountId, workspaceId) {
  const { rows } = await db.query(`
    SELECT COUNT(*) AS cnt
    FROM contacts c
    JOIN campaigns camp ON camp.id = c.campaign_id
    WHERE camp.account_id   = $1
      AND camp.workspace_id = $2
      AND c.last_profile_view_at >= date_trunc('day', NOW())
  `, [accountId, workspaceId]);
  return parseInt(rows[0].cnt, 10);
}

function isWithinWorkingHours(hours) {
  const now    = new Date();
  const jsDay  = now.getDay();
  const dayKey = String(jsDay === 0 ? 7 : jsDay);
  const h      = (hours && hours[dayKey]) || DEFAULT_WORKING_HOURS[dayKey];
  if (!h?.on) return false;
  const [fromH, fromM] = (h.from || '09:00').split(':').map(Number);
  const [toH,   toM  ] = (h.to   || '18:00').split(':').map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= fromH * 60 + fromM && nowMin < toH * 60 + toM;
}

function extractIdentifier(url) {
  const match = (url || '').match(/linkedin\.com\/in\/([^/?#]+)/);
  return match ? match[1] : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { start };
