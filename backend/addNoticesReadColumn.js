const pool = require('./database/db');

async function run() {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_notices_read_at TIMESTAMP;
  `);
  console.log('Migration complete: users.last_notices_read_at added.');
  process.exit(0);
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
