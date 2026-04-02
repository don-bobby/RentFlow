/**
 * backend/jobs/balanceUpdater.js
 *
 * Runs daily at midnight and checks all active tenants.
 * If today is past their rent_due_day and no payment has been
 * recorded for this month, it adds their rent amount to their balance.
 */

const cron = require('node-cron');
const pool = require('../database/db');

async function updateBalances() {
  console.log('💰 Running daily balance update...');

  const today    = new Date();
  const todayDay = today.getDate();        // e.g. 15
  const month    = today.getMonth() + 1;  // e.g. 3 (March)
  const year     = today.getFullYear();   // e.g. 2026

  try {
    // Get all active tenants with their rent amount
    const { rows: tenants } = await pool.query(`
      SELECT t.id, t.full_name, t.rent_due_day, t.balance, h.rent_amount
      FROM tenants t
      JOIN houses h ON t.house_id = h.id
      WHERE t.is_active = true
    `);

    let updated = 0;

    for (const tenant of tenants) {
      // Only process tenants whose due day has passed this month
      if (todayDay < tenant.rent_due_day) continue;

      // Check if a payment has already been recorded for this month
      const { rows: payments } = await pool.query(`
        SELECT id FROM payments
        WHERE tenant_id = $1
          AND EXTRACT(MONTH FROM payment_date) = $2
          AND EXTRACT(YEAR  FROM payment_date) = $3
        LIMIT 1
      `, [tenant.id, month, year]);

      if (payments.length > 0) {
        // Payment exists this month — make sure balance is 0
        await pool.query(
          'UPDATE tenants SET balance = 0 WHERE id = $1 AND balance < 0',
          [tenant.id]
        );
        continue;
      }

      // No payment this month — add rent amount to balance if not already added
      // We track this by checking if balance already reflects this month's unpaid rent
      const currentBalance = parseFloat(tenant.balance || 0);
      const rentAmount     = parseFloat(tenant.rent_amount || 0);

      // Only add rent if balance hasn't already been incremented this month
      // We store a monthly_charged flag by checking payment logs
      const { rows: charged } = await pool.query(`
        SELECT id FROM payments
        WHERE tenant_id = $1
          AND method = 'balance_charge'
          AND EXTRACT(MONTH FROM payment_date) = $2
          AND EXTRACT(YEAR  FROM payment_date) = $3
        LIMIT 1
      `, [tenant.id, month, year]);

      if (charged.length > 0) continue; // Already charged this month

      // Add rent to balance
      await pool.query(
        'UPDATE tenants SET balance = balance + $1 WHERE id = $2',
        [rentAmount, tenant.id]
      );

      // Log a balance charge record so we don't charge twice
      await pool.query(`
        INSERT INTO payments (tenant_id, house_id, amount, payment_date, method, status, notes)
        SELECT t.id, t.house_id, h.rent_amount, NOW(), 'balance_charge', 'unmatched',
               'Auto-charged: rent due ' || $1
        FROM tenants t
        JOIN houses h ON t.house_id = h.id
        WHERE t.id = $2
      `, [`${year}-${String(month).padStart(2,'0')}`, tenant.id]);

      console.log(`  → Charged KES ${rentAmount} to ${tenant.full_name}`);
      updated++;
    }

    console.log(`✅ Balance update complete — ${updated} tenant(s) charged.`);
  } catch (err) {
    console.error('❌ Balance update error:', err.message);
  }
}

// Run every day at midnight
cron.schedule('0 0 * * *', updateBalances);

// Also run once immediately on server start (for testing)
// Comment this out in production if you don't want it running on every restart
// updateBalances();

console.log('⏰ Balance updater scheduled (runs daily at midnight)');

module.exports = { updateBalances };
