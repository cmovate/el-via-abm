const UNIPILE_DSN     = process.env.UNIPILE_DSN;
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY;

const RETRY_DELAYS = [3000, 8000, 15000];

async function request(endpoint, options = {}, _attempt = 0) {
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) {
    throw new Error('UNIPILE_DSN and UNIPILE_API_KEY must be set in .env');
  }
  const url = `${UNIPILE_DSN}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'X-API-KEY':    UNIPILE_API_KEY,
      'Content-Type': 'application/json',
      'accept':       'application/json',
      ...options.headers,
    },
  });

  if ((res.status === 503 || res.status === 429) && _attempt < RETRY_DELAYS.length) {
    const delay = RETRY_DELAYS[_attempt];
    console.warn(`[Unipile] ${res.status} on ${endpoint} \u2014 retry ${_attempt + 1}/${RETRY_DELAYS.length} in ${delay}ms`);
    await new Promise(r => setTimeout(r, delay));
    return request(endpoint, options, _attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Unipile ${res.status}: ${text}`);
  }
  return res.json();
}

async function getAccounts() {
  const data  = await request('/api/v1/accounts');
  const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
  return items.filter(acc => {
    const p = String(acc?.provider || '').toLowerCase();
    return p.includes('linkedin') || p === '';
  });
}

/**
 * Fetch a single Unipile account object (includes name, picture, etc.).
 * Used to hydrate avatar_url / full_name on our unipile_accounts row.
 *
 * Returned object typically contains:
 *   { id, name, type, provider, sources, picture, ... }
 */
async function getAccountInfo(accountId) {
  return request(`/api/v1/accounts/${encodeURIComponent(accountId)}`);
}

async function searchPeople(accountId, companyName, titles = []) {
  const keywords = titles.length
    ? `${titles.join(' OR ')} "${companyName}"`
    : `"${companyName}"`;
  const data = await request(
    `/api/v1/linkedin/search?account_id=${encodeURIComponent(accountId)}`,
    { method: 'POST', body: JSON.stringify({ api: 'classic', category: 'people', keywords, limit: 10 }) }
  );
  return Array.isArray(data?.items) ? data.items : [];
}

async function searchPeopleByKeywords(accountId, keywords, limit = 50, cursor = null) {
  const body = { api: 'classic', category: 'people', keywords, limit };
  if (cursor) body.cursor = cursor;
  const data = await request(
    `/api/v1/linkedin/search?account_id=${encodeURIComponent(accountId)}`,
    { method: 'POST', body: JSON.stringify(body) }
  );
  return {
    items:      Array.isArray(data?.items) ? data.items : [],
    cursor:     data?.paging?.cursor || null,
    totalCount: data?.paging?.total_count || 0,
  };
}

async function lookupCompany(accountId, slugOrId) {
  if (/^\d+$/.test(slugOrId)) return { id: slugOrId, name: slugOrId };
  const keywords = slugOrId.replace(/-/g, ' ');
  let items = [];
  try {
    const data = await request(
      `/api/v1/linkedin/search?account_id=${encodeURIComponent(accountId)}`,
      { method: 'POST', body: JSON.stringify({ api: 'classic', category: 'companies', keywords, limit: 5 }) }
    );
    items = Array.isArray(data?.items) ? data.items : [];
  } catch (err) {
    console.warn(`[Unipile] lookupCompany failed for "${slugOrId}": ${err.message}`);
    return null;
  }
  if (!items.length) return null;
  const exact = items.find(c => {
    const cn = String(c.universal_name || c.vanity_name || c.slug || c.name || '').toLowerCase();
    return cn === slugOrId.toLowerCase() || cn === keywords.toLowerCase();
  });
  const company = exact || items[0];
  const id =
    company.id ||
    company.company_id ||
    company.entity_urn?.match(/(\d+)$/)?.[1] ||
    company.urn?.match(/(\d+)$/)?.[1] ||
    null;
  const name = company.name || company.company_name || keywords;
  console.log(`[Unipile] lookupCompany: "${slugOrId}" \u2192 id=${id} name="${name}"`);
  return id ? { id: String(id), name } : { id: null, name };
}

