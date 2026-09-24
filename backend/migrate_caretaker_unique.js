require('dotenv').config();
const pool = require('./database/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Add unique constraint on plot_id in caretaker_plots
    // First remove any duplicate assignments (keep the most recent)
    await client.query(`
      DELETE FROM caretaker_plots a
      USING caretaker_plots b
      WHERE a.id < b.id AND a.plot_id = b.plot_id;
    `);

    // Now add the unique constraint
    await client.query(`
      ALTER TABLE caretaker_plots
      ADD CONSTRAINT unique_plot_caretaker UNIQUE (plot_id);
    `);

    await client.query('COMMIT');
    console.log('✅ Migration complete — one caretaker per property enforced.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', e.message);
  } finally {
    client.release();
    process.exit();
  }
}
migrate();
