require('dotenv').config();
const pool = require('./database/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create junction table
    await client.query(`
      CREATE TABLE IF NOT EXISTS caretaker_plots (
        id          SERIAL PRIMARY KEY,
        caretaker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plot_id      INTEGER NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
        assigned_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(caretaker_id, plot_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_caretaker_plots_caretaker ON caretaker_plots(caretaker_id);
    `);

    // Migrate existing single plot_id assignments into the new table
    await client.query(`
      INSERT INTO caretaker_plots (caretaker_id, plot_id)
      SELECT id, plot_id FROM users
      WHERE role = 'caretaker' AND plot_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('✅ Migration complete — caretaker_plots table created and existing assignments migrated.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', e.message);
  } finally {
    client.release();
    process.exit();
  }
}
migrate();
