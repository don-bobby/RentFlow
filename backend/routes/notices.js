const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');

// This file was the one staff route file in the whole backend still using
// its own copy-pasted auth() instead of the shared middleware/auth.js —
// every other file (tenants.js, payments.js, plots.js, houses.js,
// expenses.js, maintenance.js, mpesa.js, listings.js, sms.js) already
// migrated to it. Importing the shared one instead of hand-patching the
// local copy gets two things the local version still couldn't do even
// after rejecting tenant tokens:
//   1. Role/approval is re-read from the DB on every request instead of
//      trusted from the (up to 7-day-old) JWT, so a role change, a
//      suspended agent, or an un-approved landlord is cut off immediately
//      instead of keeping notices/messaging access until their token
//      expires — which is exactly what every other route already does.
//   2. A deleted user's token stops working here too, not just elsewhere.
const { authMiddleware: auth } = require('../middleware/auth');
const { logTenantActivity } = require('../utils/tenantActivity');

// This only ever checked the JWT's own signature/role, never the database —
// unlike tenantportal.js's tenantAuth, which was already fixed to re-check.
// A moved-out or deleted tenant could keep using an old token (good for up
// to 7 days) to read notices and send/receive messages here, the exact same
// hole that was closed over there. Brought in line with it.
async function tenantAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'tenant') return res.status(403).json({ error: 'Tenant only' });
    const result = await pool.query('SELECT id, is_active FROM tenants WHERE id = $1', [decoded.id]);
    const tenant = result.rows[0];
    if (!tenant) return res.status(401).json({ error: 'Account no longer exists.' });
    if (!tenant.is_active) return res.status(403).json({ error: 'This account is no longer active.' });
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

// ── Helper: is this person actually a participant in this conversation? ───────
async function isParticipant(conversationId, participantId, participantType) {
  const result = await pool.query(
    `SELECT 1 FROM conversation_participants
     WHERE conversation_id=$1 AND participant_id=$2 AND participant_type=$3`,
    [conversationId, participantId, participantType]
  );
  return result.rows.length > 0;
}

