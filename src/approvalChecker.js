/**
 * Approval Checker
 *
 * Every 30 minutes, fetches the full relations list from Unipile for each
 * active account, then marks invite_approved=true for any contact whose
 * provider_id appears in that list (and who had invite_sent=true but
 * invite_approved=false).
 *
 * Also marks already_connected=true for contacts found in relations who
 * never had an invite sent (pre-existing connections).
 *
 * Scheduled: every 30 minutes.
 */

const db      = require('./db');

const UNIPILE_DSN     = process.env.UNIPILE_DSN;
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;
const INTERVAL_MS     = 30 * 60 * 1000;

let isRunning = false;
let lastResult = null;

function start() {
  console.log('[ApprovalChecker] Started — checking every 30 min');
  run();
  setInterval(run, INTERVAL_MS);
}

async function run() {
  const watchdog = require('./watchdog');
  watchdog.tick('approvalChecker');
  if (isRunning) return;
  isRunning = true;
  console.log('[ApprovalChecker] Running...');
  try {
    const { rows: accounts } = await db.query(
      `SELECT ua.account_id, ua.workspace_id
       FROM unipile_accounts ua
       WHERE ua.account_id IS NOT NULL`
    );

    let totalApproved = 0;
    let totalChecked  = 0;

    for (const acc of accounts) {
      try {
        // Fetch all relations (connections) for this account
        const providerIds = await fetchAllRelations(acc.account_id);
        totalChecked += providerIds.size;

        if (!providerIds.size) continue;

        // Find contacts with invite_sent=true, invite_approved=false
        // whose provider_id is now in the relations list
        const { rows: contacts } = await db.query(
          `SELECT c.id, c.provider_id
           FROM contacts c
           JOIN campaigns camp ON camp.id = c.campaign_id
           WHERE camp.account_id = $1
             AND c.invite_sent = true
             AND c.invite_approved = false
             AND c.provider_id IS NOT NULL`,
          [acc.account_id]
        );

        const toApprove = contacts.filter(c => providerIds.has(c.provider_id));
        if (toApprove.length) {
          await db.query(
            `UPDATE contacts
               SET invite_approved = true, invite_approved_at = NOW()
             WHERE id = ANY($1::int[])`,
            [toApprove.map(c => c.id)]
          );
          // Sync enrollments: move invite_sent → approved so processEnrollments sends messages
          await db.query(`
            UPDATE enrollments SET
              status='approved', invite_approved_at=NOW(),
              next_action_at=NOW(), updated_at=NOW()
            WHERE contact_id = ANY($1::int[]) AND status='invite_sent'
          `, [toApprove.map(c => c.id)]).catch(() => {});
          totalApproved += toApprove.length;
          console.log(`[ApprovalChecker] Account ${acc.account_id.substring(0,8)}: ${toApprove.length} newly approved`);
        }
      } catch (e) {
        console.error(`[ApprovalChecker] Account error (${acc.account_id.substring(0,8)}): ${e.message}`);
      }
    }

    lastResult = { ran_at: new Date().toISOString(), total_checked: totalChecked, total_approved: totalApproved };
    console.log(`[ApprovalChecker] Done — checked ${totalChecked} relations, ${totalApproved} newly approved`);
  } catch (e) {
    console.error('[ApprovalChecker] Run error:', e.message);
  } finally {
    isRunning = false;
  }
}

async function fetchAllRelations(accountId) {
  const ids  = new Set();
  let cursor = null;
  let page   = 0;
  const MAX_PAGES = 50;

  do {
    page++;
    const params = new URLSearchParams({ account_id: accountId, limit: 100 });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(
      `${UNIPILE_DSN}/api/v1/users/relations?${params}`,
      { headers: { 'X-API-KEY': UNIPILE_API_KEY, accept: 'application/json' } }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Unipile ${res.status}: ${txt.substring(0, 200)}`);
    }

    const data  = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    for (const r of items) {
      // provider_id is stored as ACoXXX — match against id or provider_id fields
      if (r.id)          ids.add(r.id);
      if (r.provider_id) ids.add(r.provider_id);
    }

    cursor = data.cursor
      ? (typeof data.cursor === 'object' ? data.cursor.value : data.cursor)
      : null;

    if (cursor && items.length > 0 && page < MAX_PAGES) {
      await new Promise(r => setTimeout(r, 500));
    }
  } while (cursor && page < MAX_PAGES);

  console.log(`[ApprovalChecker] Account ${accountId.substring(0,8)}: fetched ${ids.size} relations (${page} pages)`);
  return ids;
}

function getStatus() { return { is_running: isRunning, last_result: lastResult }; }

module.exports = { start, run, getStatus };
