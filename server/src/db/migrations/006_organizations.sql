-- FR-18: review of access requests (FR-18.2) and the organization's own identity provider (FR-18.8).
ALTER TABLE organizations
  ADD COLUMN reviewed_at      timestamptz,                                    -- activation or rejection
  ADD COLUMN reviewed_by      integer REFERENCES users ON DELETE SET NULL,    -- the platform administrator
  ADD COLUMN rejection_reason varchar(500),
  ADD COLUMN sso_secret_enc   text,                                           -- AES-256-GCM, like the verification answers
  ADD COLUMN sso_enabled      boolean NOT NULL DEFAULT false,                 -- true only after a successful test
  ADD COLUMN sso_checked_at   timestamptz,
  ADD CONSTRAINT organizations_rejection_reason CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL);
