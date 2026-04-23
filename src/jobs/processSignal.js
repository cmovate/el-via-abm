/**
 * src/jobs/processSignal.js
 *
 * Handles ALL Unipile webhook events → signals table.
 * Called from: POST /api/webhooks/unipile (via enqueueSignal)
 *
 * Events handled:
 *   new_relation          → invite_accepted
 *   message_received      → message_received
 *   profile_view          → profile_view
 *   reaction_received     → post_like
 *   comment_received      → post_comment
 *   invitation_received   → invite_received
 *   company_follow        → company_follow
 *   post_published        → update scheduled_post status
 *
 * For each event:
 *   1. Map to signal type
 *   2. Identify actor (contact in our lists? target_account?)
 *   3. Insert signal record
 *   4. If known actor: update engagement scores + create notification
 *   5. Handle enrollment state transitions (invite_accepted, message_received)
 */

const db = require('../db');

const EVENT_TO_SIGNAL = {
  'new_relation':         'invite_accepted',
  'message_received':     'message_received',
  'profile_view':         'profile_view',
  'reaction_received':    'post_like',
  'comment_received':     'post_comment',
  'invitation_received':  'invite_received',
  'company_follow':       'company_follow',
};

const SIGNAL_SCORES = {
  profile_view:    1,
  post_like:       2,
  post_comment:    5,
  invite_received: 10,
  invite_accepted: 15,
  message_received: 8,
  company_follow:  10,
};

// ── Actor identification ──────────────────────────────────────────────────────

async function identifyActor(payload, workspaceId) {
  const providerId =
    payload.actor_provider_id ||
    payload.sender?.attendee_provider_id ||
    payload.user_id ||
    payload.viewer_id ||
    null;

  const profileUrl = payload.user_profile_url ||
    payload.actor_profile_url ||
    (providerId ? `https://www.linkedin.com/in/${providerId}` : null);

  if (!providerId && !profileUrl) return { is_known: false };

  // Search in contacts (our workspace)
  const { rows: contacts } = await db.query(`
    SELECT c.id, c.first_name, c.last_name, c.target_account_id
    FROM contacts c
    WHERE c.workspace_id = $1
      AND (
        ($2::text IS NOT NULL AND c.provider_id = $2)
        OR ($3::text IS NOT NULL AND c.li_profile_url ILIKE $3)
      )
    LIMIT 1
  `, [workspaceId, providerId || null, profileUrl ? `%${profileUrl.split('/in/')[1]}%` : null]);

  if (contacts.length) {
    const c = contacts[0];
    return {
      contact_id:        c.id,
      target_account_id: c.target_account_id,
      provider_id:       providerId,
      name:              `${c.first_name} ${c.last_name}`.trim(),
      li_url:            profileUrl,
      is_known:          true,
    };
  }

  return {
    contact_id:        null,
    target_account_id: null,
    provider_id:       providerId,
    name:              payload.user_full_name || payload.actor_name || null,
    li_url:            profileUrl,
    is_known:          false,
  };
}

// ── Engagement score update ───────────────────────────────────────────────────

async function updateScores(actor, signalType) {
  const delta = SIGNAL_SCORES[signalType] || 1;

  if (actor.contact_id) {
    await db.query(
      `UPDATE contacts SET
         engagement_score = COALESCE(engagement_score, 0) + $2,
         last_signal_at = NOW()
       WHERE id = $1`,
      [actor.contact_id, delta]
    );
  }

  if (actor.target_account_id) {
    await db.query(
      `UPDATE target_accounts SET
         engagement_score = COALESCE(engagement_score, 0) + $2,
         last_signal_at = NOW()
       WHERE id = $1`,
      [actor.target_account_id, delta]
    );
  }
}

// ── Enrollment state transitions ──────────────────────────────────────────────

