/**
 * Like Sender (manual / API-triggered)
 *
 * Sends personal-account likes on LinkedIn.
 * Same-day isolation: skips contacts the company page liked today
 * (tracked via company_likes_sent_at).
 *
 * Rules:
 *   - Only contacts with engagement_level in (engaged, average_engaged)
 *   - Skip contacts personal-liked in last 3 days (likes_sent_at)
 *   - Skip contacts company-liked TODAY (company_likes_sent_at)
 *   - Never like the same post/comment twice (liked_ids dedup)
 *   - Up to 3 likes per contact per run
 *   - Random delays: 10-30s between contacts, 5-15s between likes
 */

const db      = require('./db');
const unipile = require('./unipile');

const MAX_LIKES_PER_CONTACT = 3; // max cumulative likes per contact
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const rand  = (min, max) => min + Math.random() * (max - min);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let isRunning = false;

async function run(campaignId, options = {}) {
  if (isRunning) { console.log('[LikeSender] Already running, skipping'); return { skipped: true }; }
  isRunning = true;
  console.log(`[LikeSender] Starting for campaign ${campaignId}...`);

  try {
    const { rows: campRows } = await db.query(
      'SELECT id, account_id, workspace_id, settings FROM campaigns WHERE id = $1', [campaignId]
    );
    if (!campRows.length) return { error: 'Campaign not found' };

    const campaign = campRows[0];
    const eng      = campaign.settings?.engagement || {};
    const flags    = {
      doLikePosts:    !!eng.like_posts,
      doLikeComments: !!eng.like_comments,
    };

    // Read daily limit from account settings — use workspace-specific row
    const { rows: accRows } = await db.query(
      'SELECT settings FROM unipile_accounts WHERE account_id = $1 AND workspace_id = $2',
      [campaign.account_id, campaign.workspace_id]
    );
    const accSettings = accRows[0]?.settings || {};
    const dailyLimit  = accSettings.limits?.likes ?? 15;

    // Count personal likes sent today across all campaigns for this account
    const { rows: todayRows } = await db.query(
      `SELECT COALESCE(SUM(COALESCE(post_likes_sent,0)+COALESCE(comment_likes_sent,0)),0) AS n
        FROM contacts
        WHERE campaign_id IN (SELECT id FROM campaigns WHERE account_id = $1 AND workspace_id = $2 AND status='active')
        AND likes_sent_at >= CURRENT_DATE`,
      [campaign.account_id, campaign.workspace_id]
    );
    const sentToday = parseInt(todayRows[0]?.n || 0);
    const remaining = dailyLimit - sentToday;
    if (remaining <= 0) {
      console.log(`[LikeSender] Daily limit reached (${sentToday}/${dailyLimit}), skipping`);
      return { skipped: true, reason: 'daily_limit_reached', sent_today: sentToday, limit: dailyLimit };
    }
    console.log(`[LikeSender] Budget: ${sentToday}/${dailyLimit}, sending up to ${remaining} more`);
    if (!flags.doLikePosts && !flags.doLikeComments) {
      return { skipped: true, reason: 'no_personal_like_actions_enabled' };
    }

    const cooldownCutoff = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const likedFilter  = options.force ? '' :
      `AND (COALESCE(post_likes_sent,0)+COALESCE(comment_likes_sent,0)) < ${MAX_LIKES_PER_CONTACT}`;
    const contactLimit = Math.min(20, remaining);

    // Isolation: skip contacts company-liked today (company_likes_sent_at)
    const { rows: contacts } = await db.query(
      `SELECT id, first_name, last_name, provider_id, engagement_level,
              engagement_data, post_likes_sent, comment_likes_sent, liked_ids
       FROM contacts
       WHERE campaign_id = $1
         AND engagement_level IN ('engaged', 'average_engaged')
         AND engagement_data IS NOT NULL
         AND provider_id IS NOT NULL
         AND (likes_sent_at IS NULL OR likes_sent_at < $2)
         AND (
           company_likes_sent_at IS NULL
           OR DATE(company_likes_sent_at AT TIME ZONE 'UTC') < CURRENT_DATE
         )
         ${likedFilter}
       ORDER BY CASE engagement_level WHEN 'engaged' THEN 0 ELSE 1 END, id ASC
       LIMIT ${contactLimit}`,
      [campaignId, cooldownCutoff]
    );

    if (!contacts.length) {
      console.log('[LikeSender] No eligible contacts');
      return { liked_contacts: 0 };
    }

    console.log(`[LikeSender] Processing ${contacts.length} contacts`);

    let totalPostLikes = 0, totalCommentLikes = 0, processedContacts = 0;

    for (const contact of contacts) {
      const { postLikes, commentLikes } = await likeContactPersonal(contact, campaign.account_id, flags);
      totalPostLikes    += postLikes;
      totalCommentLikes += commentLikes;
      if (postLikes + commentLikes > 0) processedContacts++;

      if (processedContacts < contacts.length) await sleep(rand(10000, 30000));
    }

    const summary = { contacts_processed: processedContacts, total_post_likes: totalPostLikes, total_comment_likes: totalCommentLikes };
    console.log('[LikeSender] Done:', JSON.stringify(summary));
    return summary;
  } catch (err) {
    console.error('[LikeSender] Error:', err.message);
    return { error: err.message };
  } finally {
    isRunning = false;
  }
}

