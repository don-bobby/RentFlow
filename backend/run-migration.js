// One-time script to apply migrations/002_reports_features.sql
// Run with:  node run-migration.js
// Safe to re-run — every statement in the SQL file uses IF NOT EXISTS.

const fs   = require('fs');
const path = require('path');
const pool = require('./database/db');

const migrationPath = path.join(__dirname, 'database', 'migrations', '002_reports_features.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

console.log('Applying migration:', migrationPath);

pool.query(sql)
  .then(() => {
    console.log('✅ Migration applied successfully.');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  });