async function handleInviteAccepted(payload, workspaceId) {
  const accountId  = payload.account_id;
  const identifier = payload.user_public_identifier ||
    (payload.user_profile_url?.match(/linkedin\.com\/in\/([^/?#]+)/)?.[1]) ||
    null;

  if (!accountId || !identifier) return;

  // Find matching enrollment
  const { rows } = await db.query(`
    SELECT e.id, e.contact_id, c.chat_id
    FROM enrollments e
    JOIN contacts c   ON c.id = e.contact_id
    JOIN campaigns camp ON camp.id = e.campaign_id
    WHERE camp.account_id = $1
      AND e.status = 'invite_sent'
      AND c.li_profile_url ILIKE $2
    LIMIT 1
  `, [accountId, `%/${identifier}%`]);

  if (!rows.length) {
    console.log(`[Signal] invite_accepted: no matching enrollment for ${identifier}`);
    return;
  }

  const { id: enrollmentId } = rows[0];
  const chatId = payload.chat_id || null;

  await db.query(`
    UPDATE enrollments SET
      status = 'approved',
      invite_approved_at = NOW(),
      next_action_at = NOW(),
      chat_id = COALESCE($2, chat_id),
      updated_at = NOW()
    WHERE id = $1
  `, [enrollmentId, chatId]);

  console.log(`[Signal] invite_accepted: enrollment #${enrollmentId} → approved`);
}

async function handleMessageReceived(payload, workspaceId) {
  const accountId  = payload.account_id;
  const senderPrId = payload.sender?.attendee_provider_id;
  const ourUserId  = payload.account_info?.user_id;
  const chatId     = payload.chat_id;

  // Skip messages sent by us
  if (ourUserId && senderPrId && ourUserId === senderPrId) return;
  if (!accountId || !senderPrId) return;

  // Find matching enrollment
  const { rows } = await db.query(`
    SELECT e.id, e.status
    FROM enrollments e
    JOIN contacts c   ON c.id = e.contact_id
    JOIN campaigns camp ON camp.id = e.campaign_id
    WHERE camp.account_id = $1
      AND e.status IN ('invite_sent','approved','messaged')
      AND (c.provider_id = $2 OR e.chat_id = $3)
    LIMIT 1
  `, [accountId, senderPrId, chatId || '']);

  if (!rows.length) return;

  const { id: enrollmentId } = rows[0];

  // Mark as replied, stop sequence
  await db.query(`
    UPDATE enrollments SET
      status = 'replied',
      updated_at = NOW()
    WHERE id = $1 AND status NOT IN ('replied','positive_reply','done')
  `, [enrollmentId]);

  // Save chat_id on contact if missing
  if (chatId) {
    await db.query(`
      UPDATE contacts SET chat_id = $1
      WHERE id = (SELECT contact_id FROM enrollments WHERE id = $2)
        AND chat_id IS NULL
    `, [chatId, enrollmentId]);
  }

  console.log(`[Signal] message_received: enrollment #${enrollmentId} → replied`);

  // AI classification — is this a positive reply?
  const messageText = payload.message || payload.text || payload.body || '';
  if (messageText && messageText.trim().length > 3) {
    classifyReply(enrollmentId, messageText, chatId).catch(e =>
      console.warn('[Signal] classify reply error:', e.message)
    );
  }
}

// ── AI Positive Reply Classification ─────────────────────────────────────────

async function classifyReply(enrollmentId, messageText, chatId) {
  const https = require('https');

  // Fetch conversation history for context (last 5 messages)
  let conversationContext = '';
  if (chatId) {
    try {
      const { rows: msgs } = await db.query(`
        SELECT m.direction, m.content, m.sent_at
        FROM inbox_messages m
        JOIN inbox_threads t ON t.id = m.thread_id
        WHERE t.thread_id = $1
        ORDER BY m.sent_at DESC LIMIT 5
      `, [chatId]);
      if (msgs.length) {
        conversationContext = msgs.reverse().map(m =>
          `[${m.direction === 'sent' ? 'We' : 'Them'}]: ${m.content}`
        ).join('\n');
      }
    } catch(e) { /* best effort */ }
  }

  const prompt = conversationContext
    ? `Conversation:
${conversationContext}

Latest reply: "${messageText}"`
    : `LinkedIn reply: "${messageText}"`;

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    system: `You classify LinkedIn message replies as positive or not.
POSITIVE = genuinely interested: wants a call/demo, asks for info, says yes/sure/interested, schedules meeting.
NOT POSITIVE = rejection, wrong person, auto-reply, out of office, polite decline, no interest.
Reply with ONLY the word: POSITIVE or NOT_POSITIVE`,
    messages: [{ role: 'user', content: prompt }]
  });

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const verdict = result.content?.[0]?.text?.trim().toUpperCase();
  console.log(`[Signal] AI classify enrollment #${enrollmentId}: "${messageText.slice(0,60)}" → ${verdict}`);

  if (verdict === 'POSITIVE') {
    // Update enrollment to positive_reply
    await db.query(`
      UPDATE enrollments SET
        status = 'positive_reply',
        updated_at = NOW()
      WHERE id = $1 AND status IN ('replied', 'messaged')
    `, [enrollmentId]);

    // Update contact fields
    await db.query(`
      UPDATE contacts SET
        positive_reply    = true,
        positive_reply_at = NOW(),
        conversation_stage = 'positive'
      WHERE id = (SELECT contact_id FROM enrollments WHERE id = $1)
        AND (positive_reply IS NULL OR positive_reply = false)
    `, [enrollmentId]);

    console.log(`[Signal] ✅ Positive reply detected! enrollment #${enrollmentId} → positive_reply`);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

async function handler(job) {
  const { payload, workspace_id } = job.data;

  const signalType = EVENT_TO_SIGNAL[payload?.event];

  // Handle post_published separately
  if (payload?.event === 'post_published' && payload?.post_id) {
    await db.query(
      `UPDATE scheduled_posts SET status='published', published_at=NOW(),
       unipile_post_id=$1 WHERE unipile_post_id=$1 OR (status='scheduled' AND account_id=$2)`,
      [payload.post_id, payload.account_id]
    ).catch(() => {});
    return;
  }

  if (!signalType || !workspace_id) return;

  // Identify actor
  const actor = await identifyActor(payload, workspace_id);

  // Insert signal record
  await db.query(`
    INSERT INTO signals (
      workspace_id, type,
      actor_contact_id, actor_target_account_id,
      actor_provider_id, actor_name, actor_li_url,
      subject_li_account_id,
      content, post_url, raw_data,
      is_known, occurred_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
  `, [
    workspace_id, signalType,
    actor.contact_id || null,
    actor.target_account_id || null,
    actor.provider_id || null,
    actor.name || null,
    actor.li_url || null,
    payload.account_id || null,
    payload.message || payload.text || payload.content || null,
    payload.post_url || null,
    JSON.stringify(payload),
    actor.is_known,
  ]);

  // Update engagement scores for known actors
  if (actor.is_known) {
    await updateScores(actor, signalType);
  }

  // Handle enrollment state transitions
  if (payload.event === 'new_relation') {
    await handleInviteAccepted(payload, workspace_id);
  } else if (payload.event === 'message_received') {
    await handleMessageReceived(payload, workspace_id);
  }

  console.log(`[Signal] ${signalType} from ${actor.name || actor.provider_id || 'unknown'} — known: ${actor.is_known}`);
}

module.exports = { handler };
