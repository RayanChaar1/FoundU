-- FoundU database schema (Appendix B of the requirements document).
-- Every entity has a surrogate integer key; enumerations are text columns with CHECK constraints.

CREATE TABLE organizations (
  organization_id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              varchar(100) NOT NULL UNIQUE,
  type              varchar(20)  NOT NULL CHECK (type IN ('UNIVERSITY', 'COMPANY')),
  email_domains     text[]       NOT NULL CHECK (cardinality(email_domains) > 0),
  status            varchar(20)  NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED')),
  contact_name      varchar(100) NOT NULL,
  contact_email     varchar(120) NOT NULL,
  domain_token      varchar(64),                       -- DNS TXT value proving domain control (FR-18.2)
  karma_enabled     boolean      NOT NULL DEFAULT true, -- FR-18.6
  qr_enabled        boolean      NOT NULL DEFAULT true, -- FR-18.7
  match_threshold   integer      NOT NULL DEFAULT 60 CHECK (match_threshold BETWEEN 0 AND 100),    -- FR-5.3, FR-5.8
  possible_threshold integer     NOT NULL DEFAULT 40 CHECK (possible_threshold BETWEEN 0 AND 100), -- FR-5.5, FR-5.8
  match_weights     jsonb        NOT NULL DEFAULT '{"category":35,"building":25,"campus":10,"date1":20,"date3":12,"date7":5,"keywords":20}',
  retention_months  integer      NOT NULL DEFAULT 12 CHECK (retention_months BETWEEN 1 AND 60),  -- FR-16.8, FR-17.5
  sso_issuer        varchar(200),                      -- FR-18.8 (OpenID Connect)
  sso_client_id     varchar(200),
  created_at        timestamptz  NOT NULL DEFAULT now(),
  CHECK (possible_threshold <= match_threshold)
);

CREATE TABLE campuses (
  campus_id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   integer NOT NULL REFERENCES organizations ON DELETE CASCADE,
  name              varchar(60) NOT NULL,
  latitude          numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude         numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  UNIQUE (organization_id, name)
);

CREATE TABLE locations (
  location_id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   integer NOT NULL REFERENCES organizations ON DELETE CASCADE,
  campus_id         integer NOT NULL REFERENCES campuses ON DELETE CASCADE,
  building          varchar(80) NOT NULL,
  latitude          numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude         numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  UNIQUE (campus_id, building)
);

