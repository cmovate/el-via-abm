/**
 * Background enrichment queue.
 * Processes ONE contact at a time with 5-10s random delay.
 *
 * After enrichment:
 *   1. Extracts fields + detects already_connected (1st-degree LinkedIn connection)
 *   2. Saves to DB (including already_connected)
 *   3. If already_connected=true: checks chat history → saves has_chat_history + chat_id
 *   4. Classifies contact into a message sequence:
 *        already_connected=false           → msg_sequence='new'
 *        already_connected=true, no chat   → msg_sequence='existing_no_history'
 *        already_connected=true, has chat  → msg_sequence='existing_with_history'
 *
 * network_distance values confirmed from live API:
 *   'FIRST_DEGREE'  → 1st degree (already connected)
 *   'SECOND_DEGREE' → 2nd degree
 *   'THIRD_DEGREE'  → 3rd degree
 */

const db = require('./db');
const { enrichProfile, getChatsByAttendee } = require('./unipile');

const queue = [];
let isRunning = false;
let processed = 0;
let errors    = 0;

function enqueue(contactId, accountId, li_profile_url) {
  if (!li_profile_url || !li_profile_url.includes('linkedin.com/in/')) {
    console.log(`[Enrichment] Skip contact ${contactId} - no valid LinkedIn URL`);
    return;
  }
  queue.push({ contactId, accountId, li_profile_url });
  console.log(`[Enrichment] Queued contact ${contactId}. Queue: ${queue.length}`);
  if (!isRunning) processNext();
}

function getStatus() {
  return { queued: queue.length, running: isRunning, processed, errors };
}

/**
 * Detect if a contact is a 1st-degree LinkedIn connection.
 */
function detectAlreadyConnected(profile) {
  const dist = String(profile.network_distance || '').toUpperCase();
  if (dist === 'FIRST_DEGREE') return true;
  if (dist === 'DISTANCE_1' || dist === '1') return true;
  if (profile.relation_type === 1 || profile.relation_type === '1') return true;
  if (profile.degree === 1 || profile.degree === '1') return true;
  if (profile.connection_degree === 1 || profile.connection_degree === '1') return true;
  return false;
}

function extractFields(profile, contactId) {
  const providerId = profile.provider_id || '';
  const memberUrn  = profile.member_urn  || '';

  const expArray = profile.work_experience || [];
  const exp = Array.isArray(expArray) && expArray.length > 0 ? expArray[0] : null;

  const title =
    exp?.position || exp?.title || profile.headline || '';

  const company =
    (typeof exp?.company === 'string' ? exp.company : '') ||
    (typeof exp?.company === 'object' ? (exp?.company?.name || '') : '') ||
    exp?.company_name || '';

  const companyLinkedInId = exp?.company_id ? String(exp.company_id) : '';

  const liCompanyUrl = companyLinkedInId
    ? 'https://www.linkedin.com/company/' + companyLinkedInId
    : (exp?.company_url || exp?.company_linkedin_url || '');

  const website =
    (Array.isArray(profile.websites) && profile.websites.length > 0 ? profile.websites[0] : '') ||
    (profile.contact_info?.websites?.[0]) || '';

  const email =
    profile.contact_info?.emails?.[0] || profile.emails?.[0] || profile.email || '';

  const firstName        = profile.first_name || '';
  const lastName         = profile.last_name  || '';
  const location         = profile.location   || '';
  const alreadyConnected = detectAlreadyConnected(profile);

  console.log(
    `[Enrichment] contact=${contactId}` +
    ` provider_id="${providerId}"` +
    ` network_distance="${profile.network_distance}"` +
    ` connected=${alreadyConnected}` +
    ` company="${company}"`
  );

  return { firstName, lastName, title, company, location, email, website,
           liCompanyUrl, companyLinkedInId, providerId, memberUrn, alreadyConnected };
}

function randomDelay() {
  return 5000 + Math.random() * 5000;
}