async function searchPeopleByCompany(accountId, companyId, companyName, titles = [], limit = 10, locationId = null) {
  const body = { api: 'classic', category: 'people', limit };

  // Set company filter (top-level per Unipile docs)
  if (companyId) {
    body.company = [String(companyId)];
  }

  // Set location filter (top-level per Unipile docs)
  if (locationId) {
    body.location = [String(locationId)];
  }

  // Keywords: job titles joined with OR, or fall back to company name
  if (titles.length) {
    const titleKeywords = titles.join(' OR ');
    body.keywords = companyId ? titleKeywords : '(' + titleKeywords + ') "' + companyName + '"';
  } else if (!companyId) {
    body.keywords = '"' + companyName + '"';
  }

  const data = await request(
    '/api/v1/linkedin/search?account_id=' + encodeURIComponent(accountId),
    { method: 'POST', body: JSON.stringify(body) }
  );
  return Array.isArray(data?.items) ? data.items : [];
}

async function getChatMessages(accountId, chatId, limit = 200) {
  const params = new URLSearchParams({ account_id: accountId, limit: String(Math.min(limit, 200)) });
  const data  = await request(`/api/v1/chats/${encodeURIComponent(chatId)}/messages?${params}`);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.reverse();
}

async function enrichProfile(accountId, li_profile_url, notify = false) {
  const match      = li_profile_url.match(/linkedin\.com\/in\/([^/?#]+)/);
  const identifier = match ? match[1] : li_profile_url;
  const params     = new URLSearchParams({ account_id: accountId, linkedin_sections: '*', notify: notify ? 'true' : 'false' });
  return request(`/api/v1/users/${encodeURIComponent(identifier)}?${params}`);
}

async function viewProfile(accountId, identifier) {
  const params = new URLSearchParams({ account_id: accountId, linkedin_sections: '*_preview', notify: 'true' });
  return request(`/api/v1/users/${encodeURIComponent(identifier)}?${params}`);
}

async function getUserPosts(accountId, providerId, limit = 50, isCompany = false) {
  const params = new URLSearchParams({ account_id: accountId, limit: String(limit) });
  if (isCompany) params.set('is_company', 'true');
  const data = await request(`/api/v1/users/${encodeURIComponent(providerId)}/posts?${params}`);
  return Array.isArray(data?.items) ? data.items : [];
}

async function getUserComments(accountId, providerId, limit = 50) {
  const params = new URLSearchParams({ account_id: accountId, limit: String(limit) });
  const data = await request(`/api/v1/users/${encodeURIComponent(providerId)}/comments?${params}`);
  return Array.isArray(data?.items) ? data.items : [];
}

async function likePost(accountId, postSocialId, commentId, asOrganization, reactionType = 'like') {
  const body = { account_id: accountId, post_id: postSocialId, reaction_type: reactionType };
  if (commentId)      body.comment_id      = commentId;
  if (asOrganization) body.as_organization = asOrganization;
  return request('/api/v1/posts/reaction', { method: 'POST', body: JSON.stringify(body) });
}

async function createRelationWebhook(accountId, serverUrl) {
  const data = await request('/api/v1/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      source: 'users', name: `new_relation_${accountId}`,
      request_url: `${serverUrl}/api/webhooks/unipile`,
      account_ids: [accountId], events: ['new_relation'], format: 'json',
      headers: [
        { key: 'Content-Type',     value: 'application/json' },
        { key: 'X-Webhook-Secret', value: process.env.WEBHOOK_SECRET || 'elvia-secret' },
      ],
    }),
  });
  return data.webhook_id;
}

async function deleteWebhook(webhookId) {
  try { await request(`/api/v1/webhooks/${webhookId}`, { method: 'DELETE' }); }
  catch (err) { console.warn(`[Unipile] Could not delete webhook ${webhookId}: ${err.message}`); }
}