CREATE TABLE users (
  user_id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   integer REFERENCES organizations ON DELETE CASCADE,
  email             varchar(120) NOT NULL,
  full_name         varchar(100) NOT NULL,
  display_name      varchar(60)  NOT NULL,
  role              varchar(20)  NOT NULL DEFAULT 'USER'
                    CHECK (role IN ('USER', 'SECURITY', 'ORG_ADMIN', 'PLATFORM_ADMIN')),
  campus_id         integer REFERENCES campuses ON DELETE SET NULL,
  karma_points      integer      NOT NULL DEFAULT 0 CHECK (karma_points >= 0),
  status            varchar(20)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  email_notifications boolean    NOT NULL DEFAULT true,  -- FR-1.11
  hide_from_leaderboard boolean  NOT NULL DEFAULT false, -- FR-13.5
  flagged_for_review boolean     NOT NULL DEFAULT false, -- FR-6.14
  created_at        timestamptz  NOT NULL DEFAULT now(),
  CHECK (role = 'PLATFORM_ADMIN' OR organization_id IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE otp_codes (                              -- FR-1.3, FR-1.4
  otp_id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email             varchar(120) NOT NULL,
  code_hash         text        NOT NULL,
  attempts          integer     NOT NULL DEFAULT 0,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_email_idx ON otp_codes (lower(email), created_at DESC);

CREATE TABLE categories (
  category_id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   integer NOT NULL REFERENCES organizations ON DELETE CASCADE,
  name              varchar(60) NOT NULL,
  is_sensitive_default boolean NOT NULL DEFAULT false, -- FR-17.1
  UNIQUE (organization_id, name)
);

CREATE TABLE dropoff_points (                         -- FR-14.1, FR-14.2
  dropoff_id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   integer NOT NULL REFERENCES organizations ON DELETE CASCADE,
  location_id       integer NOT NULL REFERENCES locations,
  name              varchar(80) NOT NULL,
  opening_hours     varchar(80) NOT NULL,
  contact_number    varchar(40) NOT NULL,
  is_active         boolean     NOT NULL DEFAULT true
);

CREATE TABLE posts (
  post_id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   integer NOT NULL REFERENCES organizations ON DELETE CASCADE,
  owner_id          integer REFERENCES users ON DELETE SET NULL,
  type              varchar(5)    NOT NULL CHECK (type IN ('LOST', 'FOUND')),
  title             varchar(80)   NOT NULL CHECK (length(trim(title)) > 0),
  description       varchar(1000) NOT NULL DEFAULT '',
  category_id       integer NOT NULL REFERENCES categories,
  location_id       integer NOT NULL REFERENCES locations,
  event_datetime    timestamptz   NOT NULL,
  status            varchar(10)   NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'CLAIMED', 'RETURNED', 'CLOSED', 'REMOVED')),
  is_sensitive      boolean       NOT NULL DEFAULT false,
  is_hidden         boolean       NOT NULL DEFAULT false,     -- FR-15.3, FR-15.5
  whereabouts       varchar(10)   CHECK (whereabouts IN ('FINDER', 'DROPOFF')),
  verification_question varchar(200),
  verification_answer_enc text,                               -- NFR-10.1: encrypted, never in clear text
  dropoff_id        integer REFERENCES dropoff_points,
  returned_at       timestamptz,                              -- FR-9.6
  closed_at         timestamptz,
  anonymized_at     timestamptz,                              -- FR-17.5
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  search            tsvector GENERATED ALWAYS AS
                    (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED,
  CHECK (type = 'LOST' OR (verification_question IS NOT NULL AND verification_answer_enc IS NOT NULL
                           AND whereabouts IS NOT NULL)),
  CHECK (whereabouts IS DISTINCT FROM 'DROPOFF' OR dropoff_id IS NOT NULL)
);
CREATE INDEX posts_feed_idx ON posts (organization_id, status, created_at DESC);
CREATE INDEX posts_match_idx ON posts (organization_id, type, status, category_id, location_id, event_datetime);
CREATE INDEX posts_search_idx ON posts USING gin (search);
CREATE INDEX posts_owner_idx ON posts (owner_id);
CREATE INDEX posts_dropoff_idx ON posts (dropoff_id);

CREATE TABLE post_history (                           -- FR-10.3
  history_id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id           integer NOT NULL REFERENCES posts ON DELETE CASCADE,
  editor_id         integer REFERENCES users ON DELETE SET NULL,
  changes           jsonb   NOT NULL,
  edited_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_history_post_idx ON post_history (post_id);

CREATE TABLE photos (
  photo_id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id           integer NOT NULL REFERENCES posts ON DELETE CASCADE,
  storage_path      text    NOT NULL,
  blurred_path      text,                               -- FR-17.2
  is_blurred        boolean NOT NULL DEFAULT false,
  position          integer NOT NULL CHECK (position BETWEEN 1 AND 5), -- FR-2.3, FR-3.3
  UNIQUE (post_id, position)
);

CREATE TABLE matches (
  match_id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   integer NOT NULL REFERENCES organizations ON DELETE CASCADE,
  lost_post_id      integer NOT NULL REFERENCES posts ON DELETE CASCADE,
  found_post_id     integer NOT NULL REFERENCES posts ON DELETE CASCADE,
  score             integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  status            varchar(10) NOT NULL DEFAULT 'SUGGESTED' CHECK (status IN ('SUGGESTED', 'DISMISSED')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lost_post_id, found_post_id)                  -- FR-5.7: a dismissed pair is never suggested again
);
CREATE INDEX matches_found_idx ON matches (found_post_id);

CREATE TABLE claims (
  claim_id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id           integer NOT NULL REFERENCES posts ON DELETE CASCADE,
  claimant_id       integer REFERENCES users ON DELETE SET NULL,
  answer_text       varchar(500) NOT NULL,
  description       varchar(1000),                      -- FR-6.2
  status            varchar(10)  NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'COMPLETED')),
  rejection_reason  varchar(500),                       -- FR-6.9
  cancel_reason     varchar(500),                       -- FR-9.10
  handover_code_hash text,                              -- NFR-10.2
  handover_code_enc  text,                              -- shown to the claimant only (FR-9.3)
  failed_attempts   integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  code_locked_until timestamptz,                        -- FR-9.7
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);
CREATE UNIQUE INDEX claims_one_pending_idx ON claims (post_id, claimant_id) WHERE status = 'PENDING'; -- FR-6.4
CREATE UNIQUE INDEX claims_one_approved_idx ON claims (post_id) WHERE status IN ('APPROVED', 'COMPLETED');
CREATE INDEX claims_claimant_idx ON claims (claimant_id);

CREATE TABLE messages (
  message_id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id          integer NOT NULL REFERENCES claims ON DELETE CASCADE,
  sender_id         integer REFERENCES users ON DELETE SET NULL,
  body              varchar(1000) NOT NULL CHECK (length(trim(body)) > 0), -- FR-7.3
  sent_at           timestamptz NOT NULL DEFAULT now(),
  is_read           boolean     NOT NULL DEFAULT false
);
CREATE INDEX messages_claim_idx ON messages (claim_id, sent_at);

CREATE TABLE post_contacts (                          -- FR-6.13 "I may have found this"
  contact_id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id           integer NOT NULL REFERENCES posts ON DELETE CASCADE,
  sender_id         integer REFERENCES users ON DELETE SET NULL,
  body              varchar(1000) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (                          -- FR-8
  notification_id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           integer NOT NULL REFERENCES users ON DELETE CASCADE,
  type              varchar(20) NOT NULL CHECK (type IN ('MATCH', 'CLAIM_RECEIVED', 'CLAIM_APPROVED',
                    'CLAIM_REJECTED', 'MESSAGE', 'HANDOVER', 'BADGE', 'MODERATION', 'CONTACT', 'QR_MESSAGE',
                    'CODE_BLOCKED', 'HANDOVER_CANCELLED')),
  content           varchar(500) NOT NULL,
  link              varchar(200),
  claim_id          integer REFERENCES claims ON DELETE CASCADE,   -- FR-8.5 email throttling per conversation
  is_read           boolean NOT NULL DEFAULT false,
  emailed_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, is_read, created_at DESC);

CREATE TABLE qr_tags (                                -- FR-12
  tag_id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id          integer NOT NULL REFERENCES users ON DELETE CASCADE,
  tag_code          varchar(64) NOT NULL UNIQUE,        -- base64url of 128 random bits or more (FR-12.2)
  item_label        varchar(80) NOT NULL,
  category_id       integer REFERENCES categories,
  photo_path        text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qr_tags_owner_idx ON qr_tags (owner_id);

CREATE TABLE qr_messages (                            -- FR-12.7 to FR-12.9
  qr_message_id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tag_id            integer NOT NULL REFERENCES qr_tags ON DELETE CASCADE,
  body              varchar(500) NOT NULL,
  contact           varchar(200),
  device_hash       varchar(64) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qr_messages_rate_idx ON qr_messages (tag_id, device_hash, created_at);

CREATE TABLE reports (                                -- FR-15
  report_id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   integer NOT NULL REFERENCES organizations ON DELETE CASCADE,
  reporter_id       integer REFERENCES users ON DELETE SET NULL,
  post_id           integer REFERENCES posts ON DELETE CASCADE,
  message_id        integer REFERENCES messages ON DELETE CASCADE,
  reason            varchar(20) NOT NULL CHECK (reason IN ('SPAM', 'FRAUD', 'INAPPROPRIATE', 'PERSONAL_DATA', 'OTHER')),
  details           varchar(500),
  status            varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DISMISSED', 'ACTIONED')),
  action            varchar(10) CHECK (action IN ('DISMISS', 'HIDE', 'REMOVE', 'WARN')),
  handled_by        integer REFERENCES users ON DELETE SET NULL,
  handled_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((post_id IS NULL) <> (message_id IS NULL))
);
CREATE UNIQUE INDEX reports_one_per_user_post ON reports (post_id, reporter_id) WHERE post_id IS NOT NULL;
CREATE INDEX reports_queue_idx ON reports (organization_id, status, created_at);

CREATE TABLE audit_log (                              -- FR-15.7, FR-16
  audit_id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   integer REFERENCES organizations ON DELETE CASCADE,
  actor_id          integer REFERENCES users ON DELETE SET NULL,
  action            varchar(40) NOT NULL,
  target_type       varchar(20) NOT NULL,
  target_id         integer,
  reason            varchar(500),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_idx ON audit_log (organization_id, created_at DESC);

CREATE TABLE badges (                                 -- Table 13
  badge_id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              varchar(30) NOT NULL UNIQUE,
  name              varchar(40) NOT NULL,
  karma_threshold   integer CHECK (karma_threshold > 0)  -- NULL for First Find (first return)
);

CREATE TABLE user_badges (
  user_id           integer NOT NULL REFERENCES users ON DELETE CASCADE,
  badge_id          integer NOT NULL REFERENCES badges ON DELETE CASCADE,
  awarded_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE karma_events (                           -- FR-13.1, semester leaderboard (FR-13.4)
  karma_event_id    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           integer NOT NULL REFERENCES users ON DELETE CASCADE,
  points            integer NOT NULL,
  reason            varchar(30) NOT NULL CHECK (reason IN ('RETURN', 'DROPOFF', 'HELPFUL_REPORT', 'FRAUD')),
  post_id           integer REFERENCES posts ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX karma_events_user_idx ON karma_events (user_id, created_at);