async function processNext() {
  if (queue.length === 0) { isRunning = false; console.log('[Enrichment] Queue empty - idle.'); return; }

  isRunning = true;
  const item = queue.shift();
  console.log('[Enrichment] Processing contact ' + item.contactId);

  try {
    const profile = await enrichProfile(item.accountId, item.li_profile_url);
    if (!profile || typeof profile !== 'object' || !Object.keys(profile).length) {
      console.log('[Enrichment] Empty/null profile for contact ' + item.contactId + ' — skipped');
      // Don't increment errors, don't increment processed — just skip
    } else {
      const fields  = extractFields(profile, item.contactId);
      await applyToDb(item.contactId, fields, profile);
      await upsertCampaignCompany(item.contactId, fields);
      // Cross-campaign sync: copy provider_id to other contacts with same URL in same workspace
      if (fields.providerId) {
        try {
          await db.query(`
            UPDATE contacts AS t
            SET    provider_id  = src.provider_id,
                   member_urn   = COALESCE(t.member_urn,   src.member_urn),
                   profile_data = COALESCE(t.profile_data, src.profile_data)
            FROM   contacts AS src
            WHERE  src.id          = $1
              AND  t.id           != src.id
              AND  t.workspace_id  = src.workspace_id
              AND  (t.provider_id IS NULL OR t.provider_id = '')
              AND  LOWER(REGEXP_REPLACE(t.li_profile_url,   '^https?://', '')) =
                   LOWER(REGEXP_REPLACE(src.li_profile_url, '^https?://', ''))
          `, [item.contactId]);
        } catch(e) { /* non-critical — log but continue */ console.warn('[Enrichment] cross-sync failed:', e.message); }
      }

      let hasChatHistory = false;
      if (fields.alreadyConnected && fields.providerId) {
        hasChatHistory = await checkChatHistory(item.contactId, item.accountId, fields.providerId);
      }

      await classifySequence(item.contactId, fields.alreadyConnected, hasChatHistory);

      processed++;
      console.log('[Enrichment] OK ' + fields.firstName + ' ' + fields.lastName + ' @ ' + fields.company);
    }
  } catch (err) {
    errors++;
    console.error('[Enrichment] FAIL contact ' + item.contactId + ': ' + err.message);
  }

  setTimeout(processNext, randomDelay());
}

async function applyToDb(contactId, fields, profile) {
  const { firstName, lastName, title, company, location, email, website,
          liCompanyUrl, providerId, memberUrn, alreadyConnected } = fields;
  await db.query(
    `UPDATE contacts SET
       first_name        = COALESCE(NULLIF($1,''),  first_name),
       last_name         = COALESCE(NULLIF($2,''),  last_name),
       title             = COALESCE(NULLIF($3,''),  title),
       company           = COALESCE(NULLIF($4,''),  company),
       location          = COALESCE(NULLIF($5,''),  location),
       email             = COALESCE(NULLIF($6,''),  email),
       website           = COALESCE(NULLIF($7,''),  website),
       li_company_url    = COALESCE(NULLIF($8,''),  li_company_url),
       provider_id       = COALESCE(NULLIF($9,''),  provider_id),
       member_urn        = COALESCE(NULLIF($10,''), member_urn),
       profile_data      = $11,
       already_connected = $12
     WHERE id = $13`,
    [firstName, lastName, title, company, location, email, website, liCompanyUrl,
     providerId, memberUrn, JSON.stringify(profile), alreadyConnected, contactId]
  );
}

async function checkChatHistory(contactId, accountId, providerId) {
  try {
    const chats = await getChatsByAttendee(accountId, providerId);
    const hasChatHistory = chats.length > 0;
    const chatId = hasChatHistory ? (chats[0].id || null) : null;

    await db.query(
      `UPDATE contacts SET has_chat_history = $1, chat_id = $2 WHERE id = $3`,
      [hasChatHistory, chatId, contactId]
    );

    console.log(
      `[Enrichment] Chat check contact=${contactId}: ` +
      `has_chat_history=${hasChatHistory}` +
      (chatId ? ` chat_id=${chatId}` : '')
    );
    return hasChatHistory;
  } catch (err) {
    console.warn(`[Enrichment] checkChatHistory failed for contact ${contactId}: ${err.message}`);
    return false;
  }
}

