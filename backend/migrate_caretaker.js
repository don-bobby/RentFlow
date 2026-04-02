require('dotenv').config();
const pool = require('./database/db');

async function migrate() {
  try {
    // Add plot_id column to users for caretaker assignment
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plot_id INTEGER REFERENCES plots(id) ON DELETE SET NULL
    `);
    console.log('✅ Migration done: added plot_id to users table');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    process.exit();
  }
}

migrate();