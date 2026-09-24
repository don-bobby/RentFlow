require('dotenv').config();
const pool = require('./database/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT true;`);
    await client.query(`UPDATE houses SET is_approved = true WHERE is_approved IS NULL;`);
    await client.query('COMMIT');
    console.log('✅ Migration complete — is_approved column added to houses.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', e.message);
  } finally {
    client.release();
    process.exit();
  }
}
migrate();
