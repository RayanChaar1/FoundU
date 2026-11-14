-- Claims rejected automatically when another claim is approved (FR-6.11) do not count towards the
-- three rejections that flag an account for review (FR-6.14).
ALTER TABLE claims ADD COLUMN auto_rejected boolean NOT NULL DEFAULT false;
ALTER TABLE claims ADD COLUMN returned_at timestamptz; -- FR-9.6: date-time of the confirmed return
CREATE INDEX claims_rejections_idx ON claims (claimant_id, decided_at) WHERE status = 'REJECTED' AND NOT auto_rejected;

-- FR-8.2: the email sweep handles each notification once, whether it is emailed or skipped
ALTER TABLE notifications ADD COLUMN email_checked boolean NOT NULL DEFAULT false;
CREATE INDEX notifications_email_idx ON notifications (created_at) WHERE NOT email_checked;
