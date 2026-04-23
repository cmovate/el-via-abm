/**
 * syncOpportunities.js — runs every 2 hours
 *
 * For each company: search PEOPLE with company + DISTANCE_1.
 * Alternates between accounts per company so no single account
 * gets rate-limited.
 */

const db      = require('../db');
const unipile = require('../unipile');

async function handler() {
  const { rows: workspaces } = await db.query(`
    SELECT DISTINCT lc.workspace_id
    FROM list_companies lc
    JOIN lists l ON l.id = lc.list_id AND l.workspace_id = lc.workspace_id
    WHERE l.type = 'companies'
      AND lc.company_linkedin_id IS NOT NULL
      AND lc.company_linkedin_id != ''
  `);

  for (const { workspace_id } of workspaces) {
    const { rows: accounts } = await db.query(
      `SELECT account_id, display_name FROM unipile_accounts WHERE workspace_id=$1 ORDER BY id`,
      [workspace_id]
    );
    if (!accounts.length) continue;

    // Rotation: 10 companies per run, oldest opp_last_synced_at first (NULL = never synced)
    const { rows: companies } = await db.query(`
      SELECT company_linkedin_id, company_name, opp_last_synced_at
      FROM (
        SELECT DISTINCT ON (lc.company_linkedin_id)
          lc.company_linkedin_id, lc.company_name, lc.opp_last_synced_at
        FROM list_companies lc
        JOIN lists l ON l.id = lc.list_id AND l.workspace_id = lc.workspace_id
        WHERE lc.workspace_id = $1
          AND l.type = 'companies'
          AND lc.company_linkedin_id IS NOT NULL
          AND lc.company_linkedin_id != ''
        ORDER BY lc.company_linkedin_id
      ) sub
      ORDER BY opp_last_synced_at ASC NULLS FIRST
      LIMIT 10
    `, [workspace_id]);

    console.log(`[Opportunities] WS${workspace_id}: ${companies.length} companies, ${accounts.length} accounts — alternating`);

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      // Alternate account per company
      const account = accounts[i % accounts.length];

      try {
        const data = await unipile._request(
          '/api/v1/linkedin/search?account_id=' + encodeURIComponent(account.account_id),
          {
            method: 'POST',
            body: JSON.stringify({
              api: 'classic',
              category: 'people',
              filters: {
                currentCompany: [(() => {
                  const raw = company.company_linkedin_id;
                  try { const p = JSON.parse(raw); return String(p.id || p); } catch(e) { return String(raw); }
                })()],
                network_distance: ['DISTANCE_1']
              },
              limit: 50
            })
          }
        );

        const people = Array.isArray(data?.items) ? data.items : [];

        if (people.length > 0) {
          console.log(`[Opportunities] ${account.display_name} @ ${company.company_name}: ${people.length} connections`);
        }

        for (const p of people) {
          // p.id = ACoXXX (needed for messaging)
          // p.public_identifier = slug (needed for LinkedIn URL)
          const acoId = p.id?.startsWith('ACo') ? p.id : null;
          const slug  = p.public_identifier || p.identifier;
          if (!slug && !acoId) continue;
          const liUrl = `https://www.linkedin.com/in/${slug || acoId}`;

          const firstName = p.first_name || p.firstName || '';
          const lastName  = p.last_name  || p.lastName  || '';
          const title     = p.headline   || p.title     || '';

          await db.query(`
            INSERT INTO opportunity_contacts (
              workspace_id, company_linkedin_id, company_name,
              li_profile_url, provider_id, aco_id,
              first_name, last_name, title,
              connected_via_account_id, connected_via_name,
              last_seen_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
            ON CONFLICT (workspace_id, li_profile_url, connected_via_account_id)
            DO UPDATE SET
              last_seen_at = NOW(),
              aco_id     = COALESCE(NULLIF(EXCLUDED.aco_id,''),     opportunity_contacts.aco_id),
              title      = COALESCE(NULLIF(EXCLUDED.title,''),      opportunity_contacts.title),
              first_name = COALESCE(NULLIF(EXCLUDED.first_name,''), opportunity_contacts.first_name),
              last_name  = COALESCE(NULLIF(EXCLUDED.last_name,''),  opportunity_contacts.last_name)
          `, [
            workspace_id,
            (() => { try { const p = JSON.parse(company.company_linkedin_id); return String(p.id||p); } catch(e) { return String(company.company_linkedin_id); } })(),
            company.company_name,
            liUrl, slug, acoId,
            firstName, lastName, title,
            account.account_id,
            account.display_name,
          ]);

          // Also upsert into main contacts table (campaign_id=NULL = workspace pool)
          // These contacts will NEVER be enrolled in campaigns automatically
          await db.query(`
            INSERT INTO contacts
              (workspace_id, campaign_id, first_name, last_name, title,
               company, li_profile_url, provider_id, already_connected)
            VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, true)
            ON CONFLICT (workspace_id, li_profile_url) DO UPDATE SET
              first_name       = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
              last_name        = COALESCE(NULLIF(EXCLUDED.last_name,''),  contacts.last_name),
              title            = COALESCE(NULLIF(EXCLUDED.title,''),      contacts.title),
              company          = COALESCE(NULLIF(EXCLUDED.company,''),    contacts.company),
              already_connected = true
          `, [
            workspace_id,
            firstName, lastName, title,
            company.company_name,
            liUrl, slug || acoId,
          ]);
        }

        await new Promise(r => setTimeout(r, 1500));

      } catch(e) {
        console.warn(`[Opportunities] ${account.display_name} @ ${company.company_name}: ${e.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }

      // Mark company as synced for rotation — always, regardless of success/failure
      await db.query(
        `UPDATE list_companies SET opp_last_synced_at = NOW()
         WHERE workspace_id = $1 AND company_linkedin_id = $2`,
        [workspace_id, company.company_linkedin_id]
      ).catch(() => {});
    }
  }

  console.log('[Opportunities] Sync complete');
}

module.exports = { handler };

// After sync: enrich aco_id for contacts missing it
async function enrichAcoIds(workspace_id) {
  const { rows: contacts } = await db.query(`
    SELECT oc.id, oc.li_profile_url, oc.connected_via_account_id
    FROM opportunity_contacts oc
    WHERE oc.workspace_id=$1 AND (oc.aco_id IS NULL OR oc.aco_id='')
    LIMIT 20
  `, [workspace_id]);
  for (const c of contacts) {
    try {
      const enriched = await unipile.enrichProfile(c.connected_via_account_id, c.li_profile_url);
      const acoId = enriched?.provider_id?.startsWith('ACo') ? enriched.provider_id : null;
      if (acoId) {
        await db.query(`UPDATE opportunity_contacts SET aco_id=$1 WHERE id=$2`, [acoId, c.id]);
        console.log(`[Opportunities] aco_id resolved: ${c.li_profile_url} → ${acoId}`);
      }
      await new Promise(r => setTimeout(r, 800));
    } catch(e) { /* silent */ }
  }
}

// After all contacts are upserted, look up existing chats for those without one
async function lookupChats(workspace_id) {
  // Get all opportunity contacts that have no chat_id yet
  const { rows: contacts } = await db.query(`
    SELECT oc.id, oc.provider_id, oc.li_profile_url,
           oc.connected_via_account_id
    FROM opportunity_contacts oc
    WHERE oc.workspace_id = $1
      AND oc.provider_id IS NOT NULL
      AND oc.provider_id != ''
      AND (oc.chat_id IS NULL OR oc.chat_id = '')
    LIMIT 100
  `, [workspace_id]);

  if (!contacts.length) return;
  console.log(`[Opportunities] Looking up chats for ${contacts.length} contacts in WS${workspace_id}`);

  for (const c of contacts) {
    try {
      const chats = await unipile.getChatsByAttendee(c.connected_via_account_id, c.provider_id);
      const chatId = chats?.[0]?.id || null;
      if (chatId) {
        await db.query(
          `UPDATE opportunity_contacts SET chat_id=$1 WHERE id=$2`,
          [chatId, c.id]
        );
      }
      await new Promise(r => setTimeout(r, 500));
    } catch(e) {
      // silent — chat lookup is best-effort
    }
  }
}

const _origHandler = module.exports.handler;
module.exports.handler = async function() {
  await _origHandler();
  // After sync, lookup chats for all workspaces
  const { rows: wsList } = await db.query(
    `SELECT DISTINCT workspace_id FROM opportunity_contacts WHERE (chat_id IS NULL OR chat_id='') AND provider_id IS NOT NULL`
  );
  for (const { workspace_id } of wsList) {
    await lookupChats(workspace_id);
    await enrichAcoIds(workspace_id);
  }
};
