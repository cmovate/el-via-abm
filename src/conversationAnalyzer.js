/**
 * conversationAnalyzer.js
 *
 * Analyzes a full LinkedIn conversation thread and produces:
 *   - stage       : no_reply | cold_reply | engaged | meeting_intent | meeting_booked | not_interested | ghost
 *   - score       : 1-10 probability of converting to a meeting
 *   - signals     : [{type: 'positive'|'negative', text: '...'}]
 *   - suggested_action : what the sender should do next
 *   - exchange_depth   : total number of messages in the thread
 *   - prospect_msgs    : how many messages the prospect sent
 *   - summary     : one-sentence summary
 *
 * Uses the OpenAI API (OPENAI_API_KEY env var).
 * All output is in English regardless of conversation language.
 */

const db                  = require('./db');
const { getChatMessages } = require('./unipile');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL             = 'claude-haiku-4-5-20251001'; // fast + cheap for classification

/**
 * Build a compact, timestamped transcript from Unipile chat messages.
 * Format: "[Day N — YYYY-MM-DD] Sender: message text"
 */
function buildTranscript(messages, contactName) {
  if (!messages || !messages.length) return '(no messages)';

  const sorted = [...messages].sort((a, b) =>
    new Date(a.created_at || a.timestamp || 0) - new Date(b.created_at || b.timestamp || 0)
  );

  const first = new Date(sorted[0].created_at || sorted[0].timestamp || Date.now());

  return sorted.map(m => {
    const ts      = new Date(m.created_at || m.timestamp || Date.now());
    const dayN    = Math.floor((ts - first) / 86400000) + 1;
    const dateStr = ts.toISOString().slice(0, 10);
    const sender  = m.is_sender ? 'You' : (contactName || 'Prospect');
    const text    = (m.text || m.body || m.content || '').replace(/\n+/g, ' ').trim();
    return `[Day ${dayN} — ${dateStr}] ${sender}: ${text}`;
  }).join('\n');
}

/**
 * Call the OpenAI API (gpt-4o) and parse the JSON response.
 */
