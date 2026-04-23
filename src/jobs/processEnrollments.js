/**
 * src/jobs/processEnrollments.js
 *
 * The enrollment state machine — runs every 5 minutes.
 *
 * For every enrollment where next_action_at <= NOW() and campaign is active:
 *   pending       → send invite  → invite_sent
 *   invite_sent   → (if past withdraw date) withdraw → withdrawn
 *   approved      → send message step 0 → messaged
 *   messaged      → send next message step → messaged (current_step++)
 *   messaged      → (no more steps) → done
 *
 * Webhook events (handled separately in processSignal.js):
 *   invite_accepted → approved
 *   message_received → replied / positive_reply
 *
 * Replaces: invitationSender.js + messageSender.js
 */

const db = require('../db');
const unipile = require('../unipile');

const MAX_BATCH = 50; // enrollments per run

// ── Helpers ──────────────────────────────────────────────────────────────────

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function jitter(ms) {
  // ±20% random jitter to avoid looking robotic
  return ms + (Math.random() * 0.4 - 0.2) * ms;
}

function isWithinWorkingHours(hours) {
  if (!hours || typeof hours !== 'object') return true;
  const now    = new Date();
  const jsDay  = now.getDay();
  const dayKey = String(jsDay === 0 ? 7 : jsDay);
  const d      = hours[dayKey];
  if (!d?.on) return false;
  const [fH, fM] = (d.from || '09:00').split(':').map(Number);
  const [tH, tM] = (d.to   || '18:00').split(':').map(Number);
  const nowMins  = now.getHours() * 60 + now.getMinutes();
  return nowMins >= fH * 60 + fM && nowMins < tH * 60 + tM;
}

function substituteTokens(text, contact) {
  return String(text || '')
    .replace(/\{\{first_name\}\}/g, contact.first_name || '')
    .replace(/\{\{last_name\}\}/g,  contact.last_name  || '')
    .replace(/\{\{company\}\}/g,    contact.company    || '')
    .replace(/\{\{title\}\}/g,      contact.title      || '');
}

function pickVariant(variants, enrollment) {
  if (!Array.isArray(variants) || !variants.length) return null;
  // Use A/B assignment stored on enrollment, or pick randomly once
  const assignments = enrollment.a_b_assignments || {};
  const stepKey = `step_${enrollment.current_step}`;
  if (assignments[stepKey]) {
    return variants.find(v => v.label === assignments[stepKey]) || variants[0];
  }
  // Random assignment, store it
  const picked = variants[Math.floor(Math.random() * variants.length)];
  return picked;
}

async function setStatus(enrollmentId, status, extra = {}) {
  const sets = ['status = $2', 'updated_at = NOW()'];
  const vals = [enrollmentId, status];

  if (extra.next_action_at !== undefined) {
    vals.push(extra.next_action_at);
    sets.push(`next_action_at = $${vals.length}`);
  }
  if (extra.invite_sent_at !== undefined) {
    vals.push(extra.invite_sent_at);
    sets.push(`invite_sent_at = $${vals.length}`);
  }
  if (extra.invite_approved_at !== undefined) {
    vals.push(extra.invite_approved_at);
    sets.push(`invite_approved_at = $${vals.length}`);
  }
  if (extra.current_step !== undefined) {
    vals.push(extra.current_step);
    sets.push(`current_step = $${vals.length}`);
  }
  if (extra.chat_id !== undefined) {
    vals.push(extra.chat_id);
    sets.push(`chat_id = $${vals.length}`);
  }
  if (extra.a_b_assignments !== undefined) {
    vals.push(JSON.stringify(extra.a_b_assignments));
    sets.push(`a_b_assignments = $${vals.length}`);
  }

  await db.query(
    `UPDATE enrollments SET ${sets.join(', ')} WHERE id = $1`,
    vals
  );
}

