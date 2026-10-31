// Vendor directory: trades people a landlord uses, assignable to maintenance requests.
//   GET    /api/vendors                       vendors the user may see, with job count and spend
//   POST   /api/vendors                       add (needs maintenance.update on one of that landlord's plots)
//   PUT    /api/vendors/:id                   edit / archive
//   PATCH  /api/vendors/assign/:requestId     { vendor_id | null } set the vendor on a maintenance request
// Spend = confirmed expenses linked to that vendor's maintenance requests.
const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissions } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');

const isAdmin = (u) => ['admin', 'super_admin'].includes(u.role);
const pid = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const missing = (e) => e.code === '42P01' || e.code === '42703';
const fail = (res, e) => { if (missing(e)) return res.json({ success: true, migration_needed: true, data: [] }); console.error(e); res.status(500).json({ error: e.message }); };
const clean = (v, n) => { const s = String(v ?? '').trim().slice(0, n); return s || null; };

// Landlord ids whose plots this user can see AND holds `perm` on (admin: every landlord).
async function landlordsWith(user, perm) {
  if (isAdmin(user)) return 'ALL';
  const visible = await getVisiblePlotIds(user);
  const plots = (await pool.query('SELECT id, user_id FROM plots WHERE user_id IS NOT NULL')).rows
    .filter(p => visible === 'ALL' || visible.includes(p.id));
  const out = new Set();
  for (const p of plots) {
    if (out.has(p.user_id)) continue;
    const { permissions } = await getPermissions(user, p.id);
    if (permissions.includes('*') || permissions.includes(perm)) out.add(p.user_id);
  }
  return [...out];
}

router.get('/', auth, async (req, res) => {
  try {
    const ids = await landlordsWith(req.user, 'maintenance.view');
    if (ids !== 'ALL' && ids.length === 0) return res.json({ success: true, data: [], can_edit: false });
    const rows = (await pool.query(
      `SELECT v.*, u.name AS landlord_name,
              COUNT(DISTINCT m.id)::int AS jobs,
              COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'completed')::int AS completed,
              COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'confirmed'), 0)::float AS spent
         FROM vendors v
         JOIN users u ON u.id = v.landlord_id
         LEFT JOIN maintenance_requests m ON m.vendor_id = v.id
         LEFT JOIN expenses e ON e.maintenance_request_id = m.id
        ${ids === 'ALL' ? '' : 'WHERE v.landlord_id = ANY($1)'}
        GROUP BY v.id, u.name
        ORDER BY v.is_active DESC, v.name`, ids === 'ALL' ? [] : [ids])).rows;
    const editIds = await landlordsWith(req.user, 'maintenance.update');
    const editable = (lid) => editIds === 'ALL' || editIds.includes(lid);
    const landlords = (await pool.query('SELECT DISTINCT u.id, u.name FROM users u JOIN plots p ON p.user_id = u.id ORDER BY u.name')).rows
      .filter(l => editable(l.id));
    res.json({ success: true, data: rows.map(r => ({ ...r, can_edit: editable(r.landlord_id) })), landlords });
  } catch (e) { fail(res, e); }
});

