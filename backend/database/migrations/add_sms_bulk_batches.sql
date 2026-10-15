-- Bulk SMS — adds support for sending one message to many recipients at
-- once (all tenants / one property / tenants in arrears / all landlords
-- & agents / a manually picked list), with a per-batch delivered/undelivered
-- report. Builds on the existing sms_logs table rather than replacing it —
-- the existing single free-form send (POST /sms/send) and the automatic
-- arrears-reminder blast (POST /sms/send-reminders) are untouched and keep
-- writing rows with no batch_id, exactly as before.

-- One row per bulk send: who sent it, what was sent, which recipient scope
-- was used, and running totals for the report.
CREATE TABLE sms_batches (
  id               SERIAL PRIMARY KEY,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message_template TEXT NOT NULL,
  scope            VARCHAR(20) NOT NULL,  -- 'all_tenants' | 'property' | 'arrears' | 'landlords' | 'manual'
  scope_plot_id    INTEGER REFERENCES plots(id) ON DELETE SET NULL,  -- only set when scope = 'property'
  total_count      INTEGER NOT NULL DEFAULT 0,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- Ties a log row back to the batch it belongs to (NULL for anything sent
-- outside this feature), and to the specific tenant it went to (NULL for a
-- landlord/agent recipient, who has no tenants row at all). recipient_type
-- tells a tenant row apart from a landlord/agent row within the same batch,
-- since both can appear together once a future "everyone" scope is added.
ALTER TABLE sms_logs
  ADD COLUMN batch_id       INTEGER REFERENCES sms_batches(id) ON DELETE SET NULL,
  ADD COLUMN tenant_id      INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN recipient_type VARCHAR(20);  -- 'tenant' | 'landlord' | 'agent' (NULL for pre-existing/non-bulk rows)

CREATE INDEX idx_sms_logs_batch_id ON sms_logs(batch_id);
