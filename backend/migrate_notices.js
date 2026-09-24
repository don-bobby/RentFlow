require('dotenv').config();
const pool = require('./database/db');

async function migrate() {
  console.log('🔄 Creating notices and messaging tables...');
  try {
    await pool.query(`
      -- Notices table
      CREATE TABLE IF NOT EXISTS notices (
        id          SERIAL PRIMARY KEY,
        author_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title       VARCHAR(255) NOT NULL,
        body        TEXT NOT NULL,
        priority    VARCHAR(20) DEFAULT 'info',  -- info | warning | urgent
        target_type VARCHAR(20) DEFAULT 'all',   -- all | property | unit | tenant
        target_id   INTEGER,
        expires_at  TIMESTAMP,
        created_at  TIMESTAMP DEFAULT NOW()
      );

      -- Track which tenants have read which notices
      CREATE TABLE IF NOT EXISTS notice_reads (
        notice_id   INTEGER REFERENCES notices(id) ON DELETE CASCADE,
        tenant_id   INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        read_at     TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (notice_id, tenant_id)
      );

      -- Conversations (for messaging between staff and tenants)
      CREATE TABLE IF NOT EXISTS conversations (
        id          SERIAL PRIMARY KEY,
        notice_id   INTEGER REFERENCES notices(id) ON DELETE SET NULL,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );

      -- Participants in each conversation
      CREATE TABLE IF NOT EXISTS conversation_participants (
        conversation_id  INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
        participant_id   INTEGER NOT NULL,
        participant_type VARCHAR(10) NOT NULL,  -- 'user' | 'tenant'
        last_read_at     TIMESTAMP,
        PRIMARY KEY (conversation_id, participant_id, participant_type)
      );

      -- Messages
      CREATE TABLE IF NOT EXISTS messages (
        id               SERIAL PRIMARY KEY,
        conversation_id  INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id        INTEGER NOT NULL,
        sender_type      VARCHAR(10) NOT NULL,  -- 'user' | 'tenant'
        body             TEXT NOT NULL,
        created_at       TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('✅ Notices and messaging tables created successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    process.exit();
  }
}

migrate();
