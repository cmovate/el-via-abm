const express = require('express');
const router = express.Router();
const db = require('../db');
const { createRelationWebhook, createMessageWebhook, deleteWebhook, getAccountInfo, enrichProfile } = require('../unipile');
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

/**
 * Hydrate avatar_url + full_name for a Unipile LinkedIn account.
 *
 * /api/v1/accounts/:id returns basic account metadata but NO profile picture.
 * The picture lives on the LinkedIn user profile â we get it via enrichProfile
 * using the publicIdentifier from connection_params.im.publicIdentifier.
 */
async function hydrateAccountProfile(accountId) {
  try {
    // Step 1: get account metadata to extract the LinkedIn public identifier
    const account = await getAccountInfo(accountId);
    const identifier = account?.connection_params?.im?.publicIdentifier || null;
    const nameFromAccount = account?.name ||
      account?.connection_params?.im?.username ||
      account?.connection_params?.im?.name ||
      null;

    if (!identifier) {
      console.warn('[Avatar] No publicIdentifier for account', accountId,
        'â keys:', Object.keys(account || {}).join(', '));
      // Still save name if we have it
      if (nameFromAccount) {
        await db.query(
          'UPDATE unipile_accounts SET full_name = $1 WHERE account_id = $2 AND full_name IS NULL',
          [nameFromAccount, accountId]
        );
      }
      return;
    }

    // Step 2: fetch the LinkedIn user profile to get the picture
    const profile = await enrichProfile(accountId, 'https://www.linkedin.com/in/' + identifier, false);
    const avatarUrl =
      profile?.profile_picture_url ||
      profile?.profile_picture_url_large ||
      profile?.picture ||
      profile?.avatar ||
      profile?.photo_url ||
      null;
    const fullName = profile?.first_name && profile?.last_name
      ? (profile.first_name + ' ' + profile.last_name).trim()
      : (profile?.full_name || profile?.name || nameFromAccount || null);

    await db.query(
      'UPDATE unipile_accounts SET avatar_url = $1, full_name = $2 WHERE account_id = $3',
      [avatarUrl, fullName, accountId]
    );
    console.log('[Avatar] Hydrated', accountId, 'â name:', fullName, 'â avatar:', avatarUrl ? 'YES' : 'NO');
  } catch (err) {
    console.warn('[Avatar] Could not hydrate', accountId, ':', err.message);
  }
}

