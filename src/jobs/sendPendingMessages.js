/**
 * sendPendingMessages.js
 *
 * Runs every 10 minutes.
 * Finds approved enrollments with sequence message steps and sends the first message.
 * This is a reliable fallback alongside processEnrollments.
 */

const db      = require('../db');
const unipile = require('../unipile');

async function handler() {
  // Find workspaces with approved enrollments + message sequences
  const { rows: workspaces } = await db.query(`
    SELECT DISTINCT camp.workspace_id
    FROM enrollments e
    JOIN campaigns camp ON camp.id = e.campaign_id
    WHERE e.status = 'approved'
      AND e.current_step = -1
      AND camp.sequence_id IS NOT NULL
      AND camp.status = 'active'
  `);

  let totalSent = 0;

  for (const { workspace_id } of workspaces) {
    const { rows } = await db.query(`
      SELECT e.id, e.contact_id, e.campaign_id,
             c.first_name, c.last_name, c.company, c.title, c.provider_id, c.chat_id,
             camp.account_id, camp.sequence_id
      FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      WHERE camp.workspace_id = $1
        AND e.status = 'approved'
        AND e.current_step = -1
        AND camp.sequence_id IS NOT NULL
        AND camp.status = 'active'
      ORDER BY e.next_action_at ASC
      LIMIT 10
    `, [workspace_id]);

    for (const row of rows) {
      // Load first message step
      const { rows: steps } = await db.query(
        `SELECT * FROM sequence_steps WHERE sequence_id=$1 AND type='message' ORDER BY step_index ASC LIMIT 1`,
        [row.sequence_id]
      );
      if (!steps.length) {
        await db.query(`UPDATE enrollments SET status='done', updated_at=NOW() WHERE id=$1`, [row.id]);
        continue;
      }

      const variant = (steps[0].variants || [])[0];
      if (!variant?.text?.trim()) {
        await db.query(`UPDATE enrollments SET status='done', updated_at=NOW() WHERE id=$1`, [row.id]);
        continue;
      }

      const text = variant.text
        .replace(/\{\{first_name\}\}/g, row.first_name || '')
        .replace(/\{\{last_name\}\}/g,  row.last_name  || '')
        .replace(/\{\{company\}\}/g,    row.company    || '')
        .replace(/\{\{title\}\}/g,      row.title      || '');

      try {
        let chatId = row.chat_id;
        if (!chatId && row.provider_id) {
          const result = await unipile.startDirectMessage(row.account_id, row.provider_id, text);
          chatId = result?.id || result?.chat_id || null;
        } else if (chatId) {
          await unipile.sendMessage(row.account_id, chatId, text);
        } else {
          console.warn(`[SendPending] #${row.id} no chat_id or provider_id — skipping`);
          continue;
        }

        await db.query(
          `UPDATE enrollments SET status='messaged', current_step=1, chat_id=$2, next_action_at=NOW()+'999 days'::interval, updated_at=NOW() WHERE id=$1`,
          [row.id, chatId]
        );
        if (chatId) await db.query('UPDATE contacts SET chat_id=$1 WHERE id=$2 AND chat_id IS NULL', [chatId, row.contact_id]);

        totalSent++;
        console.log(`[SendPending] WS${workspace_id} enrollment #${row.id} sent to ${row.first_name}`);
      } catch(e) {
        console.error(`[SendPending] #${row.id} error: ${e.message}`);
        await db.query(`UPDATE enrollments SET status='error', error_message=$2, updated_at=NOW() WHERE id=$1`, [row.id, e.message]);
      }

      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (totalSent > 0) console.log(`[SendPending] Sent ${totalSent} messages total`);
}

module.exports = { handler };
