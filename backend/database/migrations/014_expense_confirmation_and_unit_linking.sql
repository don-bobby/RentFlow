-- 014_expense_confirmation_and_unit_linking.sql
-- Supports the new maintenance → expense workflow:
--   - A caretaker closing out a maintenance request can attach a cost,
--     which creates an expense — but as 'pending', not counted as real
--     spend until a landlord/admin/agent confirms it (expenses.edit).
--   - Expenses can now be traced back to the maintenance request that
--     caused them, and tied to a specific unit, not just a property.
--
-- All new columns are nullable/defaulted, so every existing expense row
-- is automatically a 'confirmed' expense with no linked maintenance
-- request and no house — i.e. behaves exactly as it did before this
-- migration. Nothing here changes existing data.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS house_id INTEGER REFERENCES houses(id),
  ADD COLUMN IF NOT EXISTS maintenance_request_id INTEGER REFERENCES maintenance_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed')),
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS confirmed_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_expenses_status                 ON expenses (status);
CREATE INDEX IF NOT EXISTS idx_expenses_maintenance_request_id ON expenses (maintenance_request_id);
CREATE INDEX IF NOT EXISTS idx_expenses_house_id                ON expenses (house_id);
