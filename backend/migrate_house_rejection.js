require('dotenv').config();
const pool = require('./database/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS rejection_reason TEXT;`);
    await client.query('COMMIT');
    console.log('✅ Migration complete — rejection_reason column added to houses.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', e.message);
  } finally {
    client.release();
    process.exit();
  }
}
migrate();
