const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { logAudit, diff } = require('../utils/audit');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissions } = require('../middleware/permissions');
const { authMiddleware: auth } = require('../middleware/auth');
const { computeLedger, loadPaidMaps } = require('../utils/rentLedger');


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
// GET /api/houses/building/:plotId — everything the 3D building view needs:
// every unit of one property with its floor and this month's payment state.
// States: paid | partial | pending (rent not yet due) | unpaid | overdue
// (2+ months owed) | vacant | other. Tenant details and money states need
// tenants.view for that property; without it units just show occupied/vacant.
router.get('/building/:plotId', auth, async (req, res) => {
  try {
    const plotId = parseInt(req.params.plotId);
    if (!plotId) return res.status(400).json({ error: 'Invalid property.' });
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && !visible.includes(plotId)) return res.status(403).json({ error: 'Access denied' });

    const plotRes = await pool.query('SELECT id, name, location, layout_extras FROM plots WHERE id = $1', [plotId]);
    if (!plotRes.rows[0]) return res.status(404).json({ error: 'Property not found' });
    const { permissions } = await getPermissions(req.user, plotId);
    const seeMoney = permissions.includes('*') || permissions.includes('tenants.view');

    const hs = await pool.query(
      `SELECT h.id, h.unit_number, h.house_type, h.rent_amount, h.status, h.floor,
              h.layout_x, h.layout_z, h.layout_w, h.layout_d,
              t.id AS tenant_id, t.full_name, t.phone, t.move_in_date, t.rent_due_day
       FROM houses h
       LEFT JOIN LATERAL (
         SELECT * FROM tenants tt WHERE tt.house_id = h.id AND tt.is_active = true ORDER BY tt.id DESC LIMIT 1
       ) t ON true
       WHERE h.plot_id = $1 AND COALESCE(h.is_approved, true) = true
       ORDER BY h.floor NULLS LAST, h.unit_number`, [plotId]);

    const tenantIds = hs.rows.map(r => r.tenant_id).filter(Boolean);
    const maps = seeMoney ? await loadPaidMaps(pool, tenantIds) : {};
    const now = new Date();
    const curKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

    const units = hs.rows.map(h => {
      const base = { id: h.id, unit_number: h.unit_number, house_type: h.house_type, rent_amount: parseFloat(h.rent_amount || 0), floor: h.floor,
                     layout_x: h.layout_x, layout_z: h.layout_z, layout_w: h.layout_w || 1, layout_d: h.layout_d || 1 };
      if (!h.tenant_id) return { ...base, state: h.status === 'vacant' ? 'vacant' : (h.status === 'occupied' ? 'occupied' : 'other'), house_status: h.status };
      if (!seeMoney) return { ...base, state: 'occupied', house_status: h.status };
      const paidMap = maps[h.tenant_id] || {};
      const { unpaidMonths, totalOwed } = computeLedger({ rent: h.rent_amount, moveInDate: h.move_in_date, paidMap, now });
      const curPaid = paidMap[curKey] || 0;
      const dueDay = Math.min(28, parseInt(h.rent_due_day) || 1);
      let state;
      if (totalOwed <= 0) state = 'paid';
      else if (unpaidMonths.length >= 2) state = 'overdue';
      else if (curPaid > 0) state = 'partial';
      else if (now.getDate() <= dueDay) state = 'pending';
      else state = 'unpaid';
      return { ...base, state, house_status: h.status, tenant: { id: h.tenant_id, name: h.full_name, phone: h.phone },
               balance: totalOwed, months_owed: unpaidMonths.length, paid_this_month: curPaid, due_day: dueDay };
    });

    const summary = units.reduce((a, u) => { a[u.state] = (a[u.state] || 0) + 1; return a; }, {});
    res.json({ success: true, data: { plot: { id: plotRes.rows[0].id, name: plotRes.rows[0].name, location: plotRes.rows[0].location },
      extras: plotRes.rows[0].layout_extras || [],
      can_edit_layout: permissions.includes('*') || permissions.includes('houses.edit'),
      units, summary, see_money: seeMoney,
      month: now.toLocaleString('en-KE', { month: 'long', year: 'numeric' }) } });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// PUT /api/houses/layout/:plotId — save the 3D layout of one property.
// Body: { units: [{ id, placed, floor, x, z, w, d }], extras: [{ id, kind, floor, x, z, w, d }] }
// Every placed piece must fit the grid and nothing may overlap on a floor.
const GRID_MAX = 40;
const EXTRA_KINDS = ['corridor', 'stairs', 'garden', 'road', 'fence', 'gate'];
router.put('/layout/:plotId', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const plotId = parseInt(req.params.plotId);
    if (!plotId) return res.status(400).json({ error: 'Invalid property.' });
    const plotRow = await client.query('SELECT id, name FROM plots WHERE id = $1', [plotId]);
    if (!plotRow.rows[0]) return res.status(404).json({ error: 'Property not found' });
    const { permissions } = await getPermissions(req.user, plotId);
    if (!permissions.includes('*') && !permissions.includes('houses.edit')) {
      return res.status(403).json({ error: 'Missing permission: houses.edit' });
    }
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && !visible.includes(plotId)) return res.status(403).json({ error: 'Access denied' });

    const unitsIn = Array.isArray(req.body.units) ? req.body.units : [];
    const extrasIn = Array.isArray(req.body.extras) ? req.body.extras : [];
    if (unitsIn.length > 500 || extrasIn.length > 100) return res.status(400).json({ error: 'Too many items.' });

    const own = await client.query('SELECT id FROM houses WHERE plot_id = $1', [plotId]);
    const ownIds = new Set(own.rows.map(r => r.id));
    const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);
    const rect = (o) => ({ floor: int(o.floor), x: int(o.x), z: int(o.z), w: int(o.w), d: int(o.d) });
    const valid = (r) => r.floor >= 0 && r.floor <= 60 && r.x >= 0 && r.z >= 0 && r.w >= 1 && r.d >= 1 && r.w <= 8 && r.d <= 8 && r.x + r.w <= GRID_MAX && r.z + r.d <= GRID_MAX;

    const placed = [], cleared = [], extras = [];
    for (const u of unitsIn) {
      const id = int(u.id);
      if (!ownIds.has(id)) return res.status(400).json({ error: 'A unit in the layout does not belong to this property.' });
      if (!u.placed) { cleared.push(id); continue; }
      const r = rect(u);
      if (!valid(r)) return res.status(400).json({ error: 'A unit position is outside the allowed grid.' });
      placed.push({ kind: 'unit', id, ...r });
    }
    for (const e of extrasIn) {
      if (!EXTRA_KINDS.includes(e.kind)) return res.status(400).json({ error: 'Unknown layout piece.' });
      const r = rect(e);
      if (!valid(r)) return res.status(400).json({ error: 'A layout piece is outside the allowed grid.' });
      extras.push({ kind: e.kind, id: String(e.id || '').slice(0, 24) || `${e.kind}-${extras.length}`, ...r });
    }
    // No overlaps on the same floor
    const all = [...placed, ...extras.map(e => ({ ...e, kind: 'extra' }))];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.floor === b.floor && a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d) {
        return res.status(400).json({ error: 'Two pieces overlap on the same floor. Move one and save again.' });
      }
    }

    await client.query('BEGIN');
    for (const u of placed) {
      await client.query('UPDATE houses SET floor=$1, layout_x=$2, layout_z=$3, layout_w=$4, layout_d=$5 WHERE id=$6 AND plot_id=$7',
        [u.floor, u.x, u.z, u.w, u.d, u.id, plotId]);
    }
    if (cleared.length) {
      await client.query('UPDATE houses SET layout_x=NULL, layout_z=NULL, layout_w=1, layout_d=1 WHERE id = ANY($1) AND plot_id=$2', [cleared, plotId]);
    }
    await client.query('UPDATE plots SET layout_extras = $1::jsonb WHERE id = $2',
      [JSON.stringify(extras.map(({ kind, id, floor, x, z, w, d }) => ({ kind, id, floor, x, z, w, d }))), plotId]);
    await client.query('COMMIT');
    await logAudit({ user: req.user, action: 'plot.layout_saved', entityType: 'plot', entityId: plotId,
      changes: { placed_units: { to: placed.length }, pieces: { to: extras.length } } });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Layout save failed:', err);
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

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
// Was gated by requirePermission('houses.create') as middleware — that runs
// before the body is even parsed here, so a per-property override could
// never apply. Unlike plots.js's own POST / (a brand new plot, with nothing
// yet to scope against), this route always targets an EXISTING plot given
// right in the request body, so the permission can be checked against that
// plot immediately — no extra query needed to find it.
router.post('/', auth, async (req, res) => {
  try {
    const { plot_id, unit_number, house_type, rent_amount, deposit, status, meter_no, floor } = req.body;
    if (!plot_id || !unit_number || !rent_amount) return res.status(400).json({ error: 'plot_id, unit_number and rent_amount are required' });

    const plotIdNum = parseInt(plot_id);
    const { permissions } = await getPermissions(req.user, plotIdNum);
    if (!permissions.includes('*') && !permissions.includes('houses.create')) {
      return res.status(403).json({ error: 'Missing permission: houses.create' });
    }

    // Scope check: does this user have access to the plot they're adding a unit to?
    // Covers landlord (own plots), agent (their landlords' plots), caretaker
    // (assigned plots) and admin (everything) via the same rules GET already uses.
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && !visible.includes(plotIdNum)) {
      return res.status(403).json({ error: 'You do not have access to this plot.' });
    }

    // Agent- and caretaker-added units require approval; only admin/landlord
    // (actual owners/operators of the account) auto-approve.
    const isApproved = !['agent', 'caretaker'].includes(req.user.role);

    const result = await pool.query(
      `INSERT INTO houses (plot_id, unit_number, house_type, rent_amount, deposit, status, meter_no, is_approved, status_changed_at, floor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9) RETURNING *`,
      [plot_id, unit_number, house_type || 'Bedsitter', rent_amount, deposit || null, status || 'vacant', meter_no || null, isApproved,
       floor === '' || floor == null ? null : Math.max(0, Math.min(60, parseInt(floor) || 0))]
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
// Was gated by requirePermission('houses.edit') as middleware — before this
// house's property was known, so a per-property override could never apply.
// Moved down to right after the house (and its plot) is loaded.
router.put('/:id', auth, async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT p.user_id, h.plot_id FROM houses h LEFT JOIN plots p ON h.plot_id = p.id WHERE h.id = $1',
      [req.params.id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'House not found' });

    const plotId = check.rows[0].plot_id;
    const { permissions } = await getPermissions(req.user, plotId);
    if (!permissions.includes('*') && !permissions.includes('houses.edit')) {
      return res.status(403).json({ error: 'Missing permission: houses.edit' });
    }

    // Scope check: same rule as everywhere else — admin sees all, agent
    // covers their landlords' plots, landlord covers their own, caretaker
    // covers assigned plots.
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && !visible.includes(plotId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { plot_id, unit_number, house_type, rent_amount, deposit, status, meter_no, floor } = req.body;
    const oldStatusRes = await pool.query('SELECT status, rent_amount, unit_number FROM houses WHERE id=$1', [req.params.id]);
    const statusChanged = oldStatusRes.rows[0] && oldStatusRes.rows[0].status !== (status || 'vacant');
    const result = await pool.query(
      `UPDATE houses SET plot_id=$1, unit_number=$2, house_type=$3, rent_amount=$4,
       deposit=$5, status=$6, meter_no=$7, status_changed_at = CASE WHEN $9 THEN NOW() ELSE status_changed_at END,
       floor = CASE WHEN $10 THEN $11 ELSE floor END
       WHERE id=$8 RETURNING *`,
      [plot_id, unit_number, house_type, rent_amount, deposit || null, status || 'vacant', meter_no || null, req.params.id, statusChanged,
       floor !== undefined, floor === '' || floor == null ? null : Math.max(0, Math.min(60, parseInt(floor) || 0))]
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
//
// Now also hands back plotId — each of those four routes used to gate on
// requirePermission(...) as middleware, before this house's property was
// knowable at all, so a per-property override could never apply. They each
// now check the permission themselves, right after calling this, against
// the exact plot it resolves here.
async function assertHouseInScope(req, houseId) {
  const row = await pool.query('SELECT plot_id FROM houses WHERE id = $1', [houseId]);
  if (!row.rows[0]) return { ok: false, notFound: true, plotId: null };
  const plotId = row.rows[0].plot_id;
  const visible = await getVisiblePlotIds(req.user);
  const ok = visible === 'ALL' || (plotId != null && visible.includes(plotId));
  return { ok, notFound: false, plotId };
}

// PATCH /api/houses/:id/reject — rejects a caretaker-submitted unit.
// Was hardcoded to ['admin','landlord'], which let EVERY landlord reject
// (including landlord_with_agent, who shouldn't) and blocked agent entirely
// (who the matrix does grant this to). Now matrix-driven + scoped.
router.patch('/:id/reject', auth, async (req, res) => {
  const { reason } = req.body;
  try {
    const scope = await assertHouseInScope(req, req.params.id);
    if (scope.notFound) return res.status(404).json({ error: 'House not found' });

    const { permissions } = await getPermissions(req.user, scope.plotId);
    if (!permissions.includes('*') && !permissions.includes('houses.approve')) {
      return res.status(403).json({ error: 'Missing permission: houses.approve' });
    }
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
router.patch('/:id/approve', auth, async (req, res) => {
  try {
    const scope = await assertHouseInScope(req, req.params.id);
    if (scope.notFound) return res.status(404).json({ error: 'House not found' });

    const { permissions } = await getPermissions(req.user, scope.plotId);
    if (!permissions.includes('*') && !permissions.includes('houses.approve')) {
      return res.status(403).json({ error: 'Missing permission: houses.approve' });
    }
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
router.patch('/:id/description', auth, async (req, res) => {
  const { description } = req.body;
  try {
    const scope = await assertHouseInScope(req, req.params.id);
    if (scope.notFound) return res.status(404).json({ error: 'House not found' });

    const { permissions } = await getPermissions(req.user, scope.plotId);
    if (!permissions.includes('*') && !permissions.includes('houses.edit')) {
      return res.status(403).json({ error: 'Missing permission: houses.edit' });
    }
    if (!scope.ok) return res.status(403).json({ error: 'Access denied' });

    await pool.query('UPDATE houses SET description = $1 WHERE id = $2', [description || null, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE house — was hardcoded to 'admin' (not super_admin-aware). No
// profile in the matrix has houses.delete, so this stays effectively
// admin-only, but now driven by the matrix like every other DELETE route.
router.delete('/:id', auth, async (req, res) => {
  try {
    const scope = await assertHouseInScope(req, req.params.id);
    if (scope.notFound) return res.status(404).json({ error: 'House not found' });

    const { permissions } = await getPermissions(req.user, scope.plotId);
    if (!permissions.includes('*') && !permissions.includes('houses.delete')) {
      return res.status(403).json({ error: 'Missing permission: houses.delete' });
    }
    if (!scope.ok) return res.status(403).json({ error: 'Access denied' });

    // The database has a foreign key from tenants.house_id to houses.id with
    // no cascade, so deleting a unit that still has ANY tenant row attached
    // — including a past tenant who moved out and was never reassigned or
    // removed, which doesn't show anywhere on the Properties page, since
    // that card only shows the current active tenant — used to just throw a
    // raw Postgres error ("violates foreign key constraint
    // tenants_house_id_fkey") straight into an alert() popup. Checking for
    // this first and explaining it in plain language, instead of attempting
    // the delete and letting it fail, is both clearer for the admin and
    // avoids relying on the database to explain its own constraint names.
    const linkedTenants = await pool.query(
      'SELECT full_name, is_active FROM tenants WHERE house_id = $1 ORDER BY is_active DESC, full_name',
      [req.params.id]
    );
    if (linkedTenants.rows.length > 0) {
      const names = linkedTenants.rows.map(t => `${t.full_name}${t.is_active ? '' : ' (moved out)'}`).join(', ');
      return res.status(400).json({
        error: `Can't delete this unit — it still has tenant record(s) linked to it: ${names}. Move or delete them on the Tenants page first.`,
      });
    }

    const result = await pool.query('DELETE FROM houses WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'House not found' });
    res.json({ success: true, message: 'House deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
