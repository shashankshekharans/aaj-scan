-- Dedicated BACKUP_DB only. Existing usage storage and migrations are unchanged.
CREATE TABLE backup_contacts (
  contact_id TEXT PRIMARY KEY NOT NULL CHECK(length(contact_id) BETWEEN 1 AND 64 AND contact_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  batch_id TEXT NOT NULL CHECK(length(batch_id) BETWEEN 1 AND 64 AND batch_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  event_key TEXT NOT NULL CHECK(length(event_key) = 64 AND event_key NOT GLOB '*[^a-f0-9]*'),
  event_name TEXT NOT NULL CHECK(length(event_name) BETWEEN 1 AND 200),
  event_date TEXT NOT NULL CHECK(length(event_date) = 10 AND event_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  first_name TEXT CHECK(first_name IS NULL OR length(first_name) <= 200),
  last_name TEXT CHECK(last_name IS NULL OR length(last_name) <= 200),
  company TEXT CHECK(company IS NULL OR length(company) <= 300),
  email TEXT CHECK(email IS NULL OR length(email) <= 320),
  job_title TEXT CHECK(job_title IS NULL OR length(job_title) <= 300),
  phone TEXT CHECK(phone IS NULL OR length(phone) <= 100),
  provider TEXT CHECK(provider IS NULL OR length(provider) <= 64),
  model TEXT CHECK(model IS NULL OR length(model) <= 200),
  card_created_at INTEGER NOT NULL CHECK(typeof(card_created_at) = 'integer' AND card_created_at BETWEEN 1 AND 8640000000000000),
  approved_at INTEGER NOT NULL CHECK(typeof(approved_at) = 'integer' AND approved_at BETWEEN card_created_at AND 8640000000000000),
  backed_up_at INTEGER NOT NULL CHECK(typeof(backed_up_at) = 'integer' AND backed_up_at BETWEEN 1 AND 8640000000000000)
);
CREATE INDEX backup_contacts_event_export ON backup_contacts(event_key, card_created_at, contact_id);
CREATE INDEX backup_contacts_batch ON backup_contacts(batch_id);
CREATE INDEX backup_contacts_recent ON backup_contacts(backed_up_at);
