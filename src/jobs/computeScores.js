/**
 * src/jobs/computeScores.js — Hourly engagement score computation
 */
const db = require('../db');

const SIGNAL_SCORES = {
  profile_view: 1, post_like: 2, post_comment: 5,
  invite_received: 10, invite_accepted: 15, message_received: 8, company_follow: 10,
};

async function handler() {
  // Recompute contact scores from signals (last 30 days)
  await db.query(`
    UPDATE contacts c SET
      engagement_score = COALESCE(sub.score_30d, 0),
      engagement_score_7d = COALESCE(sub7.score_7d, 0)
    FROM (
      SELECT actor_contact_id,
             SUM(CASE type
               WHEN 'profile_view'    THEN 1
               WHEN 'post_like'       THEN 2
               WHEN 'post_comment'    THEN 5
               WHEN 'invite_received' THEN 10
               WHEN 'invite_accepted' THEN 15
               WHEN 'message_received' THEN 8
               WHEN 'company_follow'  THEN 10
               ELSE 1 END) AS score_30d
      FROM signals
      WHERE actor_contact_id IS NOT NULL
        AND occurred_at > NOW() - INTERVAL '30 days'
      GROUP BY actor_contact_id
    ) sub
    LEFT JOIN (
      SELECT actor_contact_id,
             SUM(CASE type
               WHEN 'profile_view'    THEN 1
               WHEN 'post_like'       THEN 2
               WHEN 'post_comment'    THEN 5
               WHEN 'invite_received' THEN 10
               WHEN 'invite_accepted' THEN 15
               WHEN 'message_received' THEN 8
               WHEN 'company_follow'  THEN 10
               ELSE 1 END) AS score_7d
      FROM signals
      WHERE actor_contact_id IS NOT NULL
        AND occurred_at > NOW() - INTERVAL '7 days'
      GROUP BY actor_contact_id
    ) sub7 ON sub7.actor_contact_id = sub.actor_contact_id
    WHERE c.id = sub.actor_contact_id
  `).catch(err => console.warn('[ComputeScores] contacts:', err.message));

  // Recompute target_account scores
  await db.query(`
    UPDATE target_accounts ta SET
      engagement_score    = COALESCE(sub.score_30d, 0),
      engagement_score_7d = COALESCE(sub7.score_7d, 0)
    FROM (
      SELECT actor_target_account_id,
             SUM(CASE type
               WHEN 'profile_view'    THEN 1
               WHEN 'post_like'       THEN 2
               WHEN 'post_comment'    THEN 5
               WHEN 'invite_received' THEN 10
               WHEN 'invite_accepted' THEN 15
               WHEN 'message_received' THEN 8
               WHEN 'company_follow'  THEN 10
               ELSE 1 END) AS score_30d
      FROM signals
      WHERE actor_target_account_id IS NOT NULL
        AND occurred_at > NOW() - INTERVAL '30 days'
      GROUP BY actor_target_account_id
    ) sub
    LEFT JOIN (
      SELECT actor_target_account_id,
             SUM(CASE type WHEN 'profile_view' THEN 1 WHEN 'post_like' THEN 2
               WHEN 'post_comment' THEN 5 WHEN 'invite_received' THEN 10
               WHEN 'invite_accepted' THEN 15 WHEN 'message_received' THEN 8
               WHEN 'company_follow' THEN 10 ELSE 1 END) AS score_7d
      FROM signals
      WHERE actor_target_account_id IS NOT NULL
        AND occurred_at > NOW() - INTERVAL '7 days'
      GROUP BY actor_target_account_id
    ) sub7 ON sub7.actor_target_account_id = sub.actor_target_account_id
    WHERE ta.id = sub.actor_target_account_id
  `).catch(err => console.warn('[ComputeScores] target_accounts:', err.message));
}

module.exports = { handler };
