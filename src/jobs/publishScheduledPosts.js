/**
 * src/jobs/publishScheduledPosts.js — Publish due posts/comments (every 1 min)
 */
const db = require('../db');
const unipile = require('../unipile');

async function handler() {
  // Posts
  const { rows: posts } = await db.query(`
    SELECT id, account_id, content, workspace_id
    FROM scheduled_posts
    WHERE status = 'scheduled' AND scheduled_at <= NOW()
    ORDER BY scheduled_at ASC
    LIMIT 10
  `);

  for (const post of posts) {
    try {
      // Mark as publishing first (prevents double-publish on crash)
      await db.query(`UPDATE scheduled_posts SET status='publishing' WHERE id=$1`, [post.id]);

      const result = await unipile.request('/api/v1/posts', {
        method: 'POST',
        headers: { 'X-Account-Id': post.account_id },
        body: JSON.stringify({ text: post.content }),
      });

      const postId = result?.id || result?.post_id || null;
      await db.query(
        `UPDATE scheduled_posts SET status='published', published_at=NOW(), unipile_post_id=$2 WHERE id=$1`,
        [post.id, postId]
      );
      console.log(`[PublishPosts] Published post #${post.id}`);
    } catch (err) {
      await db.query(
        `UPDATE scheduled_posts SET status='failed', error=$2 WHERE id=$1`,
        [post.id, err.message]
      );
      console.error(`[PublishPosts] Failed post #${post.id}: ${err.message}`);
    }
  }

  // Comments
  const { rows: comments } = await db.query(`
    SELECT id, account_id, post_url, scheduled_post_id, content
    FROM scheduled_comments
    WHERE status = 'scheduled' AND scheduled_at <= NOW()
    ORDER BY scheduled_at ASC
    LIMIT 10
  `);

  for (const comment of comments) {
    try {
      await db.query(`UPDATE scheduled_comments SET status='publishing' WHERE id=$1`, [comment.id]);

      // Resolve post_url from scheduled_post if needed
      let postUrl = comment.post_url;
      if (!postUrl && comment.scheduled_post_id) {
        const { rows } = await db.query(
          `SELECT unipile_post_id FROM scheduled_posts WHERE id=$1`,
          [comment.scheduled_post_id]
        );
        postUrl = rows[0]?.unipile_post_id || null;
      }

      if (!postUrl) throw new Error('No post URL/ID');

      const socialId = postUrl.split(':').pop(); // extract ID from URN

      await unipile.commentPost(comment.account_id, socialId, comment.content, null);

      await db.query(
        `UPDATE scheduled_comments SET status='published', published_at=NOW() WHERE id=$1`,
        [comment.id]
      );
      console.log(`[PublishPosts] Published comment #${comment.id}`);
    } catch (err) {
      await db.query(
        `UPDATE scheduled_comments SET status='failed', error=$2 WHERE id=$1`,
        [comment.id, err.message]
      );
      console.error(`[PublishPosts] Failed comment #${comment.id}: ${err.message}`);
    }
  }
}

module.exports = { handler };