async function setError(enrollmentId, message) {
  await db.query(
    `UPDATE enrollments SET
       error_count = error_count + 1,
       last_error = $2,
       next_action_at = NOW() + INTERVAL '1 hour',
       updated_at = NOW()
     WHERE id = $1`,
    [enrollmentId, message]
  );
  // After 5 errors, mark as error status
  await db.query(
    `UPDATE enrollments SET status = 'error'
     WHERE id = $1 AND error_count >= 5`,
    [enrollmentId]
  );
}

async function saveEnrollmentMessage(enrollmentId, stepIndex, variantLabel, text, unipileMessageId) {
  await db.query(
    `INSERT INTO enrollment_messages (enrollment_id, step_index, variant_label, text, sent_at, unipile_message_id)
     VALUES ($1, $2, $3, $4, NOW(), $5)`,
    [enrollmentId, stepIndex, variantLabel || 'A', text, unipileMessageId || null]
  );
}

// ── Step handlers ─────────────────────────────────────────────────────────────

async function handlePending(enrollment, campaign, contact) {
  // Already connected — skip invite, jump to approved
  if (contact.already_connected) {
    await setStatus(enrollment.id, 'approved', { next_action_at: new Date() });
    await db.query('UPDATE contacts SET invite_approved=true, already_connected=true WHERE id=$1', [contact.id]).catch(()=>{});
    console.log(`[Enrollments] #${enrollment.id} already_connected → approved immediately`);
    return;
  }

  // Need real ACoXXX provider_id — slugs fail at Unipile. Postpone until enriched.
  if (!contact.provider_id || !contact.provider_id.startsWith('ACo')) {
    await setStatus(enrollment.id, 'pending', { next_action_at: addDays(new Date(), 1) });
    return;
  }

  // Guard against double-send with invitationSender
  const { rows: check } = await db.query(
    'SELECT invite_sent FROM contacts WHERE id=$1', [contact.id]
  );
  if (check[0]?.invite_sent) {
    await setStatus(enrollment.id, 'invite_sent', { invite_sent_at: new Date(), next_action_at: addDays(new Date(), 14) });
    console.log(`[Enrollments] #${enrollment.id} already sent by invitationSender — syncing`);
    return;
  }

  const withdrawDays = campaign.settings?.connection?.withdraw_after_days || 14;
  const inviteNote = getInviteNote(campaign);

  await unipile.sendInvitation(campaign.account_id, contact.provider_id, inviteNote);

  // Sync contacts table so invitationSender.countSentToday counts this invite
  await db.query('UPDATE contacts SET invite_sent=true, invite_sent_at=NOW() WHERE id=$1', [contact.id]).catch(()=>{});

  await setStatus(enrollment.id, 'invite_sent', {
    invite_sent_at: new Date(),
    next_action_at: addDays(new Date(), withdrawDays),
  });

  console.log(`[Enrollments] #${enrollment.id} invite sent → ${contact.first_name} ${contact.last_name}`);
}

async function handleInviteSent(enrollment, campaign, contact) {
  // next_action_at is the withdraw deadline — we're past it
  const autoWithdraw = campaign.settings?.connection?.auto_withdraw !== false;

  if (autoWithdraw && contact?.provider_id) {
    try {
      await unipile.withdrawInvitation(campaign.account_id, contact.li_profile_url);
      console.log(`[Enrollments] #${enrollment.id} invite withdrawn`);
    } catch (err) {
      // Ignore withdraw failures (invite may have been accepted already)
      console.warn(`[Enrollments] #${enrollment.id} withdraw failed: ${err.message}`);
    }
  }

  await setStatus(enrollment.id, 'withdrawn');
}

// ── Engagement actions ────────────────────────────────────────────────────────

