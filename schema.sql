CREATE TABLE IF NOT EXISTS workspaces (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS unipile_accounts (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255),
  provider VARCHAR(50) DEFAULT 'linkedin',
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'draft',
  audience_type VARCHAR(50),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  company VARCHAR(255),
  title VARCHAR(255),
  li_profile_url TEXT,
  li_company_url TEXT,
  email VARCHAR(255),
  website VARCHAR(255),
  location VARCHAR(255),
  profile_data JSONB DEFAULT '{}',
  invite_sent BOOLEAN DEFAULT FALSE,
  invite_approved BOOLEAN DEFAULT FALSE,
  msg_sent BOOLEAN DEFAULT FALSE,
  msg_replied BOOLEAN DEFAULT FALSE,
  positive_reply BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_campaign ON contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace ON contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace ON campaigns(workspace_id);
