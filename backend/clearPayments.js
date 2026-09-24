require('dotenv').config();
const pool = require('./database/db');

async function clearPayments() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM payments');
    // Reset all tenant balances to 0 after clearing payments
    await client.query('UPDATE tenants SET balance = 0');
    await client.query('COMMIT');
    console.log('✅ All payment records cleared. Tenant balances reset to 0.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Failed:', e.message);
  } finally {
    client.release();
    process.exit();
  }
}

clearPayments();