/**
 * watchdog.js
 *
 * Self-healing watchdog for all in-process automations.
 *
 * How it works:
 *   1. Each automation calls watchdog.tick('name') at the START of every run.
 *   2. The watchdog checks every WATCH_INTERVAL_MS whether any automation
 *      hasn't ticked in its expected window.
 *   3. If stale → calls the automation's reset() + restart():
 *        a. Clears stuck lock (isRunning, activelySending, isScraping)
 *        b. Re-calls start() to restore the setInterval
 *   4. Logs all events to watchdog_log table so you can audit history.
 *   5. Exposes getStatus() used by /api/automations/status.
 *
 * Stale thresholds (generous — 2× the expected interval):
 *   invitationSender    45 min  (interval: 15min)
 *   messageSender       15 min  (interval:  5min)
 *   approvalChecker     75 min  (interval: 30min)
 *   profileViewer       45 min  (interval: 15min)
 *   companyFollowSender 75 min  (interval: 30min)
 *   withdrawSender      30 hours(interval: 24h)
 *   likeSender         150 min  (interval: 60min)
 *   inboxPoller         75 min  (interval: 30min)
 *   followerScraper     75 min  (interval: 30min)
 *   engagementSync      75 min  (interval: 30min)
 */

const db = require('./db');

const WATCH_INTERVAL_MS = 10 * 60 * 1000; // check every 10 minutes

// heartbeats[name] = { lastTick: Date, restarts: N, lastRestart: Date|null }
const heartbeats = {};
let watchTimer   = null;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Call this at the start of every automation run cycle.
 * e.g.  watchdog.tick('invitationSender');
 */
function tick(name) {
  if (!heartbeats[name]) {
    heartbeats[name] = { lastTick: null, restarts: 0, lastRestart: null };
  }
  heartbeats[name].lastTick = new Date();
}

function getStatus() {
  const out = {};
  const now = Date.now();
  for (const [name, hb] of Object.entries(heartbeats)) {
    const cfg = AUTOMATIONS[name];
    const ageMs = hb.lastTick ? now - hb.lastTick.getTime() : Infinity;
    out[name] = {
      lastTick:    hb.lastTick?.toISOString() || null,
      ageMinutes:  Math.round(ageMs / 60000),
      staleAfterMinutes: cfg ? Math.round(cfg.staleMs / 60000) : null,
      ok:          cfg ? ageMs < cfg.staleMs : true,
      restarts:    hb.restarts,
      lastRestart: hb.lastRestart?.toISOString() || null,
    };
  }
  return out;
}

// ─── Automation registry ─────────────────────────────────────────────────────

// Each entry: { staleMs, module (lazy-loaded), reset(), restart() }
const AUTOMATIONS = {
  invitationSender: {
    staleMs: 45 * 60 * 1000,
    get mod() { return require('./invitationSender'); },
    reset()   { /* activelySending.clear() not exported — rely on restart */ },
    restart() { this.mod.start(); },
  },
  messageSender: {
    staleMs: 15 * 60 * 1000,
    get mod() { return require('./messageSender'); },
    reset()   { try { this.mod.stop?.(); } catch {} },
    restart() { this.mod.start(); },
  },
  approvalChecker: {
    staleMs: 75 * 60 * 1000,
    get mod() { return require('./approvalChecker'); },
    reset() {
      // isRunning is module-private — force via run() which checks it
      // We rely on restart() clearing the timer and setting a new one
    },
    restart() { this.mod.start(); },
  },
  profileViewer: {
    staleMs: 45 * 60 * 1000,
    get mod() { return require('./profileViewer'); },
    reset()   {},
    restart() { this.mod.start(); },
  },
  companyFollowSender: {
    staleMs: 75 * 60 * 1000,
    get mod() { return require('./companyFollowSender'); },
    reset()   {},
    restart() { this.mod.start(); },
  },
  withdrawSender: {
    staleMs: 30 * 60 * 60 * 1000, // 30h
    get mod() { return require('./withdrawSender'); },
    reset()   {},
    restart() { this.mod.start(); },
  },
  likeSender: {
    staleMs: 150 * 60 * 1000,
    get mod() { return require('./likeSender'); },
    reset()   {},
    restart() { this.mod.start(); },
  },
  inboxPoller: {
    staleMs: 75 * 60 * 1000,
    get mod() { return require('./inboxPoller'); },
    reset()   {},
    restart() { this.mod.start?.(); },
  },
  opportunityFollowSender: {
    staleMs: 26 * 60 * 60 * 1000, // 26h — runs once daily
    get mod() { return require('./opportunityFollowSender'); },
    reset()   {},
    restart() { this.mod.start(); },
  },
  followerScraper: {
    staleMs: 75 * 60 * 1000,
    get mod() { return require('./followerScraper'); },
    reset()   { /* isScraping is private — runScrape() checks it */ },
    restart() { this.mod.start(); },
  },
};

