const express = require('express');
const router  = express.Router();

// Simple in-memory cache: key → { data, ts }
const _cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function fromCache(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return entry.data;
}
function toCache(key, data) { _cache.set(key, { data, ts: Date.now() }); }

// Reddit User-Agent must follow: platform:appId:version (by /u/username)
const REDDIT_UA = 'web:elvia-abm:1.0 (by /u/elvia_abm_app)';

// ── GET /api/discover/reddit ─────────────────────────────────────────────────
router.get('/reddit', async (req, res) => {
  const { q, sort = 'relevance', t = 'month', limit = 25, after } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });

  const cacheKey = `reddit:${q}:${sort}:${t}:${after||''}`;
  const cached = fromCache(cacheKey);
  if (cached) { return res.json(cached); }

  try {
    // Reddit max is 100 per call
    const safeLimit = Math.min(parseInt(limit) || 25, 100);
    const params = new URLSearchParams({ q, sort, t, limit: safeLimit, raw_json: 1 });
    if (after) params.set('after', after);

    const url = `https://www.reddit.com/search.json?${params}`;
    console.log('[discover/reddit] fetching:', url.slice(0, 100));

    const resp = await fetch(url, {
      headers: {
        'User-Agent': REDDIT_UA,
        'Accept': 'application/json',
      }
    });

    console.log('[discover/reddit] status:', resp.status, 'ratelimit-remaining:', resp.headers.get('x-ratelimit-remaining'));

    if (!resp.ok) {
      const body = await resp.text();
      console.warn('[discover/reddit] error body:', body.slice(0, 300));
      if (resp.status === 429) {
        const retryAfter = resp.headers.get('retry-after') || '60';
        return res.status(429).json({ error: `Reddit rate limit. Retry after ${retryAfter}s`, posts: [] });
      }
      return res.json({ posts: [], after: null, message: `Reddit returned ${resp.status}` });
    }

    let data;
    const text = await resp.text();
    try { data = JSON.parse(text); }
    catch(e) {
      console.warn('[discover/reddit] JSON parse error, body:', text.slice(0, 300));
      return res.json({ posts: [], after: null, message: 'Reddit returned non-JSON response' });
    }

    const posts = (data?.data?.children || []).map(c => {
      const p = c.data;
      return {
        id:          p.id,
        title:       p.title,
        selftext:    (p.selftext || '').slice(0, 500),
        author:      p.author,
        subreddit:   p.subreddit_name_prefixed || ('r/' + p.subreddit),
        score:       p.score,
        num_comments:p.num_comments,
        url:         p.url,
        permalink:   'https://reddit.com' + p.permalink,
        created_utc: p.created_utc,
        is_self:     p.is_self,
      };
    });

    const result = { posts, after: data?.data?.after || null };
    toCache(cacheKey, result);
    res.json(result);

  } catch(e) {
    console.error('[discover/reddit]', e.message);
    res.status(500).json({ error: e.message, posts: [] });
  }
});

// ── GET /api/discover/linkedin ───────────────────────────────────────────────
router.get('/linkedin', async (req, res) => {
  const { q, workspace_id, limit = 20, sort = 'relevance', date_filter } = req.query;
  if (!q || !workspace_id) return res.status(400).json({ error: 'q and workspace_id required' });

  try {
    const db = require('../db');
    const { rows: accts } = await db.query(
      'SELECT account_id FROM unipile_accounts WHERE workspace_id=$1 LIMIT 1',
      [workspace_id]
    );
    if (!accts.length) return res.json({ posts: [], message: 'No LinkedIn account in workspace' });

    const accountId = accts[0].account_id;
    const UNIPILE_DSN     = process.env.UNIPILE_DSN;
    const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;
    if (!UNIPILE_DSN || !UNIPILE_API_KEY) return res.json({ posts: [], message: 'Unipile not configured' });

    const { searchPostsByKeywords } = require('../unipile');
    const opts = { limit: parseInt(limit) };
    if (sort === 'date')  opts.sortBy     = 'date';
    if (date_filter)      opts.datePosted = date_filter;

    // Try accounts from ALL workspaces until one succeeds (current workspace first)
    const { rows: allAccts } = await db.query(
      `SELECT account_id, workspace_id FROM unipile_accounts
       ORDER BY (workspace_id = $1) DESC, workspace_id ASC LIMIT 10`,
      [workspace_id]
    );
    if (!allAccts.length) return res.json({ posts: [], message: 'No LinkedIn account found' });

    let lastErr = null;
    for (const acct of allAccts) {
      const liCacheKey = `li:${acct.account_id}:${q}:${sort}:${date_filter||''}`;
      const liCached = fromCache(liCacheKey);
      if (liCached) {
        console.log('[discover/linkedin] cache hit ws', acct.workspace_id);
        return res.json(liCached);
      }

      try {
        console.log('[discover/linkedin] trying account ws', acct.workspace_id);
        const result = await searchPostsByKeywords(acct.account_id, q, opts);
        if (result.posts.length > 0 || !result.rateLimited) {
          const liResult = { posts: result.posts, total: result.total };
          if (result.posts.length > 0) toCache(liCacheKey, liResult);
          return res.json(liResult);
        }
      } catch(e) {
        console.warn('[discover/linkedin] account ws', acct.workspace_id, 'failed:', e.message);
        lastErr = e;
        if (!e.message?.includes('429')) break; // only skip on rate limit
      }
    }

    // All accounts rate limited
    return res.json({ posts: [], rate_limited: true, message: 'LinkedIn is rate limiting searches right now. Wait a minute and try again.' });
  } catch(e) {
    console.error('[discover/linkedin]', e.message);
    if (e.message?.includes('429')) {
      return res.json({ posts: [], rate_limited: true, message: 'LinkedIn is rate limiting searches right now. Wait a minute and try again.' });
    }
    res.status(500).json({ error: e.message, posts: [] });
  }
});

module.exports = router;