async function runEngagementActions(enrollment, campaign, contact) {
  const eng = campaign.settings?.engagement || {};
  const accountId = campaign.account_id;
  const actions = [];

  // Keys match ENGAGEMENT_ACTIONS in campaigns.html:
  // view_profile, follow_company, like_posts, like_comments

  if (eng.view_profile && contact.li_profile_url) {
    try {
      await unipile.viewProfile(accountId, contact.li_profile_url || contact.provider_id);
      actions.push('view_profile');
    } catch (e) { console.warn(`[Enrollments] #${enrollment.id} view_profile failed: ${e.message}`); }
  }

  if (eng.like_posts && contact.provider_id) {
    try {
      await unipile.likeLatestPost(accountId, contact.provider_id);
      actions.push('like_post');
    } catch (e) { console.warn(`[Enrollments] #${enrollment.id} like_post failed: ${e.message}`); }
  }

  if (eng.follow_company && contact.li_company_url) {
    try {
      await unipile.followCompany(accountId, contact.li_company_url);
      actions.push('follow_company');
    } catch (e) { console.warn(`[Enrollments] #${enrollment.id} follow_company failed: ${e.message}`); }
  }

  if (actions.length) {
    console.log(`[Enrollments] #${enrollment.id} engagement: ${actions.join(', ')}`);
  }
  return actions;
}

function getFirstMessage(campaign, sequence) {
  // Priority 1: sequence steps (new system) — find first MESSAGE step (skip invite/engagement)
  if (sequence?.steps?.length) {
    const msgStep = sequence.steps
      .filter(s => s.type === 'message' || s.type === 'send_message')
      .sort((a, b) => a.step_index - b.step_index)[0];
    if (msgStep) return { source: 'sequence', step: msgStep };
  }
  // Priority 2: campaign.settings.messages.new (old system — still respect it)
  const msgs = campaign.settings?.messages?.new;
  if (Array.isArray(msgs) && msgs.length) {
    const m = msgs[0];
    const variants = m.variants?.length ? m.variants : [{ label: 'A', text: m.text || '' }];
    return { source: 'settings', step: { step_index: 0, type: 'message', delay_days: parseInt(m.delay) || 1, variants } };
  }
  return null; // no messages configured → engagement only
}

function getFollowUpMessage(campaign, sequence, currentStepIndex) {
  // Priority 1: sequence (new system) — find next MESSAGE step after currentStepIndex
  if (sequence?.steps?.length) {
    const next = sequence.steps
      .filter(s => (s.type === 'message' || s.type === 'send_message') && s.step_index > currentStepIndex)
      .sort((a, b) => a.step_index - b.step_index)[0];
    if (next) return { source: 'sequence', step: next };
  }
  // Priority 2: old system messages
  const msgs = campaign.settings?.messages?.new;
  if (Array.isArray(msgs) && msgs.length > currentStepIndex + 1) {
    const m = msgs[currentStepIndex + 1];
    const variants = m.variants?.length ? m.variants : [{ label: 'A', text: m.text || '' }];
    return { source: 'settings', step: { step_index: currentStepIndex + 1, type: 'message', delay_days: parseInt(m.delay) || 3, variants } };
  }
  return null;
}

async function handleApproved(enrollment, campaign, contact, sequence) {
  // Step 1: Run engagement actions the user configured
  await runEngagementActions(enrollment, campaign, contact);

  // Step 2: Check if there are messages to send
  const firstMsg = getFirstMessage(campaign, sequence);

  if (!firstMsg) {
    // No messages configured — engagement only. Mark done.
    await setStatus(enrollment.id, 'done');
    console.log(`[Enrollments] #${enrollment.id} approved → engagement done, no messages configured`);
    return;
  }

  // Schedule first message after the configured delay
  const delay = firstMsg.step?.delay_days ?? 1;
  await setStatus(enrollment.id, 'approved', {
    next_action_at: addDays(new Date(), delay),
    current_step: -1, // will be set to 0 when message is sent
  });

  // If delay is 0, send immediately in next run (next_action_at = NOW)
  if (delay === 0) {
    await sendMessageStep(enrollment, campaign, contact, firstMsg.step, 0);
  } else {
    console.log(`[Enrollments] #${enrollment.id} engagement done → first message in ${delay}d`);
  }
}

