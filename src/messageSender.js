/**
 * messageSender.js
 *
 * Sends LinkedIn messages based on campaign sequences.
 * Runs every 5 minutes. Respects campaign working hours.
 *
 * A/B/C VARIANTS
 * Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
 * Each step can define multiple variants:
 *   { delay: 3, unit: 'days', variants: [
 *     { label: 'A', text: 'Hi {{first_name}}...' },
 *     { label: 'B', text: 'Hello {{first_name}}...' },
 *   ]}
 * A random variant is chosen per contact at send time.
 * Variant label saved to msg_N_variant. Supports up to 20 steps.
 * Backward compatible: if no variants array, falls back to msg.text.
 */

const db = require('./db');
const { sendMessage, startDirectMessage } = require('./unipile');

const INTERVAL_MS    = 5 * 60 * 1000;
const MAX_JITTER_MS  = 3 * 3600 * 1000;
const MAX_SLOTS      = 20;
const MIN_FUTURE_MS  = 60 * 1000; // scheduled time must be at least 1 min in the future
let timer = null;

function toMs(delay, unit) {
  const n = parseFloat(delay) || 1;
  switch (String(unit).toLowerCase()) {
    case 'hours': return n * 3600 * 1000;
    case 'weeks': return n * 7 * 24 * 3600 * 1000;
    default:      return n * 24 * 3600 * 1000;
  }
}

function computeScheduledAt(triggerTime, delay, unit) {
  const baseMs   = toMs(delay, unit);
  const jitterMs = (Math.random() * 2 - 1) * MAX_JITTER_MS;
  const extraMs  = Math.floor(Math.random() * 3600) * 1000;
  const raw      = new Date(triggerTime).getTime() + baseMs + jitterMs + extraMs;
  // Clamp: scheduled time must be at least MIN_FUTURE_MS from now
  return new Date(Math.max(raw, Date.now() + MIN_FUTURE_MS));
}

function substituteTokens(text, contact) {
  return String(text || '')
    .replace(/\{\{first_name\}\}/g, contact.first_name || '')
    .replace(/\{\{last_name\}\}/g,  contact.last_name  || '')
    .replace(/\{\{company\}\}/g,    contact.company    || '');
}

function isWithinWorkingHours(hours) {
  if (!hours || typeof hours !== 'object') return true;
  const now    = new Date();
  const jsDay  = now.getDay();
  const dayKey = String(jsDay === 0 ? 7 : jsDay);
  const d      = hours[dayKey];
  if (!d?.on) return false;
  const [fH, fM] = d.from.split(':').map(Number);
  const [tH, tM] = d.to.split(':').map(Number);
  const nowMins  = now.getHours() * 60 + now.getMinutes();
  return nowMins >= fH * 60 + fM && nowMins < tH * 60 + tM;
}

const DEFAULT_MSG_LIMIT = 50;

async function countMessagesSentToday(accountId, workspaceId) {
  const { rows } = await db.query(`
    SELECT COALESCE(SUM(msgs_sent_count), 0) AS cnt
    FROM contacts c
    JOIN campaigns camp ON camp.id = c.campaign_id
    WHERE camp.account_id   = $1
      AND camp.workspace_id = $2
      AND c.msg_sent_at >= date_trunc('day', NOW())
  `, [accountId, workspaceId]);
  return parseInt(rows[0].cnt, 10) || 0;
}

async function runOnce() {
  const watchdog = require('./watchdog');
  watchdog.tick('messageSender');
  try {
    // Include workspace_id + account settings — enforce per-workspace limits
    const { rows: campaigns } = await db.query(`
      SELECT c.id, c.account_id, c.workspace_id, c.settings,
             ua.settings AS account_settings
      FROM campaigns c
      JOIN unipile_accounts ua
        ON  ua.account_id   = c.account_id
        AND ua.workspace_id = c.workspace_id
      WHERE c.status = 'active'
    `);

    // Group by workspace:account to enforce per-account daily limit
    const byKey = {};
    for (const camp of campaigns) {
      const key = `${camp.workspace_id}:${camp.account_id}`;
      if (!byKey[key]) byKey[key] = {
        accountId: camp.account_id,
        workspaceId: camp.workspace_id,
        accountSettings: camp.account_settings,
        campaigns: []
      };
      byKey[key].campaigns.push(camp);
    }

    for (const { accountId, workspaceId, accountSettings, campaigns: accountCamps } of Object.values(byKey)) {
      const accSettings = (typeof accountSettings === 'string'
        ? JSON.parse(accountSettings) : accountSettings) || {};
      const dailyLimit  = accSettings.limits?.messages ?? DEFAULT_MSG_LIMIT;
      const sentToday   = await countMessagesSentToday(accountId, workspaceId);
      let remaining     = dailyLimit - sentToday;

      if (remaining <= 0) {
        console.log(`[MsgSender] Account ${accountId.slice(0,8)}: daily limit reached (${sentToday}/${dailyLimit})`);
        continue;
      }

      for (const camp of accountCamps) {
        if (remaining <= 0) break;
        const settings = typeof camp.settings === 'string'
          ? JSON.parse(camp.settings) : (camp.settings || {});
        const sent = await processCampaign(camp, settings.messages || {}, settings.hours, remaining);
        remaining -= sent;
      }
    }
  } catch (err) {
    console.error('[MsgSender] runOnce error:', err.message);
  }
}

