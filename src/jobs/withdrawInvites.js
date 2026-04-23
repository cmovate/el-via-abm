/**
 * src/jobs/withdrawInvites.js — Auto-withdraw old invites (daily 03:00)
 */
const db = require('../db');
const unipile = require('../unipile');

async function handler() {
  const { rows } = await db.query(`
    SELECT e.id, e.contact_id, c.li_profile_url, c.provider_id,
           camp.account_id,
           (camp.settings->'connection'->>'withdraw_after_days')::int AS withdraw_days
    FROM enrollments e
    JOIN contacts c   ON c.id = e.contact_id
    JOIN campaigns camp ON camp.id = e.campaign_id
    WHERE e.status = 'invite_sent'
      AND e.invite_sent_at IS NOT NULL
      AND (camp.settings->'connection'->>'withdraw_after_days')::int > 0
      AND e.invite_sent_at < NOW() - INTERVAL '1 day' *
          (camp.settings->'connection'->>'withdraw_after_days')::int
    LIMIT 50
  `);

  let withdrawn = 0;
  for (const row of rows) {
    try {
      await unipile.withdrawInvitation(row.account_id, row.li_profile_url);
      await db.query(
        `UPDATE enrollments SET status='withdrawn', updated_at=NOW() WHERE id=$1`,
        [row.id]
      );
      withdrawn++;
    } catch (err) {
      console.warn(`[WithdrawInvites] enrollment #${row.id}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (withdrawn > 0) console.log(`[WithdrawInvites] Withdrew ${withdrawn} invites`);
}

module.exports = { handler };
