const router  = require('express').Router();
const pool    = require('../database/db');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { logAudit } = require('../utils/audit');

// ── Middleware ────────────────────────────────────────────────────────────────

// Live auth: re-reads the user from the database on every request, so
// suspensions and permission changes apply immediately (see middleware/auth.js).
const { authMiddleware } = require('../middleware/auth');

function requireAdmin(req, res, next) {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ── GET /api/auth/me — who am I, and what can I do right now? ─────────────────
// The frontend calls this on app load (and after any permission-affecting
// action) so the UI always reflects the LIVE database state, not the
// token's snapshot from up to 7 days ago.
const { authMiddleware: liveAuthMiddleware } = require('../middleware/auth');
const { getPermissions, requirePermission } = require('../middleware/permissions');
const { getVisiblePlotIds } = require('../middleware/scope');

router.get('/me', liveAuthMiddleware, async (req, res) => {
  try {
    const { profile, permissions } = await getPermissions(req.user);

    // Landlords previously had no way to see WHICH agent manages them, only
    // the raw agent_id was ever exposed (or nothing at all, from the UI's
    // point of view). Resolve it to a name here.
    let agent_name = null;
    if (req.user.agent_id) {
      const a = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.agent_id]);
      agent_name = a.rows[0]?.name || null;
    }

    res.json({
      success: true,
      data: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        agent_id: req.user.agent_id,
        agent_name,
        profile,
        permissions,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user   = result.rows[0];

    if (!user) return res.status(401).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Wrong password' });

    // Block unapproved landlords
    if (user.role === 'landlord' && !user.is_approved) {
      return res.status(403).json({ error: 'Your account is pending admin approval.' });
    }

    // Block suspended agents
    if (user.role === 'agent' && !user.is_approved) {
      return res.status(403).json({ error: 'Your account has been suspended. Contact the administrator.' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, name: user.name, role: user.role, is_approved: user.is_approved } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/register (public — landlord self-registration) ─────────────
router.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already registered.' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, phone, is_approved)
       VALUES ($1, $2, $3, 'landlord', $4, false)
       RETURNING id, name, email, role, is_approved`,
      [name, email, hashedPassword, phone || null]
    );

    res.json({
      success: true,
      message: 'Registration successful. Your account is pending admin approval.',
      user: result.rows[0],
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/auth/users (admin OR landlord creates users) ───────────────────
router.post('/users', authMiddleware, async (req, res) => {
  const { role: requesterRole, id: requesterId } = req.user;

  // Landlords can only create caretakers
  if (requesterRole === 'landlord') {
    if (req.body.role !== 'caretaker') {
      return res.status(403).json({ error: 'Landlords can only create caretaker accounts.' });
    }
  } else if (requesterRole === 'agent') {
    // Agents can create landlords (auto-assigned to themselves) and caretakers.
    if (!['landlord', 'caretaker'].includes(req.body.role)) {
      return res.status(403).json({ error: 'Agents can only create landlord or caretaker accounts.' });
    }
  } else if (requesterRole !== 'admin' && requesterRole !== 'super_admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const { name, email, password, role, phone, plot_id } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password and role are required.' });
  }

  const allowedRoles = ['admin', 'agent', 'landlord', 'caretaker'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${allowedRoles.join(', ')}` });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already registered.' });

    const hashedPassword = await bcrypt.hash(password, 10);

    // For landlords creating caretakers, auto-assign to their first plot if no plot_id given
    let assignedPlot = plot_id || null;
    if (requesterRole === 'landlord' && !assignedPlot) {
      const plotRes = await pool.query('SELECT id FROM plots WHERE user_id = $1 LIMIT 1', [requesterId]);
      if (plotRes.rows.length > 0) assignedPlot = plotRes.rows[0].id;
    }

    // Previously an explicitly-supplied plot_id was trusted outright — a
    // landlord or agent could create a caretaker record pointing at a plot
    // that isn't theirs, just by passing a different plot_id in the request
    // body. Now checked against the requester's own visible plots, same as
    // every other route that accepts a plot_id from a non-admin.
    if (assignedPlot && !['admin', 'super_admin'].includes(requesterRole)) {
      const visible = await getVisiblePlotIds(req.user);
      if (visible !== 'ALL' && !visible.includes(Number(assignedPlot))) {
        return res.status(403).json({ error: 'You do not have access to this plot.' });
      }
    }

    // Landlords created by an agent are auto-assigned to that agent.
    const assignedAgent = (requesterRole === 'agent' && role === 'landlord') ? requesterId : null;

    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, phone, is_approved, plot_id, agent_id)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7)
       RETURNING id, name, email, role, phone, is_approved, plot_id, agent_id, created_at`,
      [name, email, hashedPassword, role, phone || null, assignedPlot, assignedAgent]
    );

    res.status(201).json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/auth/users (admin sees all, landlord sees own caretakers) ────────
router.get('/users', authMiddleware, async (req, res) => {
  try {
    let result;
    if (['admin', 'super_admin'].includes(req.user.role)) {
      result = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.phone, u.is_approved, u.plot_id, u.agent_id, u.created_at,
                -- For caretakers: their assigned plot name
                cp.name AS plot_name,
                -- For landlords: comma-separated list of their properties
                lp.plot_names AS landlord_plots,
                -- For caretakers: all assigned plot names (multi-plot support)
                ctp.plot_names AS caretaker_plots,
                -- For agents: every plot currently pointing at them via
                -- plots.agent_id (direct assignment or cascaded landlord default)
                ap.plot_names AS agent_plots
         FROM users u
         LEFT JOIN plots cp ON u.plot_id = cp.id AND u.role = 'caretaker'
         LEFT JOIN (
           SELECT user_id, STRING_AGG(name, ', ' ORDER BY name) AS plot_names
           FROM plots GROUP BY user_id
         ) lp ON lp.user_id = u.id AND u.role = 'landlord'
         LEFT JOIN (
           SELECT cp.caretaker_id AS user_id, STRING_AGG(p.name, ', ' ORDER BY p.name) AS plot_names
           FROM caretaker_plots cp JOIN plots p ON cp.plot_id = p.id
           GROUP BY cp.caretaker_id
         ) ctp ON ctp.user_id = u.id AND u.role = 'caretaker'
         LEFT JOIN (
           SELECT agent_id AS user_id, STRING_AGG(name, ', ' ORDER BY name) AS plot_names
           FROM plots WHERE agent_id IS NOT NULL GROUP BY agent_id
         ) ap ON ap.user_id = u.id AND u.role = 'agent'
         ORDER BY u.created_at DESC`
      );
    } else if (req.user.role === 'landlord') {
      result = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.phone, u.is_approved, u.plot_id, u.agent_id, u.created_at,
                cp.name AS plot_name,
                lp.plot_names AS landlord_plots,
                ctp.plot_names AS caretaker_plots
         FROM users u
         LEFT JOIN plots cp ON u.plot_id = cp.id AND u.role = 'caretaker'
         LEFT JOIN (
           SELECT user_id, STRING_AGG(name, ', ' ORDER BY name) AS plot_names
           FROM plots GROUP BY user_id
         ) lp ON lp.user_id = u.id AND u.role = 'landlord'
         LEFT JOIN (
           SELECT cp.caretaker_id AS user_id, STRING_AGG(p.name, ', ' ORDER BY p.name) AS plot_names
           FROM caretaker_plots cp JOIN plots p ON cp.plot_id = p.id
           GROUP BY cp.caretaker_id
         ) ctp ON ctp.user_id = u.id AND u.role = 'caretaker'
         WHERE u.id = $1 OR (u.role = 'caretaker' AND u.plot_id IN (SELECT id FROM plots WHERE user_id = $1))
         ORDER BY u.created_at DESC`,
        [req.user.id]
      );

    } else if (req.user.role === 'caretaker') {
      // Caretakers can see admins/landlords (to message them) plus themselves,
      // but not the full roster of other caretakers on other properties.
      result = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.phone, u.is_approved, u.plot_id, u.agent_id, u.created_at,
                cp.name AS plot_name,
                lp.plot_names AS landlord_plots,
                ctp.plot_names AS caretaker_plots
         FROM users u
         LEFT JOIN plots cp ON u.plot_id = cp.id AND u.role = 'caretaker'
         LEFT JOIN (
           SELECT user_id, STRING_AGG(name, ', ' ORDER BY name) AS plot_names
           FROM plots GROUP BY user_id
         ) lp ON lp.user_id = u.id AND u.role = 'landlord'
         LEFT JOIN (
           SELECT cp.caretaker_id AS user_id, STRING_AGG(p.name, ', ' ORDER BY p.name) AS plot_names
           FROM caretaker_plots cp JOIN plots p ON cp.plot_id = p.id
           GROUP BY cp.caretaker_id
         ) ctp ON ctp.user_id = u.id AND u.role = 'caretaker'
         WHERE u.role IN ('admin', 'super_admin', 'landlord') OR u.id = $1
         ORDER BY u.created_at DESC`,
        [req.user.id]
      );

    } else if (req.user.role === 'agent') {
      // Agents see: themselves, the landlords assigned to them (agent_id = their id),
      // and caretakers reachable through those landlords' plots — via either the
      // legacy single u.plot_id assignment or the multi-plot caretaker_plots table.
      result = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.phone, u.is_approved, u.plot_id, u.agent_id, u.created_at,
                cp.name AS plot_name,
                lp.plot_names AS landlord_plots,
                ctp.plot_names AS caretaker_plots
         FROM users u
         LEFT JOIN plots cp ON u.plot_id = cp.id AND u.role = 'caretaker'
         LEFT JOIN (
           SELECT user_id, STRING_AGG(name, ', ' ORDER BY name) AS plot_names
           FROM plots GROUP BY user_id
         ) lp ON lp.user_id = u.id AND u.role = 'landlord'
         LEFT JOIN (
           SELECT cp.caretaker_id AS user_id, STRING_AGG(p.name, ', ' ORDER BY p.name) AS plot_names
           FROM caretaker_plots cp JOIN plots p ON cp.plot_id = p.id
           GROUP BY cp.caretaker_id
         ) ctp ON ctp.user_id = u.id AND u.role = 'caretaker'
         WHERE u.id = $1
            OR (u.role = 'landlord' AND u.agent_id = $1)
            OR (u.role = 'caretaker' AND (
                  u.plot_id IN (SELECT id FROM plots WHERE user_id IN (SELECT id FROM users WHERE agent_id = $1))
                  OR u.id IN (
                    SELECT cp.caretaker_id FROM caretaker_plots cp
                    JOIN plots p ON p.id = cp.plot_id
                    WHERE p.user_id IN (SELECT id FROM users WHERE agent_id = $1)
                  )
                ))
         ORDER BY u.created_at DESC`,
        [req.user.id]
      );
    } else {
      return res.status(403).json({ error: 'Access denied.' });
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/users/pending-landlords-count (for the dashboard alert) ─────
router.get('/users/pending-landlords-count', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE role = 'landlord' AND is_approved = false`
    );
    res.json({ success: true, count: result.rows[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/auth/users/:id/approve (admin approves a landlord) ─────────────
// Body may optionally include { agent_id }: if given, the landlord is
// approved AND assigned to that agent (switching their profile to
// landlord_with_agent) in one step. Omit or pass null to approve as
// self-managed (landlord_self).
// A landlord's agent is the DEFAULT for all their properties — a plot's own
// agent_id normally just mirrors it. Only when a plot has been deliberately
// set to a DIFFERENT agent (a genuine one-off exception, e.g. one building
// handled by a different agent than the rest of the portfolio) does it stay
// untouched here. Concretely: cascade the new agent onto every plot that
// currently matches the landlord's OLD agent (or has none set at all) —
// never onto a plot already pointing at some other agent.
async function cascadeAgentToPlots(landlordId, oldAgentId, newAgentId) {
  await pool.query(
    `UPDATE plots SET agent_id = $1
     WHERE user_id = $2 AND (agent_id = $3 OR agent_id IS NULL)`,
    [newAgentId, landlordId, oldAgentId]
  );
}

router.patch('/users/:id/approve', authMiddleware, requireAdmin, async (req, res) => {
  const { agent_id } = req.body;
  try {
    if (agent_id) {
      const agentCheck = await pool.query(`SELECT id FROM users WHERE id = $1 AND role = 'agent'`, [agent_id]);
      if (!agentCheck.rows[0]) return res.status(400).json({ error: 'agent_id must refer to an existing agent.' });
    }
    const before = await pool.query('SELECT agent_id FROM users WHERE id = $1', [req.params.id]);
    const oldAgentId = before.rows[0]?.agent_id || null;

    const result = await pool.query(
      `UPDATE users SET is_approved = true, agent_id = $2 WHERE id = $1
       RETURNING id, name, email, role, is_approved, agent_id`,
      [req.params.id, agent_id || null]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    if ((agent_id || null) !== oldAgentId) {
      await cascadeAgentToPlots(req.params.id, oldAgentId, agent_id || null);
    }

    await logAudit({ user: req.user, action: 'user.approve', entityType: 'user', entityId: req.params.id, changes: { is_approved: { from: false, to: true }, agent_id: { to: agent_id || null } } });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/auth/users/:id/reject (admin rejects/deactivates a user) ───────
router.patch('/users/:id/reject', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_approved = false WHERE id = $1 RETURNING id, name, email, role, is_approved`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    // Suspending an agent isn't a delete, so the FK's ON DELETE SET NULL
    // won't fire on its own — release their landlords explicitly so they
    // fall back to self-managed rather than being stuck pointing at a
    // suspended agent.
    if (result.rows[0].role === 'agent') {
      await pool.query(`UPDATE users SET agent_id = NULL WHERE agent_id = $1`, [req.params.id]);
      // Plots individually assigned to this agent (the exception case, not
      // following their landlord's own agent_id) need releasing too —
      // otherwise one stays silently stuck pointing at a suspended agent.
      await pool.query(`UPDATE plots SET agent_id = NULL WHERE agent_id = $1`, [req.params.id]);
    }

    await logAudit({ user: req.user, action: 'user.reject', entityType: 'user', entityId: req.params.id, changes: { is_approved: { from: true, to: false } } });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/auth/users/:id/agent (assign, change, or remove a landlord's agent)
// Body: { agent_id } — a number to assign/change, or null/omitted to remove
// (landlord falls back to self-managed). Admin only, since this changes
// what a landlord can see and do system-wide.
router.patch('/users/:id/agent', authMiddleware, requireAdmin, async (req, res) => {
  const { agent_id } = req.body;
  try {
    const landlordCheck = await pool.query(`SELECT id, role, agent_id FROM users WHERE id = $1`, [req.params.id]);
    if (!landlordCheck.rows[0]) return res.status(404).json({ error: 'User not found.' });
    if (landlordCheck.rows[0].role !== 'landlord') {
      return res.status(400).json({ error: 'agent_id can only be set on landlord accounts.' });
    }
    if (agent_id) {
      const agentCheck = await pool.query(`SELECT id FROM users WHERE id = $1 AND role = 'agent'`, [agent_id]);
      if (!agentCheck.rows[0]) return res.status(400).json({ error: 'agent_id must refer to an existing agent.' });
    }
    const oldAgentId = landlordCheck.rows[0].agent_id || null;

    const result = await pool.query(
      `UPDATE users SET agent_id = $2 WHERE id = $1 RETURNING id, name, email, role, agent_id`,
      [req.params.id, agent_id || null]
    );

    if ((agent_id || null) !== oldAgentId) {
      await cascadeAgentToPlots(req.params.id, oldAgentId, agent_id || null);
    }

    await logAudit({ user: req.user, action: 'user.set_agent', entityType: 'user', entityId: req.params.id, changes: { agent_id: { to: agent_id || null } } });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/auth/users/:id (admin deletes a user) ─────────────────────────
router.delete('/users/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/auth/users/:id/profile (any user updates own profile) ──────────
router.patch('/users/:id/profile', authMiddleware, async (req, res) => {
  // Users can only update their own profile unless admin
  if (req.user.id !== parseInt(req.params.id) && !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'You can only update your own profile.' });
  }

  const { name, email, phone } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET
        name  = COALESCE(NULLIF($1, ''), name),
        email = COALESCE(NULLIF($2, ''), email),
        phone = COALESCE(NULLIF($3, ''), phone)
       WHERE id = $4 RETURNING id, name, email, phone, role`,
      [name, email, phone, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/auth/users/:id/password (any user changes own password) ────────
router.patch('/users/:id/password', authMiddleware, async (req, res) => {
  if (req.user.id !== parseInt(req.params.id) && !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'You can only change your own password.' });
  }

  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password are required.' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const valid = await bcrypt.compare(current_password, result.rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.params.id]);

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/users/:id/plots — get all plots assigned to a caretaker ──────
// Previously had no scope check — any logged-in staff member could look up
// which properties ANY caretaker is assigned to, just by guessing their
// user id, not only caretakers on their own properties. Now scoped the same
// way the assign-plot routes right below it already are.
router.get('/users/:id/plots', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.location FROM caretaker_plots cp
       JOIN plots p ON cp.plot_id = p.id
       WHERE cp.caretaker_id = $1 ORDER BY p.name`,
      [req.params.id]
    );

    if (!['admin', 'super_admin'].includes(req.user.role) && result.rows.length > 0) {
      // Only block when there's actually something to protect — an empty
      // result (caretaker has no plots assigned) leaks nothing either way.
      const visible = await getVisiblePlotIds(req.user);
      const ownAny = req.user.id === parseInt(req.params.id);
      const sharesVisiblePlot = visible === 'ALL' || result.rows.some(p => visible.includes(p.id));
      if (!ownAny && !sharesVisiblePlot) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/auth/users/:id/assign-plot — add a plot to a caretaker ──────────
router.post('/users/:id/assign-plot', authMiddleware, requirePermission('users.assign_caretaker'), async (req, res) => {
  const { plot_id } = req.body;
  if (!plot_id) return res.status(400).json({ error: 'plot_id is required.' });
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      if (visible !== 'ALL' && !visible.includes(Number(plot_id))) {
        return res.status(403).json({ error: 'You do not have access to this property.' });
      }
    }
    // Check caretaker exists
    const check = await pool.query(`SELECT id FROM users WHERE id=$1 AND role='caretaker'`, [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Caretaker not found.' });

    // Check if this plot already has a caretaker assigned (one caretaker per plot only)
    const existing = await pool.query(
      `SELECT u.name FROM caretaker_plots cp
       JOIN users u ON cp.caretaker_id = u.id
       WHERE cp.plot_id = $1 AND cp.caretaker_id != $2`,
      [plot_id, req.params.id]
    );
    if (existing.rows[0]) {
      return res.status(400).json({
        error: `This property is already assigned to ${existing.rows[0].name}. Remove them first before assigning a new caretaker.`
      });
    }

    await pool.query(
      `INSERT INTO caretaker_plots (caretaker_id, plot_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, plot_id]
    );
    // Keep users.plot_id in sync with most recent assignment (for legacy compatibility)
    await pool.query(`UPDATE users SET plot_id=$1 WHERE id=$2`, [plot_id, req.params.id]);

    const plots = await pool.query(
      `SELECT p.id, p.name, p.location FROM caretaker_plots cp
       JOIN plots p ON cp.plot_id = p.id WHERE cp.caretaker_id = $1 ORDER BY p.name`,
      [req.params.id]
    );
    res.json({ success: true, data: plots.rows });
  } catch (err) {
    // Handle unique constraint violation gracefully (duplicate caretaker+plot pair)
    if (err.code === '23505') {
      return res.status(400).json({ error: 'This caretaker is already assigned to this property.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/auth/users/:id/assign-plot/:plotId — remove a plot from caretaker
router.delete('/users/:id/assign-plot/:plotId', authMiddleware, requirePermission('users.assign_caretaker'), async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      if (visible !== 'ALL' && !visible.includes(Number(req.params.plotId))) {
        return res.status(403).json({ error: 'You do not have access to this property.' });
      }
    }
    await pool.query(
      `DELETE FROM caretaker_plots WHERE caretaker_id=$1 AND plot_id=$2`,
      [req.params.id, req.params.plotId]
    );
    // Update legacy users.plot_id to next remaining plot or null
    const remaining = await pool.query(
      `SELECT plot_id FROM caretaker_plots WHERE caretaker_id=$1 ORDER BY assigned_at DESC LIMIT 1`,
      [req.params.id]
    );
    await pool.query(
      `UPDATE users SET plot_id=$1 WHERE id=$2`,
      [remaining.rows[0]?.plot_id || null, req.params.id]
    );
    const plots = await pool.query(
      `SELECT p.id, p.name, p.location FROM caretaker_plots cp
       JOIN plots p ON cp.plot_id = p.id WHERE cp.caretaker_id = $1 ORDER BY p.name`,
      [req.params.id]
    );
    res.json({ success: true, data: plots.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/auth/users/:id/assign-plot (legacy — kept for compatibility) ───
router.patch('/users/:id/assign-plot', authMiddleware, requireAdmin, async (req, res) => {
  const { plot_id } = req.body;
  try {
    if (plot_id) {
      await pool.query(
        `INSERT INTO caretaker_plots (caretaker_id, plot_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.params.id, plot_id]
      );
    }
    await pool.query(`UPDATE users SET plot_id=$1 WHERE id=$2`, [plot_id || null, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/auth/users/:id/role (admin updates user role) ──────────────────
router.patch('/users/:id/role', authMiddleware, requireAdmin, async (req, res) => {
  const { role } = req.body;
  const allowedRoles = ['admin', 'agent', 'landlord', 'caretaker'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${allowedRoles.join(', ')}` });
  }
  try {
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role',
      [role, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/auth/users/:id/reset-password (admin resets to default password)
router.patch('/users/:id/reset-password', authMiddleware, requireAdmin, async (req, res) => {
  const DEFAULT_PASSWORD = 'RentFlow@123';
  try {
    const hashed = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2 RETURNING id, name',
      [hashed, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, message: `Password reset to RentFlow@123 for ${result.rows[0].name}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/tenant-request-otp ────────────────────────────────────────
// Sends a 6-digit OTP via SMS to the tenant's registered phone
router.post('/tenant-request-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number is required.' });

  try {
    // Find active tenant by phone
    const result = await pool.query(
      'SELECT id, full_name, phone FROM tenants WHERE phone = $1 AND is_active = true LIMIT 1',
      [phone]
    );
    const tenant = result.rows[0];

    // Always return success to avoid phone enumeration
    if (!tenant) {
      return res.json({ success: true, message: 'If that number is registered, an OTP has been sent.' });
    }

    // Generate 6-digit OTP
    const otp     = String(Math.floor(100000 + Math.random() * 900000));
    const hash    = await bcrypt.hash(otp, 10);
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate any existing OTPs for this tenant
    await pool.query('UPDATE tenant_otps SET used = true WHERE tenant_id = $1 AND used = false', [tenant.id]);

    // Store new OTP
    await pool.query(
      'INSERT INTO tenant_otps (tenant_id, otp_hash, expires_at) VALUES ($1, $2, $3)',
      [tenant.id, hash, expires]
    );

    // Send SMS via Africa's Talking
    try {
      const AT  = require('africastalking')({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME });
      const sms = AT.SMS;
      const formatted = tenant.phone.startsWith('0')
        ? `+254${tenant.phone.slice(1)}`
        : tenant.phone.startsWith('254') ? `+${tenant.phone}` : tenant.phone;

      // Sandbox rejects any custom 'from' value outright (InvalidSenderId) —
      // it must be omitted so AT uses its own shared test shortcode. Only
      // include 'from' once AT_SENDER_ID is actually set (live app with an
      // approved sender ID).
      const smsPayload = {
        to:      [formatted],
        message: `Your RentFlow PIN reset code is: ${otp}. It expires in 10 minutes. Do not share it with anyone.`,
      };
      if (process.env.AT_SENDER_ID) smsPayload.from = process.env.AT_SENDER_ID;

      await sms.send(smsPayload);
    } catch (smsErr) {
      console.error('OTP SMS failed:', smsErr.message);
      // Still respond success — don't reveal SMS failure to client
    }

    res.json({ success: true, message: 'If that number is registered, an OTP has been sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/tenant-reset-pin ──────────────────────────────────────────
// Verifies OTP and sets a new PIN, then returns a login token
router.post('/tenant-reset-pin', async (req, res) => {
  const { phone, otp, new_pin } = req.body;
  if (!phone || !otp || !new_pin)
    return res.status(400).json({ error: 'Phone, OTP, and new PIN are required.' });
  if (new_pin.length < 4)
    return res.status(400).json({ error: 'PIN must be at least 4 digits.' });

  try {
    const tenantRes = await pool.query(
      `SELECT t.*, h.unit_number, h.rent_amount, h.house_type, h.deposit,
              p.name AS plot_name, p.location AS plot_location
       FROM tenants t
       LEFT JOIN houses h ON t.house_id = h.id
       LEFT JOIN plots  p ON h.plot_id  = p.id
       WHERE t.phone = $1 AND t.is_active = true LIMIT 1`,
      [phone]
    );
    const tenant = tenantRes.rows[0];
    if (!tenant) return res.status(400).json({ error: 'Phone number not found.' });

    // Get the latest unused, unexpired OTP
    const otpRes = await pool.query(
      `SELECT * FROM tenant_otps
       WHERE tenant_id = $1 AND used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [tenant.id]
    );
    const otpRecord = otpRes.rows[0];
    if (!otpRecord) return res.status(400).json({ error: 'OTP expired or not found. Please request a new one.' });

    const valid = await bcrypt.compare(otp, otpRecord.otp_hash);
    if (!valid) return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });

    // Mark OTP as used
    await pool.query('UPDATE tenant_otps SET used = true WHERE id = $1', [otpRecord.id]);

    // Hash and save new PIN
    const pinHash = await bcrypt.hash(new_pin, 10);
    await pool.query('UPDATE tenants SET pin = $1 WHERE id = $2', [pinHash, tenant.id]);

    // Return login token so they're immediately logged in
    const token = jwt.sign(
      { id: tenant.id, role: 'tenant', phone: tenant.phone },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      success: true,
      token,
      tenant: {
        id: tenant.id, full_name: tenant.full_name, phone: tenant.phone,
        unit_number: tenant.unit_number, plot_name: tenant.plot_name,
        plot_location: tenant.plot_location, rent_amount: tenant.rent_amount,
        house_type: tenant.house_type, move_in_date: tenant.move_in_date,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/tenant-login ───────────────────────────────────────────────
// Login is now by National ID, not phone — phone stays reserved for OTP
// PIN-reset (tenant-request-otp / tenant-reset-pin, below) and for M-Pesa
// payment matching (mpesa.js), neither of which changed.
router.post('/tenant-login', async (req, res) => {
  const { national_id, pin } = req.body;
  if (!national_id || !pin) return res.status(400).json({ error: 'National ID and PIN are required.' });
  try {
    const result = await pool.query(
      `SELECT t.*, h.unit_number, h.rent_amount, h.house_type, h.deposit,
              p.name AS plot_name, p.location AS plot_location
       FROM tenants t
       LEFT JOIN houses h ON t.house_id = h.id
       LEFT JOIN plots  p ON h.plot_id  = p.id
       WHERE t.national_id = $1 AND t.is_active = true`,
      [national_id]
    );
    const tenant = result.rows[0];
    // Previously this told the caller whether the National ID itself existed
    // ("National ID not found" vs "Incorrect PIN") — two different error
    // messages let anyone enumerate valid tenant National IDs just by trying
    // numbers and watching which error comes back. Both "no such tenant" and
    // "wrong PIN" now return the same generic message.
    if (!tenant) return res.status(401).json({ error: 'Incorrect National ID or PIN.' });
    if (!tenant.pin) return res.status(401).json({ error: 'PIN not set. Contact your landlord to set up your portal access.' });

    const valid = await bcrypt.compare(pin, tenant.pin);
    if (!valid) return res.status(401).json({ error: 'Incorrect National ID or PIN.' });

    const token = jwt.sign(
      { id: tenant.id, role: 'tenant', phone: tenant.phone },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, tenant: {
      id: tenant.id, full_name: tenant.full_name, phone: tenant.phone,
      unit_number: tenant.unit_number, plot_name: tenant.plot_name,
      plot_location: tenant.plot_location, rent_amount: tenant.rent_amount,
      house_type: tenant.house_type, move_in_date: tenant.move_in_date,
    }});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/auth/tenants/:id/set-pin (admin/landlord sets tenant PIN) ──────
// Was hardcoded to ['admin','super_admin','landlord'] with NO scope check at
// all — any landlord (including a view-only landlord_with_agent) could set
// the PIN of ANY tenant in the system, not just their own, and agent was
// excluded entirely despite having tenants.edit. Now matrix-driven + scoped,
// matching every other write route in this project.
router.patch('/tenants/:id/set-pin', authMiddleware, requirePermission('tenants.set_pin'), async (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits.' });
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const visible = await getVisiblePlotIds(req.user);
      const tenantRow = await pool.query(
        `SELECT h.plot_id FROM tenants t LEFT JOIN houses h ON t.house_id = h.id WHERE t.id = $1`,
        [req.params.id]
      );
      const plotId = tenantRow.rows[0]?.plot_id;
      const allowed = visible === 'ALL' || (plotId != null && visible.includes(plotId));
      if (!allowed) return res.status(403).json({ error: 'You do not have access to this tenant.' });
    }

    const hashed = await bcrypt.hash(pin, 10);
    const result = await pool.query(
      'UPDATE tenants SET pin = $1 WHERE id = $2 RETURNING id, full_name, phone',
      [hashed, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Tenant not found.' });
    res.json({ success: true, message: `PIN set for ${result.rows[0].full_name}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});



const crypto     = require('crypto');
const nodemailer = require('nodemailer');

function getMailer() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const result = await pool.query(
      'SELECT id, name, role, email FROM users WHERE email = $1 AND is_approved = true LIMIT 1',
      [email]
    );
    const user = result.rows[0];

    // Always return success to avoid email enumeration
    if (!user) return res.json({ success: true });

    if (!['admin', 'super_admin'].includes(user.role)) {
      // Non-admin staff — don't send email, frontend handles contact message
      return res.json({ success: true, role: user.role });
    }

    // Generate secure token
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate old tokens
    await pool.query('UPDATE password_reset_tokens SET used=true WHERE user_id=$1 AND used=false', [user.id]);

    // Store new token
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, token, expires]
    );

    // Send email
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${token}`;
    const mailer   = getMailer();

    await mailer.sendMail({
      from:    `"RentFlow" <${process.env.EMAIL_USER}>`,
      to:      user.email,
      subject: 'RentFlow — Password Reset',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8f9fc;border-radius:12px;">
          <h2 style="color:#4f46e5;font-family:'Segoe UI',sans-serif;margin-bottom:8px;">Password Reset</h2>
          <p style="color:#374151;font-size:15px;">Hello ${user.name},</p>
          <p style="color:#374151;font-size:15px;">Click the button below to reset your RentFlow password. This link expires in <strong>1 hour</strong>.</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${resetUrl}" style="background:#4f46e5;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">Reset Password</a>
          </div>
          <p style="color:#9ca3af;font-size:13px;">If you didn't request this, ignore this email. Your password won't change.</p>
          <hr style="border:1px solid #e5e7eb;margin:20px 0;"/>
          <p style="color:#9ca3af;font-size:12px;">RentFlow · Kenya Rental Management</p>
        </div>
      `,
    });

    res.json({ success: true, role: 'admin' });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'Failed to send reset email. Please try again.' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) return res.status(400).json({ error: 'Token and new password are required.' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  try {
    const result = await pool.query(
      `SELECT prt.*, u.name FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token=$1 AND prt.used=false AND prt.expires_at > NOW()
       LIMIT 1`,
      [token]
    );
    const record = result.rows[0];
    if (!record) return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });

    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hashed, record.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used=true WHERE id=$1', [record.id]);

    res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/admin-contact — returns admin contact info for non-admin forgot password
router.get('/admin-contact', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT name, email, phone FROM users WHERE role IN ('admin', 'super_admin') ORDER BY id ASC LIMIT 1`
    );
    const admin = result.rows[0];
    res.json({ success: true, data: admin || { name: 'Admin', email: process.env.ADMIN_EMAIL, phone: process.env.ADMIN_PHONE } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ── Roles & Permissions matrix (super admin only) ──────────────────────────────
// Backs the visual permissions editor. super_admin itself is never stored
// here or editable through this endpoint — it always has every permission,
// enforced in code (see middleware/permissions.js).

// Permissions that can NEVER be granted to any profile through this
// endpoint, regardless of what's sent — a defensive floor independent of
// whatever the frontend currently exposes as toggleable.
const NEVER_GRANTABLE = ['system.manage_roles', 'system.manage_permissions', 'users.create_super_admin'];

const EDITABLE_PROFILES = ['agent', 'landlord_with_agent', 'landlord_self', 'caretaker'];

// GET /api/auth/role-permissions — the full matrix, one row per (profile, permission)
router.get('/role-permissions', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT profile, permission, allowed FROM role_permissions ORDER BY permission, profile`
    );
    res.json({ success: true, data: result.rows, profiles: EDITABLE_PROFILES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/auth/role-permissions — toggle a single (profile, permission) cell
// Body: { profile, permission, allowed }
router.patch('/role-permissions', authMiddleware, requireAdmin, async (req, res) => {
  const { profile, permission, allowed } = req.body;
  if (!profile || !permission || typeof allowed !== 'boolean') {
    return res.status(400).json({ error: 'profile, permission, and allowed (boolean) are required.' });
  }
  if (!EDITABLE_PROFILES.includes(profile)) {
    return res.status(400).json({ error: `profile must be one of: ${EDITABLE_PROFILES.join(', ')}` });
  }
  if (NEVER_GRANTABLE.includes(permission)) {
    return res.status(403).json({ error: 'This permission can never be granted through the matrix.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO role_permissions (profile, permission, allowed) VALUES ($1, $2, $3)
       ON CONFLICT (profile, permission) DO UPDATE SET allowed = $3
       RETURNING profile, permission, allowed`,
      [profile, permission, allowed]
    );
    await logAudit({
      user: req.user, action: 'permissions.toggle', entityType: 'role_permissions', entityId: profile,
      changes: { [permission]: { to: allowed } },
    });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
