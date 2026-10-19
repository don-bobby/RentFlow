-- 015_recurring_expenses.sql
-- Supports recurring bills (garbage collection, water, electricity, etc.)
-- that repeat every month without being re-entered by hand each time.
-- A recurring_expenses row is a TEMPLATE, not an actual expense — scoped to
-- either a whole property (house_id NULL) or one specific unit, same as a
-- normal expense. A daily cron job (jobs/recurringExpenseGenerator.js)
-- reads active templates and, once each month, inserts a real row into
-- `expenses` for whichever one is due — those generated rows are ordinary
-- expenses (they show up in Expenses, reports, Dashboard spend totals) and
-- are tagged back to their template via expenses.recurring_expense_id so
-- the UI can show a "Recurring" badge on them.
--
-- day_of_month is capped at 28 so every month actually has that day,
-- rather than a day_of_month=31 template silently skipping February.

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id                    SERIAL PRIMARY KEY,
  plot_id               INTEGER REFERENCES plots(id),
  house_id              INTEGER REFERENCES houses(id),
  category              VARCHAR(50) NOT NULL,
  description           TEXT,
  amount                DECIMAL(10,2) NOT NULL,
  day_of_month          INTEGER NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  last_generated_period VARCHAR(7), -- 'YYYY-MM' of the last expense this template generated
  created_by            INTEGER REFERENCES users(id),
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_active ON recurring_expenses (is_active);

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS recurring_expense_id INTEGER REFERENCES recurring_expenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_recurring_expense_id ON expenses (recurring_expense_id);