async function likeContactPersonal(contact, accountId, flags) {
  const engData = typeof contact.engagement_data === 'string'
    ? JSON.parse(contact.engagement_data) : (contact.engagement_data || {});

  const alreadyLiked = new Set(Array.isArray(contact.liked_ids) ? contact.liked_ids : []);
  const alreadySent  = (contact.post_likes_sent || 0) + (contact.comment_likes_sent || 0);
  const remaining    = MAX_LIKES - alreadySent;
  if (remaining <= 0) return { postLikes: 0, commentLikes: 0 };

  const items = [];

  if (flags.doLikePosts) {
    const posts = engData.non_employer_posts_14d_data || engData.posts_14d_data || [];
    for (const p of posts) {
      const sid = String(p.social_id || p.id || p.post_id || '');
      if (sid && !alreadyLiked.has(sid)) items.push({ type: 'post', social_id: sid, key: sid });
    }
  }

  if (flags.doLikeComments) {
    const comments = engData.non_employer_comments_14d_data || engData.comments_14d_data || [];
    for (const c of comments) {
      const postSid = String(c.post?.social_id || c.post_id || c.parent_post_id || '');
      const cid     = String(c.id || c.comment_id || '');
      const key     = `comment:${cid}`;
      if (postSid && cid && !alreadyLiked.has(key)) items.push({ type: 'comment', social_id: postSid, comment_id: cid, key });
    }
  }

  if (!items.length) return { postLikes: 0, commentLikes: 0 };

  let postLikes = 0, commentLikes = 0, sent = 0;
  const newKeys = [];

  for (const item of items) {
    if (sent >= remaining) break;
    try {
      await unipile.likePost(accountId, item.social_id, item.type === 'comment' ? item.comment_id : undefined, undefined);
      if (item.type === 'post')    postLikes++;
      if (item.type === 'comment') commentLikes++;
      newKeys.push(item.key);
      sent++;
      console.log(`[LikeSender] ð ${item.type} â ${contact.first_name} ${contact.last_name}`);
      if (sent < remaining) await sleep(rand(5000, 15000));
    } catch (err) {
      console.error(`[LikeSender] â ${item.type} contact ${contact.id}: ${err.message}`);
    }
  }

  if (postLikes > 0 || commentLikes > 0) {
    const merged = [...alreadyLiked, ...newKeys];
    await db.query(
      `UPDATE contacts
       SET post_likes_sent    = COALESCE(post_likes_sent, 0)    + $1,
           comment_likes_sent = COALESCE(comment_likes_sent, 0) + $2,
           likes_sent_at      = NOW(),
           liked_ids          = $3::jsonb
       WHERE id = $4`,
      [postLikes, commentLikes, JSON.stringify(merged), contact.id]
    );
  }

  return { postLikes, commentLikes };
}

module.exports = { run, start };

// -- Scheduled runner: respects account daily limit --
const LIKE_INTERVAL_MS = 60 * 60 * 1000; // 60 min

function start() {
  console.log('[LikeSender] Scheduler started — runs every 60 min');
  setTimeout(runAll, 2 * 60 * 1000);
  setInterval(runAll, LIKE_INTERVAL_MS);
}

async function runAll() {
  const watchdog = require('./watchdog');
  watchdog.tick('likeSender');
  try {
    const { rows: camps } = await db.query(
      `SELECT DISTINCT id FROM campaigns
        WHERE status = 'active'
        AND ((settings->'engagement'->>'like_posts')::boolean = true
          OR (settings->'engagement'->>'like_comments')::boolean = true)`
    );
    for (const c of camps) await run(c.id);
  } catch(err) {
    console.error('[LikeSender] runAll error:', err.message);
  }
}