async function sendInvitation(accountId, linkedinUrl, message = '') {
  const match      = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
  const identifier = match ? match[1] : linkedinUrl;
  const body       = { account_id: accountId, provider_id: identifier };
  if (message) body.message = message;
  return request('/api/v1/users/invite', { method: 'POST', body: JSON.stringify(body) });
}

async function withdrawInvitation(accountId, linkedinUrl) {
  const match      = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
  const identifier = match ? match[1] : linkedinUrl;
  return request(
    `/api/v1/users/invite?account_id=${encodeURIComponent(accountId)}&provider_id=${encodeURIComponent(identifier)}`,
    { method: 'DELETE' }
  );
}

async function deleteChat(accountId, chatId) {
  return request(`/api/v1/chats/${encodeURIComponent(chatId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ account_id: accountId }),
  });
}

async function deleteMessage(accountId, messageId) {
  return request(`/api/v1/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ account_id: accountId }),
  });
}

async function sendMessage(accountId, chatId, text) {
  return request(`/api/v1/chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST', body: JSON.stringify({ account_id: accountId, text }),
  });
}

async function startDirectMessage(accountId, providerId, text) {
  // Unipile POST /api/v1/chats requires multipart/form-data, not JSON
  const form = new FormData();
  form.append('account_id', accountId);
  // If providerId is a slug (not ACoXXX), send as LinkedIn profile URL
  if (providerId && !providerId.startsWith('ACo')) {
    const liUrl = providerId.startsWith('http')
      ? providerId
      : `https://www.linkedin.com/in/${providerId}`;
    form.append('attendees_ids', liUrl);
  } else {
    form.append('attendees_ids', providerId);
  }
  form.append('text', text);
  const url = `${UNIPILE_DSN}/api/v1/chats`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json' },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Unipile ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function getChatsByAttendee(accountId, providerId) {
  // ONLY use /api/v1/users/{provider_id}/chats — direct, reliable lookup.
  // Fallback scan was REMOVED — scanning 200 chats returns false positives (wrong person).
  try {
    const params = new URLSearchParams({ account_id: accountId });
    const data = await request(`/api/v1/users/${encodeURIComponent(providerId)}/chats?${params}`);
    const items = Array.isArray(data?.items) ? data.items : [];
    if (items.length > 0) {
      console.log(`[Unipile] getChatsByAttendee: found ${items.length} chat(s) for ${providerId}`);
    }
    return items;
  } catch(e) {
    console.log(`[Unipile] getChatsByAttendee: no chat found for ${providerId} (${e.message})`);
    return [];
  }
}

async function sendCompanyFollowInvites(accountId, companyPageUrn, memberUrns) {
  if (!memberUrns.length) return;
  const companyIdMatch = companyPageUrn.match(/(\d+)$/);
  if (!companyIdMatch) throw new Error(`Invalid companyPageUrn: ${companyPageUrn}`);
  const companyId = companyIdMatch[1];
  const elements = memberUrns.map(urn => ({ inviteeMember: urn, genericInvitationType: 'ORGANIZATION' }));
  return request('/api/v1/linkedin', {
    method: 'POST',
    body: JSON.stringify({
      account_id: accountId,
      request_url: 'https://www.linkedin.com/voyager/api/voyagerRelationshipsDashInvitations',
      method: 'POST', body: { elements },
      query_params: { inviter: `(organizationUrn:urn%3Ali%3Afsd_company%3A${companyId})` },
      headers: { 'x-restli-method': 'batch_create' },
      encoding: false,
    }),
  });
}


/**
 * Search for 1st-degree LinkedIn connections working at a specific company.
 * Uses DISTANCE_1 filter so results are only direct connections.
 */
