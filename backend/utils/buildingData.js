// Everything the 3D views need for one property: every approved unit with its
// floor/position and this month's payment state, plus fences/roads/etc.
// Used by GET /api/houses/building/:plotId and the admin estate map.
const pool = require('../database/db');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissions } = require('../middleware/permissions');
const { computeLedger, loadPaidMaps } = require('./rentLedger');

const httpError = (status, message) => Object.assign(new Error(message), { status });

async function loadBuilding(user, plotId) {
    const visible = await getVisiblePlotIds(user);
    if (visible !== 'ALL' && !visible.includes(plotId)) throw httpError(403, 'Access denied');

    const plotRes = await pool.query('SELECT id, name, location, layout_extras, gps_lat, gps_lng FROM plots WHERE id = $1', [plotId]);
    if (!plotRes.rows[0]) throw httpError(404, 'Property not found');
    const { permissions } = await getPermissions(user, plotId);
    const seeMoney = permissions.includes('*') || permissions.includes('tenants.view');

    const hs = await pool.query(
      `SELECT h.id, h.unit_number, h.house_type, h.rent_amount, h.status, h.floor,
              h.layout_x, h.layout_z, h.layout_w, h.layout_d, h.layout_facing,
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
                     layout_x: h.layout_x, layout_z: h.layout_z, layout_w: h.layout_w || 1, layout_d: h.layout_d || 1, layout_facing: h.layout_facing ?? 2 };
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

    // 360 photo count (quietly 0 if the panoramas migration has not been run yet)
    let panoramaCount = 0;
    try { panoramaCount = (await pool.query('SELECT COUNT(*)::int AS n FROM property_panoramas WHERE plot_id = $1', [plotId])).rows[0].n; } catch { /* table missing */ }

    const summary = units.reduce((a, u) => { a[u.state] = (a[u.state] || 0) + 1; return a; }, {});
    return { plot: { id: plotRes.rows[0].id, name: plotRes.rows[0].name, location: plotRes.rows[0].location,
      lat: plotRes.rows[0].gps_lat == null ? null : parseFloat(plotRes.rows[0].gps_lat), lng: plotRes.rows[0].gps_lng == null ? null : parseFloat(plotRes.rows[0].gps_lng) },
      extras: plotRes.rows[0].layout_extras || [],
      panorama_count: panoramaCount,
      can_edit_layout: permissions.includes('*') || permissions.includes('houses.edit'),
      units, summary, see_money: seeMoney,
      month: now.toLocaleString('en-KE', { month: 'long', year: 'numeric' }) };
}

module.exports = { loadBuilding, httpError };
