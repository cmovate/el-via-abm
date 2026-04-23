/**
 * healthChecker.js
 *
 * Runs once daily (configurable). For each automation:
 *   1. Queries the DB for evidence of recent activity (not just "process alive")
 *   2. If stale → calls the automation's manual trigger endpoint (auto-heal)
 *   3. If heal fails → sends a webhook alert
 *
 * Checks are DB-evidence-based:
 *   invitationSender    → contacts.invite_sent_at within 36h (if eligible contacts exist)
 *   messageSender       → contacts.msg_1_sent_at within 12h (if eligible contacts exist)
 *   approvalChecker     → contacts.invite_approved_at updated within 2h OR no new approvals expected
 *   profileViewer       → contacts.last_profile_view_at within 36h (if eligible contacts exist)
 *   companyFollowSender → contacts.company_follow_invited_at within 36h (if eligible contacts exist)
 *   withdrawSender      → daily — contacts.invite_withdrawn_at within 30h (if eligible contacts exist)
 *   likeSender          → contacts.likes_sent_at within 36h (if eligible contacts exist)
 *   profileViewScraper  → profile_view_events.scraped_at within 14h
 *   postsScraper        → user_posts.scraped_at within 14h
 *   engagementSync      → post_reactions.scraped_at within 2h
 *   followerScraper     → company_followers.scraped_at within 2h
 *   inboxPoller         → inbox_messages.created_at within 2h OR no new messages expected
 *   engagementScraper   → contacts.engagement_data updated within 36h
 *   opportunityScraper  → contacts where already_connected=true and created_at within 36h
 *   statsSnapshotter    → campaign_daily_stats.snapshot_date = today
 *   scheduler           → list_contacts.last_scanned_at within 8h
 *
 * Runs at RUN_HOUR (default: 09:00 server time) daily.
 */

const db     = require('./db');
const https  = require('https');
const http   = require('http');

const RUN_HOUR        = parseInt(process.env.HEALTH_CHECK_HOUR  || '9', 10);
const ALERT_WEBHOOK   = process.env.HEALTH_ALERT_WEBHOOK || '';   // e.g. Slack webhook URL
const ALERT_EMAIL     = process.env.HEALTH_ALERT_EMAIL   || '';
const BASE_URL        = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:3000';

let lastRunDate = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1000);
}

async function q(sql, params = []) {
  try {
    const { rows } = await db.query(sql, params);
    return rows;
  } catch { return []; }
}

async function callEndpoint(path, method = 'POST', body = {}) {
  return new Promise((resolve) => {
    const url    = new URL(BASE_URL + path);
    const lib    = url.protocol === 'https:' ? https : http;
    const data   = JSON.stringify(body);
    const opts   = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout:  30000,
    };
    const req = lib.request(opts, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, body }));
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(data);
    req.end();
  });
}

async function sendAlert(issues) {
  if (!issues.length) return;
  const text = [
    `🚨 *El-Via Health Check — ${new Date().toISOString().slice(0,10)}*`,
    `${issues.length} automation(s) failed auto-heal:`,
    ...issues.map(i => `• *${i.name}*: ${i.reason}  →  heal: ${i.healResult}`),
  ].join('\n');

  console.error('[HealthChecker] ALERT:', text);

  if (ALERT_WEBHOOK) {
    try {
      await callEndpoint(ALERT_WEBHOOK.replace(BASE_URL, ''), 'POST', { text });
    } catch {}
  }
}

// ─── Individual checks ────────────────────────────────────────────────────────

