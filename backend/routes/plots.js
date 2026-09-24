const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const jwt     = require('jsonwebtoken');
const axios   = require('axios');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// Turns a free-text location (e.g. "Site Estate, Olkalou") into { lat, lng }
// using OpenStreetMap's free Nominatim geocoder — no API key required.
// Returns null (never throws) if nothing is found or the request fails, so a
// bad/vague address never blocks creating or updating a plot.
//
// Tries the full location first. If that fails — common when the location
// includes an informal estate/neighbourhood name that isn't mapped in
// OpenStreetMap (e.g. "Site Estate, Olkalou") — falls back to just the part
// after the last comma (usually the actual town), since Nominatim tends to
// fail the whole query rather than partially match a compound one.
async function geocodeOne(query) {
  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'RentFlow-RentalManagementSystem/1.0' }, // required by Nominatim's usage policy
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
    // small pause so the fallback attempt doesn't immediately follow the
    // first one — stays comfortably within Nominatim's rate limit
    await new Promise(r => setTimeout(r, 1100));
    const areaOnly = await geocodeOne(`${parts[parts.length - 1]}, Kenya`);
    if (areaOnly) return areaOnly;
  }

  return null;
}

// GET ALL plots — admin sees all, landlord sees own, caretaker sees assigned
router.get('/', auth, async (req, res) => {
  try {
    let query, params = [];

    if (req.user.role === 'admin') {
      query = `
        SELECT p.*, u.name AS owner_name
        FROM plots p
        LEFT JOIN users u ON p.user_id = u.id
        ORDER BY p.name
      `;
    } else if (req.user.role === 'landlord') {
      query = `
        SELECT p.*, u.name AS owner_name
        FROM plots p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.user_id = $1
        ORDER BY p.name
      `;
      params = [req.user.id];
    } else if (req.user.role === 'caretaker') {
      // Support multiple plot assignments via caretaker_plots junction table
      // Fall back to users.plot_id for legacy single assignments
      query = `
        SELECT DISTINCT p.*, u.name AS owner_name
        FROM plots p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.id IN (
          SELECT plot_id FROM caretaker_plots WHERE caretaker_id = $1
          UNION
          SELECT plot_id FROM users WHERE id = $1 AND plot_id IS NOT NULL
        )
        ORDER BY p.name
      `;
      params = [req.user.id];
    } else {
      return res.json([]);
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET ONE plot
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM plots WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });
    const plot = result.rows[0];
    if (req.user.role !== 'admin' && plot.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(plot);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create plot — caretakers cannot create properties
router.post('/', auth, async (req, res) => {
  if (!['admin', 'landlord'].includes(req.user.role)) return res.status(403).json({ error: 'Only admins and landlords can add properties.' });
  try {
    const { name, location, description, owner_id, gps_lat, gps_lng } = req.body;
    if (!name) return res.status(400).json({ error: 'Plot name is required' });

    // Admin can assign to any landlord via owner_id, otherwise assign to self
    const assignedTo = req.user.role === 'admin' && owner_id ? owner_id : req.user.id;

    // Use explicit coordinates if given; otherwise try to geocode the
    // location text automatically. Never blocks plot creation if it fails.
    let lat = gps_lat ?? null, lng = gps_lng ?? null;
    if ((lat == null || lng == null) && location) {
      const geo = await geocodeLocation(location);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }

    const result = await pool.query(
      'INSERT INTO plots (user_id, name, location, description, gps_lat, gps_lng) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [assignedTo, name, location || null, description || null, lat, lng]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update plot
router.put('/:id', auth, async (req, res) => {
  try {
    const check = await pool.query('SELECT user_id, location, gps_lat, gps_lng FROM plots WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });
    if (req.user.role !== 'admin' && check.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const { name, location, description, owner_id, gps_lat, gps_lng } = req.body;

    // Only admin can reassign owner
    const newOwnerId = req.user.role === 'admin' && owner_id ? owner_id : check.rows[0].user_id;

    // Keep existing coordinates by default. If the caller passed explicit
    // coordinates, use those. Otherwise, only re-geocode if the location
    // text actually changed (avoids hitting Nominatim on every unrelated edit).
    let lat = gps_lat ?? check.rows[0].gps_lat;
    let lng = gps_lng ?? check.rows[0].gps_lng;
    const locationChanged = location && location !== check.rows[0].location;
    if (gps_lat == null && gps_lng == null && locationChanged) {
      const geo = await geocodeLocation(location);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }

    const result = await pool.query(
      'UPDATE plots SET name=$1, location=$2, description=$3, user_id=$4, gps_lat=$5, gps_lng=$6 WHERE id=$7 RETURNING *',
      [name, location || null, description || null, newOwnerId, lat, lng, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE plot (admin only)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const result = await pool.query('DELETE FROM plots WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plot not found' });
    res.json({ success: true, message: 'Plot deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST backfill GPS coordinates for existing plots that have a location
// but no coordinates yet (e.g. plots created before this feature existed).
// Admin only. Runs requests one at a time with a short delay between each,
// per Nominatim's free-tier usage policy (max ~1 request/second).
router.post('/geocode-missing', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
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
      await new Promise(r => setTimeout(r, 1100)); // stay under Nominatim's rate limit
    }

    res.json({ success: true, processed: results.length, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
