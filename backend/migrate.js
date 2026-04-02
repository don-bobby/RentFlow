require('dotenv').config();
const pool = require('./database/db');

async function migrate() {
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT true
    `);
    await pool.query(`
      UPDATE users SET is_approved = true WHERE is_approved IS NULL
    `);
    console.log('✅ Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    process.exit();
  }
}

migrate();