/**
 * Engagement Scraper ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Contacts
 *
 * Runs daily for ALL active campaigns regardless of settings.
 * Three distinct phases per campaign:
 *
 *   Phase 1 ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Scrape (unconditional)
 *     Fetches posts + comments for unscraped contacts, saves JSONB to DB.
 *
 *   Phase 2 ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Personal account likes (if enabled in campaign settings)
 *     Selects up to 20 contacts with content.
 *     Rule: skips contacts the company page already liked TODAY.
 *     Tracks in: likes_sent_at, liked_ids, post_likes_sent, comment_likes_sent
 *
 *   Phase 3 ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Company page likes (if enabled in campaign settings)
 *     Selects up to 20 DIFFERENT contacts with content.
 *     Rule: skips contacts the personal account liked TODAY (including Phase 2).
 *     Tracks in: company_likes_sent_at, company_liked_ids,
 *                company_post_likes_sent, company_comment_likes_sent
 *
 * ABSOLUTE ISOLATION RULE:
 *   On any calendar day, a contact can only be liked by ONE identity
 *   (personal OR company page). Never both on the same day. No exceptions.
 *
 * Engagement levels (OR logic):
 *   un_engaged       ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ 0 non-employer posts AND 0 non-employer comments in 14d
 *   average_engaged  ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¥1 non-employer post OR ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¥1 non-employer comment in 14d
 *   engaged          ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¥2 non-employer posts OR ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¥2 non-employer comments in 14d
 *
 * Cooldown: 3 days before re-liking the same contact (per identity)
 * Dedup: liked_ids / company_liked_ids track IDs already liked
 *
 * Scheduled: once daily at 06:00.
 */

const db      = require('./db');
const unipile = require('./unipile');

const DAYS_7        = 7 * 24 * 60 * 60 * 1000;
const MAX_LIKES     = 3;
const COOLDOWN_DAYS = 3;
const BATCH_SIZE    = 30;
const SCRAPE_LIMIT  = 5;
const LIKE_BATCH    = 20;   // max contacts liked per identity per run

const rand  = (min, max) => min + Math.random() * (max - min);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let isRunning = false;

function start() {
  console.log('[EngagementScraper] Started - runs twice daily at 09:00 and 21:00 (Israel time)');
  scheduleTwiceDaily();
}

function scheduleTwiceDaily() {
  const RUN_HOURS_UTC = [6, 18]; // 09:00 and 21:00 Israel (UTC+3)

  function msUntilNext() {
    const now = new Date();
    const nowMinUTC = now.getUTCHours() * 60 + now.getUTCMinutes();
    for (const h of RUN_HOURS_UTC) {
      if (h * 60 > nowMinUTC) return (h * 60 - nowMinUTC) * 60 * 1000;
    }
    return ((24 * 60 - nowMinUTC) + RUN_HOURS_UTC[0] * 60) * 60 * 1000;
  }

  function scheduleNext() {
    const ms = msUntilNext();
    console.log('[EngagementScraper] Next run in ' + Math.round(ms / 3600000 * 10) / 10 + 'h');
    setTimeout(function() { run(); scheduleNext(); }, ms);
  }

  scheduleNext();
}

async function run(campaignId = null) {
  if (isRunning) { console.log('[EngagementScraper] Already running, skipping'); return { skipped: true }; }
  isRunning = true;
  console.log('[EngagementScraper] Starting run...');

  try {
    let query = `SELECT c.id, c.account_id, c.workspace_id, c.name, c.settings FROM campaigns c WHERE c.status = 'active'`;
    const qp = [];
    if (campaignId) { qp.push(campaignId); query += ` AND c.id = $${qp.length}`; }

    const { rows: campaigns } = await db.query(query, qp);
    if (!campaigns.length) { console.log('[EngagementScraper] No active campaigns'); return { campaigns_processed: 0 }; }

    const summary = [];
    for (const campaign of campaigns) {
      const result = await processCampaign(campaign);
      summary.push({ campaign_id: campaign.id, name: campaign.name, ...result });
    }

    console.log('[EngagementScraper] Done:', JSON.stringify(summary));
    return { campaigns_processed: campaigns.length, summary };
  } catch (err) {
    console.error('[EngagementScraper] Error:', err.message);
    return { error: err.message };
  } finally {
    isRunning = false;
  }
}

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ

