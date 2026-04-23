const express = require('express');
const router  = express.Router();
const db      = require('../db');
// Ensure tables exist on first use (inline — can't require schema-v2 due to top-level await)
let _ready = false;
async function ensureReady() {
  if (_ready) return;
  await db.query(`CREATE TABLE IF NOT EXISTS discover_feeds (
    id           SERIAL PRIMARY KEY,
    workspace_id INT  NOT NULL,
    name         TEXT NOT NULL,
    keywords     TEXT NOT NULL,
    sources      JSONB NOT NULL DEFAULT '["reddit","linkedin"]',
    date_filter  TEXT  DEFAULT 'past_month',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    last_run_at  TIMESTAMPTZ,
    item_count   INT  DEFAULT 0,
    auto_run     BOOLEAN DEFAULT TRUE
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS discover_items (
    id           SERIAL PRIMARY KEY,
    feed_id      INT  NOT NULL REFERENCES discover_feeds(id) ON DELETE CASCADE,
    workspace_id INT  NOT NULL,
    source       TEXT NOT NULL,
    title        TEXT,
    snippet      TEXT,
    author       TEXT,
    author_url   TEXT,
    subreddit    TEXT,
    url          TEXT NOT NULL,
    score        INT  DEFAULT 0,
    comments     INT  DEFAULT 0,
    found_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(feed_id, url)
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS discover_items_feed_id  ON discover_items(feed_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS discover_feeds_workspace ON discover_feeds(workspace_id)`);
  _ready = true;
}