// ── Helper: is this sender allowed to START a conversation with this
// recipient at all? Previously there was no check here — any authenticated
// sender could message any user or tenant in the system by id. This follows
// the agent/landlord/caretaker/tenant chain already used for data scoping
// elsewhere: admin can message anyone; everyone else can message super
// admin, and otherwise only people within their own property relationship.
async function canMessage(sender, recipientId, recipientType) {
  // sender: { type: 'user'|'tenant', id, role? } — role only set for 'user'
  if (sender.type === 'user' && (sender.role === 'admin' || sender.role === 'super_admin')) {
    return true; // admin can message anyone
  }

  // Anyone can always reach super admin.
  if (recipientType === 'user') {
    const r = await pool.query(`SELECT role FROM users WHERE id = $1`, [recipientId]);
    if (!r.rows[0]) return false;
    if (r.rows[0].role === 'admin' || r.rows[0].role === 'super_admin') return true;
  }

  if (sender.type === 'user' && sender.role === 'agent') {
    if (recipientType === 'user') {
      // Their own landlords, or caretakers assigned to those landlords' plots
      const r = await pool.query(
        `SELECT 1 FROM users WHERE id = $1 AND role = 'landlord' AND agent_id = $2
         UNION
         SELECT 1 FROM users u JOIN caretaker_plots cp ON cp.caretaker_id = u.id
           JOIN plots p ON p.id = cp.plot_id JOIN users landlord ON landlord.id = p.user_id
           WHERE u.id = $1 AND u.role = 'caretaker' AND landlord.agent_id = $2`,
        [recipientId, sender.id]
      );
      return r.rows.length > 0;
    }
    if (recipientType === 'tenant') {
      const r = await pool.query(
        `SELECT 1 FROM tenants t JOIN houses h ON t.house_id = h.id JOIN plots p ON h.plot_id = p.id
         JOIN users landlord ON landlord.id = p.user_id
         WHERE t.id = $1 AND landlord.agent_id = $2`,
        [recipientId, sender.id]
      );
      return r.rows.length > 0;
    }
  }

  if (sender.type === 'user' && sender.role === 'landlord') {
    if (recipientType === 'user') {
      // Their own agent (if any), or a caretaker assigned to their own plots
      const r = await pool.query(
        `SELECT 1 FROM users WHERE id = $2 AND id = (SELECT agent_id FROM users WHERE id = $1)
         UNION
         SELECT 1 FROM users u JOIN caretaker_plots cp ON cp.caretaker_id = u.id
           JOIN plots p ON p.id = cp.plot_id
           WHERE u.id = $2 AND u.role = 'caretaker' AND p.user_id = $1`,
        [sender.id, recipientId]
      );
      return r.rows.length > 0;
    }
  }

  if (sender.type === 'user' && sender.role === 'caretaker') {
    if (recipientType === 'user') {
      // The landlord (and that landlord's agent) of any plot they're
      // assigned to — via either caretaker_plots or the legacy single
      // users.plot_id assignment, same as every other scoping query.
      const r = await pool.query(
        `SELECT 1 FROM plots p
         WHERE p.id IN (
           SELECT plot_id FROM caretaker_plots WHERE caretaker_id = $1
           UNION SELECT plot_id FROM users WHERE id = $1 AND plot_id IS NOT NULL
         ) AND (p.user_id = $2 OR $2 = (SELECT agent_id FROM users WHERE id = p.user_id))`,
        [sender.id, recipientId]
      );
      return r.rows.length > 0;
    }
    if (recipientType === 'tenant') {
      const r = await pool.query(
        `SELECT 1 FROM tenants t JOIN houses h ON t.house_id = h.id
         WHERE t.id = $1 AND h.plot_id IN (
           SELECT plot_id FROM caretaker_plots WHERE caretaker_id = $2
           UNION SELECT plot_id FROM users WHERE id = $2 AND plot_id IS NOT NULL
         )`,
        [recipientId, sender.id]
      );
      return r.rows.length > 0;
    }
  }

  if (sender.type === 'tenant') {
    if (recipientType === 'user') {
      // The caretaker, landlord, or agent responsible for their own unit
      const r = await pool.query(
        `SELECT 1 FROM tenants t JOIN houses h ON t.house_id = h.id JOIN plots p ON h.plot_id = p.id
         WHERE t.id = $1 AND (
           $2 = p.user_id OR
           $2 = (SELECT agent_id FROM users WHERE id = p.user_id) OR
           $2 IN (
             SELECT caretaker_id FROM caretaker_plots WHERE plot_id = p.id
             UNION SELECT id FROM users WHERE plot_id = p.id
           )
         )`,
        [sender.id, recipientId]
      );
      return r.rows.length > 0;
    }
    return false; // tenants can never message another tenant
  }

  return false;
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
          AND (n.author_id=$2 OR n.target_type='all' OR n.target_type='staff'
            OR (n.target_type='property' AND n.target_id IN (SELECT id FROM plots WHERE user_id=$2))
            OR (n.target_type='unit' AND n.target_id IN (
              SELECT h.id FROM houses h JOIN plots p ON h.plot_id=p.id WHERE p.user_id=$2
            )))
      `, [lastRead, req.user.id]);
    } else if (req.user.role === 'agent') {
      // Was missing entirely — agents always got 0 here, regardless of how
      // many notices actually applied to them.
      noticesResult = await pool.query(`
        SELECT COUNT(*) AS count FROM notices n
        WHERE n.created_at > $1
          AND (n.author_id=$2 OR n.target_type='all' OR n.target_type='staff'
            OR (n.target_type='property' AND n.target_id IN (
              SELECT id FROM plots WHERE user_id IN (SELECT id FROM users WHERE agent_id=$2)
            ))
            OR (n.target_type='unit' AND n.target_id IN (
              SELECT h.id FROM houses h JOIN plots p ON h.plot_id=p.id
              WHERE p.user_id IN (SELECT id FROM users WHERE agent_id=$2)
            )))
      `, [lastRead, req.user.id]);
    } else if (req.user.role === 'caretaker') {
      noticesResult = await pool.query(`
        SELECT COUNT(*) AS count FROM notices n
        WHERE n.created_at > $1
          AND (n.author_id=$2 OR n.target_type='all'
            OR (n.target_type='property' AND n.target_id IN (
              SELECT plot_id FROM caretaker_plots WHERE caretaker_id=$2
              UNION SELECT plot_id FROM users WHERE id=$2 AND plot_id IS NOT NULL
            ))
            OR (n.target_type='unit' AND n.target_id IN (
              SELECT h.id FROM houses h WHERE h.plot_id IN (
                SELECT plot_id FROM caretaker_plots WHERE caretaker_id=$2
                UNION SELECT plot_id FROM users WHERE id=$2 AND plot_id IS NOT NULL
              )
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

// GET /api/notices/contacts — who this STAFF user is allowed to message.
// Previously the "New Message" picker reused GET /auth/users, which is
// scoped for managing caretakers, not for messaging — for a caretaker that
// meant seeing EVERY landlord in the system (not just their own), and for
// agent/landlord it meant never seeing admin at all, even though canMessage
// allows reaching admin from any role. This mirrors canMessage's own logic
// exactly so the picker and the actual send permission always agree.
router.get('/contacts', auth, async (req, res) => {
  try {
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      const r = await pool.query(`SELECT id, name, role FROM users WHERE id != $1 ORDER BY role, name`, [req.user.id]);
      return res.json({ success: true, data: r.rows });
    }

    const admins = await pool.query(`SELECT id, name, role FROM users WHERE role IN ('admin','super_admin')`);
    let others = { rows: [] };

    if (req.user.role === 'agent') {
      others = await pool.query(`
        SELECT id, name, role FROM users WHERE role='landlord' AND agent_id=$1
        UNION
        SELECT u.id, u.name, u.role FROM users u JOIN caretaker_plots cp ON cp.caretaker_id=u.id
          JOIN plots p ON p.id=cp.plot_id JOIN users landlord ON landlord.id=p.user_id
          WHERE u.role='caretaker' AND landlord.agent_id=$1
      `, [req.user.id]);
      // canMessage() already allows an agent to reach any tenant under one
      // of their assigned landlords (see the agent branch above it) — this
      // was just never surfaced as a pickable contact, so there was no way
      // to actually start that conversation from the UI. 'tenant' as the
      // role value (not a real users.role) is how the frontend is expected
      // to tell these apart and send recipient_type: 'tenant'.
      const tenantContacts = await pool.query(`
        SELECT t.id, t.full_name AS name, 'tenant' AS role
        FROM tenants t
        JOIN houses h ON t.house_id = h.id
        JOIN plots p ON h.plot_id = p.id
        JOIN users landlord ON landlord.id = p.user_id
        WHERE landlord.agent_id = $1
      `, [req.user.id]);
      others = { rows: [...others.rows, ...tenantContacts.rows] };
    } else if (req.user.role === 'landlord') {
      others = await pool.query(`
        SELECT id, name, role FROM users WHERE id = (SELECT agent_id FROM users WHERE id=$1)
        UNION
        SELECT u.id, u.name, u.role FROM users u JOIN caretaker_plots cp ON cp.caretaker_id=u.id
          JOIN plots p ON p.id=cp.plot_id WHERE u.role='caretaker' AND p.user_id=$1
      `, [req.user.id]);
    } else if (req.user.role === 'caretaker') {
      others = await pool.query(`
        SELECT DISTINCT u.id, u.name, u.role FROM plots p
        JOIN users u ON u.id = p.user_id OR u.id = (SELECT agent_id FROM users WHERE id=p.user_id)
        WHERE p.id IN (
          SELECT plot_id FROM caretaker_plots WHERE caretaker_id=$1
          UNION SELECT plot_id FROM users WHERE id=$1 AND plot_id IS NOT NULL
        )
      `, [req.user.id]);
    }

    res.json({ success: true, data: [...admins.rows, ...others.rows] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notices/contacts/tenant — who this tenant is allowed to message.
// Previously there was no way for the frontend to even know who a tenant
// could start a conversation with, since nothing populated the "new
// message" picker — this is exactly canMessage()'s tenant-branch logic,
// exposed as a list instead of a yes/no check.
router.get('/contacts/tenant', tenantAuth, async (req, res) => {
  try {
    // p.agent_id is not a real column — plots never store an agent of their
    // own, only the landlord's own users.agent_id does (see the comment at
    // the top of plots.js). This query referenced it anyway, so it has been
    // throwing a database error on every single call — meaning a tenant
    // could never open "New Message" and see who they're allowed to write
    // to; the whole picker was broken. Fixed to look up the landlord's agent
    // the same way canMessage() and every other scoping query in this file
    // already does.
    const result = await pool.query(
      `SELECT u.id, u.name, u.role FROM tenants t
       JOIN houses h ON t.house_id = h.id
       JOIN plots  p ON h.plot_id  = p.id
       JOIN users  u ON u.id = p.user_id
         OR u.id = (SELECT agent_id FROM users WHERE id = p.user_id)
         OR u.id IN (
           SELECT caretaker_id FROM caretaker_plots WHERE plot_id = p.id
           UNION SELECT id FROM users WHERE plot_id = p.id
         )
       WHERE t.id = $1
       ORDER BY CASE u.role WHEN 'caretaker' THEN 1 WHEN 'landlord' THEN 2 WHEN 'agent' THEN 3 ELSE 4 END`,
      [req.tenant.id]
    );
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
             cp2.participant_type AS other_type,
             u.role AS other_role
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
    const allowed = await canMessage({ type: 'user', id: req.user.id, role: req.user.role }, parseInt(recipient_id), recipient_type);
    if (!allowed) return res.status(403).json({ error: 'You are not able to message this person.' });
    const convId = await findOrCreateConversation(req.user.id, 'user', parseInt(recipient_id), recipient_type);
    res.json({ success: true, conversation_id: convId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notices/conversations/new/tenant — tenant starts new conversation
router.post('/conversations/new/tenant', tenantAuth, async (req, res) => {
  const { recipient_id, recipient_type } = req.body;
  if (!recipient_id || !recipient_type) return res.status(400).json({ error: 'recipient_id and recipient_type required.' });
  try {
    const allowed = await canMessage({ type: 'tenant', id: req.tenant.id }, parseInt(recipient_id), recipient_type);
    if (!allowed) return res.status(403).json({ error: 'You are not able to message this person.' });
    const convId = await findOrCreateConversation(req.tenant.id, 'tenant', parseInt(recipient_id), recipient_type);
    res.json({ success: true, conversation_id: convId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notices/conversations/:id/messages — staff reads messages
router.get('/conversations/:id/messages', auth, async (req, res) => {
  try {
    if (!(await isParticipant(req.params.id, req.user.id, 'user'))) {
      return res.status(403).json({ error: 'You are not part of this conversation.' });
    }
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
    if (!(await isParticipant(req.params.id, req.tenant.id, 'tenant'))) {
      return res.status(403).json({ error: 'You are not part of this conversation.' });
    }
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
    if (!(await isParticipant(req.params.id, req.user.id, 'user'))) {
      return res.status(403).json({ error: 'You are not part of this conversation.' });
    }
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
    if (!(await isParticipant(req.params.id, req.tenant.id, 'tenant'))) {
      return res.status(403).json({ error: 'You are not part of this conversation.' });
    }
    const tenantRes = await pool.query('SELECT full_name FROM tenants WHERE id=$1', [req.tenant.id]);
    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, sender_type, body) VALUES ($1,$2,'tenant',$3) RETURNING *`,
      [req.params.id, req.tenant.id, body.trim()]
    );
    await pool.query(`UPDATE conversations SET updated_at=NOW() WHERE id=$1`, [req.params.id]);
    await logTenantActivity({ tenantId: req.tenant.id, action: 'message_sent' });
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
    // Staff keep seeing expired notices (unlike the tenant feed, which drops
    // them outright) so there's still a history of what was posted — but
    // previously nothing distinguished an expired one from a live one, so a
    // notice could sit in the "active" board for days after its own expiry
    // date with no indication. `is_expired` surfaces that so the frontend
    // can badge it instead of rendering it exactly like a current notice.
    const isExpiredCol = `(n.expires_at IS NOT NULL AND n.expires_at <= NOW()) AS is_expired`;
    if (req.user.role === 'admin') {
      query = `SELECT n.*, u.name AS author_name, COUNT(DISTINCT nr.tenant_id) AS read_count, ${isExpiredCol}
               FROM notices n JOIN users u ON n.author_id=u.id
               LEFT JOIN notice_reads nr ON nr.notice_id=n.id
               GROUP BY n.id, u.name ORDER BY n.created_at DESC`;
    } else if (req.user.role === 'landlord') {
      // Added target_type='unit' — previously a caretaker's unit-targeted
      // notice on the landlord's own plot never matched here, since this
      // only checked 'property'-wide targeting.
      query = `SELECT n.*, u.name AS author_name, COUNT(DISTINCT nr.tenant_id) AS read_count, ${isExpiredCol}
               FROM notices n JOIN users u ON n.author_id=u.id
               LEFT JOIN notice_reads nr ON nr.notice_id=n.id
               WHERE n.author_id=$1 OR n.target_type='all' OR n.target_type='staff'
                 OR (n.target_type='property' AND n.target_id IN (SELECT id FROM plots WHERE user_id=$1))
                 OR (n.target_type='unit' AND n.target_id IN (
                   SELECT h.id FROM houses h JOIN plots p ON h.plot_id=p.id WHERE p.user_id=$1
                 ))
               GROUP BY n.id, u.name ORDER BY n.created_at DESC`;
      params = [req.user.id];
    } else if (req.user.role === 'caretaker') {
      // Now also includes n.author_id=$1 (caretakers can post their own
      // notices as of this change) and target_type='unit' on their plot
      // (previously only 'property'-wide notices were visible to them).
      query = `SELECT n.*, u.name AS author_name, COUNT(DISTINCT nr.tenant_id) AS read_count, ${isExpiredCol}
               FROM notices n JOIN users u ON n.author_id=u.id
               LEFT JOIN notice_reads nr ON nr.notice_id=n.id
               WHERE n.author_id=$1 OR n.target_type='all'
                 OR (n.target_type='property' AND n.target_id IN (
                   SELECT plot_id FROM caretaker_plots WHERE caretaker_id=$1
                   UNION SELECT plot_id FROM users WHERE id=$1 AND plot_id IS NOT NULL
                 ))
                 OR (n.target_type='unit' AND n.target_id IN (
                   SELECT h.id FROM houses h WHERE h.plot_id IN (
                     SELECT plot_id FROM caretaker_plots WHERE caretaker_id=$1
                     UNION SELECT plot_id FROM users WHERE id=$1 AND plot_id IS NOT NULL
                   )
                 ))
               GROUP BY n.id, u.name ORDER BY n.created_at DESC`;
      params = [req.user.id];
    } else if (req.user.role === 'agent') {
      // Was missing entirely — agents fell through to the empty-list else
      // branch below. Same shape as landlord's own-plus-targeted-plot
      // query, scoped through the agent's own assigned landlords.
      query = `SELECT n.*, u.name AS author_name, COUNT(DISTINCT nr.tenant_id) AS read_count, ${isExpiredCol}
               FROM notices n JOIN users u ON n.author_id=u.id
               LEFT JOIN notice_reads nr ON nr.notice_id=n.id
               WHERE n.author_id=$1 OR n.target_type='all' OR n.target_type='staff'
                 OR (n.target_type='property' AND n.target_id IN (
                   SELECT id FROM plots WHERE user_id IN (SELECT id FROM users WHERE agent_id=$1)
                 ))
                 OR (n.target_type='unit' AND n.target_id IN (
                   SELECT h.id FROM houses h JOIN plots p ON h.plot_id=p.id
                   WHERE p.user_id IN (SELECT id FROM users WHERE agent_id=$1)
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
  if (!['admin', 'super_admin', 'landlord', 'agent', 'caretaker'].includes(req.user.role))
    return res.status(403).json({ error: 'Access denied.' });
  const { title, body, priority, target_type, target_id, expires_at } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body are required.' });

  // Caretakers can only post to their own assigned plot's tenants — never
  // 'all' (everyone system-wide), 'staff', or 'tenant' (that's messaging's job).
  if (req.user.role === 'caretaker' && !['property', 'unit'].includes(target_type)) {
    return res.status(403).json({ error: 'Caretakers can only post notices to their own property or a specific unit on it.' });
  }

  // Previously unchecked: a landlord or agent could target a notice at ANY
  // plot_id, not just their own — and target_type='unit' had NO ownership
  // check at all, for anyone. 'all'/'staff' targeting and admin are unrestricted.
  if (['property', 'unit'].includes(target_type) && target_id && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    let ownsIt;
    if (req.user.role === 'caretaker') {
      // Via caretaker_plots, or the legacy single users.plot_id assignment
      ownsIt = target_type === 'property'
        ? await pool.query(
            `SELECT 1 FROM plots WHERE id = $1 AND id IN (
               SELECT plot_id FROM caretaker_plots WHERE caretaker_id = $2
               UNION SELECT plot_id FROM users WHERE id = $2 AND plot_id IS NOT NULL
             )`,
            [target_id, req.user.id])
        : await pool.query(
            `SELECT 1 FROM houses WHERE id = $1 AND plot_id IN (
               SELECT plot_id FROM caretaker_plots WHERE caretaker_id = $2
               UNION SELECT plot_id FROM users WHERE id = $2 AND plot_id IS NOT NULL
             )`,
            [target_id, req.user.id]);
    } else if (req.user.role === 'agent') {
      ownsIt = target_type === 'property'
        ? await pool.query(`SELECT 1 FROM plots WHERE id = $1 AND user_id IN (SELECT id FROM users WHERE agent_id = $2)`, [target_id, req.user.id])
        : await pool.query(`SELECT 1 FROM houses h JOIN plots p ON h.plot_id=p.id WHERE h.id = $1 AND p.user_id IN (SELECT id FROM users WHERE agent_id = $2)`, [target_id, req.user.id]);
    } else {
      // landlord
      ownsIt = target_type === 'property'
        ? await pool.query(`SELECT 1 FROM plots WHERE id = $1 AND user_id = $2`, [target_id, req.user.id])
        : await pool.query(`SELECT 1 FROM houses h JOIN plots p ON h.plot_id=p.id WHERE h.id = $1 AND p.user_id = $2`, [target_id, req.user.id]);
    }
    if (ownsIt.rows.length === 0) {
      return res.status(403).json({ error: 'You can only target a notice at your own property.' });
    }
  }

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
    const tenantRes = await pool.query(
      `SELECT t.id, t.house_id, h.plot_id FROM tenants t LEFT JOIN houses h ON t.house_id=h.id WHERE t.id=$1`,
      [req.tenant.id]
    );
    const tenant = tenantRes.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

    // Same targeting rule as GET /notices/tenant — a tenant can only reply
    // to a notice that was actually shown to them in the first place.
    const notice = await pool.query(
      `SELECT author_id FROM notices
       WHERE id = $1 AND (target_type='all'
         OR (target_type='property' AND target_id=$2)
         OR (target_type='unit'     AND target_id=$3)
         OR (target_type='tenant'   AND target_id=$4))`,
      [req.params.noticeId, tenant.plot_id, tenant.house_id, tenant.id]
    );
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
  // Caretakers were left off this list even though POST / lets them post
  // their own notices — the frontend shows a Delete button for any notice
  // the author can see (canPost && they wrote it), so a caretaker's own
  // button always failed with "Access denied." The query below already
  // restricts anyone but admin/super_admin to deleting only their own
  // notice (author_id=$2), so adding caretaker here doesn't open up
  // anything wider — it just lets them remove what they themselves posted.
  if (!['admin', 'super_admin', 'landlord', 'agent', 'caretaker'].includes(req.user.role))
    return res.status(403).json({ error: 'Access denied.' });
  try {
    await pool.query(
      `DELETE FROM notices WHERE id=$1 AND (author_id=$2 OR $3 IN ('admin','super_admin'))`,
      [req.params.id, req.user.id, req.user.role]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
