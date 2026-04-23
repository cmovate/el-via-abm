/**
 * src/inboxPoller.js
 *
 * Inbox insurance poller: runs every 30 minutes.
 * For every workspace + account:
 *   1. Fetch last 15 chats from Unipile
 *   2. Sync new messages into inbox_threads / inbox_messages
 *   3. For each RECEIVED message → check if the sender is a campaign contact
 *      who hasn't been marked as replied yet → mark msg_replied + fire webhook logic
 *      (backup for missed webhooks)
 */

const db = require('./db');

const POLL_INTERVAL_MS  = 30 * 60 * 1000; // 30 minutes
const STARTUP_DELAY_MS  = 2  * 60 * 1000; // 2 min after boot (let server settle)
const CHATS_PER_ACCOUNT = 15;

// ── Unipile helpers ──────────────────────────────────────────────────────────

function unipileHeaders() {
  return {
    'X-API-KEY': process.env.UNIPILE_API_KEY,
    'accept':    'application/json',
    'Content-Type': 'application/json'
  };
}

async function fetchRecentChats(accountId, limit = 15) {
  const dsn = process.env.UNIPILE_DSN;
  const url  = `${dsn}/api/v1/chats?account_id=${encodeURIComponent(accountId)}&limit=${limit}`;
  const res  = await fetch(url, { headers: unipileHeaders() });
  if (!res.ok) throw new Error(`chats HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
}

async function fetchChatMessages(accountId, chatId, limit = 20) {
  const dsn = process.env.UNIPILE_DSN;
  const url  = `${dsn}/api/v1/chats/${encodeURIComponent(chatId)}/messages?account_id=${encodeURIComponent(accountId)}&limit=${limit}`;
  const res  = await fetch(url, { headers: unipileHeaders() });
  if (!res.ok) throw new Error(`messages HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
}

async function getAccountSelfId(accountId) {
  const dsn = process.env.UNIPILE_DSN;
  const url  = `${dsn}/api/v1/accounts/${encodeURIComponent(accountId)}`;
  const res  = await fetch(url, { headers: unipileHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.user_id || data?.provider_id || null;
}

// ── Core poll logic ──────────────────────────────────────────────────────────

async function pollWorkspace(workspaceId) {
  const { rows: accounts } = await db.query(
    'SELECT account_id FROM unipile_accounts WHERE workspace_id = $1',
    [workspaceId]
  );
  if (!accounts.length) return;

  let totalNewMsgs = 0, totalNewReplies = 0;

  for (const { account_id } of accounts) {
    try {
      const selfId = await getAccountSelfId(account_id);
      const chats  = await fetchRecentChats(account_id, CHATS_PER_ACCOUNT);

      for (const chat of chats) {
        const chatId     = chat.id || chat.chat_id;
        const providerId = chat.attendee_provider_id
          || chat.attendees?.[0]?.provider_id
          || chat.attendees?.[0]?.id;
        if (!chatId || !providerId) continue;

        // ── 1. Resolve / create thread ──────────────────────────────────────

        // Find contact (provider_id or li_profile_url)
        let contact = null;
        const { rows: byPid } = await db.query(
          'SELECT id, campaign_id, msg_replied, msg_sent FROM contacts WHERE workspace_id=$1 AND provider_id=$2 LIMIT 1',
          [workspaceId, providerId]
        );
        contact = byPid[0] || null;

        if (!contact) {
          const { rows: byUrl } = await db.query(
            'SELECT id, campaign_id, msg_replied, msg_sent FROM contacts WHERE workspace_id=$1 AND li_profile_url=$2 LIMIT 1',
            [workspaceId, 'https://www.linkedin.com/in/' + providerId]
          );
          contact = byUrl[0] || null;
        }

        // Upsert thread
        const { rows: threadRows } = await db.query(
          `INSERT INTO inbox_threads
             (campaign_id, workspace_id, contact_id, account_id, thread_id, updated_at)
           VALUES ($1,$2,$3,$4,$5,NOW())
           ON CONFLICT (thread_id) DO UPDATE SET updated_at=NOW()
           RETURNING id`,
          [contact?.campaign_id || null, workspaceId, contact?.id || null, account_id, chatId]
        );
        const threadDbId = threadRows[0]?.id;
        if (!threadDbId) continue;

        // ── 2. Fetch & upsert messages ──────────────────────────────────────
        let messages;
        try {
          messages = await fetchChatMessages(account_id, chatId, 20);
        } catch(e) {
          console.warn(`[InboxPoller] fetchMessages ${chatId}: ${e.message}`);
          continue;
        }

        let addedInThread = 0;
        let hasNewReceived = false;

        for (const msg of messages) {
          const msgId   = msg.id || msg.message_id || msg.uid;
          if (!msgId) continue;

          const senderPid = msg.sender?.attendee_provider_id || msg.sender_id || null;
          const isOurs    = selfId && senderPid && senderPid === selfId;
          const direction = (msg.is_sender === 1 || msg.is_sender === true || isOurs || msg.from_me || msg.is_me)
            ? 'sent' : 'received';
          const content   = msg.text || msg.body || msg.content || '';
          const sentAt    = msg.created_at || msg.timestamp || msg.sent_at || null;

          const { rowCount } = await db.query(
            `INSERT INTO inbox_messages (thread_id, unipile_msg_id, direction, content, sent_at)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (unipile_msg_id) DO NOTHING`,
            [threadDbId, msgId, direction, content, sentAt]
          );
          if (rowCount > 0) {
            addedInThread++;
            totalNewMsgs++;
            if (direction === 'received') hasNewReceived = true;
          }
        }

        // Update thread preview
        if (messages.length > 0) {
          const last    = messages[messages.length - 1];
          const preview = (last.text || last.body || last.content || '').slice(0, 120);
          const lastAt  = last.created_at || last.timestamp || null;
          await db.query(
            'UPDATE inbox_threads SET last_message_at=$1, last_message_preview=$2, updated_at=NOW() WHERE id=$3',
            [lastAt, preview, threadDbId]
          );
        }

        // ── 3. Webhook backup: mark reply if missed ─────────────────────────
        // Only trigger if:
        //   a) There's a new received message in this thread
        //   b) Contact exists, was sent a message (msg_sent=true), but NOT yet marked replied
        if (hasNewReceived && contact?.msg_sent && !contact?.msg_replied && contact?.campaign_id) {
          try {
            // Count total received messages in thread
            const { rows: rcvd } = await db.query(
              `SELECT COUNT(*) FROM inbox_messages WHERE thread_id=$1 AND direction='received'`,
              [threadDbId]
            );
            const replyCount = parseInt(rcvd[0].count) || 1;

            await db.query(
              `UPDATE contacts SET
                 msg_replied    = true,
                 msg_replied_at = COALESCE(msg_replied_at, NOW()),
                 reply_count    = $2,
                 msg_sequence   = NULL,
                 chat_id        = COALESCE(chat_id, $3)
               WHERE id=$1`,
              [contact.id, replyCount, chatId]
            );

            totalNewReplies++;
            console.log(`[InboxPoller] ✅ Webhook backup: marked reply for contact ${contact.id} (chat ${chatId}) in campaign ${contact.campaign_id}`);

            // Fire conversation analysis if available
            try {
              const { enqueueContact } = require('./conversationQueue');
              if (enqueueContact) enqueueContact(contact.id, account_id, chatId, contact.campaign_id);
            } catch(e) { /* optional */ }

          } catch(e) {
            console.warn(`[InboxPoller] reply-mark error contact ${contact.id}:`, e.message);
          }
        }

        // Small delay between chats to avoid Unipile rate limits
        await new Promise(r => setTimeout(r, 500));
      }

    } catch(err) {
      console.error(`[InboxPoller] account ${account_id} error:`, err.message);
    }
  }

  if (totalNewMsgs > 0 || totalNewReplies > 0) {
    console.log(`[InboxPoller] ws=${workspaceId}: +${totalNewMsgs} new messages, ${totalNewReplies} webhook-backup replies marked`);
  }
}

async function pollAllWorkspaces() {
  const watchdog = require('./watchdog');
  watchdog.tick('inboxPoller');
  console.log('[InboxPoller] Starting poll cycle...');
  try {
    const { rows: workspaces } = await db.query(
      `SELECT DISTINCT w.id FROM workspaces w
       JOIN unipile_accounts ua ON ua.workspace_id = w.id`
    );
    for (const { id } of workspaces) {
      try {
        await pollWorkspace(id);
      } catch(e) {
        console.error(`[InboxPoller] workspace ${id} error:`, e.message);
      }
    }
    console.log('[InboxPoller] Poll cycle complete.');
  } catch(e) {
    console.error('[InboxPoller] pollAllWorkspaces error:', e.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

function start() {
  // Delay startup to let server + DB fully initialize
  setTimeout(() => {
    pollAllWorkspaces().catch(e => console.error('[InboxPoller] startup error:', e.message));
    setInterval(() => {
      pollAllWorkspaces().catch(e => console.error('[InboxPoller] interval error:', e.message));
    }, POLL_INTERVAL_MS);
    console.log(`[InboxPoller] Started — polling every ${POLL_INTERVAL_MS / 60000} minutes`);
  }, STARTUP_DELAY_MS);
}

module.exports = { start, pollAllWorkspaces, pollWorkspace };