// ── Phase 4: Company follow invitations ─────────────────────────────────────
const FOLLOW_BATCH = 20;

async function runCompanyFollowInvites(campaignId, accountId, companyPageUrn) {
  const { rows: toFollow } = await db.query(
    `SELECT id, provider_id, member_urn FROM contacts
     WHERE campaign_id = $1
       AND invite_approved = true
       AND company_follow_invited = false
       AND (member_urn IS NOT NULL OR provider_id LIKE 'ACo%')
     ORDER BY RANDOM()
     LIMIT $2`,
    [campaignId, FOLLOW_BATCH]
  );

  if (!toFollow.length) {
    console.log(`[EngagementScraper] Company follow: 0 contacts to invite`);
    return 0;
  }

  // Build URNs — prefer member_urn, fall back to urn:li:fsd_profile:ACoXXX
  const elements = toFollow
    .map(c => {
      const urn = c.member_urn?.startsWith('urn:li:') ? c.member_urn
        : c.provider_id?.startsWith('ACo') ? `urn:li:fsd_profile:${c.provider_id}`
        : null;
      return urn ? { id: c.id, urn } : null;
    })
    .filter(Boolean);

  if (!elements.length) {
    console.log(`[EngagementScraper] Company follow: no valid URNs found`);
    return 0;
  }

  const memberUrns = elements.map(e => e.urn);

  try {
    await unipile.sendCompanyFollowInvites(accountId, companyPageUrn, memberUrns);
    await db.query(
      `UPDATE contacts
         SET company_follow_invited = true, company_follow_invited_at = NOW()
       WHERE id = ANY($1::int[])`,
      [elements.map(e => e.id)]
    );
    console.log(`[EngagementScraper] Company follow invites sent: ${elements.length}`);
    return elements.length;
  } catch (err) {
    console.error(`[EngagementScraper] Company follow invite error: ${err.message}`);
    return 0;
  }
}