async function handleApprovedSendMessage(enrollment, campaign, contact, sequence) {
  // Called when next_action_at has passed after engagement phase
  const firstMsg = getFirstMessage(campaign, sequence);
  if (!firstMsg) {
    await setStatus(enrollment.id, 'done');
    return;
  }
  await sendMessageStep(enrollment, campaign, contact, firstMsg.step, 0);
}

async function handleMessaged(enrollment, campaign, contact, sequence) {
  const followUp = getFollowUpMessage(campaign, sequence, enrollment.current_step);

  if (!followUp) {
    await setStatus(enrollment.id, 'done');
    console.log(`[Enrollments] #${enrollment.id} all messages done → done`);
    return;
  }

  await sendMessageStep(enrollment, campaign, contact, followUp.step, followUp.step.step_index);
}

async function sendMessageStep(enrollment, campaign, contact, step, stepIndex) {
  const variant = pickVariant(step.variants, enrollment);
  if (!variant || !variant.text?.trim()) {
    console.warn(`[Enrollments] #${enrollment.id} step ${stepIndex} has no text, skipping`);
    await setStatus(enrollment.id, 'done');
    return;
  }

  const text = substituteTokens(variant.text, contact);

  let chatId = enrollment.chat_id || contact.chat_id;
  let unipileMsgId = null;

  if (chatId) {
    const result = await unipile.sendMessage(campaign.account_id, chatId, text);
    unipileMsgId = result?.id || null;
  } else if (contact.provider_id) {
    const result = await unipile.startDirectMessage(campaign.account_id, contact.provider_id, text);
    chatId = result?.id || result?.chat_id || null;
    unipileMsgId = result?.message_id || null;
  } else {
    throw new Error('No chat_id or provider_id to send message');
  }

  if (chatId && !enrollment.chat_id) {
    await db.query('UPDATE contacts SET chat_id=$1 WHERE id=$2 AND chat_id IS NULL', [chatId, contact.id]);
  }

  await saveEnrollmentMessage(enrollment.id, stepIndex, variant.label, text, unipileMsgId);

  const assignments = { ...(enrollment.a_b_assignments || {}), [`step_${stepIndex}`]: variant.label };

  // Calculate next step delay
  const followUp = getFollowUpMessage(campaign, null, stepIndex); // check settings only for timing
  const nextActionAt = followUp
    ? new Date(jitter(addDays(new Date(), followUp.step.delay_days || 3).getTime()))
    : addDays(new Date(), 999);

  await setStatus(enrollment.id, 'messaged', {
    current_step: stepIndex,
    next_action_at: nextActionAt,
    chat_id: chatId || enrollment.chat_id,
    a_b_assignments: assignments,
  });

  console.log(`[Enrollments] #${enrollment.id} step ${stepIndex} sent → ${contact.first_name}`);
}

function getInviteNote(campaign) {
  // Check if sequence has an invite step with a note
  return campaign.invite_note || '';
}

// ── Load sequence for a campaign ─────────────────────────────────────────────

async function loadSequence(sequenceId) {
  if (!sequenceId) return null;
  const { rows: steps } = await db.query(
    `SELECT * FROM sequence_steps WHERE sequence_id = $1 ORDER BY step_index ASC`,
    [sequenceId]
  );
  return steps.length ? { steps } : null;
}

// ── Daily limit helpers (per workspace + account) ─────────────────────────────

async function countInvitesSentToday(accountId, workspaceId) {
  const { rows } = await db.query(`
    SELECT COUNT(*) AS n FROM contacts c
    JOIN campaigns camp ON camp.id = c.campaign_id
    WHERE c.invite_sent_at >= CURRENT_DATE
      AND camp.account_id  = $1
      AND camp.workspace_id = $2
  `, [accountId, workspaceId]);
  return parseInt(rows[0]?.n || 0);
}

