/* NFR-22.1 (Lebanese Law No. 81 of 2018: purpose limitation, user information): what FoundU keeps, why, and for how
   long.  Every column of every table belongs to one entry, so a new column cannot be added without stating its
   purpose; tests/nfr-privacy.test.js checks this against the database.  Shown to everyone at /privacy. */
const ITEMS = [
  {
    data: 'Your account',
    personal: true,
    purpose: 'Sign you in with your organization email, show your name on your posts and messages, and send you notifications.',
    kept: 'While your account exists.  Deleting your data (My data) anonymizes the account at once.',
    columns: { users: ['user_id', 'organization_id', 'email', 'full_name', 'display_name', 'role', 'campus_id', 'status',
      'email_notifications', 'hide_from_leaderboard', 'flagged_for_review', 'created_at', 'session_epoch', 'karma_points'] },
  },
  {
    data: 'Sign-in codes',
    personal: true,
    purpose: 'Prove that you own your email address.  Only a hash of each code is stored.',
    kept: 'Each code works for 10 minutes; it is deleted one day after it expires.',
    columns: { otp_codes: ['otp_id', 'email', 'code_hash', 'attempts', 'expires_at', 'used_at', 'created_at'] },
  },
  {
    data: 'Your posts and their photos',
    personal: true,
    purpose: 'Describe a lost or found item so that its owner or finder can recognize it, match it, and claim it.  Photos of sensitive items are blurred for others; the expected answer is encrypted.',
    kept: 'Until the post is closed, then for the retention period of your organization (12 months by default), after which the personal data is removed and only anonymous statistics remain.',
    columns: {
      posts: ['post_id', 'organization_id', 'owner_id', 'type', 'title', 'description', 'category_id', 'location_id', 'event_datetime',
        'status', 'is_sensitive', 'is_hidden', 'whereabouts', 'verification_question', 'verification_answer_enc', 'dropoff_id',
        'returned_at', 'closed_at', 'anonymized_at', 'created_at', 'updated_at', 'search', 'received_at', 'received_by'],
      photos: ['photo_id', 'post_id', 'storage_path', 'blurred_path', 'is_blurred', 'position'],
      post_history: ['history_id', 'post_id', 'editor_id', 'changes', 'edited_at'],
      matches: ['match_id', 'organization_id', 'lost_post_id', 'found_post_id', 'score', 'status', 'created_at', 'notified_at', 'updated_at'],
    },
  },
  {
    data: 'Claims and handover codes',
    personal: true,
    purpose: 'Let the finder check that you own the item, and confirm the return with a one-time code (encrypted, and hashed for checking).',
    kept: 'With the post: removed with its personal data at the end of the retention period.',
    columns: { claims: ['claim_id', 'post_id', 'claimant_id', 'answer_text', 'description', 'status', 'rejection_reason', 'cancel_reason',
      'handover_code_hash', 'handover_code_enc', 'failed_attempts', 'code_locked_until', 'created_at', 'decided_at', 'auto_rejected',
      'returned_at', 'id_checked_by'] },
  },
  {
    data: 'Messages',
    personal: true,
    purpose: 'Arrange the return between the claimant and the finder, or contact the poster about a post, without sharing email or phone numbers.',
    kept: 'With the post: anonymized at the end of the retention period, or at once when you delete your data.',
    columns: {
      messages: ['message_id', 'claim_id', 'sender_id', 'body', 'sent_at', 'is_read'],
      post_contacts: ['contact_id', 'post_id', 'sender_id', 'body', 'created_at'],
    },
  },
  {
    data: 'Notifications',
    personal: true,
    purpose: 'Tell you about matches, claims, messages and returns, in the application and by email if you allow it.',
    kept: '6 months, or until you delete your data.',
    columns: { notifications: ['notification_id', 'user_id', 'type', 'content', 'link', 'claim_id', 'is_read', 'emailed_at', 'created_at', 'email_checked'] },
  },
  {
    data: 'QR tags and finder messages',
    personal: true,
    purpose: 'Let a finder who scans your sticker message you without seeing who you are.  The finder may leave a contact; the device is kept only as a hash to stop abuse.',
    kept: 'While the tag exists; deleted with your data.',
    columns: {
      qr_tags: ['tag_id', 'owner_id', 'tag_code', 'item_label', 'category_id', 'photo_path', 'is_active', 'created_at'],
      qr_messages: ['qr_message_id', 'tag_id', 'body', 'contact', 'device_hash', 'created_at'],
    },
  },
  {
    data: 'Karma points and badges',
    personal: true,
    purpose: 'Thank users who return items, shown on profiles and the leaderboard (you can hide yourself from it).',
    kept: 'While your account exists.',
    columns: {
      karma_events: ['karma_event_id', 'user_id', 'points', 'reason', 'post_id', 'created_at'],
      user_badges: ['user_id', 'badge_id', 'awarded_at'],
    },
  },
  {
    data: 'Reports and moderation',
    personal: true,
    purpose: 'Keep FoundU safe: review reported posts and messages, and keep a record of every moderation action.',
    kept: 'Reports with the post; moderation records 1 year.  Your name is removed from your reports when you delete your data.',
    columns: {
      reports: ['report_id', 'organization_id', 'reporter_id', 'post_id', 'message_id', 'reason', 'details', 'status', 'action', 'handled_by', 'handled_at', 'created_at'],
      audit_log: ['audit_id', 'organization_id', 'actor_id', 'action', 'target_type', 'target_id', 'reason', 'created_at'],
    },
  },
  {
    data: 'Organization contact and settings',
    personal: true,
    purpose: 'Review an organization\'s access request, contact the person who made it, and apply its settings (domains, single sign-on, matching, retention).',
    kept: 'While the organization uses FoundU.',
    columns: { organizations: ['organization_id', 'name', 'type', 'email_domains', 'status', 'contact_name', 'contact_email', 'domain_token',
      'karma_enabled', 'qr_enabled', 'match_threshold', 'possible_threshold', 'match_weights', 'retention_months', 'sso_issuer',
      'sso_client_id', 'created_at', 'karma_rules', 'reviewed_at', 'reviewed_by', 'rejection_reason', 'sso_secret_enc', 'sso_enabled', 'sso_checked_at'] },
  },
  {
    data: 'Places, categories and badges',
    personal: false,
    purpose: 'Reference data of each organization: campuses, buildings, drop-off points (with their office phone), categories and the badge list.  No personal data.',
    kept: 'While the organization uses FoundU.',
    columns: {
      campuses: ['campus_id', 'organization_id', 'name', 'latitude', 'longitude'],
      locations: ['location_id', 'organization_id', 'campus_id', 'building', 'latitude', 'longitude'],
      dropoff_points: ['dropoff_id', 'organization_id', 'location_id', 'name', 'opening_hours', 'contact_number', 'is_active'],
      categories: ['category_id', 'organization_id', 'name', 'is_sensitive_default'],
      badges: ['badge_id', 'code', 'name', 'karma_threshold'],
      schema_migrations: ['name', 'applied_at'],
    },
  },
];

const RIGHTS = [
  'See and download everything FoundU keeps about you (My data, "Download my data").',
  'Correct your name, display name and campus (My data).',
  'Delete your data: your account is anonymized and your posts are removed (My data).',
  'Turn email notifications off, and hide yourself from the leaderboard (My activity).',
];

const RULES = [
  'Use FoundU only to return lost items, and follow the rules of your organization (at LAU, the acceptable use policy for IT resources and the student code of conduct).',
  'Post only items you lost or found.  Do not show names, ID or card numbers, or faces in descriptions and photos.',
  'Claim only what is yours.  False claims and fraud cost karma and can suspend the account.',
  'Reports are reviewed by your organization\'s security officers, who can hide or remove a post, warn, or suspend.',
];

module.exports = { ITEMS, RIGHTS, RULES };
