/**
 * src/jobs/syncTargetAccounts.js
 *
 * Runs every 6 hours via pg-boss.
 * Automatically creates/updates target_accounts from enriched contacts:
 *   1. Groups contacts by (workspace_id, company_linkedin_id or company_name)
 *   2. Upserts a target_account row for each unique company
 *   3. Links contacts.target_account_id to their company's target_account
 *
 * Only processes contacts with real ACoXXX provider_id (confirmed enriched).
 */

const db = require('../db');

async function handler() {
  // Get all workspaces
  const { rows: workspaces } = await db.query('SELECT id FROM workspaces');

  for (const ws of workspaces) {
    await syncWorkspace(ws.id);
  }
}

async function syncWorkspace(workspaceId) {
  // Find distinct companies from enriched contacts in this workspace
  // Use company_linkedin_id when available; fall back to company name
  const { rows: companies } = await db.query(`
    SELECT
      COALESCE(
        (profile_data->'work_experience'->0->>'company_id'),
        LOWER(TRIM(company))
      ) AS company_key,
      -- Prefer LinkedIn company URL from profile_data
      COALESCE(
        CASE WHEN (profile_data->'work_experience'->0->>'company_id') IS NOT NULL
          THEN 'https://www.linkedin.com/company/' || (profile_data->'work_experience'->0->>'company_id')
          ELSE NULL END,
        li_company_url
      ) AS li_company_url,
      (profile_data->'work_experience'->0->>'company_id') AS li_company_id,
      -- Best company name: from profile_data first, then contacts.company
      COALESCE(
        (profile_data->'work_experience'->0->>'company'),
        (profile_data->'work_experience'->0->>'company_name'),
        company
      ) AS company_name,
      COUNT(*) AS contact_count,
      $1 AS workspace_id
    FROM contacts
    WHERE workspace_id = $1
      AND (company IS NOT NULL AND TRIM(company) != '')
      AND provider_id LIKE 'ACo%'
    GROUP BY company_key, li_company_url, li_company_id, company_name
    HAVING COUNT(*) >= 1
    ORDER BY COUNT(*) DESC
    LIMIT 500
  `, [workspaceId]);

  let created = 0, updated = 0, linked = 0;

  for (const co of companies) {
    if (!co.company_key || !co.company_name) continue;

    // Upsert target_account
    const { rows: upserted } = await db.query(`
      INSERT INTO target_accounts (workspace_id, name, li_company_url, li_company_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (workspace_id, li_company_id) WHERE li_company_id IS NOT NULL
      DO UPDATE SET
        name           = EXCLUDED.name,
        li_company_url = COALESCE(EXCLUDED.li_company_url, target_accounts.li_company_url)
      RETURNING id, (xmax = 0) AS is_new
    `, [workspaceId, co.company_name, co.li_company_url || null, co.li_company_id || null])
    .catch(() => null);

    if (!upserted?.length) {
      // Fallback: upsert by name when no li_company_id
      const { rows: byName } = await db.query(`
        INSERT INTO target_accounts (workspace_id, name, li_company_url)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [workspaceId, co.company_name, co.li_company_url || null]).catch(() => ({ rows: [] }));

      if (!byName.length) continue; // Already exists by name, find it
    }

    // Find the target_account id (whether just created or existing)
    const { rows: taRows } = await db.query(`
      SELECT id FROM target_accounts
      WHERE workspace_id = $1
        AND (
          ($2::text IS NOT NULL AND li_company_id = $2)
          OR LOWER(name) = LOWER($3)
        )
      LIMIT 1
    `, [workspaceId, co.li_company_id || null, co.company_name]);

    if (!taRows.length) continue;
    const taId = taRows[0].id;

    if (upserted?.[0]?.is_new) created++;
    else updated++;

    // Link contacts that belong to this company and don't have target_account_id yet
    let linkQuery;
    if (co.li_company_id) {
      const { rowCount } = await db.query(`
        UPDATE contacts SET target_account_id = $1
        WHERE workspace_id = $2
          AND target_account_id IS DISTINCT FROM $1
          AND (
            profile_data->'work_experience'->0->>'company_id' = $3
            OR (li_company_url IS NOT NULL AND li_company_url LIKE '%/company/' || $3 || '%')
          )
      `, [taId, workspaceId, co.li_company_id]);
      linked += linkQuery?.rowCount || rowCount || 0;
    } else {
      const { rowCount } = await db.query(`
        UPDATE contacts SET target_account_id = $1
        WHERE workspace_id = $2
          AND target_account_id IS DISTINCT FROM $1
          AND LOWER(TRIM(company)) = LOWER($3)
      `, [taId, workspaceId, co.company_name]);
      linked += rowCount || 0;
    }
  }

  if (created + updated + linked > 0) {
    console.log(`[SyncTargetAccounts] WS${workspaceId}: ${created} created, ${updated} updated, ${linked} contacts linked`);
  }
}

module.exports = { handler };