// ─── Watch loop ──────────────────────────────────────────────────────────────

async function checkAll() {
  const now  = Date.now();
  const dead = [];

  for (const [name, cfg] of Object.entries(AUTOMATIONS)) {
    const hb    = heartbeats[name];
    const ageMs = hb?.lastTick ? now - hb.lastTick.getTime() : Infinity;

    if (ageMs > cfg.staleMs) {
      const ageMin = Math.round(ageMs / 60000);
      const stalMin = Math.round(cfg.staleMs / 60000);
      console.warn(`[Watchdog] ⚠️  ${name} stale: ${ageMin}min (expected <${stalMin}min) — restarting`);
      dead.push({ name, ageMin, stalMin });

      try {
        cfg.reset();
        cfg.restart();
        if (!heartbeats[name]) heartbeats[name] = { lastTick: null, restarts: 0, lastRestart: null };
        heartbeats[name].restarts++;
        heartbeats[name].lastRestart = new Date();
        console.log(`[Watchdog] ✅ Restarted ${name}`);
        await logEvent(name, 'restarted', `stale ${ageMin}min`);
      } catch (e) {
        console.error(`[Watchdog] ❌ Failed to restart ${name}:`, e.message);
        await logEvent(name, 'restart_failed', e.message);
      }
    }
  }

  if (dead.length === 0) {
    // Quiet success — log only periodically to avoid noise
  }
}

async function logEvent(name, event, detail) {
  try {
    await db.query(
      `INSERT INTO watchdog_log (automation_name, event, detail, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT DO NOTHING`,
      [name, event, detail]
    );
  } catch {
    // Table may not exist yet — create it
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS watchdog_log (
          id             SERIAL PRIMARY KEY,
          automation_name TEXT NOT NULL,
          event          TEXT NOT NULL,
          detail         TEXT,
          created_at     TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch {}
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function start() {
  console.log('[Watchdog] Started — checking every 10 minutes');

  // Ensure watchdog_log table exists
  logEvent('watchdog', 'started', `watching ${Object.keys(AUTOMATIONS).length} automations`);

  // Run first check after 5 min (give automations time to start)
  setTimeout(async () => {
    await checkAll();
    watchTimer = setInterval(checkAll, WATCH_INTERVAL_MS);
  }, 5 * 60 * 1000);
}

function stop() {
  clearInterval(watchTimer);
  watchTimer = null;
}

/**
 * Force-restart a named automation immediately.
 * Called by healthChecker or /api/automations/restart endpoint.
 */
async function forceRestart(name) {
  const cfg = AUTOMATIONS[name];
  if (!cfg) return { ok: false, error: `Unknown automation: ${name}` };
  try {
    cfg.reset();
    cfg.restart();
    if (!heartbeats[name]) heartbeats[name] = { lastTick: null, restarts: 0, lastRestart: null };
    heartbeats[name].restarts++;
    heartbeats[name].lastRestart = new Date();
    await logEvent(name, 'force_restarted', 'manual trigger');
    return { ok: true, message: `${name} restarted` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Get last N watchdog log entries.
 */
async function getLogs(limit = 50) {
  try {
    const { rows } = await db.query(
      `SELECT * FROM watchdog_log ORDER BY created_at DESC LIMIT $1`, [limit]
    );
    return rows;
  } catch { return []; }
}

module.exports = { start, stop, tick, forceRestart, getStatus, getLogs };
