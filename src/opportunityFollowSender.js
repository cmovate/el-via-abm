/**
 * opportunityFollowSender.js
 *
 * Daily automation that sends company-page follow invites to Opportunity contacts.
 *
 * Logic:
 *   1. Runs once daily at SEND_HOUR (default: 10:00).
 *   2. For each workspace that has accounts with company_page_urn set:
 *      a. Fetches opportunity contacts (already_connected=true, not yet follow-invited)
 *         sorted by: hot_opportunities first, then opportunity_companies, then others.
 *      b. For each contact — finds the account_id that is "connected" to them
 *         (stored on the contact or matched via the campaign/account).
 *      c. Sends follow invite one-by-one via Unipile.
 *      d. On quota error (429 / "invitation limit") → stops immediately for that account.
 *   3. At REPORT_HOUR (default: 19:00) sends a summary email:
 *      - Per workspace / per company page: N invites sent today, N accepted lifetime.
 *
 * Environment variables:
 *   OPPORTUNITY_FOLLOW_HOUR   send hour (default: 10)
 *   REPORT_HOUR               email report hour (default: 19)
 *   REPORT_EMAIL              recipient email address (required for reports)
 *   REPORT_FROM               sender address (default: noreply@elvia-abm.com)
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS   nodemailer transport
 *   SMTP_SECURE               'true' for TLS (default false for port 587)
 */

const db         = require('./db');
const nodemailer = require('nodemailer');
const { sendCompanyFollowInvites } = require('./unipile');

const SEND_HOUR   = parseInt(process.env.OPPORTUNITY_FOLLOW_HOUR || '10', 10);
const REPORT_HOUR = parseInt(process.env.REPORT_HOUR             || '19', 10);
const REPORT_TO   = process.env.REPORT_EMAIL  || '';
const REPORT_FROM = process.env.REPORT_FROM   || 'El-Via ABM <noreply@elvia-abm.com>';

// Daily counters — reset at midnight (or on server restart)
const todayCounts = {}; // { [workspace_id:account_id:companyId]: N }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function msUntil(hour) {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function todayKey(wsId, accountId, companyId) {
  return `${wsId}:${accountId}:${companyId}`;
}

function incCount(wsId, accountId, companyId, n = 1) {
  const k = todayKey(wsId, accountId, companyId);
  todayCounts[k] = (todayCounts[k] || 0) + n;
}

function getCount(wsId, accountId, companyId) {
  return todayCounts[todayKey(wsId, accountId, companyId)] || 0;
}

// Extract member URN from contact profile_data
function getMemberUrn(contact) {
  let pd = {};
  try {
    pd = typeof contact.profile_data === 'string'
      ? JSON.parse(contact.profile_data)
      : (contact.profile_data || {});
  } catch {}
  // member_urn is always valid (full URN format)
  if (pd.member_urn && pd.member_urn.startsWith('urn:li:')) return pd.member_urn;
  if (contact.member_urn && contact.member_urn.startsWith('urn:li:')) return contact.member_urn;
  // provider_id from profile_data — only use if real ACoXXX
  if (pd.provider_id && pd.provider_id.startsWith('ACo')) return `urn:li:fsd_profile:${pd.provider_id}`;
  // provider_id from contacts column — only use if real ACoXXX
  if (contact.provider_id && contact.provider_id.startsWith('ACo')) return `urn:li:fsd_profile:${contact.provider_id}`;
  return null;
}

function isQuotaError(err) {
  const msg = (err?.message || err?.body || '').toLowerCase();
  return msg.includes('limit') || msg.includes('quota') ||
         msg.includes('invitation') || msg.includes('too many') ||
         msg.includes('429') || (err?.status === 429);
}

// ─── Email ────────────────────────────────────────────────────────────────────

function makeTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });
}

