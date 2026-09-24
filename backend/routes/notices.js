const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function tenantAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'tenant') return res.status(403).json({ error: 'Tenant only' });
    req.tenant = decoded;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ── Helper: find or create conversation ───────────────────────────────────────
async function findOrCreateConversation(p1Id, p1Type, p2Id, p2Type, noticeId = null) {
  const existing = await pool.query(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants cp1 ON cp1.conversation_id=c.id AND cp1.participant_id=$1 AND cp1.participant_type=$2
    JOIN conversation_participants cp2 ON cp2.conversation_id=c.id AND cp2.participant_id=$3 AND cp2.participant_type=$4
    LIMIT 1
  `, [p1Id, p1Type, p2Id, p2Type]);
  if (existing.rows[0]) return existing.rows[0].id;

  const conv = await pool.query(
    `INSERT INTO conversations (notice_id) VALUES ($1) RETURNING id`,
    [noticeId || null]
  );
  const convId = conv.rows[0].id;
  await pool.query(
    `INSERT INTO conversation_participants (conversation_id, participant_id, participant_type)
     VALUES ($1,$2,$3),($1,$4,$5)`,
    [convId, p1Id, p1Type, p2Id, p2Type]
  );
  return convId;
}

// ═══════════════════════════════════════════════════════════════
// STATIC ROUTES FIRST (before any /:param routes)
// ═══════════════════════════════════════════════════════════════

// GET /api/notices/unread-count
router.get('/unread-count', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) AS count FROM messages m
      JOIN conversation_participants cp
        ON cp.conversation_id=m.conversation_id
        AND cp.participant_id=$1 AND cp.participant_type='user'
      WHERE m.created_at > COALESCE(cp.last_read_at,'1970-01-01')
        AND (m.sender_id!=$1 OR m.sender_type!='user')
    `, [req.user.id]);
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notices/unread-summary — combined messages+notices unread count, for the sidebar badge
router.get('/unread-summary', auth, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT last_notices_read_at FROM users WHERE id=$1', [req.user.id]);
    const lastRead = userRes.rows[0]?.last_notices_read_at || '1970-01-01';

    const msgResult = await pool.query(`
      SELECT COUNT(*) AS count FROM messages m
      JOIN conversation_participants cp
        ON cp.conversation_id=m.conversation_id
        AND cp.participant_id=$1 AND cp.participant_type='user'
      WHERE m.created_at > COALESCE(cp.last_read_at,'1970-01-01')
        AND (m.sender_id!=$1 OR m.sender_type!='user')
    `, [req.user.id]);

    let noticesResult;
    if (req.user.role === 'admin') {
      noticesResult = await pool.query(
        `SELECT COUNT(*) AS count FROM notices n WHERE n.created_at > $1`,
        [lastRead]
      );
    } else if (req.user.role === 'landlord') {
      noticesResult = await pool.query(`
        SELECT COUNT(*) AS count FROM notices n
        WHERE n.created_at > $1
          AND (n.author_id=$2 OR n.target_type='all'
            OR (n.target_type='property' AND n.target_id IN (SELECT id FROM plots WHERE user_id=$2)))
      `, [lastRead, req.user.id]);
    } else if (req.user.role === 'caretaker') {
      noticesResult = await pool.query(`
        SELECT COUNT(*) AS count FROM notices n
        WHERE n.created_at > $1
          AND (n.target_type='all'
            OR (n.target_type='property' AND n.target_id IN (
              SELECT plot_id FROM caretaker_plots WHERE caretaker_id=$2
              UNION SELECT plot_id FROM users WHERE id=$2 AND plot_id IS NOT NULL
            )))
      `, [lastRead, req.user.id]);
    } else {
      noticesResult = { rows: [{ count: 0 }] };
    }

    const messages = parseInt(msgResult.rows[0].count);
    const notices  = parseInt(noticesResult.rows[0].count);
    res.json({ messages, notices, total: messages + notices });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notices/mark-notices-read — call when staff opens the Notices tab
router.post('/mark-notices-read', auth, async (req, res) => {
  try {
    await pool.query('UPDATE users SET last_notices_read_at=NOW() WHERE id=$1', [req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notices/tenant-unread-count
router.get('/tenant-unread-count', tenantAuth, async (req, res) => {
  try {
    const tenantRes = await pool.query(
      `SELECT t.id, t.house_id, h.plot_id FROM tenants t
       LEFT JOIN houses h ON t.house_id=h.id WHERE t.id=$1`,
      [req.tenant.id]
    );
    const tenant = tenantRes.rows[0];
    if (!tenant) return res.json({ notices: 0, messages: 0 });

    const [nr, mr] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) AS count FROM notices n
        WHERE (n.expires_at IS NULL OR n.expires_at > NOW())
          AND NOT EXISTS(SELECT 1 FROM notice_reads WHERE notice_id=n.id AND tenant_id=$1)
          AND (n.target_type='all'
            OR (n.target_type='property' AND n.target_id=$2)
            OR (n.target_type='unit'     AND n.target_id=$3)
            OR (n.target_type='tenant'   AND n.target_id=$1))
      `, [tenant.id, tenant.plot_id, tenant.house_id]),
      pool.query(`
        SELECT COUNT(*) AS count FROM messages m
        JOIN conversation_participants cp
          ON cp.conversation_id=m.conversation_id
          AND cp.participant_id=$1 AND cp.participant_type='tenant'
        WHERE m.created_at > COALESCE(cp.last_read_at,'1970-01-01')
          AND (m.sender_id!=$1 OR m.sender_type!='tenant')
      `, [tenant.id]),
    ]);

    res.json({ notices: parseInt(nr.rows[0].count), messages: parseInt(mr.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notices/tenant — notices for tenant portal
router.get('/tenant', tenantAuth, async (req, res) => {
  try {
    const tenantRes = await pool.query(
      `SELECT t.id, t.house_id, h.plot_id FROM tenants t
       LEFT JOIN houses h ON t.house_id=h.id WHERE t.id=$1`,
      [req.tenant.id]
    );
    const tenant = tenantRes.rows[0];
    if (!tenant) return res.json({ success: true, data: [] });

    const result = await pool.query(`
      SELECT n.*, u.name AS author_name,
             EXISTS(SELECT 1 FROM notice_reads WHERE notice_id=n.id AND tenant_id=$1) AS is_read
      FROM notices n
      JOIN users u ON n.author_id=u.id
      WHERE (n.expires_at IS NULL OR n.expires_at > NOW())
        AND (n.target_type='all'
          OR (n.target_type='property' AND n.target_id=$2)
          OR (n.target_type='unit'     AND n.target_id=$3)
          OR (n.target_type='tenant'   AND n.target_id=$1))
      ORDER BY n.created_at DESC
    `, [tenant.id, tenant.plot_id, tenant.house_id]);

    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notices/conversations — staff conversations list
router.get('/conversations', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.created_at, c.updated_at, c.notice_id,
             n.title AS notice_title,
             (SELECT body FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
             (SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
             (SELECT COUNT(*) FROM messages m
              JOIN conversation_participants cp ON cp.conversation_id=m.conversation_id AND cp.participant_id=$1 AND cp.participant_type='user'
              WHERE m.conversation_id=c.id AND m.created_at > COALESCE(cp.last_read_at,'1970-01-01')
                AND (m.sender_id!=$1 OR m.sender_type!='user')) AS unread_count,
             COALESCE(u.name, t.full_name) AS other_name,
             cp2.participant_type AS other_type
      FROM conversations c
      JOIN conversation_participants cp1 ON cp1.conversation_id=c.id AND cp1.participant_id=$1 AND cp1.participant_type='user'
      JOIN conversation_participants cp2 ON cp2.conversation_id=c.id AND (cp2.participant_id!=$1 OR cp2.participant_type!='user')
      LEFT JOIN users u ON u.id=cp2.participant_id AND cp2.participant_type='user'
      LEFT JOIN tenants t ON t.id=cp2.participant_id AND cp2.participant_type='tenant'
      LEFT JOIN notices n ON n.id=c.notice_id
      ORDER BY c.updated_at DESC
    `, [req.user.id]);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notices/conversations/tenant — tenant conversations list
router.get('/conversations/tenant', tenantAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.created_at, c.updated_at, c.notice_id,
             n.title AS notice_title,
             (SELECT body FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
             (SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
             (SELECT COUNT(*) FROM messages m
              JOIN conversation_participants cp ON cp.conversation_id=m.conversation_id AND cp.participant_id=$1 AND cp.participant_type='tenant'
              WHERE m.conversation_id=c.id AND m.created_at > COALESCE(cp.last_read_at,'1970-01-01')
                AND (m.sender_id!=$1 OR m.sender_type!='tenant')) AS unread_count,
             COALESCE(u.name, t2.full_name) AS other_name,
             cp2.participant_type AS other_type
      FROM conversations c
      JOIN conversation_participants cp1 ON cp1.conversation_id=c.id AND cp1.participant_id=$1 AND cp1.participant_type='tenant'
      JOIN conversation_participants cp2 ON cp2.conversation_id=c.id AND (cp2.participant_id!=$1 OR cp2.participant_type!='tenant')
      LEFT JOIN users u ON u.id=cp2.participant_id AND cp2.participant_type='user'
      LEFT JOIN tenants t2 ON t2.id=cp2.participant_id AND cp2.participant_type='tenant'
      LEFT JOIN notices n ON n.id=c.notice_id
      ORDER BY c.updated_at DESC
    `, [req.tenant.id]);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notices/conversations/new — staff starts new conversation
router.post('/conversations/new', auth, async (req, res) => {
  const { recipient_id, recipient_type } = req.body;
  if (!recipient_id || !recipient_type) return res.status(400).json({ error: 'recipient_id and recipient_type required.' });
  try {
    const convId = await findOrCreateConversation(req.user.id, 'user', parseInt(recipient_id), recipient_type);
    res.json({ success: true, conversation_id: convId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notices/conversations/new/tenant — tenant starts new conversation
router.post('/conversations/new/tenant', tenantAuth, async (req, res) => {
  const { recipient_id, recipient_type } = req.body;
  if (!recipient_id || !recipient_type) return res.status(400).json({ error: 'recipient_id and recipient_type required.' });
  try {
    const convId = await findOrCreateConversation(req.tenant.id, 'tenant', parseInt(recipient_id), recipient_type);
    res.json({ success: true, conversation_id: convId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notices/conversations/:id/messages — staff reads messages
router.get('/conversations/:id/messages', auth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE conversation_participants SET last_read_at=NOW()
       WHERE conversation_id=$1 AND participant_id=$2 AND participant_type='user'`,
      [req.params.id, req.user.id]
    );
    const result = await pool.query(`
      SELECT m.*, COALESCE(u.name, t.full_name) AS sender_name
      FROM messages m
      LEFT JOIN users u ON u.id=m.sender_id AND m.sender_type='user'
      LEFT JOIN tenants t ON t.id=m.sender_id AND m.sender_type='tenant'
      WHERE m.conversation_id=$1 ORDER BY m.created_at ASC
    `, [req.params.id]);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notices/conversations/:id/messages/tenant — tenant reads messages
router.get('/conversations/:id/messages/tenant', tenantAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE conversation_participants SET last_read_at=NOW()
       WHERE conversation_id=$1 AND participant_id=$2 AND participant_type='tenant'`,
      [req.params.id, req.tenant.id]
    );
    const result = await pool.query(`
      SELECT m.*, COALESCE(u.name, t.full_name) AS sender_name
      FROM messages m
      LEFT JOIN users u ON u.id=m.sender_id AND m.sender_type='user'
      LEFT JOIN tenants t ON t.id=m.sender_id AND m.sender_type='tenant'
      WHERE m.conversation_id=$1 ORDER BY m.created_at ASC
    `, [req.params.id]);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notices/conversations/:id/messages — staff sends message
router.post('/conversations/:id/messages', auth, async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Message cannot be empty.' });
  try {
    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, sender_type, body) VALUES ($1,$2,'user',$3) RETURNING *`,
      [req.params.id, req.user.id, body.trim()]
    );
    await pool.query(`UPDATE conversations SET updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ success: true, data: { ...result.rows[0], sender_name: req.user.name } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notices/conversations/:id/messages/tenant — tenant sends message
router.post('/conversations/:id/messages/tenant', tenantAuth, async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Message cannot be empty.' });
  try {
    const tenantRes = await pool.query('SELECT full_name FROM tenants WHERE id=$1', [req.tenant.id]);
    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, sender_type, body) VALUES ($1,$2,'tenant',$3) RETURNING *`,
      [req.params.id, req.tenant.id, body.trim()]
    );
    await pool.query(`UPDATE conversations SET updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ success: true, data: { ...result.rows[0], sender_name: tenantRes.rows[0]?.full_name } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// PARAMETERIZED ROUTES LAST
// ═══════════════════════════════════════════════════════════════

// GET /api/notices — staff notices list
router.get('/', auth, async (req, res) => {
  try {
    let query, params = [];
    if (req.user.role === 'admin') {
      query = `SELECT n.*, u.name AS author_name, COUNT(DISTINCT nr.tenant_id) AS read_count
               FROM notices n JOIN users u ON n.author_id=u.id
               LEFT JOIN notice_reads nr ON nr.notice_id=n.id
               GROUP BY n.id, u.name ORDER BY n.created_at DESC`;
    } else if (req.user.role === 'landlord') {
      query = `SELECT n.*, u.name AS author_name, COUNT(DISTINCT nr.tenant_id) AS read_count
               FROM notices n JOIN users u ON n.author_id=u.id
               LEFT JOIN notice_reads nr ON nr.notice_id=n.id
               WHERE n.author_id=$1 OR n.target_type='all'
                 OR (n.target_type='property' AND n.target_id IN (SELECT id FROM plots WHERE user_id=$1))
               GROUP BY n.id, u.name ORDER BY n.created_at DESC`;
      params = [req.user.id];
    } else if (req.user.role === 'caretaker') {
      query = `SELECT n.*, u.name AS author_name, COUNT(DISTINCT nr.tenant_id) AS read_count
               FROM notices n JOIN users u ON n.author_id=u.id
               LEFT JOIN notice_reads nr ON nr.notice_id=n.id
               WHERE n.target_type='all'
                 OR (n.target_type='property' AND n.target_id IN (
                   SELECT plot_id FROM caretaker_plots WHERE caretaker_id=$1
                   UNION SELECT plot_id FROM users WHERE id=$1 AND plot_id IS NOT NULL
                 ))
               GROUP BY n.id, u.name ORDER BY n.created_at DESC`;
      params = [req.user.id];
    } else {
      return res.json({ success: true, data: [] });
    }
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notices — create notice
router.post('/', auth, async (req, res) => {
  if (!['admin', 'landlord'].includes(req.user.role))
    return res.status(403).json({ error: 'Only admins and landlords can post notices.' });
  const { title, body, priority, target_type, target_id, expires_at } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body are required.' });
  try {
    const result = await pool.query(
      `INSERT INTO notices (author_id, title, body, priority, target_type, target_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, title, body, priority || 'info', target_type || 'all', target_id || null, expires_at || null]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notices/:noticeId/reply — tenant replies to a notice
router.post('/:noticeId/reply', tenantAuth, async (req, res) => {
  try {
    const notice = await pool.query('SELECT author_id FROM notices WHERE id=$1', [req.params.noticeId]);
    if (!notice.rows[0]) return res.status(404).json({ error: 'Notice not found.' });
    const convId = await findOrCreateConversation(
      req.tenant.id, 'tenant',
      notice.rows[0].author_id, 'user',
      parseInt(req.params.noticeId)
    );
    res.json({ success: true, conversation_id: convId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notices/:id/read — tenant marks notice as read
router.post('/:id/read', tenantAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO notice_reads (notice_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.tenant.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/notices/:id
router.delete('/:id', auth, async (req, res) => {
  if (!['admin', 'landlord'].includes(req.user.role))
    return res.status(403).json({ error: 'Access denied.' });
  try {
    await pool.query(
      `DELETE FROM notices WHERE id=$1 AND (author_id=$2 OR $3='admin')`,
      [req.params.id, req.user.id, req.user.role]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
