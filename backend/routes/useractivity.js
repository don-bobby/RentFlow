const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');

// Admin-only, same pattern as auditlog.js / the old tenantactivity.js it
// replaces: a plain JWT check plus a role gate.
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Groups one identity's chronological event stream into login "sessions":
// everything after a 'login' event tallies under it until the next login
// (or indefinitely, for the most recent one). Events that happened before
// any tracked login at all — e.g. audit_log entries from before this
// feature shipped, or a tenant's notice reads from before 012 — collapse
// into one synthetic "before tracking began" bucket per identity, same
// handling used for both tenants and staff so the report doesn't fill up
// with thousands of orphaned pre-feature rows.
function groupIntoSessions(events) {
  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  const sessions = [];
  let current = null;
  const preLogin = { login_at: null, breakdown: {} };

  for (const ev of events) {
    if (ev.action === 'login') {
      if (current) sessions.push(current);
      current = { login_at: ev.at, breakdown: {} };
      continue;
    }
    const bucket = current || preLogin;
    bucket.breakdown[ev.action] = (bucket.breakdown[ev.action] || 0) + 1;
  }
  if (current) sessions.push(current);
  if (Object.keys(preLogin.breakdown).length) sessions.push(preLogin);
  return sessions;
}

function toRows(sessions, { userType, role, userId, userName, subtitle }) {
  return sessions.map(s => {
    const breakdown = Object.entries(s.breakdown)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);
    return {
      user_type: userType,
      role,
      user_id: userId,
      user_name: userName,
      subtitle,
      login_at: s.login_at,
      activity_count: breakdown.reduce((sum, b) => sum + b.count, 0),
      breakdown,
    };
  });
}

// GET /api/user-activity — admin only.
// Combines tenant portal activity (tenant_activity_log + notice_reads) and
// staff activity (staff_activity_log + the existing audit_log) into one
// timeline, grouped into login sessions with a login time + activity
// breakdown per session — not an estimated session duration, since neither
// the tenant portal nor the staff dashboard track logout (stateless JWTs).
// "Checked" actions (statement views, report views, bulk downloads, notice
// reads) and "updated" actions (everything already in audit_log) are both
// included in the same breakdown, labeled by `action` — the frontend
// formats the label (plain names for tracked action types, actionLabel()
// for audit_log-sourced entries, which arrive prefixed "audit:").
router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const [
      tenantsRes, tenantLogRes, noticeReadsRes,
      usersRes, staffLogRes, auditRes,
    ] = await Promise.all([
      pool.query(`SELECT t.id, t.full_name, h.unit_number FROM tenants t LEFT JOIN houses h ON t.house_id = h.id`),
      pool.query(`SELECT tenant_id, action, created_at FROM tenant_activity_log ORDER BY tenant_id, created_at ASC`),
      pool.query(`SELECT tenant_id, read_at AS created_at FROM notice_reads ORDER BY tenant_id, read_at ASC`),
      pool.query(`SELECT id, name, email, role FROM users`),
      pool.query(`SELECT user_id, action, created_at FROM staff_activity_log ORDER BY user_id, created_at ASC`),
      pool.query(`SELECT user_id, action, created_at FROM audit_log WHERE user_id IS NOT NULL ORDER BY user_id, created_at ASC`),
    ]);

    const tenantById = Object.fromEntries(tenantsRes.rows.map(t => [t.id, t]));
    const userById    = Object.fromEntries(usersRes.rows.map(u => [u.id, u]));

    // ── Tenant side ──────────────────────────────────────────────────────
    const tenantEvents = {};
    for (const row of tenantLogRes.rows) (tenantEvents[row.tenant_id] ||= []).push({ action: row.action, at: row.created_at });
    for (const row of noticeReadsRes.rows) (tenantEvents[row.tenant_id] ||= []).push({ action: 'notice_read', at: row.created_at });

    let rows = [];
    for (const [tenantId, events] of Object.entries(tenantEvents)) {
      const tenant = tenantById[tenantId];
      const sessions = groupIntoSessions(events);
      rows.push(...toRows(sessions, {
        userType: 'tenant', role: 'tenant', userId: Number(tenantId),
        userName: tenant?.full_name || `Tenant #${tenantId}`,
        subtitle: tenant?.unit_number ? `Unit ${tenant.unit_number}` : null,
      }));
    }

    // ── Staff side ───────────────────────────────────────────────────────
    const staffEvents = {};
    for (const row of staffLogRes.rows) (staffEvents[row.user_id] ||= []).push({ action: row.action, at: row.created_at });
    for (const row of auditRes.rows) (staffEvents[row.user_id] ||= []).push({ action: `audit:${row.action}`, at: row.created_at });

    for (const [userId, events] of Object.entries(staffEvents)) {
      const user = userById[userId];
      const sessions = groupIntoSessions(events);
      rows.push(...toRows(sessions, {
        userType: 'staff', role: user?.role || 'staff', userId: Number(userId),
        userName: user?.name || `User #${userId}`,
        subtitle: user?.email || null,
      }));
    }

    rows.sort((a, b) => new Date(b.login_at || 0) - new Date(a.login_at || 0));

    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
