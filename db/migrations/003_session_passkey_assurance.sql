-- Email OTP establishes a temporary session. Product access for an enrolled
-- account requires an additional passkey assertion bound to that session.
CREATE TABLE IF NOT EXISTS session_passkey_assurances (
  session_id TEXT PRIMARY KEY REFERENCES "session"("id") ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  asserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS session_passkey_assurances_user_idx
  ON session_passkey_assurances (user_id, asserted_at DESC);
