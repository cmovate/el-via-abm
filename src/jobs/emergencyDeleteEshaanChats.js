const db = require('../db');
const unipile = require('../unipile');

let ran = false;

async function run() {
  if (ran) return;
  ran = true;
  console.log('[EMERGENCY] Starting Eshaan CHAT deletion (35 chats)...');

  try {
    const { rows } = await db.query(`
      SELECT e.id, e.chat_id, camp.account_id, c.first_name, c.last_name
      FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id
      JOIN campaigns camp ON camp.id = e.campaign_id
      JOIN unipile_accounts ua ON ua.account_id = camp.account_id AND ua.workspace_id = camp.workspace_id
      WHERE camp.workspace_id = 4
        AND ua.display_name ILIKE '%eshaan%'
        AND e.chat_id IS NOT NULL
      ORDER BY c.first_name
    `);

    console.log(`[EMERGENCY] Found ${rows.length} Eshaan chats to delete`);

    for (const row of rows) {
      try {
        await unipile.deleteChat(row.account_id, row.chat_id);
        console.log(`[EMERGENCY] ✅ Chat deleted: ${row.first_name} ${row.last_name}`);
      } catch(e) {
        console.error(`[EMERGENCY] ❌ ${row.first_name} ${row.last_name}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 600));
    }

    console.log('[EMERGENCY] Eshaan chat deletion COMPLETE');
  } catch(e) {
    console.error('[EMERGENCY] Fatal:', e.message);
  }
}

module.exports = { run };
