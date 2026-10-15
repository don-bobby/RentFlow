-- Follow-up to add_sms_bulk_batches.sql — one more nullable column so a bulk
-- SMS log row sent to a landlord or agent can be traced back to exactly who
-- it went to, the same way tenant_id already does for a tenant recipient.
-- Without this, building the delivered/undelivered report for a landlord
-- recipient would mean matching on phone number, which breaks the moment a
-- number is reformatted or a landlord changes their phone later.
ALTER TABLE sms_logs
  ADD COLUMN landlord_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
