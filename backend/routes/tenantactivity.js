const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');

// Admin-only, same pattern as auditlog.js: a plain JWT check (no DB
// liveness re-check — matches that file's existing, already-audited
// convention) plus a role gate.
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

// GET /api/tenant-activity — admin only.
// Returns one row per tenant login "session": the login timestamp, plus a
// count of what that tenant did afterwards (maintenance requests, messages
// sent to staff, notices read) up until their next login (or now, for the
// most recent one). This is deliberately "login time + activity count",
// not an estimated session-duration span — there's no logout tracking in
// this stateless-JWT system, so a duration would just be a guess.
//
// Activity scope is intentionally narrow: logins, maintenance requests,
// and messages (tracked in tenant_activity_log, populated at the point
// each action happens), plus notice reads (derived here from the existing
// notice_reads table rather than duplicated into a second log). Passive
// page views (balance, arrears, profile) are NOT tracked — that was an
// explicit choice, not an oversight.
router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const [tenantsRes, logRes, readsRes] = await Promise.all([
      pool.query(
        `SELECT t.id, t.full_name, h.unit_number
         FROM tenants t LEFT JOIN houses h ON t.house_id = h.id`
      ),
      pool.query(
        `SELECT tenant_id, action, created_at FROM tenant_activity_log ORDER BY tenant_id, created_at ASC`
      ),
      pool.query(
        `SELECT tenant_id, read_at AS created_at FROM notice_reads ORDER BY tenant_id, read_at ASC`
      ),
    ]);

    const tenantById = Object.fromEntries(tenantsRes.rows.map(t => [t.id, t]));

    // Merge the two event sources into one per-tenant, chronologically
    // ordered stream, then walk it grouping everything after a 'login'
    // under that login until the next one.
    const eventsByTenant = {};
    for (const row of logRes.rows) {
      (eventsByTenant[row.tenant_id] ||= []).push({ action: row.action, at: row.created_at });
    }
    for (const row of readsRes.rows) {
      (eventsByTenant[row.tenant_id] ||= []).push({ action: 'notice_read', at: row.created_at });
    }

    const sessions = [];
    for (const [tenantId, events] of Object.entries(eventsByTenant)) {
      events.sort((a, b) => new Date(a.at) - new Date(b.at));
      const tenant = tenantById[tenantId];

      let current = null; // the open login "session" being tallied
      const preLogin = { tenant_id: Number(tenantId), login_at: null, maintenance_count: 0, message_count: 0, notice_read_count: 0 };

      for (const ev of events) {
        if (ev.action === 'login') {
          if (current) sessions.push(current);
          current = { tenant_id: Number(tenantId), login_at: ev.at, maintenance_count: 0, message_count: 0, notice_read_count: 0 };
          continue;
        }
        const bucket = current || preLogin;
        if (ev.action === 'maintenance_request') bucket.maintenance_count++;
        else if (ev.action === 'message_sent') bucket.message_count++;
        else if (ev.action === 'notice_read') bucket.notice_read_count++;
      }
      if (current) sessions.push(current);
      // Only surface the "before any tracked login" bucket if it actually
      // caught something (e.g. notice reads from before this feature
      // shipped) — an empty one is just noise.
      if (preLogin.maintenance_count || preLogin.message_count || preLogin.notice_read_count) {
        sessions.push(preLogin);
      }
    }

    const data = sessions.map(s => {
      const tenant = tenantById[s.tenant_id];
      const activityCount = s.maintenance_count + s.message_count + s.notice_read_count;
      return {
        tenant_id: s.tenant_id,
        tenant_name: tenant?.full_name || `Tenant #${s.tenant_id}`,
        unit_number: tenant?.unit_number || null,
        login_at: s.login_at,
        activity_count: activityCount,
        maintenance_count: s.maintenance_count,
        message_count: s.message_count,
        notice_read_count: s.notice_read_count,
      };
    }).sort((a, b) => new Date(b.login_at || 0) - new Date(a.login_at || 0));

    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
