// Admin-only estate map: every property's 3D model on one shared map.
//   GET /api/estate         plots (with units + payment state), map positions, roads/trees
//   PUT /api/estate/layout  save plot positions and the map pieces
const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { loadBuilding } = require('../utils/buildingData');

const ADMIN_ROLES = ['admin', 'super_admin'];
function requireAdmin(req, res, next) {
  if (!ADMIN_ROLES.includes(req.user?.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

const MAP_MAX = 200;                       // cells in either direction
const PIECE_KINDS = ['road', 'tree', 'pond'];

router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const plotRows = (await pool.query('SELECT id, map_x, map_z, map_rot FROM plots ORDER BY id')).rows;
    const plots = [];
    for (const p of plotRows) {
      const b = await loadBuilding(req.user, p.id);
      plots.push({ ...b, map: { x: p.map_x, z: p.map_z, rot: p.map_rot || 0 } });
    }
    const m = await pool.query('SELECT pieces FROM estate_map WHERE id = 1');
    res.json({ success: true, data: { plots, pieces: m.rows[0]?.pieces || [], month: plots[0]?.month || '' } });
  } catch (err) {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/layout', auth, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const plotsIn = Array.isArray(req.body.plots) ? req.body.plots : [];
    const piecesIn = Array.isArray(req.body.pieces) ? req.body.pieces : [];
    if (plotsIn.length > 500 || piecesIn.length > 6000) return res.status(400).json({ error: 'Too many items.' });
    const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);
    const inRange = (n) => n >= 0 && n < MAP_MAX;

    const ids = new Set((await client.query('SELECT id FROM plots')).rows.map(r => r.id));
    const plots = [];
    for (const p of plotsIn) {
      const id = int(p.id), x = int(p.x), z = int(p.z), rot = p.rot == null ? 0 : int(p.rot);
      if (!ids.has(id)) return res.status(400).json({ error: 'Unknown property in the map.' });
      if (!inRange(x) || !inRange(z) || !(rot >= 0 && rot <= 3)) return res.status(400).json({ error: 'A property position is outside the map.' });
      plots.push({ id, x, z, rot });
    }
    const seen = new Set(), pieces = [];
    for (const q of piecesIn) {
      const x = int(q.x), z = int(q.z);
      if (!PIECE_KINDS.includes(q.kind) || !inRange(x) || !inRange(z)) return res.status(400).json({ error: 'A map piece is invalid.' });
      const key = `${x},${z}`;
      if (seen.has(key)) continue;                         // one piece per square
      seen.add(key); pieces.push({ kind: q.kind, x, z });
    }

    await client.query('BEGIN');
    for (const p of plots) await client.query('UPDATE plots SET map_x=$1, map_z=$2, map_rot=$3 WHERE id=$4', [p.x, p.z, p.rot, p.id]);
    await client.query(
      `INSERT INTO estate_map (id, pieces, updated_at) VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET pieces = EXCLUDED.pieces, updated_at = NOW()`, [JSON.stringify(pieces)]);
    await client.query('COMMIT');
    await logAudit({ user: req.user, action: 'estate.map_saved', entityType: 'estate_map', entityId: 1,
      changes: { plots: { to: plots.length }, pieces: { to: pieces.length } } });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Estate map save failed:', err);
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;
