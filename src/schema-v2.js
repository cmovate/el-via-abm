/**
 * schema-v2.js
 *
 * Phase 1 schema migrations — new tables only.
 * Runs on server startup via initSchemaV2().
 * All migrations are idempotent (IF NOT EXISTS / IF NOT EXISTS).
 *
 * New tables:
 *   sequences           — reusable outreach scripts
 *   sequence_steps      — steps within a sequence
 *   enrollments         — state machine: contact × campaign
 *   enrollment_messages — what was actually sent per step
 *   target_accounts     — companies as first-class entities
 *   signals             — all inbound LinkedIn events
 *   scheduled_posts     — post scheduler DB persistence
 *   scheduled_comments  — comments to post on a schedule
 */

const db = require('./db');

async function s(label, fn) {
  try {
    await fn();
    // console.log(`[SchemaV2] ✓ ${label}`);
  } catch (err) {
    if (err.message && (err.message.includes('already exists') || err.message.includes('duplicate'))) {
      // idempotent — already ran
    } else {
      console.error(`[SchemaV2] ✗ ${label}: ${err.message}`);
    }
  }
}

async function initSchemaV2() {
  console.log('[SchemaV2] Running v2 migrations...');

  // ── Target Accounts (companies as ABM entities) ──────────────────────────
  await s('target_accounts', () => db.query(`
    CREATE TABLE IF NOT EXISTS target_accounts (
      id                  SERIAL PRIMARY KEY,
      workspace_id        INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name                TEXT NOT NULL,
      li_company_url      TEXT,
      li_company_id       TEXT,
      website             TEXT,
      industry            TEXT,
      company_size        TEXT,
      description         TEXT,
      engagement_score    INTEGER DEFAULT 0,
      engagement_score_7d INTEGER DEFAULT 0,
      last_signal_at      TIMESTAMP,
      enriched_at         TIMESTAMP,
      created_at          TIMESTAMP DEFAULT NOW()
    )
  `));

  await s('idx_ta_workspace', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_ta_workspace ON target_accounts(workspace_id)`
  ));
  await s('idx_ta_score', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_ta_score ON target_accounts(workspace_id, engagement_score_7d DESC)`
  ));
  await s('uniq_ta_company_id', () => db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_ta_company_id ON target_accounts(workspace_id, li_company_id) WHERE li_company_id IS NOT NULL`
  ));

  // ── Sequences ────────────────────────────────────────────────────────────
  await s('sequences', () => db.query(`
    CREATE TABLE IF NOT EXISTS sequences (
      id           SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      description  TEXT,
      created_at   TIMESTAMP DEFAULT NOW()
    )
  `));

  await s('sequence_steps', () => db.query(`
    CREATE TABLE IF NOT EXISTS sequence_steps (
      id          SERIAL PRIMARY KEY,
      sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
      step_index  INTEGER NOT NULL,
      type        TEXT NOT NULL DEFAULT 'message',
        -- 'invite' | 'message' | 'view_profile' | 'like_post' | 'follow_company'
      delay_days  INTEGER NOT NULL DEFAULT 0,
      variants    JSONB NOT NULL DEFAULT '[]',
        -- [{ label: 'A', text: 'Hi {{first_name}}...' }, ...]
      conditions  JSONB DEFAULT NULL,
      UNIQUE(sequence_id, step_index)
    )
  `));

  await s('idx_seq_steps', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_seq_steps ON sequence_steps(sequence_id, step_index)`
  ));

  // ── Enrollments (state machine: contact × campaign) ──────────────────────
  await s('enrollments', () => db.query(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id                  SERIAL PRIMARY KEY,
      campaign_id         INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      contact_id          INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      status              TEXT NOT NULL DEFAULT 'pending',
        -- pending | invite_sent | approved | messaged | replied
        -- | positive_reply | withdrawn | done | skipped | error
      current_step        INTEGER DEFAULT 0,
      next_action_at      TIMESTAMP DEFAULT NOW(),
      invite_sent_at      TIMESTAMP,
      invite_approved_at  TIMESTAMP,
      chat_id             TEXT,
      a_b_assignments     JSONB DEFAULT '{}',
      error_count         INTEGER DEFAULT 0,
      last_error          TEXT,
      created_at          TIMESTAMP DEFAULT NOW(),
      updated_at          TIMESTAMP DEFAULT NOW(),
      UNIQUE(campaign_id, contact_id)
    )
  `));

  await s('idx_enroll_status', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_enroll_status
     ON enrollments(campaign_id, status)`
  ));
  await s('idx_enroll_next_action', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_enroll_next_action
     ON enrollments(next_action_at) WHERE status NOT IN ('done','withdrawn','skipped','error','positive_reply')`
  ));
  await s('idx_enroll_contact', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_enroll_contact ON enrollments(contact_id)`
  ));

  // ── Enrollment Messages (what was sent at each step) ──────────────────────
  await s('enrollment_messages', () => db.query(`
    CREATE TABLE IF NOT EXISTS enrollment_messages (
      id                  SERIAL PRIMARY KEY,
      enrollment_id       INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
      step_index          INTEGER NOT NULL,
      variant_label       TEXT DEFAULT 'A',
      text                TEXT,
      sent_at             TIMESTAMP DEFAULT NOW(),
      unipile_message_id  TEXT
    )
  `));

  await s('idx_em_enrollment', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_em_enrollment ON enrollment_messages(enrollment_id)`
  ));

  // ── Add sequence_id to campaigns ─────────────────────────────────────────
  await s('campaigns.sequence_id', () => db.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sequence_id INTEGER REFERENCES sequences(id) ON DELETE SET NULL`
  ));
  await s('campaigns.invite_note', () => db.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS invite_note TEXT`
  ));

  await s('opportunity_contacts', () => db.query(`
    CREATE TABLE IF NOT EXISTS opportunity_contacts (
      id                       SERIAL PRIMARY KEY,
      workspace_id             INTEGER NOT NULL,
      company_linkedin_id      TEXT    NOT NULL,
      company_name             TEXT    NOT NULL DEFAULT '',
      li_profile_url           TEXT    NOT NULL,
      provider_id              TEXT,
      first_name               TEXT    NOT NULL DEFAULT '',
      last_name                TEXT    NOT NULL DEFAULT '',
      title                    TEXT    NOT NULL DEFAULT '',
      connected_via_account_id TEXT    NOT NULL,
      connected_via_name       TEXT    NOT NULL DEFAULT '',
      last_seen_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, li_profile_url, connected_via_account_id)
    )
  `));
  await s('opportunity_contacts.idx_ws', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_opp_contacts_ws ON opportunity_contacts(workspace_id, company_linkedin_id)`
  ));
  await s('opportunity_contacts.chat_id', () => db.query(
    `ALTER TABLE opportunity_contacts ADD COLUMN IF NOT EXISTS chat_id TEXT`
  ));
  await s('opportunity_contacts.aco_id', () => db.query(
    `ALTER TABLE opportunity_contacts ADD COLUMN IF NOT EXISTS aco_id TEXT`
  ));
  await s('list_companies.opp_last_synced_at', () => db.query(
    `ALTER TABLE list_companies ADD COLUMN IF NOT EXISTS opp_last_synced_at TIMESTAMPTZ`
  ));
  await s('contacts.unique_campaign_idx', () => db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_unique_campaign
    ON contacts (workspace_id, li_profile_url, campaign_id)
    WHERE campaign_id IS NOT NULL
  `));
  await s('enrollments.error_message', () => db.query(
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS error_message TEXT`
  ));
  await s('contacts.unique_pool_idx', () => db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_unique_pool
    ON contacts (workspace_id, li_profile_url)
    WHERE campaign_id IS NULL
  `));

  // ── Signals (all inbound LinkedIn events) ────────────────────────────────
  await s('signals', () => db.query(`
    CREATE TABLE IF NOT EXISTS signals (
      id                      SERIAL PRIMARY KEY,
      workspace_id            INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      type                    TEXT NOT NULL,
        -- profile_view | post_like | post_comment | invite_received
        -- | invite_accepted | invite_declined | message_received | company_follow
      actor_contact_id        INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      actor_target_account_id INTEGER REFERENCES target_accounts(id) ON DELETE SET NULL,
      actor_provider_id       TEXT,
      actor_name              TEXT,
      actor_li_url            TEXT,
      actor_headline          TEXT,
      subject_li_account_id   TEXT,
        -- the unipile account_id that received this signal
      content                 TEXT,
      post_url                TEXT,
      raw_data                JSONB DEFAULT '{}',
      is_known                BOOLEAN DEFAULT FALSE,
        -- TRUE if actor is in one of our lists
      is_notified             BOOLEAN DEFAULT FALSE,
      occurred_at             TIMESTAMP,
      created_at              TIMESTAMP DEFAULT NOW()
    )
  `));

  await s('idx_signals_ws', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_signals_ws ON signals(workspace_id, occurred_at DESC)`
  ));
  await s('idx_signals_contact', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_signals_contact ON signals(actor_contact_id)`
  ));
  await s('signals.ai_cols', () => db.query(
    `ALTER TABLE signals
       ADD COLUMN IF NOT EXISTS ai_priority TEXT,
       ADD COLUMN IF NOT EXISTS ai_action   TEXT,
       ADD COLUMN IF NOT EXISTS ai_reason   TEXT,
       ADD COLUMN IF NOT EXISTS ai_fit_score INTEGER`
  ));
  await s('idx_signals_known', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_signals_known ON signals(workspace_id, is_known, occurred_at DESC)`
  ));

  // ── Scheduled Posts ───────────────────────────────────────────────────────
  await s('scheduled_posts', () => db.query(`
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id              SERIAL PRIMARY KEY,
      workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      account_id      TEXT NOT NULL,
      content         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'scheduled',
        -- draft | scheduled | published | failed
      scheduled_at    TIMESTAMP,
      published_at    TIMESTAMP,
      unipile_post_id TEXT,
      error           TEXT,
      created_at      TIMESTAMP DEFAULT NOW()
    )
  `));

  await s('idx_sp_workspace', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_sp_workspace ON scheduled_posts(workspace_id, scheduled_at)`
  ));
  await s('idx_sp_status', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_sp_status ON scheduled_posts(status, scheduled_at)
     WHERE status = 'scheduled'`
  ));

  await s('scheduled_comments', () => db.query(`
    CREATE TABLE IF NOT EXISTS scheduled_comments (
      id                  SERIAL PRIMARY KEY,
      workspace_id        INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      account_id          TEXT NOT NULL,
      scheduled_post_id   INTEGER REFERENCES scheduled_posts(id) ON DELETE SET NULL,
      post_url            TEXT,
      content             TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'scheduled',
      scheduled_at        TIMESTAMP,
      published_at        TIMESTAMP,
      unipile_comment_id  TEXT,
      error               TEXT,
      created_at          TIMESTAMP DEFAULT NOW()
    )
  `));

  await s('idx_sc_workspace', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_sc_workspace ON scheduled_comments(workspace_id, scheduled_at)`
  ));

  // ── Link contacts → target_accounts ──────────────────────────────────────
  await s('contacts.target_account_id', () => db.query(
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS target_account_id INTEGER REFERENCES target_accounts(id) ON DELETE SET NULL`
  ));

  // ── Engagement scoring + signal tracking on contacts ──────────────────────
  await s('contacts.engagement_score',    () => db.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS engagement_score    INTEGER DEFAULT 0`));
  await s('contacts.engagement_score_7d', () => db.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS engagement_score_7d INTEGER DEFAULT 0`));
  await s('contacts.last_signal_at',      () => db.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_signal_at TIMESTAMPTZ`));

  // ── Seed: set provider_id = URL slug for contacts missing provider_id ────
  // Allows invitationSender to send invites before full Unipile enrichment.
  // Real enrichment (enrichProfile) will OVERWRITE the slug with ACoXXX later.
  await s('seed.provider_id_from_slug', async () => {
    const { rowCount } = await db.query(`
      UPDATE contacts
      SET provider_id = regexp_replace(
        li_profile_url,
        '.*linkedin\\.com/in/([^/?#/]+).*',
        '\\1'
      )
      WHERE (provider_id IS NULL OR provider_id = '')
        AND li_profile_url LIKE '%linkedin.com/in/%'
        AND li_profile_url ~ 'linkedin\\.com/in/[^/?#]+'
    `);
    if (rowCount > 0) console.log(`[SchemaV2] Seeded provider_id slug for ${rowCount} contacts`);
  });

  // (workspace-specific seed data removed for white-label distribution)



  // ── workspace_company_pages ────────────────────────────────────────────────
  await s('workspace_company_pages', () => db.query(`
    CREATE TABLE IF NOT EXISTS workspace_company_pages (
      id              SERIAL PRIMARY KEY,
      workspace_id    INTEGER NOT NULL,
      name            TEXT NOT NULL,
      li_url          TEXT,
      company_page_urn TEXT NOT NULL,
      is_default      BOOLEAN DEFAULT false,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(workspace_id, company_page_urn)
    )
  `));
  await s('idx_wcp_workspace', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_wcp_workspace ON workspace_company_pages(workspace_id)`
  ));

  // ── Seed workspace_company_pages from existing account settings ─────────────
  await s('seed_workspace_company_pages', async () => {
    // Find all workspaces that have company_page_urn set on their accounts
    const { rows } = await db.query(`
      SELECT DISTINCT workspace_id,
        settings->>'company_page_urn' AS urn,
        settings->>'company_page_url' AS li_url
      FROM unipile_accounts
      WHERE settings->>'company_page_urn' IS NOT NULL
        AND settings->>'company_page_urn' != ''
    `);
    for (const row of rows) {
      await db.query(`
        INSERT INTO workspace_company_pages (workspace_id, name, li_url, company_page_urn, is_default)
        VALUES ($1, 'Company Page', $2, $3, true)
        ON CONFLICT (workspace_id, company_page_urn) DO NOTHING
      `, [row.workspace_id, row.li_url || null, row.urn]);
    }
  });

  console.log('[SchemaV2] ✓ All v2 migrations complete');
}

