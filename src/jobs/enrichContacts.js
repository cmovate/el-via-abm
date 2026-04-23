/**
 * src/jobs/enrichContacts.js
 *
 * Runs every 2 hours via pg-boss.
 * Enriches contacts missing real provider_id (ACoXXX).
 * Replaces: enrichment.js in-memory queue (which dies on server restart).
 *
 * Priority order: contacts with campaign_id first (active campaigns),
 * then list contacts (campaign_id=NULL).
 * Skips contacts whose provider_id already starts with 'ACo' (already enriched).
 */
const db = require('../db');
const unipile = require('../unipile');

const BATCH = 400; // per run

async function handler() {
  // Get contacts that need REAL enrichment (missing ACoXXX)
  // Slug provider_ids (not starting with ACo) need replacement
  const { rows: contacts } = await db.query(`
    SELECT c.id, c.li_profile_url, c.workspace_id,
           COALESCE(camp.account_id, ua.account_id) AS account_id
    FROM contacts c
    LEFT JOIN campaigns camp ON camp.id = c.campaign_id
    LEFT JOIN LATERAL (
      SELECT account_id FROM unipile_accounts
      WHERE workspace_id = c.workspace_id
      ORDER BY id LIMIT 1
    ) ua ON true
    WHERE c.li_profile_url LIKE '%linkedin.com/in/%'
      AND (
        c.provider_id IS NULL
        OR c.provider_id = ''
        OR c.provider_id NOT LIKE 'ACo%'
      )
    ORDER BY
      CASE WHEN c.campaign_id IS NOT NULL THEN 0 ELSE 1 END,
      c.id ASC
    LIMIT $1
  `, [BATCH]);

  if (!contacts.length) {
    console.log('[EnrichContacts] Nothing to enrich');
    return;
  }

  console.log(`[EnrichContacts] Enriching ${contacts.length} contacts`);
  let enriched = 0, failed = 0;

  for (const c of contacts) {
    if (!c.account_id) continue;
    try {
      const profile = await unipile.enrichProfile(c.account_id, c.li_profile_url);

      if (!profile || typeof profile !== 'object' || !Object.keys(profile).length) {
        failed++;
        continue;
      }

      const providerId = profile.provider_id || profile.id || '';
      if (!providerId) { failed++; continue; }

      const dist = String(profile.network_distance || '').toUpperCase();
      const alreadyConnected = ['FIRST_DEGREE', 'DISTANCE_1', '1'].includes(dist) ||
        profile.relation_type === 1 || profile.degree === 1;

      const expArray = profile.work_experience || [];
      const exp = Array.isArray(expArray) && expArray.length > 0 ? expArray[0] : null;

      const title   = exp?.position || exp?.title || profile.headline || '';
      const company = (typeof exp?.company === 'string' ? exp.company : '') ||
                      (exp?.company?.name || '') || exp?.company_name || '';
      const memberUrn = profile.member_urn || '';

      await db.query(`
        UPDATE contacts SET
          provider_id       = $2,
          member_urn        = COALESCE(NULLIF($3,''), member_urn),
          first_name        = COALESCE(NULLIF($4,''), first_name),
          last_name         = COALESCE(NULLIF($5,''), last_name),
          title             = COALESCE(NULLIF($6,''), title),
          company           = COALESCE(NULLIF($7,''), company),
          location          = COALESCE(NULLIF($8,''), location),
          already_connected = $9,
          enriched_at       = NOW()
        WHERE id = $1
      `, [
        c.id, providerId, memberUrn,
        profile.first_name || '', profile.last_name || '',
        title, company, profile.location || '',
        alreadyConnected,
      ]);

      // Cross-workspace sync: copy provider_id to same URL in other campaign rows
      if (providerId.startsWith('ACo')) {
        await db.query(`
          UPDATE contacts SET provider_id = $2, member_urn = COALESCE(NULLIF(member_urn,''), $3)
          WHERE workspace_id = (SELECT workspace_id FROM contacts WHERE id = $1)
            AND id != $1
            AND (provider_id IS NULL OR provider_id = '' OR provider_id NOT LIKE 'ACo%')
            AND LOWER(REGEXP_REPLACE(li_profile_url, '^https?://', '')) =
                LOWER(REGEXP_REPLACE(
                  (SELECT li_profile_url FROM contacts WHERE id = $1),
                  '^https?://', ''
                ))
        `, [c.id, providerId, memberUrn]).catch(() => {});
      }

      enriched++;
    } catch (err) {
      failed++;
      // Rate limit? Back off next run naturally
      if (err.message?.includes('429') || err.message?.includes('503')) break;
    }
    await new Promise(r => setTimeout(r, 6000 + Math.random() * 4000));
  }

  console.log(`[EnrichContacts] Done: enriched=${enriched} failed=${failed}/${contacts.length}`);
}

module.exports = { handler };

