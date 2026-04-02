const router  = require('express').Router();
const pool    = require('../database/db');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

// ── Middleware ────────────────────────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

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
  } else if (requesterRole !== 'admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const { name, email, password, role, phone, plot_id } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password and role are required.' });
  }

  const allowedRoles = ['admin', 'landlord', 'caretaker'];
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

    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, phone, is_approved, plot_id)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING id, name, email, role, phone, is_approved, plot_id, created_at`,
      [name, email, hashedPassword, role, phone || null, assignedPlot]
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
    if (req.user.role === 'admin') {
      result = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.phone, u.is_approved, u.plot_id, u.created_at,
                p.name AS plot_name
         FROM users u
         LEFT JOIN plots p ON u.plot_id = p.id
         ORDER BY u.created_at DESC`
      );
    } else if (req.user.role === 'landlord') {
      // Landlords see themselves + their caretakers
      result = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.phone, u.is_approved, u.plot_id, u.created_at,
                p.name AS plot_name
         FROM users u
         LEFT JOIN plots p ON u.plot_id = p.id
         WHERE u.id = $1 OR (u.role = 'caretaker' AND p.user_id = $1)
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

// ── PATCH /api/auth/users/:id/approve (admin approves a landlord) ─────────────
router.patch('/users/:id/approve', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_approved = true WHERE id = $1 RETURNING id, name, email, role, is_approved`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
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
  if (req.user.id !== parseInt(req.params.id) && req.user.role !== 'admin') {
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
  if (req.user.id !== parseInt(req.params.id) && req.user.role !== 'admin') {
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

// ── PATCH /api/auth/users/:id/assign-plot (admin assigns caretaker to plot) ───
router.patch('/users/:id/assign-plot', authMiddleware, requireAdmin, async (req, res) => {
  const { plot_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET plot_id = $1 WHERE id = $2 AND role = 'caretaker' RETURNING id, name, role, plot_id`,
      [plot_id || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Caretaker not found.' });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/auth/users/:id/role (admin updates user role) ──────────────────
router.patch('/users/:id/role', authMiddleware, requireAdmin, async (req, res) => {
  const { role } = req.body;
  const allowedRoles = ['admin', 'landlord', 'caretaker'];
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

// ── PATCH /api/auth/users/:id/reset-password (admin resets any user's password) 
router.patch('/users/:id/reset-password', authMiddleware, requireAdmin, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'new_password must be at least 6 characters.' });
  }
  try {
    const hashed = await bcrypt.hash(new_password, 10);
    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2 RETURNING id, name',
      [hashed, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, message: `Password reset successfully for ${result.rows[0].name}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