async function callClaude(transcript, contactName) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  const systemPrompt =
    'You are an expert B2B sales analyst evaluating LinkedIn outreach conversations.\n' +
    'Always respond ONLY with valid JSON — no preamble, no markdown fences.\n' +
    'All text fields must be in English regardless of the conversation language.';

  const userPrompt =
    `Analyze this LinkedIn outreach conversation with ${contactName || 'the prospect'}.\n\n` +
    `Full conversation transcript:\n${transcript}\n\n` +
    `Respond with this exact JSON structure:\n` +
    `{\n` +
    `  "stage": "<one of: no_reply | cold_reply | engaged | meeting_intent | meeting_booked | not_interested | ghost>",\n` +
    `  "score": <integer 1-10>,\n` +
    `  "signals": [\n` +
    `    { "type": "positive" | "negative", "text": "<specific signal observed>" }\n` +
    `  ],\n` +
    `  "suggested_action": "<concrete next step the sender should take>",\n` +
    `  "exchange_depth": <total number of messages in the thread>,\n` +
    `  "prospect_msgs": <number of messages sent by the prospect>,\n` +
    `  "summary": "<one sentence describing the conversation quality and status>"\n` +
    `}\n\n` +
    `Stage definitions:\n` +
    `- no_reply: prospect has not responded at all\n` +
    `- cold_reply: replied politely but showed no real interest (e.g. "thanks, not now")\n` +
    `- engaged: showing genuine interest, asking questions, sharing context\n` +
    `- meeting_intent: clear or implied desire to meet/talk\n` +
    `- meeting_booked: explicitly confirmed a meeting or call\n` +
    `- not_interested: clear rejection\n` +
    `- ghost: was previously engaged but has gone silent (2+ days no reply after engagement)\n\n` +
    `Score guide:\n` +
    `1-3: Very unlikely to convert (rejection, ghost, cold reply)\n` +
    `4-5: Uncertain / neutral\n` +
    `6-7: Moderate interest\n` +
    `8-9: High interest / meeting intent\n` +
    `10: Meeting already confirmed`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 512,
      system:     systemPrompt,
      messages: [
        { role: 'user', content: userPrompt + '\n\nRespond ONLY with valid JSON, no markdown.' },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0,200)}`);
  }

  const data = await res.json();
  const raw  = data.content?.[0]?.text || '';
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

/**
 * Main entry point.
 * Fetches the full chat thread, analyzes it, and writes results to the DB.
 *
 * @param {number} contactId
 * @param {string} accountId   Unipile account ID
 * @param {string} chatId      Unipile chat ID
 */
async function analyzeConversation(contactId, accountId, chatId) {
  // Guard: skip silently if no API key — don't keep retrying
  if (!ANTHROPIC_API_KEY) {
    console.warn(`[ConvAnalyzer] ANTHROPIC_API_KEY not set — skipping contact ${contactId}. Add it to Railway Variables.`);
    return null;
  }

  // 1. Load contact name from DB
  const { rows: contactRows } = await db.query(
    'SELECT first_name, last_name FROM contacts WHERE id = $1',
    [contactId]
  );
  if (!contactRows.length) throw new Error(`Contact ${contactId} not found`);
  const contact = contactRows[0];
  const name    = [contact.first_name, contact.last_name].filter(Boolean).join(' ');

  // 2. Fetch full chat history from Unipile
  let messages = [];
  try {
    messages = await getChatMessages(accountId, chatId);
  } catch (err) {
    console.warn(`[ConvAnalyzer] Could not fetch messages for chat ${chatId}: ${err.message}`);
  }

  // Skip if no messages — nothing to analyze
  if (!messages.length) {
    console.warn(`[ConvAnalyzer] No messages for contact ${contactId} chat ${chatId} — skipping`);
    return null;
  }

  // 3. Build transcript
  const transcript = buildTranscript(messages, name);

  // 4. Call Claude
  const result = await callClaude(transcript, name);

  // 5. Validate stage
  const VALID_STAGES = [
    'no_reply', 'cold_reply', 'engaged',
    'meeting_intent', 'meeting_booked', 'not_interested', 'ghost',
  ];
  const stage = VALID_STAGES.includes(result.stage) ? result.stage : 'cold_reply';
  const score = Math.min(10, Math.max(1, parseInt(result.score) || 5));

  // Positive stages that warrant marking as a positive reply
  const POSITIVE_STAGES = new Set(['engaged', 'meeting_intent', 'meeting_booked']);
  const isPositive = POSITIVE_STAGES.has(stage) || score >= 7;

  // 6. Save to DB
  await db.query(`
    UPDATE contacts SET
      conversation_stage       = $1,
      conversation_score       = $2,
      conversation_signals     = $3,
      conversation_analyzed_at = NOW(),
      positive_reply           = CASE WHEN $5 THEN true ELSE positive_reply END,
      positive_reply_at        = CASE WHEN $5 AND positive_reply_at IS NULL THEN NOW() ELSE positive_reply_at END
    WHERE id = $4
  `, [
    stage,
    score,
    JSON.stringify({
      signals:          result.signals          || [],
      suggested_action: result.suggested_action || '',
      exchange_depth:   result.exchange_depth   || messages.length,
      prospect_msgs:    result.prospect_msgs    || 0,
      summary:          result.summary          || '',
    }),
    contactId,
    isPositive,
  ]);

  console.log(
    `[ConvAnalyzer] contact=${contactId} stage=${stage} score=${score}` +
    ` exchange_depth=${result.exchange_depth} model=${MODEL}` +
    (isPositive ? ' ✅ POSITIVE' : '')
  );

  // Sync enrollment status
  if (isPositive) {
    await db.query(`
      UPDATE enrollments SET status = 'positive_reply', updated_at = NOW()
      WHERE contact_id = $1 AND status IN ('replied','messaged','approved')
    `, [contactId]).catch(() => {});
  }

  return { contactId, stage, score, isPositive };
}

module.exports = { analyzeConversation };