function body(b) {
  const phone = clean(b.phone, 25);
  if (phone && !/^[0-9+\s()-]{6,25}$/.test(phone)) return { error: 'Phone number looks wrong.' };
  const email = clean(b.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Email looks wrong.' };
  const name = clean(b.name, 120); if (!name) return { error: 'Name is required.' };
  let rating = null;
  if (b.rating != null && b.rating !== '') { rating = parseInt(b.rating, 10); if (!(rating >= 1 && rating <= 5)) return { error: 'Rating must be 1 to 5.' }; }
  return { v: { name, trade: clean(b.trade, 60), phone, email, area: clean(b.area, 120), notes: clean(b.notes, 1000), rating } };
}

router.post('/', auth, async (req, res) => {
  try {
    const b = body(req.body); if (b.error) return res.status(400).json({ error: b.error });
    const lid = pid(req.body.landlord_id); if (!lid) return res.status(400).json({ error: 'landlord_id required' });
    const ids = await landlordsWith(req.user, 'maintenance.update');
    if (ids !== 'ALL' && !ids.includes(lid)) return res.status(403).json({ error: 'You cannot add vendors for this landlord.' });
    const v = b.v;
    const r = await pool.query(
      `INSERT INTO vendors (landlord_id, name, trade, phone, email, area, notes, rating, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [lid, v.name, v.trade, v.phone, v.email, v.area, v.notes, v.rating, req.user.id]);
    logAudit({ user: req.user, action: 'vendor.create', entityType: 'vendor', entityId: r.rows[0].id, changes: { name: { to: v.name }, trade: { to: v.trade } } });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { fail(res, e); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const id = pid(req.params.id); if (!id) return res.status(400).json({ error: 'Bad id' });
    const old = (await pool.query('SELECT * FROM vendors WHERE id = $1', [id])).rows[0];
    if (!old) return res.status(404).json({ error: 'Vendor not found' });
    const ids = await landlordsWith(req.user, 'maintenance.update');
    if (ids !== 'ALL' && !ids.includes(old.landlord_id)) return res.status(403).json({ error: 'You cannot edit this vendor.' });
    const b = body({ ...old, ...req.body }); if (b.error) return res.status(400).json({ error: b.error });
    const active = req.body.is_active == null ? old.is_active : !!req.body.is_active;
    const v = b.v;
    const r = await pool.query(
      `UPDATE vendors SET name=$1, trade=$2, phone=$3, email=$4, area=$5, notes=$6, rating=$7, is_active=$8 WHERE id=$9 RETURNING *`,
      [v.name, v.trade, v.phone, v.email, v.area, v.notes, v.rating, active, id]);
    const changes = {};
    for (const k of ['name', 'trade', 'phone', 'email', 'area', 'notes', 'rating']) if (String(old[k] ?? '') !== String(v[k] ?? '')) changes[k] = { from: old[k], to: v[k] };
    if (old.is_active !== active) changes.is_active = { from: old.is_active, to: active };
    if (Object.keys(changes).length) logAudit({ user: req.user, action: 'vendor.update', entityType: 'vendor', entityId: id, changes });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { fail(res, e); }
});

router.patch('/assign/:requestId', auth, async (req, res) => {
  try {
    const rid = pid(req.params.requestId); if (!rid) return res.status(400).json({ error: 'Bad id' });
    const vid = req.body.vendor_id == null || req.body.vendor_id === '' ? null : pid(req.body.vendor_id);
    if (req.body.vendor_id != null && req.body.vendor_id !== '' && !vid) return res.status(400).json({ error: 'Bad vendor_id' });
    const m = (await pool.query(
      `SELECT m.id, m.vendor_id, m.issue, h.plot_id, p.user_id AS landlord_id
         FROM maintenance_requests m LEFT JOIN houses h ON h.id = m.house_id LEFT JOIN plots p ON p.id = h.plot_id WHERE m.id = $1`, [rid])).rows[0];
    if (!m) return res.status(404).json({ error: 'Request not found' });
    const { permissions } = await getPermissions(req.user, m.plot_id);
    if (!permissions.includes('*') && !permissions.includes('maintenance.update')) return res.status(403).json({ error: 'Missing permission: maintenance.update' });
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && !visible.includes(m.plot_id)) return res.status(403).json({ error: 'Access denied' });
    let vname = null;
    if (vid) {
      const v = (await pool.query('SELECT id, name, landlord_id, is_active FROM vendors WHERE id = $1', [vid])).rows[0];
      if (!v || v.landlord_id !== m.landlord_id) return res.status(400).json({ error: 'That vendor does not belong to this property\'s landlord.' });
      if (!v.is_active) return res.status(400).json({ error: 'That vendor is archived.' });
      vname = v.name;
    }
    await pool.query('UPDATE maintenance_requests SET vendor_id = $1, vendor_assigned_at = CASE WHEN $1::int IS NULL THEN NULL ELSE NOW() END WHERE id = $2', [vid, rid]);
    if ((m.vendor_id || null) !== vid) logAudit({ user: req.user, action: 'maintenance.vendor_assign', entityType: 'maintenance_request', entityId: rid, changes: { vendor_id: { from: m.vendor_id, to: vid }, vendor: { to: vname } } });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

module.exports = router;
