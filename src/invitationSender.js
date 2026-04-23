/**
 * Invitation Sender
 *
 * Sends LinkedIn connection requests for active campaigns.
 * Uses provider_id (ACoXXX) — not vanity slug — as required by Unipile.
 *
 * Working hours are per-campaign (campaign.settings.hours).
 * Daily limits are per-account (accSettings.limits.connection_requests).
 *
 * Scheduled: every 15 minutes.
 */

const db = require('./db');
const { sendInvitation } = require('./unipile');
const { DEFAULT_WORKING_HOURS } = require('./constants');

const DEFAULT_DAILY_LIMIT = 20;
const activelySending = new Set();

function start() {
  console.log('[InvitationSender] Started — checking every 15 minutes');
  run();
  setInterval(run, 15 * 60 * 1000);
}

async function run() {
  const watchdog = require('./watchdog');
  watchdog.tick('invitationSender');
  console.log('[InvitationSender] Running check...');
  try {
    // Include workspace_id in query + join with correct workspace settings row
    const { rows: campaigns } = await db.query(`
      SELECT c.id, c.account_id, c.name, c.workspace_id, c.settings,
             ua.settings AS account_settings
      FROM campaigns c
      JOIN unipile_accounts ua
        ON  ua.account_id   = c.account_id
        AND ua.workspace_id = c.workspace_id
      WHERE c.status = 'active'
        AND (c.settings->'connection'->>'enabled')::boolean = true
    `);

    if (!campaigns.length) {
      console.log('[InvitationSender] No active campaigns with connection requests enabled');
      return;
    }

    // Group by workspace_id + account_id so each workspace is processed independently
    // Key format: "workspaceId:accountId"
    const byKey = {};
    for (const camp of campaigns) {
      const key = `${camp.workspace_id}:${camp.account_id}`;
      if (!byKey[key]) byKey[key] = { accountId: camp.account_id, workspaceId: camp.workspace_id, accountSettings: camp.account_settings, campaigns: [] };
      byKey[key].campaigns.push(camp);
    }

    for (const { accountId, workspaceId, accountSettings, campaigns: accountCampaigns } of Object.values(byKey)) {
      if (activelySending.has(accountId)) {
        console.log(`[InvitationSender] Account ${accountId} already sending, skipping`);
        continue;
      }

      const accSettings = (typeof accountSettings === 'string' ? JSON.parse(accountSettings) : accountSettings) || {};

      const dailyLimit = accSettings.limits?.connection_requests ?? DEFAULT_DAILY_LIMIT;
      const sentToday  = await countSentToday(accountId, workspaceId);
      const canSend    = dailyLimit - sentToday;

      if (canSend <= 0) {
        console.log(`[InvitationSender] Account ${accountId} reached daily limit (${dailyLimit}), skipping`);
        continue;
      }

      console.log(`[InvitationSender] Account ${accountId}: ${sentToday}/${dailyLimit} sent today, can send ${canSend} more`);

      let remaining = canSend;

      // Count campaigns that actually have pending contacts (avoid wasting budget)
      const activeCampaigns = [];
      for (const campaign of accountCampaigns) {
        const hours = campaign.settings?.hours || accSettings.hours || null;
        if (!isWithinWorkingHours(hours)) continue;
        const count = await getPendingContactsForCampaign(campaign.id, 1);
        if (count.length) activeCampaigns.push(campaign);
      }

      if (!activeCampaigns.length) continue;

      // Split daily budget evenly so all campaigns get a fair share
      const perCampaign = Math.max(1, Math.ceil(remaining / activeCampaigns.length));

      for (const campaign of activeCampaigns) {
        if (remaining <= 0) break;
        const budget = Math.min(perCampaign, remaining);

        const contacts = await getPendingContactsForCampaign(campaign.id, budget);
        if (!contacts.length) continue;

        remaining -= contacts.length;
        sendBatch(accountId, contacts);
      }
    }
  } catch (err) {
    console.error('[InvitationSender] Error in run():', err.message);
  }
}

async function sendBatch(accountId, contacts) {
  activelySending.add(accountId);
  console.log(`[InvitationSender] Starting batch for ${accountId}: ${contacts.length} contacts`);

  for (const contact of contacts) {
    try {
      if (!contact.provider_id) {
        console.warn(`[InvitationSender] No provider_id for contact ${contact.id} — skipping`);
        continue;
      }
      await sendInvitation(accountId, contact.provider_id);
      await db.query(
        'UPDATE contacts SET invite_sent = true, invite_sent_at = NOW() WHERE id = $1',
        [contact.id]
      );
      // Sync enrollment: if this contact has an enrollment in 'pending', move it to 'invite_sent'
      await db.query(`
        UPDATE enrollments SET status='invite_sent', invite_sent_at=NOW(),
          next_action_at=NOW() + INTERVAL '14 days', updated_at=NOW()
        WHERE contact_id=$1 AND status='pending'
      `, [contact.id]).catch(() => {});
      console.log(`[InvitationSender] ✓ Sent to ${contact.provider_id} (contact ${contact.id}, campaign ${contact.campaign_id})`);
      await sleep(30000 + Math.random() * 60000);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('cannot_resend_yet') || msg.includes('already_connected')) {
        // Already has pending invite or is connected — mark done to skip next time
        await db.query('UPDATE contacts SET invite_sent = true, invite_sent_at = NOW() WHERE id = $1', [contact.id]).catch(()=>{});
        console.log(`[InvitationSender] contact ${contact.id} — already invited/connected, marking done`);
      } else {
        console.error(`[InvitationSender] ✗ contact ${contact.id}: ${msg}`);
      }
    }
  }

  activelySending.delete(accountId);
  console.log(`[InvitationSender] Batch done for ${accountId}`);
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

async function countSentToday(accountId, workspaceId) {
  const { rows } = await db.query(`
    SELECT COUNT(*) AS cnt
    FROM contacts c
    JOIN campaigns camp ON camp.id = c.campaign_id
    WHERE camp.account_id   = $1
      AND camp.workspace_id = $2
      AND c.invite_sent = true
      AND c.invite_sent_at >= date_trunc('day', NOW())
  `, [accountId, workspaceId]);
  return parseInt(rows[0].cnt, 10);
}

async function getPendingContactsForCampaign(campaignId, limit) {
  const { rows } = await db.query(`
    SELECT c.id, c.li_profile_url, c.provider_id, c.first_name, c.last_name, c.campaign_id
    FROM contacts c
    JOIN campaigns camp ON camp.id = c.campaign_id
    WHERE camp.id = $1
      AND camp.status = 'active'
      AND (camp.settings->'connection'->>'enabled')::boolean = true
      AND c.invite_sent       = false
      AND c.already_connected = false
      AND c.provider_id LIKE 'ACo%'
      AND c.li_profile_url IS NOT NULL
      AND c.li_profile_url != ''
      -- Cross-account rule: skip if already messaged by any other account in workspace
      AND NOT EXISTS (
        SELECT 1 FROM contacts c2
        JOIN campaigns camp2 ON camp2.id = c2.campaign_id
        WHERE c2.li_profile_url = c.li_profile_url
          AND c2.msg_sent = true
          AND camp2.workspace_id = camp.workspace_id
          AND c2.campaign_id <> $1
      )
    ORDER BY c.created_at ASC
    LIMIT $2
  `, [campaignId, limit]);
  return rows;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { start };
