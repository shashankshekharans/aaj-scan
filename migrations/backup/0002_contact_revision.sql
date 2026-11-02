-- Append-only upgrade: existing remote contacts start at revision zero.
ALTER TABLE backup_contacts ADD COLUMN contact_revision INTEGER NOT NULL DEFAULT 0
  CHECK(typeof(contact_revision) = 'integer' AND contact_revision BETWEEN 0 AND 9007199254740991);
