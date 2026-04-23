/**
 * src/routes/webhooks-v2.js
 *
 * New webhook handler — handles all 8 Unipile event types.
 * Each event → enqueued as a pg-boss job for async processing.
 *
 * Replaces: src/routes/webhooks.js
 *
 * Events:
 *   new_relation          — invite accepted
 *   message_received      — message received
 *   profile_view          — someone viewed our profile
 *   reaction_received     — like on our post
 *   comment_received      — comment on our post
 *   invitation_received   — someone sent us a connection request
 *   company_follow        — someone followed our company page
 *   post_published        — our scheduled post was published
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'elvia-secret';

const HANDLED_EVENTS = new Set([
  'new_relation',
  'message_received',
  'profile_view',
  'reaction_received',
  'comment_received',
  'invitation_received',
  'company_follow',
  'post_published',
]);

router.post('/unipile', async (req, res) => {
  // Validate secret
  const secret = req.headers['x-webhook-secret'];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    console.warn('[Webhook] Invalid secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body;
  const event   = payload?.event;

  // Respond immediately — process async
  res.json({ received: true });

  if (!event) return;

  console.log(`[Webhook] ${event} | account: ${payload?.account_id}`);

  if (!HANDLED_EVENTS.has(event)) {
    console.log(`[Webhook] Unhandled event: ${event}`);
    return;
  }

  try {
    // Find workspace_id from account_id
    const { rows } = await db.query(
      'SELECT workspace_id FROM unipile_accounts WHERE account_id = $1 LIMIT 1',
      [payload.account_id]
    );

    const workspaceId = rows[0]?.workspace_id;
    if (!workspaceId) {
      console.warn(`[Webhook] No workspace for account ${payload.account_id}`);
      return;
    }

    // Enqueue signal for async processing
    const { enqueueSignal } = require('../jobs/index');
    await enqueueSignal(payload, workspaceId);

  } catch (err) {
    console.error('[Webhook] Error enqueuing signal:', err.message);
  }
});

module.exports = router;
