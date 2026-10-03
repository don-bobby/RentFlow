const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { authMiddleware: staffAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getVisiblePlotIds } = require('../middleware/scope');

// Checks that houseId's plot is within this staff member's visible scope.
// Used on every staff-only listings route below — requirePermission alone
// only proves "you're allowed to publish listings in general", not "this is
// your listing to publish".
async function assertHouseInScope(req, houseId) {
  if (req.user.role === 'admin') return true;
  const visible = await getVisiblePlotIds(req.user);
  if (visible === 'ALL') return true;
  const row = await pool.query('SELECT plot_id FROM houses WHERE id = $1', [houseId]);
  const plotId = row.rows[0]?.plot_id;
  return plotId != null && visible.includes(plotId);
}

// ── Multer storage (uploads/listings/) ────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'listings');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `unit_${req.params.houseId}_${Date.now()}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.webm'];
    const ext     = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── GET /api/listings — public, no auth ───────────────────────────────────────
// Returns all plots that have at least one vacant unit, with units + media
router.get('/', async (req, res) => {
  try {
    // All plots with vacant units
    const plotsRes = await pool.query(`
      SELECT DISTINCT p.id, p.name, p.location, p.description,
             u.name AS landlord_name, u.phone AS landlord_phone
      FROM plots p
      JOIN houses h ON h.plot_id = p.id
      LEFT JOIN users u ON p.user_id = u.id
      WHERE h.status = 'vacant' AND h.listed = true
      ORDER BY p.name
    `);

    if (plotsRes.rows.length === 0) return res.json({ success: true, data: [] });

    const plotIds = plotsRes.rows.map(p => p.id);

    // Vacant units for those plots
    const unitsRes = await pool.query(`
      SELECT h.id, h.plot_id, h.unit_number, h.house_type,
             h.rent_amount, h.deposit, h.meter_no, h.status, h.description
      FROM houses h
      WHERE h.plot_id = ANY($1) AND h.status = 'vacant' AND h.listed = true
      ORDER BY h.unit_number
    `, [plotIds]);

    // Media per unit
    const unitIds  = unitsRes.rows.map(u => u.id);
    const mediaRes = unitIds.length > 0 ? await pool.query(`
      SELECT id, house_id, filename, media_type, sort_order
      FROM plot_media
      WHERE house_id = ANY($1)
      ORDER BY house_id, sort_order, id
    `, [unitIds]) : { rows: [] };

    // Group units and media by plot
    const unitsByPlot = {};
    const mediaByUnit = {};
    for (const u of unitsRes.rows)  (unitsByPlot[u.plot_id] ||= []).push(u);
    for (const m of mediaRes.rows)  (mediaByUnit[m.house_id] ||= []).push(m);

    const listings = plotsRes.rows.map(plot => ({
      ...plot,
      units: (unitsByPlot[plot.id] || []).map(u => ({
        ...u,
        media: (mediaByUnit[u.id] || []).map(m => ({
          ...m,
          url: `/uploads/listings/${m.filename}`,
        })),
      })),
    }));

    res.json({ success: true, data: listings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/listings/media/:houseId — upload photo or video ─────────────────
router.post('/media/:houseId', staffAuth, requirePermission('listings.publish'), upload.array('files', 20), async (req, res) => {
  const { houseId } = req.params;
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded.' });
  if (!(await assertHouseInScope(req, houseId))) {
    return res.status(403).json({ error: 'You do not have access to this unit.' });
  }

  try {
    const inserted = [];
    for (const file of req.files) {
      const ext       = path.extname(file.originalname).toLowerCase();
      const mediaType = ['.mp4', '.mov', '.webm'].includes(ext) ? 'video' : 'photo';
      const result    = await pool.query(
        `INSERT INTO plot_media (house_id, filename, media_type) VALUES ($1, $2, $3) RETURNING *`,
        [houseId, file.filename, mediaType]
      );
      inserted.push({ ...result.rows[0], url: `/uploads/listings/${file.filename}` });
    }
    res.json({ success: true, data: inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/listings/media/:mediaId — remove a photo/video ───────────────
router.delete('/media/:mediaId', staffAuth, requirePermission('listings.publish'), async (req, res) => {
  try {
    const mediaRow = await pool.query('SELECT house_id, filename FROM plot_media WHERE id = $1', [req.params.mediaId]);
    if (!mediaRow.rows[0]) return res.status(404).json({ error: 'Not found' });
    if (!(await assertHouseInScope(req, mediaRow.rows[0].house_id))) {
      return res.status(403).json({ error: 'You do not have access to this unit.' });
    }

    const result = await pool.query(
      'DELETE FROM plot_media WHERE id=$1 RETURNING filename',
      [req.params.mediaId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });

    // Delete the actual file
    const filePath = path.join(__dirname, '..', 'uploads', 'listings', result.rows[0].filename);
    fs.unlink(filePath, () => {}); // ignore if already gone

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/listings/media/:houseId — list media for a unit ──────────────────
router.get('/media/:houseId', staffAuth, requirePermission('listings.publish'), async (req, res) => {
  try {
    if (!(await assertHouseInScope(req, req.params.houseId))) {
      return res.status(403).json({ error: 'You do not have access to this unit.' });
    }
    // NOTE: was querying the nonexistent column `plot_id` here — plot_media
    // rows are keyed by house_id everywhere else in this file (see the
    // INSERT above and the public GET / route). Fixed to match.
    const result = await pool.query(
      'SELECT * FROM plot_media WHERE house_id=$1 ORDER BY sort_order, id',
      [req.params.houseId]
    );
    const media = result.rows.map(m => ({ ...m, url: `/uploads/listings/${m.filename}` }));
    res.json({ success: true, data: media });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/listings/toggle/:houseId — toggle listed/unlisted (admin & landlord only)
router.patch('/toggle/:houseId', staffAuth, requirePermission('listings.publish'), async (req, res) => {
  try {
    if (!(await assertHouseInScope(req, req.params.houseId))) {
      return res.status(403).json({ error: 'You do not have access to this unit.' });
    }
    const result = await pool.query(
      `UPDATE houses SET listed = NOT listed WHERE id = $1 RETURNING id, listed`,
      [req.params.houseId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Unit not found' });
    res.json({ success: true, listed: result.rows[0].listed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
