const router  = require('express').Router();
const pool    = require('../database/db');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { logAudit } = require('../utils/audit');

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
                -- For caretakers: their assigned plot name
                cp.name AS plot_name,
                -- For landlords: comma-separated list of their properties
                lp.plot_names AS landlord_plots,
                -- For caretakers: all assigned plot names (multi-plot support)
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
         ORDER BY u.created_at DESC`
      );
    } else if (req.user.role === 'landlord') {
      result = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, u.phone, u.is_approved, u.plot_id, u.created_at,
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
        `SELECT u.id, u.name, u.email, u.role, u.phone, u.is_approved, u.plot_id, u.created_at,
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
         WHERE u.role IN ('admin', 'landlord') OR u.id = $1
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
    await logAudit({ user: req.user, action: 'user.approve', entityType: 'user', entityId: req.params.id, changes: { is_approved: { from: false, to: true } } });
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
    await logAudit({ user: req.user, action: 'user.reject', entityType: 'user', entityId: req.params.id, changes: { is_approved: { from: true, to: false } } });
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

// ── GET /api/auth/users/:id/plots — get all plots assigned to a caretaker ──────
router.get('/users/:id/plots', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.location FROM caretaker_plots cp
       JOIN plots p ON cp.plot_id = p.id
       WHERE cp.caretaker_id = $1 ORDER BY p.name`,
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/auth/users/:id/assign-plot — add a plot to a caretaker ──────────
router.post('/users/:id/assign-plot', authMiddleware, requireAdmin, async (req, res) => {
  const { plot_id } = req.body;
  if (!plot_id) return res.status(400).json({ error: 'plot_id is required.' });
  try {
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
router.delete('/users/:id/assign-plot/:plotId', authMiddleware, requireAdmin, async (req, res) => {
  try {
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

      await sms.send({
        to:      [formatted],
        message: `Your RentFlow PIN reset code is: ${otp}. It expires in 10 minutes. Do not share it with anyone.`,
        from:    process.env.AT_SENDER_ID || 'RENTFLOW',
      });
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
router.post('/tenant-login', async (req, res) => {
  const { phone, pin } = req.body;
  if (!phone || !pin) return res.status(400).json({ error: 'Phone and PIN are required.' });
  try {
    const result = await pool.query(
      `SELECT t.*, h.unit_number, h.rent_amount, h.house_type, h.deposit,
              p.name AS plot_name, p.location AS plot_location
       FROM tenants t
       LEFT JOIN houses h ON t.house_id = h.id
       LEFT JOIN plots  p ON h.plot_id  = p.id
       WHERE t.phone = $1 AND t.is_active = true`,
      [phone]
    );
    const tenant = result.rows[0];
    if (!tenant) return res.status(401).json({ error: 'Phone number not found.' });
    if (!tenant.pin) return res.status(401).json({ error: 'PIN not set. Contact your landlord to set up your portal access.' });

    const valid = await bcrypt.compare(pin, tenant.pin);
    if (!valid) return res.status(401).json({ error: 'Incorrect PIN.' });

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
router.patch('/tenants/:id/set-pin', authMiddleware, async (req, res) => {
  if (!['admin','landlord'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied.' });
  const { pin } = req.body;
  if (!pin || pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits.' });
  try {
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

    if (user.role !== 'admin') {
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
      `SELECT name, email, phone FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`
    );
    const admin = result.rows[0];
    res.json({ success: true, data: admin || { name: 'Admin', email: process.env.ADMIN_EMAIL, phone: process.env.ADMIN_PHONE } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


module.exports = router;