// ── GET /api/discover-feeds?workspace_id=  ───────────────────────────────────
router.get('/', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  await ensureReady();
  try {
    const { rows } = await db.query(
      `SELECT id, name, keywords, sources, date_filter, created_at, last_run_at, item_count, auto_run
       FROM discover_feeds WHERE workspace_id=$1 ORDER BY created_at DESC`,
      [workspace_id]
    );
    res.json({ feeds: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/discover-feeds  ────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { workspace_id, name, keywords, sources, date_filter, auto_run } = req.body;
  if (!workspace_id || !name || !keywords) return res.status(400).json({ error: 'workspace_id, name, keywords required' });
  await ensureReady();
  try {
    const { rows } = await db.query(
      `INSERT INTO discover_feeds (workspace_id, name, keywords, sources, date_filter, auto_run)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [workspace_id, name, keywords,
       JSON.stringify(sources || ['reddit','linkedin']),
       date_filter || 'past_month',
       auto_run !== false]
    );
    res.json({ feed: rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/discover-feeds/:id  ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { workspace_id } = req.query;
  await ensureReady();
  try {
    await db.query('DELETE FROM discover_feeds WHERE id=$1 AND workspace_id=$2', [req.params.id, workspace_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/discover-feeds/:id/items  ───────────────────────────────────────
router.get('/:id/items', async (req, res) => {
  const { workspace_id, limit = 50, offset = 0 } = req.query;
  await ensureReady();
  try {
    const { rows } = await db.query(
      `SELECT * FROM discover_items WHERE feed_id=$1 AND workspace_id=$2
       ORDER BY found_at DESC LIMIT $3 OFFSET $4`,
      [req.params.id, workspace_id, limit, offset]
    );
    const { rows: [cnt] } = await db.query(
      'SELECT COUNT(*) as total FROM discover_items WHERE feed_id=$1', [req.params.id]
    );
    res.json({ items: rows, total: parseInt(cnt.total) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/discover-feeds/:id/run  (manual scan) ─────────────────────────
router.post('/:id/run', async (req, res) => {
  const { workspace_id } = req.body;
  await ensureReady();
  try {
    const { rows: [feed] } = await db.query(
      'SELECT * FROM discover_feeds WHERE id=$1 AND workspace_id=$2', [req.params.id, workspace_id]
    );
    if (!feed) return res.status(404).json({ error: 'Feed not found' });

    const added = await runFeedScan(feed);
    await db.query(
      'UPDATE discover_feeds SET last_run_at=NOW(), item_count=(SELECT COUNT(*) FROM discover_items WHERE feed_id=$1) WHERE id=$1',
      [feed.id]
    );
    res.json({ added, ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/discover-feeds/save-item  (save from Discover search) ──────────
router.post('/save-item', async (req, res) => {
  const { feed_id, workspace_id, source, title, snippet, author, author_url, subreddit, url, score, comments } = req.body;
  if (!feed_id || !workspace_id || !url) return res.status(400).json({ error: 'feed_id, workspace_id, url required' });
  await ensureReady();
  try {
    await db.query(
      `INSERT INTO discover_items (feed_id, workspace_id, source, title, snippet, author, author_url, subreddit, url, score, comments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (feed_id, url) DO NOTHING`,
      [feed_id, workspace_id, source, title, snippet, author, author_url, subreddit, url, score||0, comments||0]
    );
    await db.query(
      'UPDATE discover_feeds SET item_count=(SELECT COUNT(*) FROM discover_items WHERE feed_id=$1) WHERE id=$1',
      [feed_id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Core scan logic ──────────────────────────────────────────────────────────
async function runFeedScan(feed) {
  const sources = Array.isArray(feed.sources) ? feed.sources : JSON.parse(feed.sources || '["reddit","linkedin"]');
  let added = 0;

  for (const src of sources) {
    try {
      let items = [];

      if (src === 'reddit') {
        const params = new URLSearchParams({ q: feed.keywords, sort: 'relevance', t: feed.date_filter || 'month', limit: 25, raw_json: 1 });
        const r = await fetch(`https://www.reddit.com/search.json?${params}`, {
          headers: { 'User-Agent': 'web:elvia-abm:1.0 (by /u/elvia_abm_app)' }
        });
        if (r.ok) {
          const data = await r.json();
          items = (data?.data?.children || []).map(c => ({
            source: 'reddit',
            title:    c.data.title,
            snippet:  (c.data.selftext || '').slice(0, 400),
            author:   c.data.author,
            subreddit:c.data.subreddit_name_prefixed || ('r/' + c.data.subreddit),
            url:      'https://reddit.com' + c.data.permalink,
            score:    c.data.score,
            comments: c.data.num_comments,
          }));
        }
      }

      if (src === 'linkedin') {
        // Try any available account
        const { rows: accts } = await db.query(
          'SELECT account_id FROM unipile_accounts ORDER BY workspace_id ASC LIMIT 5'
        );
        for (const acct of accts) {
          try {
            const { searchPostsByKeywords } = require('../unipile');
            const result = await searchPostsByKeywords(acct.account_id, feed.keywords, {
              limit: 20,
              datePosted: feed.date_filter || 'past_month',
            });
            if (result.rateLimited) continue;
            items = result.posts.map(p => ({
              source:     'linkedin',
              title:      p.title,
              snippet:    p.snippet,
              author:     p.author,
              author_url: p.author_url,
              url:        p.post_url || '',
              score:      p.reactions,
              comments:   p.comments,
            })).filter(p => p.url);
            if (items.length) break;
          } catch(e) { console.warn('[discover-scan] linkedin acct error:', e.message); }
        }
      }

      // Upsert items
      for (const item of items) {
        if (!item.url) continue;
        const r = await db.query(
          `INSERT INTO discover_items (feed_id, workspace_id, source, title, snippet, author, author_url, subreddit, url, score, comments)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (feed_id, url) DO NOTHING RETURNING id`,
          [feed.id, feed.workspace_id, item.source, item.title, item.snippet, item.author, item.author_url, item.subreddit, item.url, item.score||0, item.comments||0]
        );
        if (r.rowCount) added++;
      }
    } catch(e) { console.error('[discover-scan]', src, 'error:', e.message); }
  }
  return added;
}


// ── DELETE /api/discover-feeds/:id/items  (clear all items) ─────────────────
router.delete('/:id/items', async (req, res) => {
  const { workspace_id } = req.query;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  await ensureReady();
  try {
    const { rowCount } = await db.query(
      `DELETE FROM discover_items WHERE feed_id=$1
       AND workspace_id=$2`,
      [req.params.id, workspace_id]
    );
    await db.query(
      `UPDATE discover_feeds SET item_count=0 WHERE id=$1 AND workspace_id=$2`,
      [req.params.id, workspace_id]
    );
    res.json({ ok: true, deleted: rowCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/discover-feeds/auto-save  (save batch of search results) ───────
// Called automatically after every search. Finds or creates a feed for these
// keywords and upserts all results in one shot.
router.post('/auto-save', async (req, res) => {
  const { workspace_id, keywords, items } = req.body;
  if (!workspace_id || !keywords || !Array.isArray(items) || !items.length)
    return res.json({ ok: true, saved: 0 }); // nothing to do
  await ensureReady();
  try {
    // Find existing feed with matching keywords (case-insensitive)
    let { rows } = await db.query(
      `SELECT id FROM discover_feeds
       WHERE workspace_id=$1 AND LOWER(keywords)=LOWER($2) LIMIT 1`,
      [workspace_id, keywords]
    );
    if (!rows.length) {
      // Also match monitors
      const { rows: monRows } = await db.query(
        `SELECT id FROM search_monitors
         WHERE workspace_id=$1 AND LOWER(keywords)=LOWER($2) AND active=true LIMIT 1`,
        [workspace_id, keywords]
      ).catch(() => ({ rows: [] }));
      // No feed and no monitor → don't auto-create, just return
      if (!monRows.length) return res.json({ ok: true, saved: 0, reason: 'no_feed' });
      // Has monitor but no feed → auto-create the feed
      const { rows: created } = await db.query(
        `INSERT INTO discover_feeds (workspace_id, name, keywords, sources, auto_run)
         VALUES ($1, $2, $3, '["reddit","linkedin"]', true)
         RETURNING id`,
        [workspace_id, keywords, keywords]
      );
      rows = created;
    }
    const feedId = rows[0].id;

    let saved = 0;
    for (const item of items) {
      if (!item.url) continue;
      const r = await db.query(
        `INSERT INTO discover_items
           (feed_id, workspace_id, source, title, snippet, author,
            author_url, subreddit, url, score, comments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (feed_id, url) DO NOTHING RETURNING id`,
        [feedId, workspace_id, item.source, item.title,
         item.snippet, item.author, item.author_url,
         item.subreddit, item.url, item.score||0, item.comments||0]
      );
      if (r.rowCount) saved++;
    }

    await db.query(
      `UPDATE discover_feeds
       SET item_count=(SELECT COUNT(*) FROM discover_items WHERE feed_id=$1),
           last_run_at=NOW()
       WHERE id=$1`, [feedId]
    );

    res.json({ ok: true, saved, feedId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.runFeedScan = runFeedScan;
