/**
 * discoverScanner.js — auto-scans discover feeds every 6 hours
 * Runs through all feeds with auto_run=true and upserts new items
 */
const db = require('./db');
const { runFeedScan } = require('./routes/discover-feeds');

let _ready = false;

async function scanAllFeeds() {
  if (!_ready) {
    try { await db.query('SELECT 1 FROM discover_feeds LIMIT 1'); }
    catch(e) { console.log('[discoverScanner] tables not ready, skipping'); return; }
    _ready = true;
  }

  let { rows: feeds } = await db.query(
    `SELECT * FROM discover_feeds WHERE auto_run = true
     AND (last_run_at IS NULL OR last_run_at < NOW() - INTERVAL '6 hours')
     ORDER BY last_run_at ASC NULLS FIRST
     LIMIT 20`
  );

  if (!feeds.length) {
    console.log('[discoverScanner] no feeds due for scan');
    return;
  }

  console.log(`[discoverScanner] scanning ${feeds.length} feeds`);
  for (const feed of feeds) {
    try {
      const added = await runFeedScan(feed);
      await db.query(
        'UPDATE discover_feeds SET last_run_at=NOW(), item_count=(SELECT COUNT(*) FROM discover_items WHERE feed_id=$1) WHERE id=$1',
        [feed.id]
      );
      console.log(`[discoverScanner] feed ${feed.id} "${feed.name}": +${added} new items`);
    } catch(e) {
      console.error(`[discoverScanner] feed ${feed.id} error:`, e.message);
    }
  }
}

function startDiscoverScanner() {
  // Run immediately, then every 6 hours
  setTimeout(async () => {
    try { await scanAllFeeds(); } catch(e) { console.error('[discoverScanner]', e.message); }
  }, 30000); // 30s delay after startup

  setInterval(async () => {
    try { await scanAllFeeds(); } catch(e) { console.error('[discoverScanner]', e.message); }
  }, 6 * 60 * 60 * 1000);

  console.log('[discoverScanner] started — scanning every 6h');
}

module.exports = { startDiscoverScanner, scanAllFeeds };