async function searchFirstDegreeAtCompany(accountId, companyId, limit = 50) {
  const data = await request(
    '/api/v1/linkedin/search?account_id=' + encodeURIComponent(accountId),
    {
      method: 'POST',
      body: JSON.stringify({
        api: 'classic',
        category: 'people',
        filters: {
          currentCompany: [String(companyId)],
          network_distance: ['DISTANCE_1']
        },
        limit
      })
    }
  );
  return Array.isArray(data?.items) ? data.items : [];
}

async function getCompanyProfile(accountId, slug) {
  const data = await request(
    '/api/v1/linkedin/company/' + encodeURIComponent(slug) + '?account_id=' + encodeURIComponent(accountId),
    { method: 'GET' }
  );
  return data;
}

async function searchPeopleAdvanced(accountId, opts) {
  const body = { api: 'classic', category: 'people', limit: opts.limit || 50 };
  if (opts.keywords) body.keywords = opts.keywords;
  if (opts.company && opts.company.length) body.company = opts.company.map(String);
  if (opts.industry && opts.industry.length) body.industry = opts.industry.map(String);
  if (opts.location && opts.location.length) body.location = opts.location.map(String);
  if (opts.advanced_keywords) body.advanced_keywords = opts.advanced_keywords;
  if (opts.cursor) body.cursor = opts.cursor;
  const data = await request(
    `/api/v1/linkedin/search?account_id=${encodeURIComponent(accountId)}`,
    { method: 'POST', body: JSON.stringify(body) }
  );
  return {
    items:      Array.isArray(data?.items) ? data.items : [],
    cursor:     data?.paging?.cursor || null,
    totalCount: data?.paging?.total_count || 0,
  };
}


async function getPost(accountId, postId) {
  const params = new URLSearchParams({ account_id: accountId });
  const data = await request(`/api/v1/posts/${encodeURIComponent(postId)}?${params}`);
  return data;
}