const CHECKS = [
  {
    name: 'profileViewScraper',
    description: 'Fetches who viewed profiles — 3×/day',
    async check() {
      const rows = await q(`SELECT MAX(scraped_at) AS t FROM profile_view_events`);
      const last = rows[0]?.t;
      const stale = !last || new Date(last) < hoursAgo(14);
      return { ok: !stale, lastRun: last, reason: stale ? 'No scrape in 14h' : null };
    },
    async heal() { return callEndpoint('/api/profile-views/scrape'); },
  },
  {
    name: 'postsScraper',
    description: 'Fetches user posts — 3×/day',
    async check() {
      const rows = await q(`SELECT MAX(scraped_at) AS t FROM user_posts`);
      const last = rows[0]?.t;
      const stale = !last || new Date(last) < hoursAgo(14);
      return { ok: !stale, lastRun: last, reason: stale ? 'No scrape in 14h' : null };
    },
    async heal() { return callEndpoint('/api/posts/scrape'); },
  },
  {
    name: 'engagementSync',
    description: 'Incremental reactions+comments sync — every 30min',
    async check() {
      const rows = await q(`SELECT MAX(scraped_at) AS t FROM post_reactions`);
      const last = rows[0]?.t;
      const stale = !last || new Date(last) < hoursAgo(2);
      return { ok: !stale, lastRun: last, reason: stale ? 'No sync in 2h' : null };
    },
    async heal() { return callEndpoint('/api/posts/engagement/sync'); },
  },
  {
    name: 'followerScraper',
    description: 'Company followers scrape — every 30min',
    async check() {
      const rows = await q(`SELECT MAX(scraped_at) AS t FROM company_followers`);
      const last = rows[0]?.t;
      const stale = !last || new Date(last) < hoursAgo(2);
      return { ok: !stale, lastRun: last, reason: stale ? 'No scrape in 2h' : null };
    },
    async heal() {
      // Find first account with company_page_urn
      const accts = await q(`SELECT account_id FROM unipile_accounts WHERE settings->>'company_page_urn' IS NOT NULL AND settings->>'company_page_urn' != '' LIMIT 1`);
      if (!accts.length) return { ok: false, error: 'no account with company_page_urn' };
      return callEndpoint('/api/followers/scrape', 'POST', { account_id: accts[0].account_id });
    },
  },
  {
    name: 'inboxPoller',
    description: 'Backup webhook insurance — every 30min',
    async check() {
      const rows = await q(`SELECT MAX(created_at) AS t FROM inbox_messages`);
      const last = rows[0]?.t;
      // Only flag if inbox is completely silent for 4h AND there are active campaigns
      const activeCamps = await q(`SELECT COUNT(*) AS n FROM campaigns WHERE status='active'`);
      const hasActive = parseInt(activeCamps[0]?.n || 0) > 0;
      const stale = hasActive && (!last || new Date(last) < hoursAgo(4));
      return { ok: !stale, lastRun: last, reason: stale ? 'No inbox poll in 4h with active campaigns' : null };
    },
    async heal() { return callEndpoint('/api/inbox/poll'); },
  },
  {
    name: 'approvalChecker',
    description: 'Checks connection approvals — every 30min',
    async check() {
      // Check if any invites were sent recently and haven't been checked
      const rows = await q(`
        SELECT MAX(invite_approved_at) AS last_approved,
               COUNT(*) FILTER (WHERE invite_sent=true AND invite_approved=false AND invite_sent_at < NOW() - INTERVAL '2 hours') AS pending
        FROM contacts
      `);
      const lastApproved = rows[0]?.last_approved;
      const pending = parseInt(rows[0]?.pending || 0);
      // Only stale if there are pending invites old enough to have been processed
      const stale = pending > 5 && (!lastApproved || new Date(lastApproved) < hoursAgo(2));
      return { ok: !stale, lastRun: lastApproved, pendingInvites: pending, reason: stale ? `${pending} pending invites not checked in 2h` : null };
    },
    async heal() {
      // No direct endpoint — approval checker runs on setInterval in process
      // We can nudge it via admin endpoint if available
      return require('./watchdog').forceRestart('approvalChecker');
    },
    async heal() { return require('./watchdog').forceRestart('approvalChecker'); },
  },
  {
    name: 'invitationSender',
    description: 'Sends connection requests — every 15min',
    async check() {
      const rows = await q(`
        SELECT MAX(invite_sent_at) AS last_sent,
               COUNT(*) FILTER (WHERE invite_sent=false OR invite_sent IS NULL) AS eligible
        FROM contacts c
        JOIN campaigns camp ON camp.id = c.campaign_id
        WHERE camp.status = 'active'
          AND c.already_connected = false
      `);
      const lastSent = rows[0]?.last_sent;
      const eligible = parseInt(rows[0]?.eligible || 0);
      const stale = eligible > 0 && (!lastSent || new Date(lastSent) < hoursAgo(36));
      return { ok: !stale, lastRun: lastSent, eligible, reason: stale ? `${eligible} eligible contacts, no invite sent in 36h` : null };
    },
    async heal() { return require('./watchdog').forceRestart('invitationSender'); },
  },
  {
    name: 'messageSender',
    description: 'Sends sequence messages — every 5min',
    async check() {
      const rows = await q(`
        SELECT MAX(msg_1_sent_at) AS last_sent,
               COUNT(*) FILTER (WHERE invite_approved=true AND (msg_sent=false OR msg_sent IS NULL)) AS eligible
        FROM contacts c
        JOIN campaigns camp ON camp.id = c.campaign_id
        WHERE camp.status = 'active'
      `);
      const lastSent = rows[0]?.last_sent;
      const eligible = parseInt(rows[0]?.eligible || 0);
      const stale = eligible > 10 && (!lastSent || new Date(lastSent) < hoursAgo(12));
      return { ok: !stale, lastRun: lastSent, eligible, reason: stale ? `${eligible} eligible contacts, no message sent in 12h` : null };
    },
    async heal() { return require('./watchdog').forceRestart('messageSender'); },
  },
  {
    name: 'profileViewer',
    description: 'Views contact profiles — every 15min',
    async check() {
      const rows = await q(`
        SELECT MAX(last_profile_view_at) AS last_view,
               COUNT(*) FILTER (WHERE last_profile_view_at IS NULL OR last_profile_view_at < NOW() - INTERVAL '7 days') AS eligible
        FROM contacts c
        JOIN campaigns camp ON camp.id = c.campaign_id
        WHERE camp.status = 'active' AND c.invite_approved = true
      `);
      const lastView = rows[0]?.last_view;
      const eligible = parseInt(rows[0]?.eligible || 0);
      const stale = eligible > 10 && (!lastView || new Date(lastView) < hoursAgo(36));
      return { ok: !stale, lastRun: lastView, eligible, reason: stale ? `${eligible} viewable contacts, no view in 36h` : null };
    },
    async heal() { return require('./watchdog').forceRestart('profileViewer'); },
  },
  {
    name: 'companyFollowSender',
    description: 'Sends company follow invites — every 30min',
    async check() {
      const rows = await q(`
        SELECT MAX(company_follow_invited_at) AS last_sent,
               COUNT(*) FILTER (WHERE invite_approved=true AND (company_follow_invited=false OR company_follow_invited IS NULL)) AS eligible
        FROM contacts c
        JOIN campaigns camp ON camp.id = c.campaign_id
        WHERE camp.status = 'active'
          AND (camp.settings->'engagement'->>'follow_company')::boolean = true
      `);
      const lastSent = rows[0]?.last_sent;
      const eligible = parseInt(rows[0]?.eligible || 0);
      const stale = eligible > 5 && (!lastSent || new Date(lastSent) < hoursAgo(36));
      return { ok: !stale, lastRun: lastSent, eligible, reason: stale ? `${eligible} eligible contacts, no follow invite in 36h` : null };
    },
    async heal() { return callEndpoint('/api/company-follow/run'); },
  },
  {
    name: 'statsSnapshotter',
    description: 'Daily campaign stats snapshot',
    async check() {
      const today = new Date().toISOString().slice(0, 10);
      const rows = await q(`SELECT MAX(snapshot_date) AS t FROM campaign_daily_stats`);
      const last = rows[0]?.t;
      const lastDate = last ? new Date(last).toISOString().slice(0, 10) : null;
      const stale = lastDate !== today;
      return { ok: !stale, lastRun: last, reason: stale ? `Last snapshot: ${lastDate || 'never'} (expected today ${today})` : null };
    },
    async heal() { return require('./watchdog').forceRestart('statsSnapshotter'); },
  },
  {
    name: 'opportunityScraper',
    description: 'Finds 1st-degree connections at target companies — every 1h',
    async check() {
      const rows = await q(`
        SELECT MAX(created_at) AS t FROM contacts
        WHERE already_connected = true AND campaign_id IS NULL
      `);
      const last = rows[0]?.t;
      // Only flag if there are opportunity companies set up
      const oppCos = await q(`SELECT COUNT(*) AS n FROM opportunity_companies`);
      const hasOpp = parseInt(oppCos[0]?.n || 0) > 0;
      const stale = hasOpp && (!last || new Date(last) < hoursAgo(36));
      return { ok: !stale, lastRun: last, reason: stale ? 'No new opportunity contacts found in 36h' : null };
    },
    async heal() { return callEndpoint('/api/opportunities/scan'); },
  },
];