async function sendReportEmail(report) {
  if (!REPORT_TO) {
    console.log('[OppFollow] No REPORT_EMAIL set — skipping email, printing report instead');
    console.log('[OppFollow] REPORT:\n' + JSON.stringify(report, null, 2));
    return;
  }

  const transport = makeTransport();
  if (!transport) {
    console.warn('[OppFollow] No SMTP config — cannot send email. Set SMTP_HOST, SMTP_USER, SMTP_PASS.');
    return;
  }

  const date = new Date().toLocaleDateString('en-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const totalSent = report.reduce((s, r) => s + r.sentToday, 0);

  // Build HTML table per workspace
  const rows = report.map(r => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #f3f4f6">${r.workspaceName}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f3f4f6">${r.accountName}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f3f4f6;font-family:monospace;font-size:12px">${r.companyName}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f3f4f6;text-align:center;font-weight:700;color:${r.sentToday > 0 ? '#16a34a' : '#9ca3af'}">${r.sentToday}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f3f4f6;text-align:center;color:#6b7280">${r.confirmedLifetime}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f3f4f6;color:${r.stoppedReason ? '#dc2626' : '#16a34a'};font-size:12px">${r.stoppedReason || '✓ OK'}</td>
    </tr>`).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:32px">
<div style="max-width:720px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
  <div style="background:linear-gradient(135deg,#0f172a,#064e3b);padding:28px 32px;color:white">
    <div style="font-size:13px;opacity:.6;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">El-Via ABM · Daily Report</div>
    <div style="font-size:22px;font-weight:700">Company Follow Report</div>
    <div style="font-size:14px;opacity:.7;margin-top:4px">${date}</div>
  </div>
  <div style="padding:24px 32px">
    <div style="display:flex;gap:20px;margin-bottom:28px">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 22px;flex:1;text-align:center">
        <div style="font-size:32px;font-weight:800;color:#16a34a">${totalSent}</div>
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Invites Sent Today</div>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 22px;flex:1;text-align:center">
        <div style="font-size:32px;font-weight:800;color:#2563eb">${report.reduce((s,r)=>s+r.confirmedLifetime,0)}</div>
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Confirmed Followers (Lifetime)</div>
      </div>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:16px 22px;flex:1;text-align:center">
        <div style="font-size:32px;font-weight:800;color:#ea580c">${report.reduce((s,r)=>s+r.remaining,0)}</div>
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">Pending Opportunities</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f9fafb">
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Workspace</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Account</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Company Page</th>
          <th style="padding:10px 14px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Sent Today</th>
          <th style="padding:10px 14px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Confirmed</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${report.some(r=>r.stoppedReason) ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 18px;margin-top:20px;font-size:13px;color:#991b1b">
      ⚠️ <strong>Quota reached</strong> on some accounts. Sending will resume tomorrow.
    </div>` : ''}
  </div>
  <div style="background:#f9fafb;padding:16px 32px;font-size:12px;color:#9ca3af;text-align:center;border-top:1px solid #f3f4f6">
    El-Via ABM &middot; Automated by el-via-abm &middot; <a href="${process.env.SERVER_URL || ''}/health.html" style="color:#2563eb">Health Dashboard</a>
  </div>
</div>
</body>
</html>`;

  try {
    await transport.sendMail({
      from:    REPORT_FROM,
      to:      REPORT_TO,
      subject: `El-Via: ${totalSent} follow invites sent today — ${date}`,
      html,
    });
    console.log(`[OppFollow] 📧 Report email sent to ${REPORT_TO}`);
  } catch (e) {
    console.error('[OppFollow] Email send error:', e.message);
  }
}

// ─── Core send logic ──────────────────────────────────────────────────────────

async function runForWorkspace(wsId) {
  // Get all accounts with company_page_urn for this workspace
  const { rows: accounts } = await db.query(`
    SELECT ua.account_id, ua.display_name, ua.settings,
      COALESCE(
        (SELECT company_page_urn FROM workspace_company_pages
         WHERE workspace_id = ua.workspace_id
         ORDER BY is_default DESC, created_at ASC LIMIT 1),
        ua.settings->>'company_page_urn'
      ) AS resolved_urn
    FROM unipile_accounts ua
    WHERE ua.workspace_id = $1
      AND (
        EXISTS(SELECT 1 FROM workspace_company_pages WHERE workspace_id = $1)
        OR (ua.settings->>'company_page_urn' IS NOT NULL AND ua.settings->>'company_page_urn' != '')
      )
    LIMIT 1
  `, [wsId]);

  if (!accounts.length) return [];

  const report = [];

  for (const acc of accounts) {
    const companyPageUrn = acc.resolved_urn || acc.settings?.company_page_urn;
    const companyIdMatch = companyPageUrn.match(/(\d+)$/);
    const companyId      = companyIdMatch?.[1] || 'unknown';

    // Get company name from company_followers or unipile_accounts
    const { rows: cfRows } = await db.query(`
      SELECT name FROM company_followers WHERE account_id=$1 LIMIT 1
    `, [acc.account_id]).catch(() => ({ rows: [] }));
    const companyName = acc.settings.company_page_name || `Company ${companyId}`;

    // Count lifetime confirmed
    const { rows: confirmedRows } = await db.query(`
      SELECT COUNT(*) AS n FROM company_followers WHERE account_id=$1
    `, [acc.account_id]).catch(() => ({ rows: [{ n: 0 }] }));
    const confirmedLifetime = parseInt(confirmedRows[0]?.n || 0);

    // Fetch opportunity contacts for this account — already_connected + not yet follow-invited
    // Priority order:
    //   1. contacts in hot_opportunities table (most qualified)
    //   2. contacts linked to opportunity_companies
    //   3. all other opportunity contacts (campaign_id IS NULL)
    const { rows: contacts } = await db.query(`
      SELECT DISTINCT
        c.id,
        c.first_name,
        c.last_name,
        c.provider_id,
        c.member_urn,
        c.profile_data,
        c.workspace_id,
        -- priority: 1=hot, 2=opp_company, 3=other
        CASE
          WHEN ho.contact_id IS NOT NULL THEN 1
          WHEN oc.workspace_id IS NOT NULL THEN 2
          ELSE 3
        END AS priority
      FROM contacts c
      -- match to this account: contact was found by this account's opportunity scraper
      -- account_id is stored on contacts only when from a campaign; for opportunities
      -- we match by workspace and already_connected
      LEFT JOIN hot_opportunities ho ON ho.contact_id = c.id
      LEFT JOIN opportunity_companies oc
             ON oc.workspace_id = c.workspace_id
            AND oc.company_linkedin_id IS NOT NULL
            AND (c.profile_data::text ILIKE '%' || oc.company_linkedin_id || '%'
                 OR c.li_company_url ILIKE '%' || oc.company_linkedin_id || '%')
      WHERE c.workspace_id = $1
        AND c.already_connected = true
        AND (c.campaign_id IS NULL OR c.campaign_id IN (
              SELECT id FROM campaigns WHERE account_id = $2
            ))
        AND (c.company_follow_invited = false OR c.company_follow_invited IS NULL)
        AND (c.member_urn IS NOT NULL OR c.provider_id LIKE 'ACo%')
      ORDER BY priority ASC, c.created_at ASC
      LIMIT 200
    `, [wsId, acc.account_id]).catch(e => {
      console.error('[OppFollow] Query error:', e.message);
      return { rows: [] };
    });

    console.log(`[OppFollow] ws${wsId} / ${acc.display_name}: ${contacts.length} opportunity contacts to follow`);

    let sentToday   = 0;
    let stoppedReason = null;

    for (const contact of contacts) {
      const memberUrn = getMemberUrn(contact);
      if (!memberUrn) {
        console.warn(`[OppFollow] Contact ${contact.id} has no URN — skipping`);
        continue;
      }

      try {
        await sendCompanyFollowInvites(acc.account_id, companyPageUrn, [memberUrn]);

        // Mark as invited
        await db.query(
          `UPDATE contacts SET company_follow_invited = true, company_follow_invited_at = NOW() WHERE id = $1`,
          [contact.id]
        );
        sentToday++;
        incCount(wsId, acc.account_id, companyId);
        console.log(`[OppFollow] ✓ Sent follow invite to ${contact.first_name} ${contact.last_name} (${memberUrn})`);

        // 2–4 second human-like delay between sends
        await sleep(2000 + Math.random() * 2000);

      } catch (err) {
        if (isQuotaError(err)) {
          stoppedReason = `Quota reached after ${sentToday} invites`;
          console.warn(`[OppFollow] ⚠️ Quota error for ${acc.display_name} — stopping. Sent: ${sentToday}`);
          break;
        }
        // Other errors (rate limit, transient) — log and continue
        console.error(`[OppFollow] ✗ Error for contact ${contact.id}: ${err.message}`);
        await sleep(5000);
      }
    }

    report.push({
      workspaceName:      wsId.toString(), // filled in below
      accountName:        acc.display_name,
      accountId:          acc.account_id,
      companyName,
      companyPageUrn,
      sentToday,
      confirmedLifetime,
      remaining:          Math.max(0, contacts.length - sentToday),
      stoppedReason,
    });

    console.log(`[OppFollow] ${acc.display_name}: sent=${sentToday} confirmed=${confirmedLifetime} stopped=${stoppedReason || 'no'}`);
  }

  return report;
}

async function runAll() {
  const watchdog = require('./watchdog');
  watchdog.tick('opportunityFollowSender');
  console.log('[OppFollow] Starting daily opportunity follow run...');

  try {
    // Get all workspaces with accounts that have company_page_urn
    const { rows: workspaces } = await db.query(`
      SELECT DISTINCT w.id, w.name
      FROM workspaces w
      JOIN unipile_accounts ua ON ua.workspace_id = w.id
      WHERE (
        EXISTS(SELECT 1 FROM workspace_company_pages wcp WHERE wcp.workspace_id = w.id)
        OR (ua.settings->>'company_page_urn' IS NOT NULL AND ua.settings->>'company_page_urn' != '')
      )
    `);

    if (!workspaces.length) {
      console.log('[OppFollow] No workspaces with company pages — nothing to do');
      return [];
    }

    let allReports = [];

    for (const ws of workspaces) {
      const wsReports = await runForWorkspace(ws.id);
      wsReports.forEach(r => r.workspaceName = ws.name || `Workspace ${ws.id}`);
      allReports = allReports.concat(wsReports);
    }

    const total = allReports.reduce((s, r) => s + r.sentToday, 0);
    console.log(`[OppFollow] ✅ Done — total sent today: ${total} across ${allReports.length} accounts`);

    // Store last result for status endpoint
    lastRunResult = { runAt: new Date().toISOString(), total, accounts: allReports.length, report: allReports };

    return allReports;
  } catch (e) {
    console.error('[OppFollow] runAll error:', e.message);
    return [];
  }
}

async function sendDailyReport() {
  console.log('[OppFollow] Preparing daily email report...');
  try {
    // Use today's accumulated counts + DB confirmed counts
    const { rows: workspaces } = await db.query(`
      SELECT DISTINCT w.id, w.name, ua.account_id, ua.display_name, ua.settings
      FROM workspaces w
      JOIN unipile_accounts ua ON ua.workspace_id = w.id
      WHERE ua.settings->>'company_page_urn' IS NOT NULL
        AND ua.settings->>'company_page_urn' != ''
    `);

    const report = [];
    for (const ws of workspaces) {
      const companyPageUrn = ws.settings.company_page_urn;
      const companyIdMatch = companyPageUrn?.match(/(\d+)$/);
      const companyId      = companyIdMatch?.[1] || 'unknown';

      const { rows: cfRows } = await db.query(
        `SELECT COUNT(*) AS n FROM company_followers WHERE account_id=$1`,
        [ws.account_id]
      ).catch(() => ({ rows: [{ n: 0 }] }));

      const { rows: pendingRows } = await db.query(`
        SELECT COUNT(*) AS n FROM contacts
        WHERE workspace_id = $1
          AND already_connected = true
          AND campaign_id IS NULL
          AND (company_follow_invited = false OR company_follow_invited IS NULL)
          AND provider_id IS NOT NULL
      `, [ws.id]).catch(() => ({ rows: [{ n: 0 }] }));

      report.push({
        workspaceName:    ws.name || `ws${ws.id}`,
        accountName:      ws.display_name,
        accountId:        ws.account_id,
        companyName:      ws.settings.company_page_name || `Company ${companyId}`,
        companyPageUrn,
        sentToday:        getCount(ws.id, ws.account_id, companyId),
        confirmedLifetime: parseInt(cfRows[0]?.n || 0),
        remaining:        parseInt(pendingRows[0]?.n || 0),
        stoppedReason:    null,
      });
    }

    await sendReportEmail(report);
  } catch (e) {
    console.error('[OppFollow] Report error:', e.message);
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

let lastRunResult = null;
function getStatus() { return lastRunResult; }

// ─── Scheduler ───────────────────────────────────────────────────────────────

let sendTimer   = null;
let reportTimer = null;

function scheduleNext() {
  clearTimeout(sendTimer);
  clearTimeout(reportTimer);

  const msSend   = msUntil(SEND_HOUR);
  const msReport = msUntil(REPORT_HOUR);

  const nextSend   = new Date(Date.now() + msSend).toISOString();
  const nextReport = new Date(Date.now() + msReport).toISOString();

  console.log(`[OppFollow] Next send: ${nextSend} | Next report: ${nextReport}`);

  sendTimer = setTimeout(async () => {
    await runAll();
    scheduleNext();
  }, msSend);

  reportTimer = setTimeout(async () => {
    await sendDailyReport();
  }, msReport);
}

function start() {
  console.log(`[OppFollow] Started — sends at ${SEND_HOUR}:00, report at ${REPORT_HOUR}:00 server time`);
  scheduleNext();
}

module.exports = { start, runAll, sendDailyReport, getStatus };
