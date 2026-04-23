/**
 * conversationQueue.js
 *
 * Lightweight in-memory analysis queue with:
 *  - Debounce per contact (2 min): if a new message arrives before the
 *    timer fires, the timer resets so we analyze after the conversation
 *    has settled, not mid-exchange.
 *  - Max 3 concurrent Claude API calls at once.
 *  - Deduplication: the same contact can only appear once in the queue.
 *  - Restart recovery: on start(), re-queues any contacts that replied
 *    but were never analyzed (or analyzed before the last reply).
 */

const db                  = require('./db');
const { analyzeConversation } = require('./conversationAnalyzer');

const DEBOUNCE_MS   = 2 * 60 * 1000; // 2 minutes
const MAX_WORKERS   = 3;
const POLL_MS       = 30 * 1000;     // poll every 30 s

// Map<contactId, { timer, accountId, chatId, campaignId, ready }>
const pending  = new Map();
let   running  = 0;
let   pollTimer = null;

/**
 * Enqueue a contact for conversation analysis (triggered by webhook).
 * Applies a 2-minute debounce so rapid consecutive messages are batched.
 */
function enqueueContact(contactId, accountId, chatId, campaignId) {
  if (!contactId || !accountId || !chatId) return;

  // Reset debounce timer if already queued
  if (pending.has(contactId)) {
    clearTimeout(pending.get(contactId).timer);
  }

  const timer = setTimeout(() => {
    const entry = pending.get(contactId);
    if (entry) {
      entry.ready = true;
      console.log(`[ConvQueue] Contact ${contactId} ready for analysis`);
    }
  }, DEBOUNCE_MS);

  pending.set(contactId, { timer, accountId, chatId, campaignId, ready: false });
  console.log(`[ConvQueue] Enqueued contact ${contactId} (debounce ${DEBOUNCE_MS / 60000} min)`);
}

/**
 * Immediately enqueue a contact in "ready" state (no debounce).
 * Used for restart recovery.
 */
function enqueueReady(contactId, accountId, chatId, campaignId) {
  if (!contactId || !accountId || !chatId) return;
  if (pending.has(contactId)) return; // already queued, skip
  pending.set(contactId, { timer: null, accountId, chatId, campaignId, ready: true });
}

async function processNext() {
  if (running >= MAX_WORKERS) return;

  // Find first ready entry
  let targetId = null;
  for (const [id, entry] of pending) {
    if (entry.ready) { targetId = id; break; }
  }
  if (targetId === null) return;

  const entry = pending.get(targetId);
  pending.delete(targetId);

  running++;
  try {
    console.log(`[ConvQueue] Analyzing contact ${targetId} (${running}/${MAX_WORKERS} workers)`);
    await analyzeConversation(targetId, entry.accountId, entry.chatId);
    console.log(`[ConvQueue] Done contact ${targetId}`);
  } catch (err) {
    console.error(`[ConvQueue] Analysis failed for contact ${targetId}: ${err.message}`);
  } finally {
    running--;
  }
}

/**
 * On startup, find contacts that replied but were never analyzed
 * (or analyzed before the last reply). Re-queue them in ready state
 * so they get analyzed without waiting for another webhook.
 */
async function recoverFromRestart() {
  try {
    const { rows } = await db.query(`
      SELECT c.id, c.chat_id, camp.account_id, c.campaign_id
      FROM contacts c
      JOIN campaigns camp ON camp.id = c.campaign_id
      WHERE c.msg_replied = true
        AND c.chat_id IS NOT NULL
        AND (
          c.conversation_analyzed_at IS NULL
          OR (c.msg_replied_at IS NOT NULL AND c.conversation_analyzed_at < c.msg_replied_at)
        )
      ORDER BY c.msg_replied_at DESC
      LIMIT 50
    `);

    if (!rows.length) {
      console.log('[ConvQueue] Recovery: no unanalyzed conversations found');
      return;
    }

    console.log(`[ConvQueue] Recovery: re-queueing ${rows.length} unanalyzed conversation(s)`);
    for (const row of rows) {
      enqueueReady(row.id, row.account_id, row.chat_id, row.campaign_id);
    }
  } catch (err) {
    console.warn(`[ConvQueue] Recovery failed: ${err.message}`);
  }
}

async function start() {
  console.log(`[ConvQueue] Starting — poll ${POLL_MS / 1000}s, max ${MAX_WORKERS} workers, debounce ${DEBOUNCE_MS / 60000} min`);

  // Re-queue contacts that replied but were never analyzed after previous restart
  await recoverFromRestart();

  pollTimer = setInterval(async () => {
    for (let i = 0; i < MAX_WORKERS; i++) await processNext();
  }, POLL_MS);
}

function stop() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  for (const [, entry] of pending) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  pending.clear();
}

function status() {
  const total   = pending.size;
  const ready   = [...pending.values()].filter(e => e.ready).length;
  const waiting = total - ready;
  return { total, ready, waiting, running, workers: MAX_WORKERS };
}

module.exports = { enqueueContact, enqueueReady, processNext, start, stop, status };
