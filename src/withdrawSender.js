/**
 * Withdraw Sender
 *
 * Automatically withdraws pending LinkedIn connection requests
 * that have not been accepted within the configured number of days.
 *
 * How it works:
 *   - Reads withdraw_after_days from campaign settings
 *   - Finds contacts where:
 *       invite_sent = true
 *       invite_approved = false
 *       invite_withdrawn = false (or null)
 *       invite_sent_at < NOW() - withdraw_after_days
 *   - Calls Unipile DELETE /api/v1/users/invite for each
 *   - Updates invite_withdrawn = true, invite_withdrawn_at = NOW()
 *
 * campaign.settings.connection.withdraw_after_days:
 *   - 0 or absent: feature disabled for that campaign
 *   - e.g. 14: withdraw after 14 days of no response
 *
 * Scheduled: once daily at 08:00.
 */

const db      = require('./db');
const unipile = require('./unipile');

const DEFAULT_WITHDRAW_DAYS = 0; // 0 = disabled by default
const rand  = (min, max) => min + Math.random() * (max - min);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let isRunning = false;

function start() {
  console.log('[WithdrawSender] Started — runs daily at 08:00');
  scheduleDaily();
}

function scheduleDaily() {
  const now   = new Date();
  const next  = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntil = next - now;
  console.log(`[WithdrawSender] Next run in ${Math.round(msUntil / 3600000)}h`);
  setTimeout(() => { run(); setInterval(run, 24 * 60 * 60 * 1000); }, msUntil);
}

async function run(campaignId = null) {
  const watchdog = require('./watchdog');
  watchdog.tick('withdrawSender');
  if (isRunning) { console.log('[WithdrawSender] Already running, skipping'); return { skipped: true }; }
  isRunning = true;
  console.log('[WithdrawSender] Starting run...');

  try {
    // Find campaigns with withdraw enabled (withdraw_after_days > 0)
    let query = `
      SELECT c.id, c.account_id, c.name, c.settings
      FROM campaigns c
      WHERE c.status = 'active'
        AND (c.settings->'connection'->>'withdraw_after_days')::int > 0
    `;
    const qp = [];
    if (campaignId) { qp.push(campaignId); query += ` AND c.id = $${qp.length}`; }

    const { rows: campaigns } = await db.query(query, qp);
    if (!campaigns.length) {
      console.log('[WithdrawSender] No campaigns with withdraw enabled');
      return { campaigns_processed: 0 };
    }

    const summary = [];
    for (const campaign of campaigns) {
      const result = await processCampaign(campaign);
      summary.push({ campaign_id: campaign.id, name: campaign.name, ...result });
    }

    console.log('[WithdrawSender] Done:', JSON.stringify(summary));
    return { campaigns_processed: campaigns.length, summary };
  } catch (err) {
    console.error('[WithdrawSender] Error:', err.message);
    return { error: err.message };
  } finally {
    isRunning = false;
  }
}

async function processCampaign(campaign) {
  const withdrawAfterDays = parseInt(
    campaign.settings?.connection?.withdraw_after_days ?? DEFAULT_WITHDRAW_DAYS, 10
  );

  if (!withdrawAfterDays || withdrawAfterDays <= 0) {
    console.log(`[WithdrawSender] Campaign ${campaign.id}: withdraw disabled`);
    return { withdrawn: 0 };
  }

  const cutoff = new Date(Date.now() - withdrawAfterDays * 24 * 60 * 60 * 1000).toISOString();

  const { rows: contacts } = await db.query(
    `SELECT id, first_name, last_name, li_profile_url, invite_sent_at
     FROM contacts
     WHERE campaign_id = $1
       AND invite_sent     = true
       AND invite_approved = false
       AND (invite_withdrawn = false OR invite_withdrawn IS NULL)
       AND invite_sent_at IS NOT NULL
       AND invite_sent_at < $2
       AND li_profile_url IS NOT NULL
     ORDER BY invite_sent_at ASC
     LIMIT 50`,
    [campaign.id, cutoff]
  );

  if (!contacts.length) {
    console.log(`[WithdrawSender] Campaign ${campaign.id}: no pending invites to withdraw`);
    return { withdrawn: 0 };
  }

  console.log(`[WithdrawSender] Campaign ${campaign.id}: withdrawing ${contacts.length} invites (sent >${withdrawAfterDays}d ago)`);

  let withdrawn = 0, failed = 0;

  for (const contact of contacts) {
    try {
      await unipile.withdrawInvitation(campaign.account_id, contact.li_profile_url);

      await db.query(
        `UPDATE contacts
         SET invite_withdrawn    = true,
             invite_withdrawn_at = NOW()
         WHERE id = $1`,
        [contact.id]
      );

      withdrawn++;
      console.log(`[WithdrawSender] ✓ Withdrew invite for ${contact.first_name} ${contact.last_name} (contact ${contact.id})`);
    } catch (err) {
      failed++;
      console.error(`[WithdrawSender] ✗ contact ${contact.id}: ${err.message}`);
    }

    // Random delay between withdrawals: 15-40s (conservative — no spam risk)
    if (withdrawn + failed < contacts.length) await sleep(rand(15000, 40000));
  }

  console.log(`[WithdrawSender] Campaign ${campaign.id}: withdrawn=${withdrawn} failed=${failed}`);
  return { withdrawn, failed };
}

module.exports = { start, run };