async function commentPost(accountId, postId, text, commentId) {
  const form = new URLSearchParams();
  form.append('account_id', accountId);
  form.append('text', text);
  if (commentId) form.append('comment_id', commentId);

  const data = await request(`/api/v1/posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  return data;
}


// Creates a per-account 'message_received' webhook (separate from the new_relation webhook)
async function createMessageWebhook(accountId, serverUrl) {
  const data = await request('/api/v1/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      source: 'messaging',
      name: `msg_received_${accountId}`,
      request_url: `${serverUrl}/api/webhooks/unipile`,
      account_ids: [accountId],
      events: ['message_received'],
      format: 'json',
      headers: [
        { key: 'Content-Type',     value: 'application/json' },
        { key: 'x-webhook-secret', value: process.env.WEBHOOK_SECRET || 'elvia-secret' }
      ]
    })
  });
  return data?.webhook_id || data?.id || null;
}

/**
 * Search for active job postings at a specific LinkedIn company.
 * Uses category: 'jobs' which is supported by Unipile classic API.
 * When company_linkedin_id is available, filter by company ID directly.
 * Otherwise fall back to keywords search with company name.
 */
async function getCompanyJobs(accountId, companyId, companyName, limit = 40) {
  const body = { api: 'classic', category: 'jobs', limit };

  if (companyId) {
    // Filter directly by company ID — most precise
    body.company = [String(companyId)];
  } else if (companyName) {
    // Fallback: search by company name as keyword
    body.keywords = companyName;
  } else {
    return [];
  }

  console.log(`[getCompanyJobs] company="${companyName}" id=${companyId}`);
  const data = await request(
    `/api/v1/linkedin/search?account_id=${encodeURIComponent(accountId)}`,
    { method: 'POST', body: JSON.stringify(body) }
  );
  const items = Array.isArray(data?.items) ? data.items : [];
  console.log(`[getCompanyJobs] returned ${items.length} jobs`);
  if (items.length > 0) console.log(`[getCompanyJobs] sample:`, JSON.stringify(items[0]).slice(0, 300));
  return items;
}


/**
 * Like the most recent post of a LinkedIn user.
 * Used by processEnrollments engagement actions.
 */
async function likeLatestPost(accountId, providerId) {
  // Get user's recent posts
  const posts = await getUserPosts(accountId, providerId, 5);
  if (!posts.length) {
    console.log(`[Unipile] likeLatestPost: no posts found for ${providerId}`);
    return null;
  }
  const post = posts[0];
  const postId = post.social_id || post.id;
  if (!postId) return null;
  return likePost(accountId, postId, null, false, 'like');
}

/**
 * Follow a company page given its LinkedIn URL or ID.
 * Used by processEnrollments engagement actions.
 */
async function followCompany(accountId, liCompanyUrl) {
  // Extract company ID/slug from URL
  const match = String(liCompanyUrl || '').match(/linkedin\.com\/company\/([^/?#]+)/);
  if (!match) return null;
  const companySlug = match[1];
  // Use the profile lookup to get the company URN, then follow
  const profile = await request(`/api/v1/users/${encodeURIComponent('company:' + companySlug)}?account_id=${encodeURIComponent(accountId)}`).catch(() => null);
  const urn = profile?.company_urn || profile?.entity_urn || null;
  if (!urn) return null;
  return request('/api/v1/users/follow', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, user_id: urn }),
  });
}


async function searchPostsByKeywords(accountId, keywords, opts = {}) {
  const { limit = 20, sortBy, datePosted, cursor } = opts;
  const body = { api: 'classic', category: 'posts', keywords, limit };
  if (sortBy)     body.sort_by     = sortBy;
  if (datePosted) body.date_posted = datePosted;
  if (cursor)     body.cursor      = cursor;
  // Use direct fetch (NO retry) so 429 returns immediately to frontend
  // Retrying 429 blocks the HTTP request for 26s and causes Railway timeouts
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) throw new Error('Unipile not configured');
  const res = await fetch(`${UNIPILE_DSN}/api/v1/linkedin/search?account_id=${encodeURIComponent(accountId)}`, {
    method: 'POST',
    headers: { 'X-API-KEY': UNIPILE_API_KEY, 'Content-Type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    // Return empty result with flag instead of throwing — lets caller try next account
    return { posts: [], cursor: null, total: 0, rateLimited: true };
  }
  if (!res.ok) { const t = await res.text(); throw new Error(`Unipile ${res.status}: ${t.slice(0,200)}`); }
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    posts: items.map(p => ({
      id:              p.id,
      title:           (p.text || '').split('\n')[0].trim().slice(0, 120),
      snippet:         (p.text || '').slice(0, 300),
      author:          p.author?.name || '',
      author_headline: p.author?.headline || '',
      author_url:      p.author?.public_identifier ? `https://linkedin.com/in/${p.author.public_identifier}` : null,
      post_url:        p.share_url || null,
      date_label:      p.date || null,
      reactions:       p.reaction_counter  || 0,
      comments:        p.comment_counter   || 0,
      reposts:         p.repost_counter    || 0,
    })),
    cursor:     data?.cursor || null,
    total:      data?.paging?.total_count || items.length,
  };
}

module.exports = {
  _request: request,
  getAccounts,
  getAccountInfo,
  searchPeople,
  searchPeopleByKeywords,
  searchPostsByKeywords,
  searchPeopleByCompany,
  searchFirstDegreeAtCompany,
  lookupCompany,
  getChatMessages,
  deleteChat,
  deleteMessage,
  enrichProfile,
  viewProfile,
  getUserPosts,
  getUserComments,
  likePost,
  createRelationWebhook,
  deleteWebhook,
  createMessageWebhook,
  sendInvitation,
  withdrawInvitation,
  sendMessage,
  startDirectMessage,
  getChatsByAttendee,
  sendCompanyFollowInvites,
  likeLatestPost,
  followCompany,
  getCompanyProfile,
  searchPeopleAdvanced,
  request,
  request,
  getCompanyJobs,

  getPost,
  commentPost,
};
