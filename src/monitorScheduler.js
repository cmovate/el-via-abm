/**
 * monitorScheduler.js — Google Alerts-style email notifications
 *
 * Checks search_monitors every hour.
 * Fetches new Reddit/LinkedIn posts for each active monitor.
 * Sends a digest email with new results based on frequency (daily/weekly/instant).
 */

const nodemailer = require('nodemailer');
const db         = require('./db');
let _ready = false;

// ── Email transport (reuses SMTP env vars) ───────────────────────────────────
function makeTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' },
  });
}

const FROM = process.env.SMTP_USER || 'noreply@elvia.app';

// ── Fetch new items for a monitor ────────────────────────────────────────────
async function fetchNewItems(monitor) {
  const sources = Array.isArray(monitor.sources) ? monitor.sources : JSON.parse(monitor.sources || '["reddit"]');
  const items   = [];

  for (const src of sources) {
    try {
      if (src === 'reddit') {
        const params = new URLSearchParams({
          q: monitor.keywords, sort: 'new', t: 'day', limit: 25, raw_json: 1
        });
        const r = await fetch(`https://www.reddit.com/search.json?${params}`, {
          headers: { 'User-Agent': 'web:elvia-abm:1.0 (by /u/elvia_abm_app)' }
        });
        if (r.ok) {
          const data = await r.json();
          for (const c of (data?.data?.children || [])) {
            const p = c.data;
            items.push({
              source:    'reddit',
              title:     p.title,
              snippet:   (p.selftext || '').slice(0, 300),
              author:    p.author,
              subreddit: p.subreddit_name_prefixed || ('r/' + p.subreddit),
              url:       'https://reddit.com' + p.permalink,
              score:     p.score,
              comments:  p.num_comments,
            });
          }
        }
      }

      if (src === 'linkedin') {
        // Try available accounts
        const { rows: accts } = await db.query(
          'SELECT account_id FROM unipile_accounts ORDER BY workspace_id ASC LIMIT 5'
        );
        const { searchPostsByKeywords } = require('./unipile');
        for (const acct of accts) {
          try {
            const result = await searchPostsByKeywords(acct.account_id, monitor.keywords, {
              limit: 10, datePosted: 'past_24h'
            });
            if (result.rateLimited) continue;
            for (const p of result.posts) {
              if (!p.post_url) continue;
              items.push({
                source:     'linkedin',
                title:      p.title,
                snippet:    p.snippet,
                author:     p.author,
                author_url: p.author_url,
                url:        p.post_url,
                score:      p.reactions,
                comments:   p.comments,
              });
            }
            if (result.posts.length) break;
          } catch(e) { /* skip */ }
        }
      }
    } catch(e) {
      console.warn('[monitor] src error:', src, e.message);
    }
  }

  // Upsert and return only NEW items (not seen before)
  const newItems = [];
  for (const item of items) {
    if (!item.url) continue;
    const r = await db.query(
      `INSERT INTO monitor_items (monitor_id, source, title, snippet, author, author_url, subreddit, url, score, comments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (monitor_id,url) DO NOTHING RETURNING id`,
      [monitor.id, item.source, item.title, item.snippet, item.author, item.author_url,
       item.subreddit, item.url, item.score||0, item.comments||0]
    );
    if (r.rowCount) newItems.push(item);
  }
  return newItems;
}

