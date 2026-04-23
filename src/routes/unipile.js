const express = require('express');
const router = express.Router();
const { getAccounts, enrichProfile, getChatsByAttendee, sendMessage, startDirectMessage } = require('../unipile');

const UNIPILE_DSN     = process.env.UNIPILE_DSN;
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;

async function rawGet(endpoint) {
  const url = UNIPILE_DSN + endpoint;
  const res = await fetch(url, {
    headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json' },
  });
  const text = await res.text();
  return { status: res.status, data: JSON.parse(text) };
}

// GET /api/unipile/accounts
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await getAccounts();
    res.json({ items: accounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/unipile/list-chats?account_id=&limit=5
router.get('/list-chats', async (req, res) => {
  try {
    const { account_id, limit = '5' } = req.query;
    if (!account_id) return res.status(400).json({ error: 'account_id required' });
    const params = new URLSearchParams({ account_id, limit });
    const { status, data } = await rawGet('/api/v1/chats?' + params);
    const items = (data.items || []).map(c => ({
      id: c.id,
      provider_id: c.provider_id,
      attendee_provider_id: c.attendee_provider_id,
      name: c.name,
      type: c.type,
    }));
    res.json({ status, count: items.length, items, cursor: data.cursor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/unipile/chat-by-provider?account_id=&provider_id=ACoXXX
router.get('/chat-by-provider', async (req, res) => {
  try {
    const { account_id, provider_id, limit = '200' } = req.query;
    if (!account_id || !provider_id) return res.status(400).json({ error: 'account_id and provider_id required' });
    const direct = await rawGet('/api/v1/chats/' + encodeURIComponent(provider_id) + '?account_id=' + encodeURIComponent(account_id));
    if (direct.status === 200) {
      const c = direct.data;
      return res.json({ method: 'direct', found: true, chat_id: c.id, attendee_provider_id: c.attendee_provider_id });
    }
    const params = new URLSearchParams({ account_id, limit });
    const list = await rawGet('/api/v1/chats?' + params);
    const chats = list.data.items || [];
    const match = chats.find(c => c.attendee_provider_id === provider_id);
    res.json({
      method: 'list_scan',
      found: !!match,
      total_checked: chats.length,
      chat_id: match ? match.id : null,
      sample: chats.slice(0, 5).map(c => ({ attendee_provider_id: c.attendee_provider_id, name: c.name })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/unipile/enrich-test
router.post('/enrich-test', async (req, res) => {
  try {
    const { account_id, li_profile_url } = req.body;
    if (!account_id || !li_profile_url) return res.status(400).json({ error: 'account_id and li_profile_url required' });
    const profile = await enrichProfile(account_id, li_profile_url);
    const dist = String(profile.network_distance || '').toUpperCase();
    const already_connected =
      dist === 'FIRST_DEGREE' || dist === 'DISTANCE_1' || dist === '1' ||
      profile.relation_type === 1 || profile.relation_type === '1' ||
      profile.degree === 1 || profile.degree === '1' ||
      profile.connection_degree === 1 || profile.connection_degree === '1';
    const exp = Array.isArray(profile.work_experience) && profile.work_experience.length > 0 ? profile.work_experience[0] : null;
    let has_chat_history = null, chat_id = null, chats_error = null;
    if (already_connected && profile.provider_id) {
      try {
        const chats = await getChatsByAttendee(account_id, profile.provider_id);
        has_chat_history = chats.length > 0;
        chat_id = has_chat_history ? (chats[0].id || null) : null;
      } catch (err) { chats_error = err.message; }
    }
    res.json({
      extracted: {
        provider_id: profile.provider_id || null,
        first_name: profile.first_name || null, last_name: profile.last_name || null,
        headline: profile.headline || null, location: profile.location || null,
        title: exp?.position || exp?.title || profile.headline || null,
        company: (typeof exp?.company === 'string' ? exp.company : exp?.company?.name) || exp?.company_name || null,
        company_id: exp?.company_id ? String(exp.company_id) : null,
        email: profile.contact_info?.emails?.[0] || profile.emails?.[0] || null,
        already_connected, network_distance: profile.network_distance,
        has_chat_history, chat_id, chats_error,
      },
      raw_keys: Object.keys(profile),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/unipile/send-test-message
// Body: { account_id, provider_id, text }
// Sends a test message to a LinkedIn contact (finds/creates chat automatically)
router.post('/send-test-message', async (req, res) => {
  try {
    const { account_id, provider_id, text } = req.body;
    if (!account_id || !provider_id || !text) {
      return res.status(400).json({ error: 'account_id, provider_id, and text are required' });
    }

    // Check if a chat already exists
    const existingChats = await getChatsByAttendee(account_id, provider_id);
    let result, method;

    if (existingChats.length > 0) {
      const chatId = existingChats[0].id;
      result = await sendMessage(account_id, chatId, text);
      method = 'existing_chat';
    } else {
      result = await startDirectMessage(account_id, provider_id, text);
      method = 'new_chat';
    }

    res.json({
      success: true,
      method,
      chat_id: result?.id || result?.chat_id || existingChats[0]?.id || null,
      result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// GET /api/unipile/chat-messages?account_id=&chat_id=&limit=5
// Returns the last N messages from a chat — used to check if conversation has messages
router.get('/chat-messages', async (req, res) => {
  try {
    const { account_id, chat_id, limit = '5' } = req.query;
    if (!account_id || !chat_id) return res.status(400).json({ error: 'account_id and chat_id required' });
    const params = new URLSearchParams({ account_id, limit });
    const { status, data } = await rawGet(`/api/v1/chats/${encodeURIComponent(chat_id)}/messages?${params}`);
    const items = data?.items || [];
    // Return minimal info: did any message arrive, who sent it
    const msgs = items.map(m => ({
      sender_id: m.sender_id,
      is_sender: m.is_sender,
      text: (m.text || '').substring(0, 120),
      timestamp: m.created_at || m.timestamp,
    }));
    res.json({ status, total: items.length, messages: msgs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