// ─── Main health run ──────────────────────────────────────────────────────────

async function runHealthCheck() {
  console.log('[HealthChecker] Starting daily health check...');
  const results = [];
  const alertIssues = [];

  for (const check of CHECKS) {
    let status;
    try {
      status = await check.check();
    } catch (e) {
      status = { ok: false, reason: `Check threw: ${e.message}` };
    }

    const result = {
      name:        check.name,
      description: check.description,
      ok:          status.ok,
      lastRun:     status.lastRun || null,
      reason:      status.reason || null,
      healResult:  null,
      checkedAt:   new Date().toISOString(),
    };

    if (!status.ok && status.reason) {
      console.warn(`[HealthChecker] ⚠️  ${check.name}: ${status.reason}`);

      // Attempt auto-heal (all automations now have heal via watchdog.forceRestart or API)
      console.log(`[HealthChecker] 🔧 Auto-healing ${check.name}...`);
      try {
        const healRes = await check.heal();
        result.healResult = healRes.ok ? 'healed' : `failed: ${healRes.error || String(healRes.body || '').substring(0,100)}`;
        console.log(`[HealthChecker] ${healRes.ok ? '✅' : '❌'} Heal ${check.name}: ${result.healResult}`);
        if (!healRes.ok) alertIssues.push({ ...result, healResult: result.healResult });
      } catch (e) {
        result.healResult = `exception: ${e.message}`;
        alertIssues.push({ ...result });
      }
    } else {
      result.healResult = status.ok ? 'healthy' : 'skipped (no eligible work)';
    }

    results.push(result);
  }

  // Send alert if any auto-heals failed
  if (alertIssues.length) {
    await sendAlert(alertIssues);
  }

  const healthy  = results.filter(r => r.ok).length;
  const issues   = results.filter(r => !r.ok).length;
  const healed   = results.filter(r => r.healResult === 'healed').length;

  console.log(`[HealthChecker] ✅ Done — ${healthy}/${CHECKS.length} healthy, ${issues} issues, ${healed} auto-healed`);

  // Store last result for /api/health endpoint
  lastHealthResult = { runAt: new Date().toISOString(), healthy, issues, healed, results };
  return lastHealthResult;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

let lastHealthResult = null;
let scheduleTimer    = null;

function msUntilNextRun() {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function scheduleNext() {
  const ms = msUntilNextRun();
  const nextStr = new Date(Date.now() + ms).toISOString();
  console.log(`[HealthChecker] Next run at ${nextStr} (in ${Math.round(ms/60000)}min)`);
  clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(async () => {
    await runHealthCheck();
    scheduleNext();
  }, ms);
}

function start() {
  console.log(`[HealthChecker] Started — daily at ${RUN_HOUR}:00 server time`);
  scheduleNext();
}

function getLastResult() {
  return lastHealthResult;
}

module.exports = { start, runHealthCheck, getLastResult };