// ── Send digest email ─────────────────────────────────────────────────────────
async function sendDigestEmail(monitor, items) {
  const transport = makeTransport();
  if (!transport) {
    console.warn('[monitor] No SMTP config — skipping email for monitor', monitor.id);
    return false;
  }

  const redditItems  = items.filter(i => i.source === 'reddit');
  const linkedItems  = items.filter(i => i.source === 'linkedin');
  const total        = items.length;

  // Build HTML email
  const renderItems = (list, isReddit) => list.map(p => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;">
        <div style="margin-bottom:4px;">
          <span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;${
            isReddit ? 'background:#fee2e2;color:#991b1b' : 'background:#dbeafe;color:#1d4ed8'
          }">${isReddit ? 'r/' : 'in'}</span>
          ${isReddit ? `<span style="font-size:12px;color:#64748b;margin-left:6px;">${p.subreddit||''}</span>` : ''}
          ${!isReddit && p.author ? `<span style="font-size:12px;color:#374151;font-weight:600;margin-left:6px;">${p.author}</span>` : ''}
        </div>
        <div style="margin-bottom:4px;">
          <a href="${p.url}" style="font-size:14px;font-weight:700;color:#0f172a;text-decoration:none;">${p.title||p.snippet?.slice(0,80)||'View post'}</a>
        </div>
        ${p.snippet && p.snippet !== p.title ? `<div style="font-size:12px;color:#64748b;line-height:1.5;margin-bottom:6px;">${p.snippet.slice(0,160)}${p.snippet.length>160?'…':''}</div>` : ''}
        <div style="font-size:11px;color:#94a3b8;">
          ${p.score ? (isReddit?'⬆ ':'👍 ') + p.score : ''}
          ${p.comments ? ' · 💬 ' + p.comments + ' comments' : ''}
        </div>
      </td>
    </tr>
  `).join('');

  const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:580px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);">

  <!-- Header -->
  <div style="background:#0f172a;padding:24px 28px;display:flex;align-items:center;">
    <span style="font-size:20px;margin-right:10px;">🔍</span>
    <div>
      <div style="color:#fff;font-size:16px;font-weight:700;">${total} new result${total!==1?'s':''} for</div>
      <div style="color:#1D9E75;font-size:18px;font-weight:800;margin-top:2px;">"${monitor.keywords}"</div>
    </div>
  </div>

  <!-- Body -->
  <div style="padding:24px 28px;">

    ${linkedItems.length ? `
    <div style="margin-bottom:24px;">
      <div style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.6px;margin-bottom:12px;">LinkedIn Posts (${linkedItems.length})</div>
      <table width="100%" cellpadding="0" cellspacing="0">${renderItems(linkedItems, false)}</table>
    </div>` : ''}

    ${redditItems.length ? `
    <div style="margin-bottom:24px;">
      <div style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.6px;margin-bottom:12px;">Reddit Discussions (${redditItems.length})</div>
      <table width="100%" cellpadding="0" cellspacing="0">${renderItems(redditItems, true)}</table>
    </div>` : ''}

  </div>

  <!-- Footer -->
  <div style="padding:16px 28px;border-top:1px solid #f1f5f9;background:#f8fafc;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:11px;color:#94a3b8;">El-Via ABM · Search Monitor · ${monitor.frequency} digest</div>
    <div style="font-size:11px;color:#94a3b8;">Monitor: "${monitor.name}"</div>
  </div>

</div>
</body></html>`;

  await transport.sendMail({
    from:    `"El-Via Discover" <${FROM}>`,
    to:      monitor.email,
    subject: `🔍 ${total} new result${total!==1?'s':''} — "${monitor.keywords}"`,
    html,
  });

  console.log(`[monitor] Email sent to ${monitor.email}: ${total} new items for "${monitor.keywords}"`);
  return true;
}

// ── Main check loop ──────────────────────────────────────────────────────────
async function checkMonitors() {
  if (!_ready) {
    await db.query(`CREATE TABLE IF NOT EXISTS search_monitors (
      id SERIAL PRIMARY KEY, workspace_id INT NOT NULL, name TEXT NOT NULL,
      keywords TEXT NOT NULL, sources JSONB NOT NULL DEFAULT '["reddit","linkedin"]',
      email TEXT NOT NULL, frequency TEXT NOT NULL DEFAULT 'daily',
      active BOOLEAN DEFAULT TRUE, last_sent_at TIMESTAMPTZ,
      last_check_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS monitor_items (
      id SERIAL PRIMARY KEY, monitor_id INT NOT NULL REFERENCES search_monitors(id) ON DELETE CASCADE,
      source TEXT NOT NULL, title TEXT, snippet TEXT, author TEXT, author_url TEXT,
      subreddit TEXT, url TEXT NOT NULL, score INT DEFAULT 0, comments INT DEFAULT 0,
      found_at TIMESTAMPTZ DEFAULT NOW(), emailed BOOLEAN DEFAULT FALSE,
      UNIQUE(monitor_id, url)
    )`);
    _ready = true;
  }

  const now   = new Date();
  const hour  = now.getHours();

  // Get monitors due for check
  const { rows: monitors } = await db.query(`
    SELECT * FROM search_monitors WHERE active = true
    AND (last_check_at IS NULL OR last_check_at < NOW() - INTERVAL '1 hour')
    ORDER BY last_check_at ASC NULLS FIRST
    LIMIT 20
  `);

  if (!monitors.length) return;
  console.log(`[monitor] Checking ${monitors.length} monitors`);

  for (const monitor of monitors) {
    try {
      const newItems = await fetchNewItems(monitor);
      await db.query('UPDATE search_monitors SET last_check_at=NOW() WHERE id=$1', [monitor.id]);

      if (!newItems.length) continue;
      console.log(`[monitor] ${newItems.length} new items for "${monitor.keywords}"`);

      // Decide whether to send email based on frequency
      const shouldSend = monitor.frequency === 'instant' ||
        (monitor.frequency === 'daily'  && (hour >= 8 && hour <= 10) && (!monitor.last_sent_at || daysSince(monitor.last_sent_at) >= 1)) ||
        (monitor.frequency === 'weekly' && now.getDay() === 1 && hour >= 8 && (!monitor.last_sent_at || daysSince(monitor.last_sent_at) >= 6));

      // For instant: always send. For daily/weekly: only at morning window
      const doSend = monitor.frequency === 'instant' ||
        (!monitor.last_sent_at) ||
        (monitor.frequency === 'daily'  && daysSince(monitor.last_sent_at) >= 1) ||
        (monitor.frequency === 'weekly' && daysSince(monitor.last_sent_at) >= 7);

      if (doSend) {
        // Get all un-emailed items (not just new ones from this check)
        const { rows: unsent } = await db.query(
          `SELECT * FROM monitor_items WHERE monitor_id=$1 AND emailed=false ORDER BY found_at DESC LIMIT 50`,
          [monitor.id]
        );
        if (unsent.length) {
          const sent = await sendDigestEmail(monitor, unsent);
          if (sent) {
            await db.query(
              'UPDATE monitor_items SET emailed=true WHERE monitor_id=$1 AND emailed=false',
              [monitor.id]
            );
            await db.query('UPDATE search_monitors SET last_sent_at=NOW() WHERE id=$1', [monitor.id]);
          }
        }
      }
    } catch(e) {
      console.error(`[monitor] Error for monitor ${monitor.id}:`, e.message);
    }
  }
}

function daysSince(ts) {
  return (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24);
}

// ── Start ────────────────────────────────────────────────────────────────────
function startMonitorScheduler() {
  // Run immediately after startup, then every hour
  setTimeout(async () => {
    try { await checkMonitors(); } catch(e) { console.error('[monitor]', e.message); }
  }, 60000); // 1 min after startup

  setInterval(async () => {
    try { await checkMonitors(); } catch(e) { console.error('[monitor]', e.message); }
  }, 60 * 60 * 1000); // every hour

  console.log('[monitorScheduler] started — checking every hour');
}

module.exports = { startMonitorScheduler, checkMonitors, fetchNewItems };
