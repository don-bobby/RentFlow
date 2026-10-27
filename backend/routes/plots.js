const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const axios   = require('axios');
const { getVisiblePlotIds } = require('../middleware/scope');
const { authMiddleware: staffAuth } = require('../middleware/auth');
const { requirePermission, getPermissions } = require('../middleware/permissions');
const { logAudit, diff } = require('../utils/audit');

async function geocodeOne(query) {
  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'RentFlow-RentalManagementSystem/1.0' },
      timeout: 5000,
    });
    const hit = res.data?.[0];
    return hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null;
  } catch (err) {
    console.error('Geocoding request failed for', query, '-', err.message);
    return null;
  }
}

async function geocodeLocation(location) {
  if (!location) return null;
  const full = await geocodeOne(`${location}, Kenya`);
  if (full) return full;
  const parts = location.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    await new Promise(r => setTimeout(r, 1100));
    const areaOnly = await geocodeOne(`${parts[parts.length - 1]}, Kenya`);
    if (areaOnly) return areaOnly;
  }
  return null;
}

const numOrNull = (v) => (v === '' || v === undefined || v === null) ? null : v;

// GET ALL plots — now also returns caretaker_name, so Properties.jsx can
// show who's assigned to each plot (previously no caretaker info at all
// came back from this route).
//
// agent_id/agent_name come from the property's OWN plots.agent_id — agents
// are assigned per property, so one landlord can have some properties run by
// an agent and others self-managed (agent_id NULL). Landlord-level agent
// assignment no longer exists.
router.get('/', staffAuth, requirePermission('plots.view'), async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.json([]);

    const query = `
      SELECT p.*, u.name AS owner_name, ag.name AS agent_name,
             ct.name AS caretaker_name
      FROM plots p
      LEFT JOIN users u  ON p.user_id  = u.id
      LEFT JOIN users ag ON ag.id = p.agent_id
      LEFT JOIN LATERAL (
        SELECT ctu.name FROM caretaker_plots cpl
        JOIN users ctu ON ctu.id = cpl.caretaker_id
        WHERE cpl.plot_id = p.id LIMIT 1
      ) ct ON true
      ${visible === 'ALL' ? '' : 'WHERE p.id = ANY($1)'}
      ORDER BY p.name
    `;
    const params = visible === 'ALL' ? [] : [visible];
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET ONE plot
// Was gated by requirePermission('plots.view') as middleware — before the
// plot itself was loaded, so a per-property override could never apply.
// Moved down to right after the plot is fetched.
router.get('/:id', staffAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM plots WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });
    const plot = result.rows[0];

    const { permissions } = await getPermissions(req.user, plot.id);
    if (!permissions.includes('*') && !permissions.includes('plots.view')) {
      return res.status(403).json({ error: 'Missing permission: plots.view' });
    }

    const visible = await getVisiblePlotIds(req.user);
    const canView = visible === 'ALL' || visible.includes(plot.id);
    if (!canView) return res.status(403).json({ error: 'Access denied' });

    res.json(plot);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', staffAuth, requirePermission('plots.create'), async (req, res) => {
  try {
    const { name, location, description, owner_id, gps_lat, gps_lng, agent_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Plot name is required' });

    let assignedTo;
    if (req.user.role === 'admin') {
      assignedTo = owner_id || req.user.id;
    } else if (req.user.role === 'agent') {
      if (!owner_id) return res.status(400).json({ error: 'owner_id (the landlord) is required.' });
      const landlordCheck = await pool.query(
        `SELECT u.id FROM users u WHERE u.id = $1 AND u.role = 'landlord'
         AND (u.agent_id = $2 OR EXISTS (SELECT 1 FROM plots p WHERE p.user_id = u.id AND p.agent_id = $2))`,
        [owner_id, req.user.id]
      );
      if (landlordCheck.rows.length === 0) {
        return res.status(403).json({ error: 'You can only add properties for landlords you manage.' });
      }
      assignedTo = owner_id;
    } else {
      assignedTo = req.user.id;
    }

    // Each property has its own agent (or none = self-managed). Only an
    // admin chooses it explicitly; an agent who adds a property for a
    // landlord becomes that property's agent; a landlord adding their own
    // property starts self-managed.
    let plotAgentId = null;
    if (req.user.role === 'agent') {
      plotAgentId = req.user.id;
    } else if (req.user.role === 'admin' && agent_id) {
      const agentCheck = await pool.query(`SELECT id FROM users WHERE id = $1 AND role = 'agent'`, [agent_id]);
      if (!agentCheck.rows[0]) return res.status(400).json({ error: 'agent_id must refer to an existing agent.' });
      plotAgentId = agent_id;
    }

    let lat = numOrNull(gps_lat), lng = numOrNull(gps_lng);
    if ((lat == null || lng == null) && location) {
      const geo = await geocodeLocation(location);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }

    const result = await pool.query(
      'INSERT INTO plots (user_id, name, location, description, gps_lat, gps_lng, agent_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [assignedTo, name, location || null, description || null, lat, lng, plotAgentId]
    );
    // Agreed agent fee % — admin only, and only meaningful with an agent.
    if (req.user.role === 'admin' && plotAgentId && req.body.agent_fee_percent !== undefined && req.body.agent_fee_percent !== '') {
      const fee = parseFloat(req.body.agent_fee_percent);
      if (Number.isFinite(fee) && fee >= 0 && fee <= 100) {
        await pool.query('UPDATE plots SET agent_fee_percent = $1 WHERE id = $2', [fee, result.rows[0].id]);
        result.rows[0].agent_fee_percent = fee;
      }
    }

    // Plot create/edit/delete was never logged at all before this.
    await logAudit({
      user: req.user, action: 'plot.create', entityType: 'plot', entityId: result.rows[0].id,
      changes: { name: { to: name }, owner_id: { to: assignedTo }, agent_id: { to: plotAgentId } },
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Was gated by requirePermission('plots.edit') as middleware, before the
// plot was loaded — same problem as GET /:id above.
router.put('/:id', staffAuth, async (req, res) => {
  try {
    const check = await pool.query('SELECT name, user_id, agent_id, agent_fee_percent, location, gps_lat, gps_lng FROM plots WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });

    const plotId = Number(req.params.id);
    const { permissions } = await getPermissions(req.user, plotId);
    if (!permissions.includes('*') && !permissions.includes('plots.edit')) {
      return res.status(403).json({ error: 'Missing permission: plots.edit' });
    }

    const visible = await getVisiblePlotIds(req.user);
    const canEdit = visible === 'ALL' || visible.includes(plotId);
    if (!canEdit) return res.status(403).json({ error: 'Access denied' });

    const { name, location, description, owner_id, gps_lat, gps_lng, agent_id } = req.body;

    // Only an admin changes a property's agent, and only when the request
    // actually includes the field ('' or null = make it self-managed).
    let newAgentId = check.rows[0].agent_id;
    if (req.user.role === 'admin' && agent_id !== undefined) {
      if (agent_id) {
        const agentCheck = await pool.query(`SELECT id FROM users WHERE id = $1 AND role = 'agent'`, [agent_id]);
        if (!agentCheck.rows[0]) return res.status(400).json({ error: 'agent_id must refer to an existing agent.' });
        newAgentId = Number(agent_id);
      } else {
        newAgentId = null;
      }
    }
    // Agent fee %: admin-editable, cleared whenever the property has no agent.
    let newFee = check.rows[0].agent_fee_percent;
    if (req.user.role === 'admin' && req.body.agent_fee_percent !== undefined) {
      const f = req.body.agent_fee_percent === '' || req.body.agent_fee_percent === null ? null : parseFloat(req.body.agent_fee_percent);
      if (f !== null && (!Number.isFinite(f) || f < 0 || f > 100)) return res.status(400).json({ error: 'Agent fee must be a percentage between 0 and 100.' });
      newFee = f;
    }
    if (!newAgentId) newFee = null;
    const newOwnerId = req.user.role === 'admin' && owner_id ? owner_id : check.rows[0].user_id;

    let lat = numOrNull(gps_lat) ?? check.rows[0].gps_lat;
    let lng = numOrNull(gps_lng) ?? check.rows[0].gps_lng;
    const locationChanged = location && location !== check.rows[0].location;
    if (numOrNull(gps_lat) == null && numOrNull(gps_lng) == null && locationChanged) {
      const geo = await geocodeLocation(location);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }

    const result = await pool.query(
      'UPDATE plots SET name=$1, location=$2, description=$3, user_id=$4, gps_lat=$5, gps_lng=$6, agent_id=$7, agent_fee_percent=$8 WHERE id=$9 RETURNING *',
      [name, location || null, description || null, newOwnerId, lat, lng, newAgentId, newFee, req.params.id]
    );

    const changes = diff(
      { name: check.rows[0].name, user_id: check.rows[0].user_id, agent_id: check.rows[0].agent_id },
      { name: result.rows[0].name, user_id: result.rows[0].user_id, agent_id: result.rows[0].agent_id },
      ['name', 'user_id', 'agent_id']
    );
    if (Object.keys(changes).length > 0) {
      await logAudit({ user: req.user, action: 'plot.update', entityType: 'plot', entityId: req.params.id, changes });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Was gated by requirePermission('plots.delete') as middleware, before the
// plot was loaded — same problem as above.
router.delete('/:id', staffAuth, async (req, res) => {
  try {
    const plotId = Number(req.params.id);
    const { permissions } = await getPermissions(req.user, plotId);
    if (!permissions.includes('*') && !permissions.includes('plots.delete')) {
      return res.status(403).json({ error: 'Missing permission: plots.delete' });
    }

    const visible = await getVisiblePlotIds(req.user);
    const canDelete = visible === 'ALL' || visible.includes(plotId);
    if (!canDelete) return res.status(403).json({ error: 'Access denied' });

    const result = await pool.query('DELETE FROM plots WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });

    await logAudit({
      user: req.user, action: 'plot.delete', entityType: 'plot', entityId: req.params.id,
      changes: { name: { from: result.rows[0].name } },
    });

    res.json({ success: true, message: 'Plot deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/geocode-missing', staffAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const missing = await pool.query(
      `SELECT id, location FROM plots WHERE location IS NOT NULL AND location != '' AND (gps_lat IS NULL OR gps_lng IS NULL)`
    );
    const results = [];
    for (const plot of missing.rows) {
      const geo = await geocodeLocation(plot.location);
      if (geo) {
        await pool.query('UPDATE plots SET gps_lat=$1, gps_lng=$2 WHERE id=$3', [geo.lat, geo.lng, plot.id]);
        results.push({ id: plot.id, location: plot.location, status: 'geocoded', ...geo });
      } else {
        results.push({ id: plot.id, location: plot.location, status: 'not_found' });
      }
      await new Promise(r => setTimeout(r, 1100));
    }
    res.json({ success: true, processed: results.length, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
