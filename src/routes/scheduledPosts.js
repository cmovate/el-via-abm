/**
 * src/routes/scheduledPosts.js
 *
 * Post Scheduler DB persistence.
 * Replaces localStorage in post-scheduler.html
 *
 * GET    /api/scheduled-posts?workspace_id=&from=&to=
 * POST   /api/scheduled-posts
 * PATCH  /api/scheduled-posts/:id
 * DELETE /api/scheduled-posts/:id
 * POST   /api/scheduled-posts/:id/comments
 * PATCH  /api/scheduled-comments/:id
 * DELETE /api/scheduled-comments/:id
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/scheduled-posts?workspace_id=&from=&to=&account_id=
router.get('/', async (req, res) => {
  try {
    const { workspace_id, from, to, account_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });

    const conds  = ['sp.workspace_id = $1'];
    const params = [workspace_id];

    if (from)       { params.push(from);       conds.push(`sp.scheduled_at >= $${params.length}`); }
    if (to)         { params.push(to);         conds.push(`sp.scheduled_at <= $${params.length}`); }
    if (account_id) { params.push(account_id); conds.push(`sp.account_id = $${params.length}`); }

    const { rows: posts } = await db.query(`
      SELECT sp.*,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('id',sc.id,'account_id',sc.account_id,'content',sc.content,
                              'status',sc.status,'scheduled_at',sc.scheduled_at)
          ) FILTER (WHERE sc.id IS NOT NULL),
          '[]'
        ) AS comments
      FROM scheduled_posts sp
      LEFT JOIN scheduled_comments sc ON sc.scheduled_post_id = sp.id
      WHERE ${conds.join(' AND ')}
      GROUP BY sp.id
      ORDER BY sp.scheduled_at ASC NULLS LAST
    `, params);

    res.json({ items: posts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/scheduled-posts
router.post('/', async (req, res) => {
  try {
    const { workspace_id, account_id, content, scheduled_at, status } = req.body;
    if (!workspace_id || !account_id || !content?.trim())
      return res.status(400).json({ error: 'workspace_id, account_id, content required' });

    const { rows } = await db.query(`
      INSERT INTO scheduled_posts (workspace_id, account_id, content, status, scheduled_at)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [
      workspace_id, account_id, content.trim(),
      status || (scheduled_at ? 'scheduled' : 'draft'),
      scheduled_at || null,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/scheduled-posts/:id
router.patch('/:id', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const post = await requirePost(req, res, wsId);
    if (!post) return;

    const fields = ['content','status','scheduled_at','account_id'];
    const sets   = [], vals = [post.id];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        vals.push(req.body[f] || null);
        sets.push(`${f} = $${vals.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    const { rows } = await db.query(
      `UPDATE scheduled_posts SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/scheduled-posts/:id
router.delete('/:id', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    const post = await requirePost(req, res, wsId);
    if (!post) return;
    await db.query('DELETE FROM scheduled_comments WHERE scheduled_post_id=$1', [post.id]);
    await db.query('DELETE FROM scheduled_posts WHERE id=$1', [post.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/scheduled-posts/:id/comments
router.post('/:id/comments', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    const post = await requirePost(req, res, wsId);
    if (!post) return;

    const { account_id, content, scheduled_at } = req.body;
    if (!account_id || !content?.trim())
      return res.status(400).json({ error: 'account_id and content required' });

    const { rows } = await db.query(`
      INSERT INTO scheduled_comments (workspace_id, account_id, scheduled_post_id, content, status, scheduled_at)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [
      post.workspace_id, account_id, post.id, content.trim(),
      scheduled_at ? 'scheduled' : 'draft',
      scheduled_at || null,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/scheduled-comments/:commentId
router.patch('/comments/:commentId', async (req, res) => {
  try {
    const wsId = req.body?.workspace_id || req.query.workspace_id;
    if (!wsId) return res.status(400).json({ error: 'workspace_id required' });

    const { rows: com } = await db.query(
      'SELECT * FROM scheduled_comments WHERE id=$1 AND workspace_id=$2',
      [req.params.commentId, wsId]
    );
    if (!com.length) return res.status(404).json({ error: 'Comment not found' });

    const fields = ['content','status','scheduled_at','account_id'];
    const sets = [], vals = [com[0].id];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        vals.push(req.body[f] || null);
        sets.push(`${f} = $${vals.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    const { rows } = await db.query(
      `UPDATE scheduled_comments SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/scheduled-comments/:commentId
router.delete('/comments/:commentId', async (req, res) => {
  try {
    const wsId = req.query.workspace_id;
    if (!wsId) return res.status(400).json({ error: 'workspace_id required' });
    await db.query(
      'DELETE FROM scheduled_comments WHERE id=$1 AND workspace_id=$2',
      [req.params.commentId, wsId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Helpers ──────────────────────────────────────────────────────────────────
async function requirePost(req, res, workspaceId) {
  if (!workspaceId) { res.status(400).json({ error: 'workspace_id required' }); return null; }
  const { rows } = await db.query(
    'SELECT * FROM scheduled_posts WHERE id=$1 AND workspace_id=$2',
    [req.params.id, workspaceId]
  );
  if (!rows.length) { res.status(404).json({ error: 'Post not found' }); return null; }
  return rows[0];
}

module.exports = router;
