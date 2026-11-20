-- FR-1.8: signing out ends the session on the server too.  Every session token carries the user's session
-- epoch; signing out increments it, so a copy of an earlier token is refused even before it expires.
ALTER TABLE users ADD COLUMN session_epoch integer NOT NULL DEFAULT 0;