async function getDailyLimit(accountId, workspaceId) {
  const { rows } = await db.query(
    `SELECT settings FROM unipile_accounts WHERE account_id=$1 AND workspace_id=$2`,
    [accountId, workspaceId]
  );
  const settings = rows[0]?.settings;
  const parsed = typeof settings === 'string' ? JSON.parse(settings) : (settings || {});
  return parsed.limits?.connection_requests ?? 20;
}

// ── Main handler ─────────────────────────────────────────────────────────────

async function handler(job) {
  // First: sync enrollment statuses from contacts table (catches invitationSender/approvalChecker events)
  await syncEnrollmentsFromContacts().catch(err =>
    console.warn('[Enrollments] sync failed:', err.message)
  );

  // Grab all enrollments due for action, with FOR UPDATE SKIP LOCKED
  // to prevent multiple workers from processing the same enrollment
  const { rows: enrollments } = await db.query(`
    SELECT
      e.*,
      c.id            AS c_id,
      c.first_name, c.last_name, c.company, c.title,
      c.li_profile_url, c.provider_id, c.chat_id,
      c.already_connected,
      camp.workspace_id,
      camp.account_id, camp.settings, camp.sequence_id,
      camp.invite_note
    FROM enrollments e
    JOIN contacts c   ON c.id   = e.contact_id
    JOIN campaigns camp ON camp.id = e.campaign_id
    WHERE camp.status = 'active'
      AND e.status NOT IN ('done','withdrawn','skipped','error','positive_reply','replied')
      AND e.next_action_at <= NOW()
    ORDER BY e.next_action_at ASC
    LIMIT $1
  `, [MAX_BATCH]);

  if (!enrollments.length) {
    console.log('[Enrollments] No enrollments due for action (next_action_at <= NOW, not done/withdrawn)');
    return;
  }

  console.log(`[Enrollments] Processing ${enrollments.length} enrollments`);
  console.log('[Enrollments] Statuses:', enrollments.slice(0,5).map(e => `#${e.id}:${e.status}:step${e.current_step}`).join(' '));

  // Group by sequence_id to avoid loading same sequence multiple times
  const sequenceCache = {};

  // Track how many invites we've sent this run per account+workspace
  // (in addition to what was already sent today)
  const invitesSentThisRun = {}; // key: "accountId:workspaceId"
  const dailyLimitCache   = {}; // key: "accountId:workspaceId"
  const dailySentCache    = {}; // key: "accountId:workspaceId" — fetched once per key

  for (const row of enrollments) {
    const enrollment = {
      id:              row.id,
      campaign_id:     row.campaign_id,
      contact_id:      row.contact_id,
      status:          row.status,
      current_step:    row.current_step,
      next_action_at:  row.next_action_at,
      invite_sent_at:  row.invite_sent_at,
      chat_id:         row.chat_id,
      a_b_assignments: row.a_b_assignments || {},
      error_count:     row.error_count || 0,
    };

    const contact = {
      id:                row.c_id,
      first_name:        row.first_name,
      last_name:         row.last_name,
      company:           row.company,
      title:             row.title,
      li_profile_url:    row.li_profile_url,
      provider_id:       row.provider_id,
      chat_id:           row.chat_id,
      already_connected: row.already_connected,
    };

    const campaign = {
      id:           row.campaign_id,
      workspace_id: row.workspace_id,
      account_id:   row.account_id,
      sequence_id:  row.sequence_id,
      invite_note:  row.invite_note,
      settings:    typeof row.settings === 'string'
                     ? JSON.parse(row.settings)
                     : (row.settings || {}),
    };

    // Check working hours
    if (!isWithinWorkingHours(campaign.settings?.hours)) {
      // Skip silently — will retry at next run
      continue;
    }

    // Load sequence (cached)
    if (campaign.sequence_id && !sequenceCache[campaign.sequence_id]) {
      sequenceCache[campaign.sequence_id] = await loadSequence(campaign.sequence_id);
    }
    const sequence = campaign.sequence_id ? sequenceCache[campaign.sequence_id] : null;

    try {
      switch (enrollment.status) {
        case 'pending': {
          // Enforce daily invite limit before sending
          const limKey = `${campaign.account_id}:${campaign.workspace_id || '?'}`;
          if (campaign.workspace_id) {
            if (!dailyLimitCache[limKey]) {
              dailyLimitCache[limKey] = await getDailyLimit(campaign.account_id, campaign.workspace_id);
              dailySentCache[limKey]  = await countInvitesSentToday(campaign.account_id, campaign.workspace_id);
              invitesSentThisRun[limKey] = 0;
            }
            const canSend = dailyLimitCache[limKey] - dailySentCache[limKey] - invitesSentThisRun[limKey];
            if (canSend <= 0) {
              console.log(`[Enrollments] ${limKey} daily limit reached — skipping pending enrollments`);
              break;
            }
            await handlePending(enrollment, campaign, contact);
            const { rows: sentCheck } = await db.query('SELECT invite_sent FROM contacts WHERE id=$1', [contact.id]);
            if (sentCheck[0]?.invite_sent) invitesSentThisRun[limKey]++;
          } else {
            await handlePending(enrollment, campaign, contact);
          }
          break;
        }
        case 'invite_sent':
          await handleInviteSent(enrollment, campaign, contact);
          break;
        case 'approved':
          // If current_step is -1, engagement was done — now send first message
          if (enrollment.current_step === -1) {
            await handleApprovedSendMessage(enrollment, campaign, contact, sequence);
          } else {
            await handleApproved(enrollment, campaign, contact, sequence);
          }
          break;
        case 'messaged':
          await handleMessaged(enrollment, campaign, contact, sequence);
          break;
      }
    } catch (err) {
      console.error(`[Enrollments] #${enrollment.id} error: ${err.message}`);
      await setError(enrollment.id, err.message);
    }

    // Small delay between actions to avoid hammering Unipile
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
  }

  console.log(`[Enrollments] Batch complete`);
}

