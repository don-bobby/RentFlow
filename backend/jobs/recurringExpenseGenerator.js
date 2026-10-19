const cron = require('node-cron');
const pool = require('../database/db');

// ── Recurring expense generator — runs daily at 1AM ───────────────────────
// For every active recurring_expenses template whose day_of_month has
// already passed (or is today) in the current calendar month, and that
// hasn't generated one yet THIS month (last_generated_period check), insert
// a real `expenses` row and stamp the template as done for this period.
//
// Runs daily rather than only on each template's exact day so a missed day
// (server down, deploy mid-day, etc.) still catches up automatically next
// run — "day_of_month <= today" plus the per-period guard makes this safe
// to run repeatedly without ever double-generating the same month's bill.
//
// Generated rows are trusted immediately (status='confirmed'), same as any
// landlord/admin/agent-entered expense — there's no caretaker involved in a
// recurring bill, so the pending-confirmation flow (see migration 014)
// doesn't apply here.
cron.schedule('0 1 * * *', async () => {
  console.log('Running recurring expense generator...');
  try {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const today = now.getDate();

    const due = await pool.query(
      `SELECT * FROM recurring_expenses
       WHERE is_active = true
         AND day_of_month <= $1
         AND (last_generated_period IS NULL OR last_generated_period != $2)`,
      [today, period]
    );

    let generated = 0;
    for (const tmpl of due.rows) {
      const expenseDate = new Date(now.getFullYear(), now.getMonth(), Math.min(tmpl.day_of_month, today));
      try {
        await pool.query(
          `INSERT INTO expenses
             (plot_id, house_id, category, description, amount, expense_date,
              status, created_by, confirmed_by, confirmed_at, recurring_expense_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $7, NOW(), $8)`,
          [
            tmpl.plot_id, tmpl.house_id, tmpl.category,
            tmpl.description || `${tmpl.category} (recurring)`,
            tmpl.amount, expenseDate, tmpl.created_by, tmpl.id,
          ]
        );
        await pool.query(
          `UPDATE recurring_expenses SET last_generated_period = $1 WHERE id = $2`,
          [period, tmpl.id]
        );
        generated++;
      } catch (e) {
        console.error(`Recurring expense generation failed for template ${tmpl.id}:`, e.message);
      }
    }
    if (generated > 0) console.log(`✅ Generated ${generated} recurring expense(s) for ${period}.`);
  } catch (err) {
    console.error('Recurring expense generator error:', err.message);
  }
});

console.log('✅ Cron job scheduled: recurring expense generator');