async function processCampaign(campaign) {
  console.log(`[EngagementScraper] Campaign ${campaign.id}: "${campaign.name}"`);

  // Load company page URN from workspace-specific account settings
  const { rows: accRows } = await db.query(
    'SELECT settings FROM unipile_accounts WHERE account_id = $1 AND workspace_id = $2',
    [campaign.account_id, campaign.workspace_id]
  );
  const companyPageUrn = accRows[0]?.settings?.company_page_urn || null;
  const asOrgId        = companyPageUrn?.match(/(\d+)$/)?.[1] || null;

  // What's enabled in campaign settings
  const eng = campaign.settings?.engagement || {};
  const personalFlags = {
    doLikePosts:    !!eng.like_posts,
    doLikeComments: !!eng.like_comments,
  };
  const companyFlags = {
    doLikePosts:    !!eng.company_like_posts    && !!asOrgId,
    doLikeComments: !!eng.company_like_comments && !!asOrgId,
  };
  const canLikePersonal = personalFlags.doLikePosts || personalFlags.doLikeComments;
  const canLikeCompany  = companyFlags.doLikePosts  || companyFlags.doLikeComments;

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Phase 1: Scrape new contacts (unconditional) ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  const scrapedCount = await scrapeNewContacts(campaign);

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Phase 2: Personal account likes ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  // Returns IDs of contacts liked in this run (to exclude from Phase 3)
  let personalLikedIds = [];
  if (canLikePersonal) {
    personalLikedIds = await runPersonalLikes(
      campaign.id, campaign.account_id, companyPageUrn, personalFlags
    );
  }

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Phase 3: Company page likes ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  // Excludes personalLikedIds + contacts personal liked today
  let companyLikedCount = 0;
  if (canLikeCompany) {
    companyLikedCount = await runCompanyLikes(
      campaign.id, campaign.account_id, asOrgId, companyFlags, personalLikedIds
    );
  }


  // ── Phase 4: Company follow invitations ─────────────────────────────────
  let followInvitedCount = 0;
  const canFollow = !!eng.follow_company && !!companyPageUrn;
  if (canFollow) {
    followInvitedCount = await runCompanyFollowInvites(
      campaign.id, campaign.account_id, companyPageUrn
    );
  }

  const { rows: statsRows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE engagement_level IN ('average_engaged','engaged')) AS with_content,
       COUNT(*) FILTER (WHERE engagement_level = 'un_engaged')                   AS un_engaged,
       COUNT(*) FILTER (WHERE engagement_level IS NULL AND provider_id IS NOT NULL) AS pending
     FROM contacts WHERE campaign_id = $1`,
    [campaign.id]
  );
  const s = statsRows[0];
  console.log(`[EngagementScraper] Campaign ${campaign.id}: with_content=${s.with_content} un_engaged=${s.un_engaged} pending=${s.pending}`);

  return {
    contacts_scraped:     scrapedCount,
    personal_liked:       personalLikedIds.length,
    company_liked:        companyLikedCount,
    follow_invited:       followInvitedCount,
  };
}

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Phase 1: Scrape new contacts ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ

async function scrapeNewContacts(campaign) {
  const TARGET    = 30;
  const cooldown  = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let totalContent = 0;
  let totalScraped = 0;
  let attempts     = 0;
  const MAX_ATTEMPTS = 150;

  console.log('[EngagementScraper] Campaign ' + campaign.id + ': targeting ' + TARGET + ' posts/comments');

  while (totalContent < TARGET && attempts < MAX_ATTEMPTS) {
    const { rows } = await db.query(
      `SELECT id, first_name, last_name, company, provider_id
       FROM contacts
       WHERE campaign_id = $1
         AND provider_id IS NOT NULL AND provider_id != ''
         AND engagement_data IS NULL
         AND (likes_sent_at IS NULL OR likes_sent_at < $2)
       ORDER BY RANDOM()
       LIMIT 1`,
      [campaign.id, cooldown]
    );

    if (!rows.length) {
      console.log('[EngagementScraper] Campaign ' + campaign.id + ': no more unscraped contacts');
      break;
    }

    const contact = rows[0];
    attempts++;

    try {
      const result = await scrapeContact(contact, campaign.account_id);
      totalScraped++;
      const ed = result.engagementData || {};
      const found = (ed.non_employer_posts_14d || 0) + (ed.non_employer_comments_14d || 0);
      totalContent += found;
      console.log('[EngagementScraper] ' + contact.first_name + ' ' + contact.last_name + ': +' + found + ' (' + totalContent + '/' + TARGET + ')');
    } catch (err) {
      console.error('[EngagementScraper] contact ' + contact.id + ': ' + err.message);
    }

    if (totalContent < TARGET) await sleep(rand(5000, 12000));
  }

  console.log('[EngagementScraper] Campaign ' + campaign.id + ': scraped=' + totalScraped + ' content=' + totalContent);
  return totalScraped;
}
async function runPersonalLikes(campaignId, accountId, companyPageUrn, flags) {
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { rows: contacts } = await db.query(
    `SELECT id, first_name, last_name, engagement_data,
            liked_ids, post_likes_sent, comment_likes_sent
     FROM contacts
     WHERE campaign_id = $1
       AND engagement_level IN ('engaged', 'average_engaged')
       AND engagement_data IS NOT NULL
       AND (likes_sent_at IS NULL OR likes_sent_at < $2)
       AND (
         company_likes_sent_at IS NULL
         OR DATE(company_likes_sent_at AT TIME ZONE 'UTC') < CURRENT_DATE
       )
     ORDER BY CASE engagement_level WHEN 'engaged' THEN 0 ELSE 1 END, RANDOM()
     LIMIT $3`,
    [campaignId, cooldownCutoff, LIKE_BATCH]
  );

  if (!contacts.length) {
    console.log(`[EngagementScraper] Personal likes: no eligible contacts`);
    return [];
  }

  console.log(`[EngagementScraper] Personal likes: processing ${contacts.length} contacts`);
  const asOrgId = companyPageUrn?.match(/(\d+)$/)?.[1] || null;
  const likedContactIds = [];

  for (const contact of contacts) {
    try {
      const liked = await likeContactPersonal(contact, accountId, asOrgId, flags);
      if (liked > 0) likedContactIds.push(contact.id);
    } catch (err) {
      console.error(`[EngagementScraper] ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ personal like contact ${contact.id}: ${err.message}`);
    }
    await sleep(rand(5000, 15000));
  }

  return likedContactIds;
}

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Phase 3: Company page likes (up to LIKE_BATCH DIFFERENT contacts) ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
// Excludes: contacts liked personally today + contacts just liked in Phase 2.
async function runCompanyLikes(campaignId, accountId, asOrgId, flags, excludeContactIds) {
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Use [-1] as dummy when no exclusions to keep the query valid
  const excludeArr = excludeContactIds.length > 0 ? excludeContactIds : [-1];

  const { rows: contacts } = await db.query(
    `SELECT id, first_name, last_name, engagement_data,
            company_liked_ids, company_post_likes_sent, company_comment_likes_sent
     FROM contacts
     WHERE campaign_id = $1
       AND engagement_level IN ('engaged', 'average_engaged')
       AND engagement_data IS NOT NULL
       AND (company_likes_sent_at IS NULL OR company_likes_sent_at < $2)
       AND (
         likes_sent_at IS NULL
         OR DATE(likes_sent_at AT TIME ZONE 'UTC') < CURRENT_DATE
       )
       AND id != ALL($3)
     ORDER BY CASE engagement_level WHEN 'engaged' THEN 0 ELSE 1 END, RANDOM()
     LIMIT $4`,
    [campaignId, cooldownCutoff, excludeArr, LIKE_BATCH]
  );

  if (!contacts.length) {
    console.log(`[EngagementScraper] Company likes: no eligible contacts`);
    return 0;
  }

  console.log(`[EngagementScraper] Company likes: processing ${contacts.length} contacts`);
  let likedCount = 0;

  for (const contact of contacts) {
    try {
      const liked = await likeContactAsCompany(contact, accountId, asOrgId, flags);
      if (liked > 0) likedCount++;
    } catch (err) {
      console.error(`[EngagementScraper] ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ company like contact ${contact.id}: ${err.message}`);
    }
    await sleep(rand(5000, 15000));
  }

  return likedCount;
}

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Scrape one contact and save JSONB ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
async function scrapeContact(contact, accountId) {
  const cutoff = new Date(Date.now() - DAYS_7);
  const contactCompany = (contact.company || '').toLowerCase().trim();

  let rawPosts = [], rawComments = [];

  try { rawPosts = await unipile.getUserPosts(accountId, contact.provider_id, SCRAPE_LIMIT); }
  catch (err) { console.warn(`[Scraper] Posts failed ${contact.provider_id}: ${err.message}`); }

  await sleep(rand(3000, 8000));

  try { rawComments = await unipile.getUserComments(accountId, contact.provider_id, SCRAPE_LIMIT); }
  catch (err) { console.warn(`[Scraper] Comments failed ${contact.provider_id}: ${err.message}`); }

  const posts14d    = rawPosts.filter(p => isWithin14Days(p, cutoff));
  const comments14d = rawComments.filter(c => isWithin14Days(c, cutoff));

  const nonEmployerPosts    = posts14d.filter(p => !isEmployerRelated(p, contactCompany, 'post'));
  const nonEmployerComments = comments14d.filter(c => !isEmployerRelated(c, contactCompany, 'comment'));

  const level = classifyEngagement(nonEmployerPosts.length, nonEmployerComments.length);

  const engagementData = {
    scraped_at:                     new Date().toISOString(),
    posts_total:                    rawPosts.length,
    comments_total:                 rawComments.length,
    posts_14d:                      posts14d.length,
    comments_14d:                   comments14d.length,
    non_employer_posts_14d:         nonEmployerPosts.length,
    non_employer_comments_14d:      nonEmployerComments.length,
    engagement_level:               level,
    contact_company:                contact.company || '',
    posts:                          rawPosts,
    comments:                       rawComments,
    posts_14d_data:                 posts14d,
    comments_14d_data:              comments14d,
    non_employer_posts_14d_data:    nonEmployerPosts,
    non_employer_comments_14d_data: nonEmployerComments,
  };

  await db.query(
    `UPDATE contacts
     SET engagement_level      = $1,
         engagement_scraped_at = NOW(),
         engagement_data       = $2
     WHERE id = $3`,
    [level, JSON.stringify(engagementData), contact.id]
  );

  console.log(
    `[EngagementScraper] ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ ${contact.first_name} ${contact.last_name} ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ ${level}` +
    ` (posts=${nonEmployerPosts.length} comments=${nonEmployerComments.length})`
  );

  return { engagement_level: level, engagementData };
}

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Like as personal account ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
async function likeContactPersonal(contact, accountId, asOrgId, flags) {
  const { rows } = await db.query('SELECT liked_ids FROM contacts WHERE id = $1', [contact.id]);
  const alreadyLiked = new Set(Array.isArray(rows[0]?.liked_ids) ? rows[0].liked_ids : []);

  const engData = typeof contact.engagement_data === 'string'
    ? JSON.parse(contact.engagement_data) : (contact.engagement_data || {});

  const items = buildLikeItems(engData, alreadyLiked, flags, false);
  if (!items.length) return 0;

  let sent = 0;
  const newKeys = [];
  let postLikes = 0, commentLikes = 0;

  for (const item of items) {
    if (sent >= MAX_LIKES) break;
    try {
      await unipile.likePost(accountId, item.social_id, item.comment_id, undefined);
      newKeys.push(item.key);
      if (item.type === 'post')    postLikes++;
      if (item.type === 'comment') commentLikes++;
      sent++;
      console.log(`[EngagementScraper] ÃÂÃÂ°ÃÂÃÂÃÂÃÂÃÂÃÂ Personal: ${item.type} ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ ${contact.first_name} ${contact.last_name}`);
      if (sent < MAX_LIKES) await sleep(rand(5000, 15000));
    } catch (err) {
      console.error(`[EngagementScraper] ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ personal like ${contact.id}: ${err.message}`);
    }
  }

  if (sent > 0) {
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

  return sent;
}

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Like as company page ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
async function likeContactAsCompany(contact, accountId, asOrgId, flags) {
  if (!asOrgId) return 0;

  const { rows } = await db.query('SELECT company_liked_ids FROM contacts WHERE id = $1', [contact.id]);
  const alreadyLiked = new Set(Array.isArray(rows[0]?.company_liked_ids) ? rows[0].company_liked_ids : []);

  const engData = typeof contact.engagement_data === 'string'
    ? JSON.parse(contact.engagement_data) : (contact.engagement_data || {});

  const items = buildLikeItems(engData, alreadyLiked, flags, true);
  if (!items.length) return 0;

  let sent = 0;
  const newKeys = [];
  let postLikes = 0, commentLikes = 0;

  for (const item of items) {
    if (sent >= MAX_LIKES) break;
    try {
      await unipile.likePost(accountId, item.social_id, item.comment_id, asOrgId);
      newKeys.push(item.key);
      if (item.type === 'post')    postLikes++;
      if (item.type === 'comment') commentLikes++;
      sent++;
      console.log(`[EngagementScraper] ÃÂÃÂ°ÃÂÃÂÃÂÃÂÃÂÃÂ Company page: ${item.type} ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ ${contact.first_name} ${contact.last_name}`);
      if (sent < MAX_LIKES) await sleep(rand(5000, 15000));
    } catch (err) {
      console.error(`[EngagementScraper] ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ company like ${contact.id}: ${err.message}`);
    }
  }

  if (sent > 0) {
    const merged = [...alreadyLiked, ...newKeys];
    await db.query(
      `UPDATE contacts
       SET company_post_likes_sent    = COALESCE(company_post_likes_sent, 0)    + $1,
           company_comment_likes_sent = COALESCE(company_comment_likes_sent, 0) + $2,
           company_likes_sent_at      = NOW(),
           company_liked_ids          = $3::jsonb
       WHERE id = $4`,
      [postLikes, commentLikes, JSON.stringify(merged), contact.id]
    );
  }

  return sent;
}

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Build list of likeable items not yet liked ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
// isCompany=true: use doLikePosts/doLikeComments from company flags (same field names)
function buildLikeItems(engData, alreadyLiked, flags, isCompany) {
  const items = [];

  if (flags.doLikePosts) {
    const posts = engData.non_employer_posts_14d_data || engData.posts_14d_data || [];
    for (const p of posts) {
      const sid = String(p.social_id || p.id || p.post_id || '');
      if (sid && !alreadyLiked.has(sid))
        items.push({ type: 'post', social_id: sid, comment_id: undefined, key: sid });
    }
  }

  if (flags.doLikeComments) {
    const comments = engData.non_employer_comments_14d_data || engData.comments_14d_data || [];
    for (const c of comments) {
      const postSid = String(c.post?.social_id || c.post_id || c.parent_post_id || '');
      const cid     = String(c.id || c.comment_id || '');
      const key     = `comment:${cid}`;
      if (postSid && cid && !alreadyLiked.has(key))
        items.push({ type: 'comment', social_id: postSid, comment_id: cid, key });
    }
  }

  return items;
}

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Re-classify from existing data (no API calls) ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
async function reclassifyFromExistingData(campaignId) {
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, engagement_data FROM contacts
     WHERE campaign_id = $1 AND engagement_data IS NOT NULL AND engagement_level IS NOT NULL`,
    [campaignId]
  );
  let updated = 0;
  for (const row of rows) {
    const d = typeof row.engagement_data === 'string' ? JSON.parse(row.engagement_data) : row.engagement_data;
    const newLevel = classifyEngagement(d.non_employer_posts_14d || 0, d.non_employer_comments_14d || 0);
    const oldLevel = d.engagement_level;
    d.engagement_level = newLevel;
    await db.query('UPDATE contacts SET engagement_level = $1, engagement_data = $2 WHERE id = $3', [newLevel, JSON.stringify(d), row.id]);
    if (newLevel !== oldLevel) console.log(`[Reclassify] ${row.first_name} ${row.last_name}: ${oldLevel} ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ ${newLevel}`);
    updated++;
  }
  return { reclassified: updated };
}

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Helpers ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ

function classifyEngagement(nonEmployerPosts, nonEmployerComments) {
  if (nonEmployerPosts >= 2 || nonEmployerComments >= 2) return 'engaged';
  if (nonEmployerPosts >= 1 || nonEmployerComments >= 1) return 'average_engaged';
  return 'un_engaged';
}

function isWithin14Days(item, cutoff) {
  const ts = item.created_at || item.date || item.published_at || item.timestamp;
  if (!ts) return false;
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  return !isNaN(d.getTime()) && d >= cutoff;
}

function isEmployerRelated(item, company, type) {
  if (!company) return false;
  if (type === 'post') {
    if (item.as_organization) return true;
    const headline = (item.author?.headline || item.author_headline || '').toLowerCase();
    const co       = (item.author?.company  || item.author_company  || '').toLowerCase();
    if (co && co.includes(company))             return true;
    if (headline && headline.includes(company)) return true;
    const reshared = (item.reshared?.author?.name || item.reshared_from || '').toLowerCase();
    if (reshared && reshared.includes(company)) return true;
  }
  if (type === 'comment') {
    if (item.post?.as_organization || item.parent_post?.as_organization) return true;
    const ph = (item.post?.author?.headline || item.parent_post?.author?.headline || '').toLowerCase();
    const pc = (item.post?.author?.company  || item.parent_post?.author?.company  || '').toLowerCase();
    if (pc && pc.includes(company)) return true;
    if (ph && ph.includes(company)) return true;
  }
  return false;
}

module.exports = { start, run, scrapeContact, reclassifyFromExistingData };