async function classifySequence(contactId, alreadyConnected, hasChatHistory) {
  let seq;
  if (!alreadyConnected) {
    seq = 'new';
  } else if (hasChatHistory) {
    seq = 'existing_with_history';
  } else {
    seq = 'existing_no_history';
  }

  if (alreadyConnected) {
    await db.query(
      `UPDATE contacts
         SET msg_sequence = $1, msg_sequence_started_at = NOW()
       WHERE id = $2 AND msg_sequence IS NULL`,
      [seq, contactId]
    );
  } else {
    await db.query(
      `UPDATE contacts SET msg_sequence = $1 WHERE id = $2 AND msg_sequence IS NULL`,
      [seq, contactId]
    );
  }

  console.log(`[Enrichment] Classified contact ${contactId} → ${seq}`);
}

/**
 * Upsert this contact's employer into campaign_companies.
 * Uses SET (not +1) to avoid double-counting on re-enrichment:
 * count is derived by counting the actual contacts for this company in this campaign.
 */
async function upsertCampaignCompany(contactId, fields) {
  if (!fields.companyLinkedInId || !fields.company) return;

  try {
    const { rows } = await db.query(
      'SELECT campaign_id, workspace_id FROM contacts WHERE id = $1',
      [contactId]
    );
    if (!rows.length || !rows[0].campaign_id) return;

    const { campaign_id, workspace_id } = rows[0];

    // Count how many contacts in this campaign share this company LinkedIn ID
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS cnt FROM contacts
       WHERE campaign_id = $1
         AND profile_data->'work_experience'->0->>'company_id' = $2`,
      [campaign_id, fields.companyLinkedInId]
    );
    const contactCount = parseInt(countRows[0]?.cnt || 1, 10);

    await db.query(
      `INSERT INTO campaign_companies
         (campaign_id, workspace_id, company_name, li_company_url, company_linkedin_id, contact_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (campaign_id, company_linkedin_id)
       DO UPDATE SET
         company_name   = EXCLUDED.company_name,
         li_company_url = EXCLUDED.li_company_url,
         contact_count  = EXCLUDED.contact_count`,
      [campaign_id, workspace_id, fields.company, fields.liCompanyUrl, fields.companyLinkedInId, contactCount]
    );
    console.log(`[Enrichment] Upserted company "${fields.company}" (id=${fields.companyLinkedInId}) count=${contactCount} for campaign ${campaign_id}`);
  } catch (err) {
    console.warn(`[Enrichment] upsertCampaignCompany failed for contact ${contactId}: ${err.message}`);
  }
}

async function reExtractAll(workspaceId) {
  const { rows } = await db.query(
    `SELECT id, profile_data FROM contacts
     WHERE workspace_id = $1
       AND profile_data IS NOT NULL
       AND profile_data::text != 'null'`,
    [workspaceId]
  );

  console.log('[Re-extract] ' + rows.length + ' contacts with stored profile_data');
  let ok = 0, fail = 0;

  for (const row of rows) {
    try {
      const profile = typeof row.profile_data === 'string'
        ? JSON.parse(row.profile_data) : row.profile_data;

      const fields = extractFields(profile, row.id);

      await db.query(
        `UPDATE contacts SET
           first_name        = COALESCE(NULLIF($1,''),  first_name),
           last_name         = COALESCE(NULLIF($2,''),  last_name),
           title             = COALESCE(NULLIF($3,''),  title),
           company           = COALESCE(NULLIF($4,''),  company),
           location          = COALESCE(NULLIF($5,''),  location),
           email             = COALESCE(NULLIF($6,''),  email),
           website           = COALESCE(NULLIF($7,''),  website),
           li_company_url    = COALESCE(NULLIF($8,''),  li_company_url),
           provider_id       = COALESCE(NULLIF($9,''),  provider_id),
           member_urn        = COALESCE(NULLIF($10,''), member_urn),
           already_connected = $11
         WHERE id = $12`,
        [fields.firstName, fields.lastName, fields.title, fields.company,
         fields.location, fields.email, fields.website, fields.liCompanyUrl,
         fields.providerId, fields.memberUrn, fields.alreadyConnected, row.id]
      );

      await upsertCampaignCompany(row.id, fields);
      ok++;
    } catch (err) {
      fail++;
      console.error('[Re-extract] Failed contact ' + row.id + ': ' + err.message);
    }
  }

  console.log('[Re-extract] Done - ' + ok + ' updated, ' + fail + ' failed');
  return { total: rows.length, updated: ok, failed: fail };
}

module.exports = { enqueue, getStatus, reExtractAll };