module.exports = { handler };

/**
 * Sync enrollment statuses from contacts table.
 * Called at the start of each run to catch events from invitationSender/messageSender/approvalChecker.
 */
async function syncEnrollmentsFromContacts() {
  // invite_sent but enrollment still pending
  await db.query(`
    UPDATE enrollments e
    SET    status = 'invite_sent',
           invite_sent_at = COALESCE(e.invite_sent_at, c.invite_sent_at, NOW()),
           next_action_at = COALESCE(e.next_action_at, NOW() + INTERVAL '14 days'),
           updated_at = NOW()
    FROM   contacts c
    JOIN   campaigns camp ON camp.id = c.campaign_id
    WHERE  e.contact_id = c.id
      AND  e.campaign_id = c.campaign_id
      AND  c.invite_sent = true
      AND  e.status = 'pending'
  `);

  // invite_approved but enrollment still invite_sent
  await db.query(`
    UPDATE enrollments e
    SET    status = 'approved',
           invite_approved_at = COALESCE(e.invite_approved_at, NOW()),
           next_action_at = NOW(),
           updated_at = NOW()
    FROM   contacts c
    WHERE  e.contact_id = c.id
      AND  e.campaign_id = c.campaign_id
      AND  (c.invite_approved = true OR c.already_connected = true)
      AND  e.status = 'invite_sent'
  `);

  // msg_sent but enrollment still approved  
  await db.query(`
    UPDATE enrollments e
    SET    status = 'messaged',
           next_action_at = NOW() + INTERVAL '999 days',
           updated_at = NOW()
    FROM   contacts c
    WHERE  e.contact_id = c.id
      AND  e.campaign_id = c.campaign_id
      AND  c.msg_sent = true
      AND  e.status = 'approved'
  `);

  // msg_replied but enrollment still messaged
  await db.query(`
    UPDATE enrollments e
    SET    status = 'replied',
           updated_at = NOW()
    FROM   contacts c
    WHERE  e.contact_id = c.id
      AND  e.campaign_id = c.campaign_id
      AND  c.msg_replied = true
      AND  e.status = 'messaged'
  `);
}