// GET /api/workspaces
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM workspaces ORDER BY created_at ASC');
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/workspaces
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    const { rows } = await db.query(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING *', [name.trim()]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/workspaces/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows: accounts } = await db.query(
      'SELECT account_id, webhook_id, msg_webhook_id FROM unipile_accounts WHERE workspace_id = $1', [req.params.id]);
    for (const acc of accounts) {
      if (acc.webhook_id)     await deleteWebhook(acc.webhook_id);
      if (acc.msg_webhook_id) await deleteWebhook(acc.msg_webhook_id);
    }
    await db.query('DELETE FROM workspaces WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/workspaces/:id/accounts
router.get('/:id/accounts', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM unipile_accounts WHERE workspace_id = $1 ORDER BY created_at ASC', [req.params.id]);
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/workspaces/:id/accounts
router.post('/:id/accounts', async (req, res) => {
  try {
    const { account_id, display_name, provider, status } = req.body;
    if (!account_id) return res.status(400).json({ error: 'account_id is required' });
    const existing = await db.query(
      'SELECT id FROM unipile_accounts WHERE workspace_id = $1 AND account_id = $2',
      [req.params.id, account_id]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'Account already connected to this workspace' });
    let webhookId = null;
    try {
      webhookId = await createRelationWebhook(account_id, SERVER_URL);
      console.log('[Workspace] Created webhook', webhookId, 'for account', account_id);
    } catch (err) {
      console.warn('[Workspace] Could not create webhook for', account_id, ':', err.message);
    }
    // Create separate message_received webhook per account
    let msgWebhookId = null;
    try {
      msgWebhookId = await createMessageWebhook(account_id, SERVER_URL);
      console.log('[Workspace] Created msg webhook', msgWebhookId, 'for account', account_id);
    } catch (err) {
      console.warn('[Workspace] Could not create msg webhook for', account_id, ':', err.message);
    }

    const { rows } = await db.query(
      `INSERT INTO unipile_accounts (workspace_id, account_id, display_name, provider, status, webhook_id, msg_webhook_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.id, account_id, display_name || account_id, provider || 'linkedin', status || 'connected', webhookId, msgWebhookId]);
    const saved = rows[0];
    hydrateAccountProfile(account_id); // fire-and-forget
    res.status(201).json(saved);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/workspaces/:id/accounts/:accountId/refresh-profile
router.post('/:id/accounts/:accountId/refresh-profile', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT account_id FROM unipile_accounts WHERE workspace_id = $1 AND account_id = $2',
      [req.params.id, req.params.accountId]);
    if (!rows.length) return res.status(404).json({ error: 'Account not found' });
    await hydrateAccountProfile(req.params.accountId);
    const { rows: updated } = await db.query(
      'SELECT * FROM unipile_accounts WHERE account_id = $1', [req.params.accountId]);
    res.json({ success: true, account: updated[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/workspaces/:id/accounts/:accountId/settings
router.patch('/:id/accounts/:accountId/settings', async (req, res) => {
  try {
    const { limits, company_page_url, company_page_urn } = req.body;
    if (!limits || typeof limits !== 'object')
      return res.status(400).json({ error: 'limits object required' });

    const settingsPatch = { limits };

    if (typeof company_page_url === 'string') {
      settingsPatch.company_page_url = company_page_url.trim();
    }
    if (typeof company_page_urn === 'string') {
      settingsPatch.company_page_urn = company_page_urn.trim();
    }

    // Auto-resolve company_page_url → company_page_urn if URL provided but URN missing
    if (settingsPatch.company_page_url && !settingsPatch.company_page_urn) {
      try {
        const { getCompanyProfile } = require('../unipile');
        const urlMatch = settingsPatch.company_page_url.match(/linkedin\.com\/company\/([^/?#]+)/);
        if (urlMatch) {
          const slug = urlMatch[1];
          const profile = await getCompanyProfile(req.params.accountId, slug).catch(() => null);
          const companyId =
            profile?.id ||
            profile?.company_id ||
            profile?.entity_urn?.match(/(\d+)$/)?.[1] ||
            profile?.urn?.match(/(\d+)$/)?.[1] ||
            null;
          if (companyId) {
            settingsPatch.company_page_urn = `urn:li:fsd_company:${companyId}`;
            console.log(`[Settings] Resolved company URN: ${settingsPatch.company_page_urn}`);
          }
        }
      } catch (e) {
        console.warn('[Settings] company URN lookup failed:', e.message);
        // Continue saving without URN — will be resolved on next save
      }
    }

    const { rows } = await db.query(
      `UPDATE unipile_accounts SET settings = settings || $1::jsonb
       WHERE workspace_id = $2 AND account_id = $3 RETURNING *`,
      [JSON.stringify(settingsPatch), req.params.id, req.params.accountId]);
    if (!rows.length) return res.status(404).json({ error: 'Account not found' });
    console.log('[Settings] Saved limits for account', req.params.accountId, ':', limits);
    res.json({ success: true, settings: rows[0].settings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/workspaces/:id/accounts/:accountId
// Full cascade: removes all account-specific data, preserves workspace contacts/campaigns.
router.delete('/:id/accounts/:accountId', async (req, res) => {
  const wsId  = req.params.id;
  const accId = req.params.accountId;
  const summary = {};
  try {
    // 1. Remove Unipile webhooks
    const { rows: acctRows } = await db.query(
      'SELECT webhook_id, msg_webhook_id FROM unipile_accounts WHERE workspace_id=$1 AND account_id=$2',
      [wsId, accId]);
    if (acctRows[0]?.webhook_id)     await deleteWebhook(acctRows[0].webhook_id).catch(()=>{});
    if (acctRows[0]?.msg_webhook_id) await deleteWebhook(acctRows[0].msg_webhook_id).catch(()=>{});

    // 2. Delete account row from unipile_accounts
    await db.query('DELETE FROM unipile_accounts WHERE workspace_id=$1 AND account_id=$2', [wsId, accId]);

    // 3. Profile views received on this account's profile
    const pv = await db.query('DELETE FROM profile_view_events WHERE account_id=$1 AND workspace_id=$2', [accId, wsId]);
    summary.profile_view_events = pv.rowCount;

    // 4. Company page view events
    const cpv = await db.query('DELETE FROM company_page_view_events WHERE account_id=$1 AND workspace_id=$2', [accId, wsId]).catch(()=>({rowCount:0}));
    summary.company_page_view_events = cpv.rowCount;

    // 5. Post reactions on this account's posts
    const pr = await db.query('DELETE FROM post_reactions WHERE account_id=$1 AND workspace_id=$2', [accId, wsId]);
    summary.post_reactions = pr.rowCount;

    // 6. User posts (the account's own LinkedIn posts + their reactions)
    const up = await db.query('DELETE FROM user_posts WHERE account_id=$1 AND workspace_id=$2', [accId, wsId]).catch(()=>({rowCount:0}));
    summary.user_posts = up.rowCount;

    // 7. Post comments on this account's posts
    await db.query('DELETE FROM post_comments WHERE account_id=$1 AND workspace_id=$2', [accId, wsId]).catch(()=>{});

    // 8. Inbox threads + messages for this account
    const { rows: threadIds } = await db.query(
      'SELECT id FROM inbox_threads WHERE account_id=$1 AND workspace_id=$2', [accId, wsId]);
    if (threadIds.length) {
      const ids = threadIds.map(r=>r.id);
      await db.query(`DELETE FROM inbox_messages WHERE thread_id = ANY($1::int[])`, [ids]);
      const it = await db.query('DELETE FROM inbox_threads WHERE account_id=$1 AND workspace_id=$2', [accId, wsId]);
      summary.inbox_threads  = it.rowCount;
      summary.inbox_messages = ids.length; // approximate
    }

    // 9. Remove account from contacts.connected_via (JSONB array field)
    // connected_via is [{account_id, name}, ...] — filter out this account
    const cv = await db.query(`
      UPDATE contacts
      SET connected_via = (
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements(connected_via) AS elem
        WHERE (elem->>'account_id') != $1
      )
      WHERE workspace_id=$2
        AND connected_via IS NOT NULL
        AND connected_via != 'null'::jsonb
        AND connected_via::text LIKE '%' || $1 || '%'
    `, [accId, wsId]);
    summary.contacts_connected_via_updated = cv.rowCount;

    // 10. Scheduled posts for this account
    await db.query('DELETE FROM scheduled_posts WHERE account_id=$1 AND workspace_id=$2', [accId, wsId]).catch(()=>{});

    res.json({ success: true, deleted: summary });
  } catch (err) {
    console.error('[DELETE account]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
