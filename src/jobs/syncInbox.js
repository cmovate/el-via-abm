/**
 * src/jobs/syncInbox.js — Pull threads/messages from Unipile every 10 min
 */
const db = require('../db');

async function handler(job) {
  const { rows: accounts } = await db.query(
    `SELECT account_id, workspace_id FROM unipile_accounts ORDER BY workspace_id`
  );

  for (const acc of accounts) {
    try {
      const UNIPILE_DSN = process.env.UNIPILE_DSN;
      const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;

      const res = await fetch(
        `${UNIPILE_DSN}/api/v1/chats?account_id=${encodeURIComponent(acc.account_id)}&limit=50`,
        { headers: { 'X-API-KEY': UNIPILE_API_KEY, accept: 'application/json' } }
      );
      if (!res.ok) continue;

      const data = await res.json();
      const chats = Array.isArray(data?.items) ? data.items : [];

      for (const chat of chats) {
        const chatId     = chat.id || chat.chat_id;
        const providerId = chat.attendee_provider_id ||
          chat.attendees?.[0]?.provider_id || chat.attendees?.[0]?.id;
        if (!chatId || !providerId) continue;

        // Find contact
        const { rows: cRows } = await db.query(
          `SELECT id, campaign_id FROM contacts
           WHERE workspace_id = $1 AND provider_id = $2 LIMIT 1`,
          [acc.workspace_id, providerId]
        );
        if (!cRows.length) continue;
        const contact = cRows[0];

        // Upsert thread
        const { rows: tRows } = await db.query(
          `INSERT INTO inbox_threads
             (campaign_id, workspace_id, contact_id, account_id, thread_id, updated_at)
           VALUES ($1,$2,$3,$4,$5,NOW())
           ON CONFLICT (thread_id) DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [contact.campaign_id, acc.workspace_id, contact.id, acc.account_id, chatId]
        );

        const threadId = tRows[0]?.id;
        if (!threadId) continue;

        // Sync last 20 messages
        await syncMessages(threadId, chatId, acc.account_id);
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      console.warn(`[SyncInbox] account ${acc.account_id}: ${err.message}`);
    }
  }
}

async function syncMessages(threadDbId, chatId, accountId) {
  const UNIPILE_DSN = process.env.UNIPILE_DSN;
  const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;
  try {
    const res = await fetch(
      `${UNIPILE_DSN}/api/v1/chats/${encodeURIComponent(chatId)}/messages?account_id=${encodeURIComponent(accountId)}&limit=20`,
      { headers: { 'X-API-KEY': UNIPILE_API_KEY, accept: 'application/json' } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const msgs = Array.isArray(data?.items) ? data.items : [];
    let lastMsg = null;
    for (const msg of msgs) {
      if (!msg.id) continue;
      const dir     = (msg.is_sender === 1 || msg.is_sender === true) ? 'sent' : 'received';
      const content = msg.text || msg.body || '';
      const sentAt  = msg.created_at || msg.timestamp || null;
      await db.query(
        `INSERT INTO inbox_messages (thread_id, unipile_msg_id, direction, content, sent_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (unipile_msg_id) DO NOTHING`,
        [threadDbId, msg.id, dir, content, sentAt]
      );
      lastMsg = { content: content.slice(0, 120), sentAt };
    }
    if (lastMsg) {
      await db.query(
        `UPDATE inbox_threads SET last_message_at=$1, last_message_preview=$2, updated_at=NOW() WHERE id=$3`,
        [lastMsg.sentAt, lastMsg.content, threadDbId]
      );
    }
  } catch (err) {
    console.warn(`[SyncInbox] syncMessages ${chatId}: ${err.message}`);
  }
}

module.exports = { handler };
