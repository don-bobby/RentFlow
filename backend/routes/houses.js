const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { logAudit, diff } = require('../utils/audit');
const { getVisiblePlotIds } = require('../middleware/scope');
const { requirePermission } = require('../middleware/permissions');
const { authMiddleware: auth } = require('../middleware/auth');


// GET ALL houses — admin/super_admin see all, agent sees their landlords',
// landlord sees own, caretaker sees assigned (scoping lives in one place now)
router.get('/', auth, async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.json([]);

    const query = `
      SELECT h.*, p.name AS plot_name, p.location AS plot_location, u.name AS owner_name
      FROM houses h
      LEFT JOIN plots p ON h.plot_id = p.id
      LEFT JOIN users u ON p.user_id = u.id
      ${visible === 'ALL' ? '' : 'WHERE p.id = ANY($1)'}
      ORDER BY h.id ASC
    `;
    const params = visible === 'ALL' ? [] : [visible];
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/houses/pending-approval-count — for the dashboard alert banner.
// Scoped the same way as everything else: admin sees every pending unit
// system-wide, everyone else only sees ones on their own visible plots.
// Must stay ABOVE GET /:id below, or Express would treat the literal text
// "pending-approval-count" as an :id value and this route would never match.
router.get('/pending-approval-count', auth, async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    let result;
    if (visible === 'ALL') {
      result = await pool.query(`SELECT id, plot_id FROM houses WHERE is_approved = false AND plot_id IS NOT NULL ORDER BY id ASC`);
    } else if (visible.length === 0) {
      return res.json({ success: true, count: 0, plot_ids: [], house_ids: [], first_house_id: null, first_plot_id: null });
    } else {
      result = await pool.query(`SELECT id, plot_id FROM houses WHERE is_approved = false AND plot_id = ANY($1) ORDER BY id ASC`, [visible]);
    }
    // count = total pending UNITS (unchanged meaning); plot_ids = the
    // distinct PLOTS they're on. house_ids + first_house_id/first_plot_id
    // (oldest pending unit, i.e. the one that's been waiting longest) let
    // "Review" jump straight to that specific unit's card instead of just
    // landing on the Properties page in general.
    const plot_ids = [...new Set(result.rows.map(r => r.plot_id))];
    const house_ids = result.rows.map(r => r.id);
    res.json({
      success: true,
      count: result.rows.length,
      plot_ids,
      house_ids,
      first_house_id: house_ids[0] || null,
      first_plot_id: result.rows[0]?.plot_id || null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET ONE house
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT h.* FROM houses h WHERE h.id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'House not found' });
    const house = result.rows[0];

    const visible = await getVisiblePlotIds(req.user);
    const canView = visible === 'ALL' || (house.plot_id != null && visible.includes(house.plot_id));
    if (!canView) return res.status(403).json({ error: 'Access denied' });

    res.json(house);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create house
// Admin/landlord: auto-approved. Agent/caretaker: pending approval — neither
// one owns the property, they're both acting on a landlord's behalf, so a
// unit either of them adds needs landlord/admin sign-off before it's live.
router.post('/', auth, requirePermission('houses.create'), async (req, res) => {
  try {
    const { plot_id, unit_number, house_type, rent_amount, deposit, status, meter_no } = req.body;
    if (!plot_id || !unit_number || !rent_amount) return res.status(400).json({ error: 'plot_id, unit_number and rent_amount are required' });

    // Scope check: does this user have access to the plot they're adding a unit to?
    // Covers landlord (own plots), agent (their landlords' plots), caretaker
    // (assigned plots) and admin (everything) via the same rules GET already uses.
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && !visible.includes(parseInt(plot_id))) {
      return res.status(403).json({ error: 'You do not have access to this plot.' });
    }

    // Agent- and caretaker-added units require approval; only admin/landlord
    // (actual owners/operators of the account) auto-approve.
    const isApproved = !['agent', 'caretaker'].includes(req.user.role);

    const result = await pool.query(
      `INSERT INTO houses (plot_id, unit_number, house_type, rent_amount, deposit, status, meter_no, is_approved, status_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
      [plot_id, unit_number, house_type || 'Bedsitter', rent_amount, deposit || null, status || 'vacant', meter_no || null, isApproved]
    );

    // Previously this just sat there unapproved with no one actually told.
    // Posting a property-targeted notice reaches the landlord (and their
    // agent, if any) through the exact same visibility rules every other
    // property notice already uses — admin sees everything regardless.
    if (!isApproved) {
      const plotRow = await pool.query('SELECT name FROM plots WHERE id = $1', [plot_id]);
      await pool.query(
        `INSERT INTO notices (author_id, title, body, priority, target_type, target_id)
         VALUES ($1, $2, $3, 'warning', 'property', $4)`,
        [
          req.user.id,
          `New unit pending approval — ${unit_number}`,
          `${req.user.name || (req.user.role === 'agent' ? 'An agent' : 'A caretaker')} added unit ${unit_number} on ${plotRow.rows[0]?.name || 'this property'}, awaiting approval before it goes live.`,
          plot_id,
        ]
      );
    }

    const msg = isApproved ? undefined : 'Unit submitted for approval by admin/landlord.';
    res.status(201).json({ success: true, data: result.rows[0], message: msg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update house
router.put('/:id', auth, requirePermission('houses.edit'), async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT p.user_id, h.plot_id FROM houses h LEFT JOIN plots p ON h.plot_id = p.id WHERE h.id = $1',
      [req.params.id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'House not found' });

    // Scope check: same rule as everywhere else — admin sees all, agent
    // covers their landlords' plots, landlord covers their own, caretaker
    // covers assigned plots.
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && !visible.includes(check.rows[0].plot_id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { plot_id, unit_number, house_type, rent_amount, deposit, status, meter_no } = req.body;
    const oldStatusRes = await pool.query('SELECT status, rent_amount, unit_number FROM houses WHERE id=$1', [req.params.id]);
    const statusChanged = oldStatusRes.rows[0] && oldStatusRes.rows[0].status !== (status || 'vacant');
    const result = await pool.query(
      `UPDATE houses SET plot_id=$1, unit_number=$2, house_type=$3, rent_amount=$4,
       deposit=$5, status=$6, meter_no=$7, status_changed_at = CASE WHEN $9 THEN NOW() ELSE status_changed_at END
       WHERE id=$8 RETURNING *`,
      [plot_id, unit_number, house_type, rent_amount, deposit || null, status || 'vacant', meter_no || null, req.params.id, statusChanged]
    );
    const changes = diff(oldStatusRes.rows[0], result.rows[0], ['status', 'rent_amount', 'unit_number']);
    if (Object.keys(changes).length > 0) {
      await logAudit({ user: req.user, action: 'house.update', entityType: 'house', entityId: req.params.id, changes });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Shared scope check for the four routes below — same rule as everywhere
// else: admin sees all, agent covers their landlords' plots, landlord
// covers their own, caretaker covers assigned plots.
async function assertHouseInScope(req, houseId) {
  const row = await pool.query('SELECT plot_id FROM houses WHERE id = $1', [houseId]);
  if (!row.rows[0]) return { ok: false, notFound: true };
  const visible = await getVisiblePlotIds(req.user);
  const ok = visible === 'ALL' || (row.rows[0].plot_id != null && visible.includes(row.rows[0].plot_id));
  return { ok, notFound: false };
}

// PATCH /api/houses/:id/reject — rejects a caretaker-submitted unit.
// Was hardcoded to ['admin','landlord'], which let EVERY landlord reject
// (including landlord_with_agent, who shouldn't) and blocked agent entirely
// (who the matrix does grant this to). Now matrix-driven + scoped.
router.patch('/:id/reject', auth, requirePermission('houses.approve'), async (req, res) => {
  const { reason } = req.body;
  try {
    const scope = await assertHouseInScope(req, req.params.id);
    if (scope.notFound) return res.status(404).json({ error: 'House not found' });
    if (!scope.ok) return res.status(403).json({ error: 'Access denied' });

    const result = await pool.query(
      `UPDATE houses SET is_approved = false, rejection_reason = $1 WHERE id = $2 RETURNING *`,
      [reason || null, req.params.id]
    );
    await logAudit({ user: req.user, action: 'house.reject', entityType: 'house', entityId: req.params.id, changes: { is_approved: { from: null, to: false } } });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/houses/:id/approve — same fix as reject above.
router.patch('/:id/approve', auth, requirePermission('houses.approve'), async (req, res) => {
  try {
    const scope = await assertHouseInScope(req, req.params.id);
    if (scope.notFound) return res.status(404).json({ error: 'House not found' });
    if (!scope.ok) return res.status(403).json({ error: 'Access denied' });

    // Clear any stale rejection_reason too — otherwise a unit rejected once
    // and then approved keeps showing a "❌ Rejected" reason in the UI even
    // though it's now fully approved and live.
    const result = await pool.query(
      'UPDATE houses SET is_approved = true, rejection_reason = NULL WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    await logAudit({ user: req.user, action: 'house.approve', entityType: 'house', entityId: req.params.id, changes: { is_approved: { from: false, to: true }, rejection_reason: { to: null } } });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/houses/:id/description — previously had NO permission or scope
// check at all; anyone authenticated could rewrite any house's description.
router.patch('/:id/description', auth, requirePermission('houses.edit'), async (req, res) => {
  const { description } = req.body;
  try {
    const scope = await assertHouseInScope(req, req.params.id);
    if (scope.notFound) return res.status(404).json({ error: 'House not found' });
    if (!scope.ok) return res.status(403).json({ error: 'Access denied' });

    await pool.query('UPDATE houses SET description = $1 WHERE id = $2', [description || null, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE house — was hardcoded to 'admin' (not super_admin-aware). No
// profile in the matrix has houses.delete, so this stays effectively
// admin-only, but now driven by the matrix like every other DELETE route.
router.delete('/:id', auth, requirePermission('houses.delete'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM houses WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'House not found' });
    res.json({ success: true, message: 'House deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