// ── Discover Feeds + Items ───────────────────────────────────────────────────
async function initDiscoverSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS discover_feeds (
      id           SERIAL PRIMARY KEY,
      workspace_id INT  NOT NULL,
      name         TEXT NOT NULL,
      keywords     TEXT NOT NULL,
      sources      JSONB NOT NULL DEFAULT '["reddit","linkedin"]',
      date_filter  TEXT  DEFAULT 'past_month',
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      last_run_at  TIMESTAMPTZ,
      item_count   INT  DEFAULT 0,
      auto_run     BOOLEAN DEFAULT TRUE
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS discover_items (
      id           SERIAL PRIMARY KEY,
      feed_id      INT  NOT NULL REFERENCES discover_feeds(id) ON DELETE CASCADE,
      workspace_id INT  NOT NULL,
      source       TEXT NOT NULL,
      title        TEXT,
      snippet      TEXT,
      author       TEXT,
      author_url   TEXT,
      subreddit    TEXT,
      url          TEXT NOT NULL,
      score        INT  DEFAULT 0,
      comments     INT  DEFAULT 0,
      found_at     TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(feed_id, url)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS discover_items_feed_id  ON discover_items(feed_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS discover_feeds_workspace ON discover_feeds(workspace_id)`);
}

module.exports.initDiscoverSchema = initDiscoverSchema;

// ── Search Monitors ──────────────────────────────────────────────────────────
async function initMonitorsSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS search_monitors (
      id           SERIAL PRIMARY KEY,
      workspace_id INT  NOT NULL,
      name         TEXT NOT NULL,
      keywords     TEXT NOT NULL,
      sources      JSONB NOT NULL DEFAULT '["reddit","linkedin"]',
      email        TEXT NOT NULL,
      frequency    TEXT NOT NULL DEFAULT 'daily',
      active       BOOLEAN DEFAULT TRUE,
      last_sent_at TIMESTAMPTZ,
      last_check_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS monitor_items (
      id           SERIAL PRIMARY KEY,
      monitor_id   INT  NOT NULL REFERENCES search_monitors(id) ON DELETE CASCADE,
      source       TEXT NOT NULL,
      title        TEXT,
      snippet      TEXT,
      author       TEXT,
      author_url   TEXT,
      subreddit    TEXT,
      url          TEXT NOT NULL,
      score        INT  DEFAULT 0,
      comments     INT  DEFAULT 0,
      found_at     TIMESTAMPTZ DEFAULT NOW(),
      emailed      BOOLEAN DEFAULT FALSE,
      UNIQUE(monitor_id, url)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS monitor_items_monitor ON monitor_items(monitor_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS monitor_items_emailed ON monitor_items(emailed, monitor_id)`);
}
module.exports.initMonitorsSchema = initMonitorsSchema;

module.exports = { initSchemaV2 };

// ── AI Opportunities (Signals tab) ───────────────────────────────────────────
  await s('ai_opportunities', () => db.query(`
    CREATE TABLE IF NOT EXISTS ai_opportunities (
      id            SERIAL PRIMARY KEY,
      workspace_id  INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      type          TEXT NOT NULL,
        -- hot_lead | multi_signal | company_spike | post_engagement | reconnect | cold_outreach
      priority      INTEGER DEFAULT 5,   -- 1 (highest) to 10
      title         TEXT NOT NULL,       -- short headline
      description   TEXT NOT NULL,       -- why this is an opportunity
      action_label  TEXT NOT NULL,       -- what AI suggests doing
      entity_name   TEXT,               -- person or company name
      entity_li_url TEXT,               -- LinkedIn URL if known
      company       TEXT,               -- company name
      raw_data      JSONB DEFAULT '{}', -- source data used to generate
      created_at    TIMESTAMP DEFAULT NOW(),
      dismissed_at  TIMESTAMP,
      handled_at    TIMESTAMP
    )
  `));
  await s('idx_ai_opps_ws', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_ai_opps_ws ON ai_opportunities(workspace_id, created_at DESC)`
  ));

  // ── ai_opportunities: add is_connected + personal_msg columns (added post-initial) ─
  await s('ai_opp.is_connected', () => db.query(
    `ALTER TABLE ai_opportunities ADD COLUMN IF NOT EXISTS is_connected BOOLEAN DEFAULT false`
  ));
  await s('ai_opp.personal_msg', () => db.query(
    `ALTER TABLE ai_opportunities ADD COLUMN IF NOT EXISTS personal_msg TEXT`
  ));

  // ── personal_campaign_contacts ───────────────────────────────────────────────────
  await s('personal_campaign_contacts', () => db.query(`
    CREATE TABLE IF NOT EXISTS personal_campaign_contacts (
      id              SERIAL PRIMARY KEY,
      campaign_id     INTEGER NOT NULL,
      workspace_id    INTEGER NOT NULL,
      entity_name     TEXT,
      entity_li_url   TEXT,
      company         TEXT,
      opp_id          INTEGER,
      personal_msg    TEXT NOT NULL,
      status          TEXT DEFAULT 'pending',
        -- pending | approved | sent
      sent_at         TIMESTAMP,
      approved_at     TIMESTAMP,
      created_at      TIMESTAMP DEFAULT NOW()
    )
  `));
  await s('idx_pcc_campaign', () => db.query(
    `CREATE INDEX IF NOT EXISTS idx_pcc_campaign ON personal_campaign_contacts(campaign_id)`
  ));

  // ── lists.icp_titles (added for ICP contact search) ─────────────────────────
  await s('lists.icp_titles', () => db.query(
    `ALTER TABLE lists ADD COLUMN IF NOT EXISTS icp_titles JSONB DEFAULT '[]'`
  ));
