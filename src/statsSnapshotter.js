/**
 * Daily Stats Snapshotter
 *
 * Runs once per day and saves a snapshot of each campaign's funnel
 * metrics into `campaign_daily_stats`.
 *
 * Idempotent: ON CONFLICT DO UPDATE — safe to re-run.
 * Scheduled: runs on startup (catches missed days), then every 24h.
 */

const db = require('./db');

const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;

function start() {
  console.log('[StatsSnapshotter] Started — daily snapshot enabled');
  run();
  setInterval(run, SNAPSHOT_INTERVAL_MS);
}

async function run() {
  console.log('[StatsSnapshotter] Running daily snapshot...');
  try {
    const today = toDateStr(new Date());

    const { rows: campaigns } = await db.query(
      `SELECT id, workspace_id, account_id, name, status FROM campaigns`
    );

    let snapped = 0;
    for (const camp of campaigns) {
      await snapshotCampaign(camp, today);
      snapped++;
    }

    const { rows: accounts } = await db.query(
      `SELECT account_id, workspace_id FROM unipile_accounts`
    );
    for (const acc of accounts) {
      await snapshotFollowers(acc, today);
    }

    console.log(`[StatsSnapshotter] Snapped ${snapped} campaigns for ${today}`);
  } catch (err) {
    console.error('[StatsSnapshotter] Error:', err.message);
  }
}

async function snapshotCampaign(campaign, date) {
  const { rows } = await db.query(`
    SELECT
      COUNT(*)                                                         AS total_contacts,
      COUNT(*) FILTER (WHERE invite_sent = true)                       AS invites_sent,
      COUNT(*) FILTER (WHERE invite_approved = true)                   AS invites_approved,
      COUNT(*) FILTER (WHERE msg_sent = true)                         AS messages_sent,
      COUNT(*) FILTER (WHERE msg_replied = true)                      AS messages_replied,
      COUNT(*) FILTER (WHERE positive_reply = true)                   AS positive_replies,
      COUNT(*) FILTER (WHERE company_follow_invited = true)           AS follow_invited,
      COUNT(*) FILTER (WHERE company_follow_confirmed = true)         AS follow_confirmed,
      COUNT(*) FILTER (WHERE last_profile_view_at IS NOT NULL)        AS profile_views
    FROM contacts
    WHERE campaign_id = $1
  `, [campaign.id]);

  const s = rows[0];

  await db.query(`
    INSERT INTO campaign_daily_stats
      (snapshot_date, campaign_id, workspace_id, account_id, campaign_name, campaign_status,
       total_contacts, invites_sent, invites_approved, messages_sent, messages_replied,
       positive_replies, follow_invited, follow_confirmed, profile_views)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (snapshot_date, campaign_id) DO UPDATE SET
      campaign_name    = EXCLUDED.campaign_name,
      campaign_status  = EXCLUDED.campaign_status,
      total_contacts   = EXCLUDED.total_contacts,
      invites_sent     = EXCLUDED.invites_sent,
      invites_approved = EXCLUDED.invites_approved,
      messages_sent    = EXCLUDED.messages_sent,
      messages_replied = EXCLUDED.messages_replied,
      positive_replies = EXCLUDED.positive_replies,
      follow_invited   = EXCLUDED.follow_invited,
      follow_confirmed = EXCLUDED.follow_confirmed,
      profile_views    = EXCLUDED.profile_views,
      updated_at       = NOW()
  `, [
    date, campaign.id, campaign.workspace_id, campaign.account_id,
    campaign.name, campaign.status,
    parseInt(s.total_contacts),
    parseInt(s.invites_sent),
    parseInt(s.invites_approved),
    parseInt(s.messages_sent),
    parseInt(s.messages_replied),
    parseInt(s.positive_replies),
    parseInt(s.follow_invited),
    parseInt(s.follow_confirmed),
    parseInt(s.profile_views),
  ]);
}

async function snapshotFollowers(account, date) {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS total FROM company_followers WHERE account_id = $1`,
    [account.account_id]
  );
  const total = parseInt(rows[0].total, 10);
  if (!total) return;

  await db.query(`
    INSERT INTO company_page_daily_stats
      (snapshot_date, account_id, workspace_id, total_followers)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (snapshot_date, account_id) DO UPDATE SET
      total_followers = EXCLUDED.total_followers,
      updated_at      = NOW()
  `, [date, account.account_id, account.workspace_id, total]);
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

module.exports = { start, run };
