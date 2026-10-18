-- 013_staff_activity_log.sql
-- Staff-side companion to tenant_activity_log (012). Tracks staff logins
-- plus a focused set of "checked" actions the user asked for specifically:
-- viewing a tenant's statement, opening a report, and downloading the bulk
-- statements zip. Does NOT log every GET request — that would be noise,
-- not signal. "Updated" activity (creates/updates/deletes) is NOT
-- duplicated here either — it's already fully captured in the existing
-- audit_log table and is merged in at query time by the /api/user-activity
-- endpoint, same as how tenant notice-reads are derived from notice_reads
-- rather than copied into tenant_activity_log.

CREATE TABLE IF NOT EXISTS staff_activity_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     VARCHAR(30) NOT NULL CHECK (action IN ('login', 'statement_viewed', 'report_viewed', 'bulk_statements_downloaded')),
  detail     TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_activity_log_user_time ON staff_activity_log (user_id, created_at);
