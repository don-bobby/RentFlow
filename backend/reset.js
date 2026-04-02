require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./database/db');

async function reset() {
  const hash = await bcrypt.hash('admin123', 10);
  await pool.query('UPDATE users SET password=$1 WHERE id=1', [hash]);
  console.log('Password reset to admin123');
  process.exit();
}

reset().catch(e => { console.error(e); process.exit(); });