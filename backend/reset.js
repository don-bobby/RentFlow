require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./database/db');

bcrypt.hash('Admin@123', 10).then(h =>
  pool.query('UPDATE users SET password = $1 WHERE id = $2', [h, 1])
).then(() => {
  console.log('Password reset successfully!');
  process.exit();
}).catch(e => {
  console.error(e);
  process.exit();
});