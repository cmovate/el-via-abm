-- Conference speaker columns (added for CONFERENCES list)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS conference_name VARCHAR(255);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS conference_date VARCHAR(100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS conference_location VARCHAR(255);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS conference_website TEXT;