async function processCampaign(camp, messages, hours, remaining = 999) {
  let sent = 0;
  const SEQ = [
    { type: 'new',                   triggerCol: 'invite_approved_at',      condition: `invite_approved = true AND invite_approved_at IS NOT NULL` },
    { type: 'existing_no_history',   triggerCol: 'msg_sequence_started_at', condition: `msg_sequence_started_at IS NOT NULL` },
    { type: 'existing_with_history', triggerCol: 'msg_sequence_started_at', condition: `msg_sequence_started_at IS NOT NULL` },
  ];

  for (const seq of SEQ) {
    const seqMsgs = messages[seq.type];
    if (!Array.isArray(seqMsgs) || seqMsgs.length === 0) continue;

    const { rows: unscheduled } = isWithinWorkingHours(hours) ? await db.query(
      `SELECT * FROM contacts
       WHERE campaign_id = $1 AND msg_sequence = $2 AND msg_step < $3
         AND msg_scheduled_send_at IS NULL AND ${seq.condition}`,
      [camp.id, seq.type, seqMsgs.length]
    ) : { rows: [] };
    for (const contact of unscheduled) {
      const stepIndex   = parseInt(contact.msg_step) || 0;
      const msg         = seqMsgs[stepIndex];
      if (!msg) continue;
      const triggerTime = contact[seq.triggerCol];
      if (!triggerTime) continue;
      const scheduledAt = computeScheduledAt(triggerTime, msg.delay, msg.unit);
      await db.query(`UPDATE contacts SET msg_scheduled_send_at = $1 WHERE id = $2`, [scheduledAt, contact.id]);
      console.log(`[MsgSender] Scheduled contact ${contact.id} step ${stepIndex + 1} Ã¢ÂÂ ${scheduledAt.toISOString()}`);
    }

    const { rows: ready } = await db.query(
      `SELECT c.* FROM contacts c
       WHERE c.campaign_id = $1 AND c.msg_sequence = $2 AND c.msg_step < $3
         AND c.msg_scheduled_send_at IS NOT NULL AND c.msg_scheduled_send_at <= NOW()
         AND ${seq.condition}
         -- Cross-account rule: skip if this person was already messaged by
         -- any other account in the same workspace (same li_profile_url)
         AND NOT EXISTS (
           SELECT 1 FROM contacts c2
           JOIN campaigns camp2 ON camp2.id = c2.campaign_id
           WHERE c2.li_profile_url IS NOT NULL
             AND c2.li_profile_url = c.li_profile_url
             AND c2.msg_sent = true
             AND camp2.workspace_id = $4
             AND c2.campaign_id <> $1
         )`,
      [camp.id, seq.type, seqMsgs.length, camp.workspace_id]
    );
    for (const contact of ready) {
      if (sent >= remaining) break;  // daily limit reached
      const ok = await trySendMessage(contact, camp, seqMsgs, seq.type);
      if (ok) sent++;
    }
  }
  return sent;
}

async function trySendMessage(contact, camp, seqMsgs, seqType) {
  const stepIndex = parseInt(contact.msg_step) || 0;
  const msg       = seqMsgs[stepIndex];
  if (!msg) return;

  const variants = Array.isArray(msg.variants) && msg.variants.length > 0
    ? msg.variants
    : (msg.text ? [{ label: 'A', text: msg.text }] : []);
  if (!variants.length) return;

  const picked       = variants[Math.floor(Math.random() * variants.length)];
  const variantLabel = (picked.label || 'A').toUpperCase();
  const text         = substituteTokens(picked.text || '', contact);
  if (!text.trim()) return;

  try {
    let chatId = contact.chat_id;
    if (chatId) {
      await sendMessage(camp.account_id, chatId, text);
    } else if (contact.provider_id) {
      const result = await startDirectMessage(camp.account_id, contact.provider_id, text);
      chatId = result?.id || result?.chat_id || null;
      if (chatId) await db.query('UPDATE contacts SET chat_id = $1 WHERE id = $2', [chatId, contact.id]);
    } else {
      console.warn(`[MsgSender] contact ${contact.id} Ã¢ÂÂ no chat_id or provider_id, skipping`);
      return false;
    }

    const slotNum    = stepIndex + 1;
    const textCol    = slotNum <= MAX_SLOTS ? `, msg_${slotNum}_text = $2`    : '';
    const variantCol = slotNum <= MAX_SLOTS ? `, msg_${slotNum}_variant = $3` : '';
    const updateParams = slotNum <= MAX_SLOTS ? [contact.id, text, variantLabel] : [contact.id];

    await db.query(
      `UPDATE contacts SET
         msg_sent = true, msg_sent_at = NOW(),
         msg_step = msg_step + 1,
         msg_scheduled_send_at = NULL,
         msgs_sent_count = COALESCE(msgs_sent_count, 0) + 1
         ${textCol}${variantCol}
       WHERE id = $1`,
      updateParams
    );

    console.log(
      `[MsgSender] Sent step ${stepIndex + 1}/${seqMsgs.length}` +
      ` Ã¢ÂÂ contact ${contact.id} (${contact.first_name} ${contact.last_name})` +
      ` ÃÂ· variant: ${variantLabel} ÃÂ· sequence: ${seqType}`
    );
    return true;
  } catch (err) {
    console.error(`[MsgSender] Failed contact ${contact.id}: ${err.message}`);
    return false;
  }
}

function start() {
  console.log(`[MsgSender] Starting Ã¢ÂÂ poll every ${INTERVAL_MS / 60000} min | jitter ÃÂ±${MAX_JITTER_MS / 3600000}h | max slots: ${MAX_SLOTS} | A/B/C enabled`);
  runOnce();
  timer = setInterval(runOnce, INTERVAL_MS);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, runOnce };
