const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const axios   = require('axios');
const { getVisiblePlotIds } = require('../middleware/scope');
const { authMiddleware: staffAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
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

async function resolveAgent(raw) {
  if (raw === '' || raw === undefined || raw === null) return { id: null };
  const r = await pool.query(`SELECT id FROM users WHERE id = $1 AND role = 'agent'`, [raw]);
  if (r.rows.length === 0) return { error: 'Selected agent was not found.' };
  return { id: r.rows[0].id };
}

const numOrNull = (v) => (v === '' || v === undefined || v === null) ? null : v;

// GET ALL plots — now also returns caretaker_name, so Properties.jsx can
// show who's assigned to each plot (previously no caretaker info at all
// came back from this route).
router.get('/', staffAuth, requirePermission('plots.view'), async (req, res) => {
  try {
    const visible = await getVisiblePlotIds(req.user);
    if (visible !== 'ALL' && visible.length === 0) return res.json([]);

    const query = `
      SELECT p.*, u.name AS owner_name, ag.name AS agent_name,
             ct.name AS caretaker_name
      FROM plots p
      LEFT JOIN users u  ON p.user_id  = u.id
      LEFT JOIN users ag ON p.agent_id = ag.id
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
router.get('/:id', staffAuth, requirePermission('plots.view'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM plots WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });
    const plot = result.rows[0];

    const visible = await getVisiblePlotIds(req.user);
    const canView = visible === 'ALL' || visible.includes(plot.id);
    if (!canView) return res.status(403).json({ error: 'Access denied' });

    res.json(plot);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', staffAuth, requirePermission('plots.create'), async (req, res) => {
  try {
    const { name, location, description, owner_id, agent_id, gps_lat, gps_lng } = req.body;
    if (!name) return res.status(400).json({ error: 'Plot name is required' });

    let assignedTo;
    if (req.user.role === 'admin') {
      assignedTo = owner_id || req.user.id;
    } else if (req.user.role === 'agent') {
      if (!owner_id) return res.status(400).json({ error: 'owner_id (the landlord) is required.' });
      const landlordCheck = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND role = 'landlord' AND agent_id = $2`,
        [owner_id, req.user.id]
      );
      if (landlordCheck.rows.length === 0) {
        return res.status(403).json({ error: 'You can only add properties for landlords assigned to you.' });
      }
      assignedTo = owner_id;
    } else {
      assignedTo = req.user.id;
    }

    let assignedAgent = null;
    if (req.user.role === 'agent') {
      assignedAgent = req.user.id;
    } else if (req.user.role === 'admin') {
      if (agent_id !== undefined && agent_id !== '') {
        // Admin explicitly picked one — respect it exactly.
        const a = await resolveAgent(agent_id);
        if (a.error) return res.status(400).json({ error: a.error });
        assignedAgent = a.id;
      } else {
        // Nothing explicit given — default to the landlord's own current
        // agent, same as every other property they already own, rather
        // than starting this one blank.
        const landlordRow = await pool.query('SELECT agent_id FROM users WHERE id = $1', [assignedTo]);
        assignedAgent = landlordRow.rows[0]?.agent_id || null;
      }
    }

    let lat = numOrNull(gps_lat), lng = numOrNull(gps_lng);
    if ((lat == null || lng == null) && location) {
      const geo = await geocodeLocation(location);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }

    const result = await pool.query(
      'INSERT INTO plots (user_id, name, location, description, gps_lat, gps_lng, agent_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [assignedTo, name, location || null, description || null, lat, lng, assignedAgent]
    );

    // Plot create/edit/delete was never logged at all before this.
    await logAudit({
      user: req.user, action: 'plot.create', entityType: 'plot', entityId: result.rows[0].id,
      changes: { name: { to: name }, owner_id: { to: assignedTo }, agent_id: { to: assignedAgent } },
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', staffAuth, requirePermission('plots.edit'), async (req, res) => {
  try {
    const check = await pool.query('SELECT name, user_id, agent_id, location, gps_lat, gps_lng FROM plots WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });

    const visible = await getVisiblePlotIds(req.user);
    const canEdit = visible === 'ALL' || visible.includes(Number(req.params.id));
    if (!canEdit) return res.status(403).json({ error: 'Access denied' });

    const { name, location, description, owner_id, agent_id, gps_lat, gps_lng } = req.body;

    let newAgentId = check.rows[0].agent_id;
    if (req.user.role === 'admin' && agent_id !== undefined) {
      const a = await resolveAgent(agent_id);
      if (a.error) return res.status(400).json({ error: a.error });
      newAgentId = a.id;
    }

    const newOwnerId = req.user.role === 'admin' && owner_id ? owner_id : check.rows[0].user_id;

    let lat = numOrNull(gps_lat) ?? check.rows[0].gps_lat;
    let lng = numOrNull(gps_lng) ?? check.rows[0].gps_lng;
    const locationChanged = location && location !== check.rows[0].location;
    if (numOrNull(gps_lat) == null && numOrNull(gps_lng) == null && locationChanged) {
      const geo = await geocodeLocation(location);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }

    const result = await pool.query(
      'UPDATE plots SET name=$1, location=$2, description=$3, user_id=$4, gps_lat=$5, gps_lng=$6, agent_id=$7 WHERE id=$8 RETURNING *',
      [name, location || null, description || null, newOwnerId, lat, lng, newAgentId, req.params.id]
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

router.delete('/:id', staffAuth, requirePermission('plots.delete'), async (req, res) => {
  try {
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
