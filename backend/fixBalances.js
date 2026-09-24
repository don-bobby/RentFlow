require('dotenv').config();
const pool = require('./database/db');

async function fixBalances() {
  console.log('🔄 Recalculating all tenant balances from move-in date...\n');

  try {
    // Recalculate balance for all active tenants
    await pool.query(`
      UPDATE tenants SET balance = GREATEST(0,
        GREATEST(1,
          (EXTRACT(YEAR FROM NOW()) - EXTRACT(YEAR FROM move_in_date)) * 12 +
          (EXTRACT(MONTH FROM NOW()) - EXTRACT(MONTH FROM move_in_date)) + 1
        ) * (SELECT rent_amount FROM houses WHERE id = tenants.house_id) -
        COALESCE((
          SELECT SUM(amount) FROM payments
          WHERE tenant_id = tenants.id AND method != 'balance_charge'
        ), 0)
      )
      WHERE is_active = true AND move_in_date IS NOT NULL
    `);

    // Show results
    const { rows } = await pool.query(`
      SELECT
        t.full_name,
        t.move_in_date,
        h.rent_amount,
        GREATEST(1,
          (EXTRACT(YEAR FROM NOW()) - EXTRACT(YEAR FROM t.move_in_date)) * 12 +
          (EXTRACT(MONTH FROM NOW()) - EXTRACT(MONTH FROM t.move_in_date)) + 1
        ) AS months,
        COALESCE((
          SELECT SUM(amount) FROM payments
          WHERE tenant_id = t.id AND method != 'balance_charge'
        ), 0) AS total_paid,
        t.balance
      FROM tenants t
      JOIN houses h ON t.house_id = h.id
      WHERE t.is_active = true
      ORDER BY t.full_name
    `);

    console.log('─'.repeat(100));
    console.log(
      'Tenant'.padEnd(26) +
      'Move-in'.padEnd(13) +
      'Months'.padEnd(8) +
      'Rent/mo'.padEnd(11) +
      'Total Due'.padEnd(13) +
      'Total Paid'.padEnd(13) +
      'Balance'
    );
    console.log('─'.repeat(100));

    rows.forEach(t => {
      const months   = parseInt(t.months);
      const rent     = parseFloat(t.rent_amount);
      const due      = months * rent;
      const paid     = parseFloat(t.total_paid);
      const balance  = parseFloat(t.balance);
      const status   = balance === 0 ? '✅' : paid > 0 ? '⚠️' : '❌';

      console.log(
        t.full_name.substring(0, 25).padEnd(26) +
        new Date(t.move_in_date).toLocaleDateString('en-KE').padEnd(13) +
        `${months}m`.padEnd(8) +
        `${rent.toLocaleString()}`.padEnd(11) +
        `${due.toLocaleString()}`.padEnd(13) +
        `${paid.toLocaleString()}`.padEnd(13) +
        `${balance.toLocaleString()} ${status}`
      );
    });

    console.log('─'.repeat(100));
    console.log('\n✅ All balances recalculated successfully!');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit();
  }
}

fixBalances();
