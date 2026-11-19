-- FR-13.1, FR-16.8: the points of Table 13 per organization, so administrators can change them.
ALTER TABLE organizations
  ADD COLUMN karma_rules jsonb NOT NULL DEFAULT '{"RETURN":10,"DROPOFF":5,"HELPFUL_REPORT":2,"FRAUD":-20}';
