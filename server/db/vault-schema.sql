-- Identity vault: the only place direct identifiers live. Read exclusively by server/routes/participant.ts (and the seed).
CREATE TABLE IF NOT EXISTS identity (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL UNIQUE,
  legal_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  dob TEXT NOT NULL,
  address_json TEXT NOT NULL DEFAULT '{}',
  verification_status TEXT NOT NULL DEFAULT 'verified',
  created_at TEXT NOT NULL
) STRICT;
