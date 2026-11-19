-- FR-14 Drop-off points: when an officer received the item, and who checked the claimant's ID card at the release.
ALTER TABLE posts ADD COLUMN received_at timestamptz;                                    -- FR-14.3, FR-14.7
ALTER TABLE posts ADD COLUMN received_by integer REFERENCES users ON DELETE SET NULL;
ALTER TABLE claims ADD COLUMN id_checked_by integer REFERENCES users ON DELETE SET NULL; -- FR-14.5
