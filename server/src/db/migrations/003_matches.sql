-- FR-5.4: the owner of the lost post is notified once per recorded match, even when Smart Match runs again
ALTER TABLE matches ADD COLUMN notified_at timestamptz;
ALTER TABLE matches ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
