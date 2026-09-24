const pool = require('./database/db');

async function run() {
  const caretakerRows = await pool.query(`
    SELECT participant_id, participant_type
    FROM conversation_participants
    WHERE participant_id IN (SELECT id FROM users WHERE role = 'caretaker');
  `);
  console.log('--- Caretaker participant rows ---');
  console.log(caretakerRows.rows);

  const convIds = await pool.query(`
    SELECT DISTINCT conversation_id
    FROM conversation_participants
    WHERE participant_id IN (SELECT id FROM users WHERE role = 'caretaker');
  `);
  const ids = convIds.rows.map(r => r.conversation_id);

  if (ids.length === 0) {
    console.log('No conversations found for any caretaker.');
    process.exit(0);
  }

  const allParticipants = await pool.query(`
    SELECT cp.conversation_id, cp.participant_id, cp.participant_type,
           COALESCE(u.name, t.full_name) AS name, u.role
    FROM conversation_participants cp
    LEFT JOIN users u ON u.id = cp.participant_id AND cp.participant_type = 'user'
    LEFT JOIN tenants t ON t.id = cp.participant_id AND cp.participant_type = 'tenant'
    WHERE cp.conversation_id = ANY($1::int[])
    ORDER BY cp.conversation_id;
  `, [ids]);
  console.log('--- All participants in those conversations ---');
  console.log(allParticipants.rows);

  const messages = await pool.query(`
    SELECT id, conversation_id, sender_id, sender_type, body, created_at
    FROM messages
    WHERE conversation_id = ANY($1::int[])
    ORDER BY conversation_id, created_at;
  `, [ids]);
  console.log('--- Messages in those conversations ---');
  console.log(messages.rows);

  process.exit(0);
}

run();