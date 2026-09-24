require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./database/db');

const TENANT_ID = 1;   // change to the tenant's id
const PIN = '1234';    // change to whatever PIN you want

bcrypt.hash(PIN, 10).then(hash => {
  return pool.query('UPDATE tenants SET pin = $1 WHERE id = $2', [hash, TENANT_ID]);
}).then(() => {
  console.log('✅ PIN set successfully');
  process.exit();
}).catch(e => {
  console.error(e);
  process.exit();
});