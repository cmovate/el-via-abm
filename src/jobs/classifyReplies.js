/**
 * classifyReplies.js — runs every hour
 *
 * Finds 'replied' enrollments with unread messages and classifies
 * them as POSITIVE or NOT_POSITIVE using Claude Haiku.
 * Updates enrollment status and contact fields accordingly.
 */

const db    = require('../db');
const https = require('https');

async function classifyOne(enrollmentId, messageText) {
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    system: `Classify LinkedIn replies as POSITIVE (interested, wants call/demo/meeting, asks for info, says yes/sure) or NOT_POSITIVE (rejection, wrong person, auto-reply, out of office, not interested, polite decline). Reply ONLY: POSITIVE or NOT_POSITIVE`,
    messages: [{ role: 'user', content: `LinkedIn reply: "${messageText.slice(0, 500)}"` }]
  });

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  return result.content?.[0]?.text?.trim().toUpperCase();
}

async function handler() {
  // Get all replied enrollments not yet classified, that have messages
  const { rows: enrollments } = await db.query(`
    SELECT
      e.id AS enrollment_id,
      c.id AS contact_id,
      c.chat_id,
      c.first_name, c.last_name
    FROM enrollments e
    JOIN contacts c ON c.id = e.contact_id
    WHERE e.status = 'replied'
      AND (c.positive_reply IS NULL OR c.positive_reply = false)
      AND c.chat_id IS NOT NULL
    ORDER BY e.updated_at DESC
    LIMIT 30
  `);

  if (!enrollments.length) {
    console.log('[ClassifyReplies] No unclassified replied enrollments');
    return;
  }

  console.log(`[ClassifyReplies] Classifying ${enrollments.length} enrollments`);
  let classified = 0;

  for (const enr of enrollments) {
    try {
      // Get last inbound message
      const { rows: msgs } = await db.query(`
        SELECT m.content
        FROM inbox_messages m
        JOIN inbox_threads t ON t.id = m.thread_id
        WHERE t.thread_id = $1 AND m.direction = 'received'
        ORDER BY m.sent_at DESC LIMIT 1
      `, [enr.chat_id]);

      if (!msgs.length || !msgs[0].content?.trim()) continue;

      const verdict = await classifyOne(enr.enrollment_id, msgs[0].content);
      console.log(`[ClassifyReplies] ${enr.first_name} ${enr.last_name}: ${verdict}`);

      if (verdict === 'POSITIVE') {
        await db.query(`
          UPDATE enrollments SET status='positive_reply', updated_at=NOW()
          WHERE id=$1 AND status='replied'
        `, [enr.enrollment_id]);
        await db.query(`
          UPDATE contacts SET
            positive_reply=true, positive_reply_at=NOW(),
            conversation_stage='positive'
          WHERE id=$1 AND (positive_reply IS NULL OR positive_reply=false)
        `, [enr.contact_id]);
        classified++;
      }

      await new Promise(r => setTimeout(r, 300));
    } catch(e) {
      console.warn(`[ClassifyReplies] Error for enrollment #${enr.enrollment_id}: ${e.message}`);
    }
  }

  console.log(`[ClassifyReplies] Done — ${classified}/${enrollments.length} positive`);
}

module.exports = { handler };
