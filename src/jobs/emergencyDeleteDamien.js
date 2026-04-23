/**
 * EMERGENCY: Delete Damien's messages immediately on server startup
 * Self-deletes after running once
 */
const db = require('../db');
const unipile = require('../unipile');
const fs = require('fs');
const path = require('path');

let ran = false;

async function run() {
  if (ran) return;
  ran = true;
  console.log('[EMERGENCY] Starting Damien message deletion...');

  try {
    const { rows } = await db.query(`
      SELECT e.id, e.chat_id, camp.account_id, c.first_name, c.last_name
      FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      JOIN unipile_accounts ua ON ua.account_id = camp.account_id AND ua.workspace_id = camp.workspace_id
      WHERE camp.workspace_id = 4
        AND ua.display_name ILIKE '%damien%'
        AND e.status = 'messaged'
        AND e.chat_id IS NOT NULL
    `);

    console.log(`[EMERGENCY] Found ${rows.length} Damien conversations to delete`);

    for (const row of rows) {
      try {
        const msgs = await unipile.getChatMessages(row.account_id, row.chat_id, 10);
        const outbound = msgs.filter(m => m.is_sender === 1 || m.is_sender === true || m.from_me === true);

        if (!outbound.length) {
          console.log(`[EMERGENCY] ${row.first_name}: no outbound msgs (already deleted?)`);
          continue;
        }

        for (const msg of outbound) {
          await unipile.deleteMessage(row.account_id, msg.id);
          console.log(`[EMERGENCY] ✅ Deleted msg to ${row.first_name} ${row.last_name}`);
          await new Promise(r => setTimeout(r, 300));
        }
      } catch(e) {
        console.error(`[EMERGENCY] ❌ ${row.first_name}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    console.log('[EMERGENCY] Damien deletion complete');
  } catch(e) {
    console.error('[EMERGENCY] Fatal error:', e.message);
  }
}

module.exports = { run };
