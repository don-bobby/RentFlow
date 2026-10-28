// 360-degree photos per property.
//   GET    /api/panoramas/plot/:plotId        list (staff, plot must be visible)
//   GET    /api/panoramas/:id/image           the image (staff)
//   POST   /api/panoramas/plot/:plotId        upload (needs houses.edit on that plot)
//   PATCH  /api/panoramas/:id                 rename / reorder / make public
//   DELETE /api/panoramas/:id
//   GET    /api/panoramas/public/plot/:plotId list public photos (no login)
//   GET    /api/panoramas/public/:id/image    a public photo (no login)
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { getVisiblePlotIds } = require('../middleware/scope');
const { getPermissions } = require('../middleware/permissions');
const { logAudit } = require('../utils/audit');

const MAX_PER_PLOT = 30;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } });

// Content check on the bytes, not the file name.
function sniffMime(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
const cleanTitle = (t) => String(t ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) || 'View';
const sendImage = (res, row, isPrivate) => {
  res.set('Content-Type', row.mime);
  res.set('Cache-Control', isPrivate ? 'private, max-age=86400' : 'public, max-age=3600');
  res.send(row.data);
};

async function canSee(user, plotId) {
  const visible = await getVisiblePlotIds(user);
  return visible === 'ALL' || visible.includes(plotId);
}
async function canEdit(user, plotId) {
  const { permissions } = await getPermissions(user, plotId);
  return permissions.includes('*') || permissions.includes('houses.edit');
}

// ── public (registered first: no login) ──
router.get('/public/plot/:plotId', async (req, res) => {
  try {
    const plotId = parseInt(req.params.plotId);
    if (!plotId) return res.status(400).json({ error: 'Invalid property.' });
    const r = await pool.query('SELECT id, title, width, height FROM property_panoramas WHERE plot_id = $1 AND is_public = true ORDER BY sort_order, id', [plotId]);
    res.json({ success: true, items: r.rows });
  } catch (err) { res.status(500).json({ error: 'Could not load photos.' }); }
});
router.get('/public/:id/image', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).end();
    const r = await pool.query('SELECT mime, data FROM property_panoramas WHERE id = $1 AND is_public = true', [id]);
    if (!r.rows[0]) return res.status(404).end();
    sendImage(res, r.rows[0], false);
  } catch (err) { res.status(500).end(); }
});

// ── staff ──
router.get('/plot/:plotId', auth, async (req, res) => {
  try {
    const plotId = parseInt(req.params.plotId);
    if (!plotId) return res.status(400).json({ error: 'Invalid property.' });
    if (!(await canSee(req.user, plotId))) return res.status(403).json({ error: 'Access denied' });
    const r = await pool.query('SELECT id, title, sort_order, is_public, width, height FROM property_panoramas WHERE plot_id = $1 ORDER BY sort_order, id', [plotId]);
    res.json({ success: true, items: r.rows, can_edit: await canEdit(req.user, plotId), max: MAX_PER_PLOT });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/:id/image', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).end();
    const r = await pool.query('SELECT plot_id, mime, data FROM property_panoramas WHERE id = $1', [id]);
    if (!r.rows[0]) return res.status(404).end();
    if (!(await canSee(req.user, r.rows[0].plot_id))) return res.status(403).end();
    sendImage(res, r.rows[0], true);
  } catch (err) { res.status(500).end(); }
});

router.post('/plot/:plotId', auth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That photo is too large (12 MB maximum).' : 'Upload failed.' });
  });
}, async (req, res) => {
  try {
    const plotId = parseInt(req.params.plotId);
    if (!plotId) return res.status(400).json({ error: 'Invalid property.' });
    if (!(await canSee(req.user, plotId)) || !(await canEdit(req.user, plotId))) return res.status(403).json({ error: 'You cannot add photos to this property.' });
    if (!req.file) return res.status(400).json({ error: 'No photo received.' });
    const mime = sniffMime(req.file.buffer);
    if (!mime) return res.status(400).json({ error: 'Only JPEG, PNG or WebP photos are accepted.' });
    const count = (await pool.query('SELECT COUNT(*)::int AS n, COALESCE(MAX(sort_order), -1) AS top FROM property_panoramas WHERE plot_id = $1', [plotId])).rows[0];
    if (count.n >= MAX_PER_PLOT) return res.status(400).json({ error: `A property can have up to ${MAX_PER_PLOT} 360° photos.` });
    const num = (v) => { const n = parseInt(v); return Number.isFinite(n) && n > 0 && n <= 20000 ? n : null; };
    const r = await pool.query(
      `INSERT INTO property_panoramas (plot_id, title, sort_order, is_public, mime, width, height, data, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, title, sort_order, is_public, width, height`,
      [plotId, cleanTitle(req.body.title), Number(count.top) + 1, req.body.is_public === 'true' || req.body.is_public === true, mime, num(req.body.width), num(req.body.height), req.file.buffer, req.user.id || null]);
    await logAudit({ user: req.user, action: 'panorama.added', entityType: 'plot', entityId: plotId, changes: { photo: { to: r.rows[0].title } } });
    res.json({ success: true, item: r.rows[0] });
  } catch (err) { console.error('Panorama upload failed:', err); res.status(500).json({ error: err.message }); }
});

async function loadForEdit(req, res) {
  const id = parseInt(req.params.id);
  if (!id) { res.status(400).json({ error: 'Invalid photo.' }); return null; }
  const r = await pool.query('SELECT id, plot_id, title FROM property_panoramas WHERE id = $1', [id]);
  const row = r.rows[0];
  if (!row) { res.status(404).json({ error: 'Photo not found.' }); return null; }
  if (!(await canSee(req.user, row.plot_id)) || !(await canEdit(req.user, row.plot_id))) { res.status(403).json({ error: 'You cannot change photos on this property.' }); return null; }
  return row;
}

router.patch('/:id', auth, async (req, res) => {
  try {
    const row = await loadForEdit(req, res); if (!row) return;
    const sets = [], vals = [];
    if (req.body.title !== undefined) { vals.push(cleanTitle(req.body.title)); sets.push(`title = $${vals.length}`); }
    if (req.body.is_public !== undefined) { vals.push(!!req.body.is_public); sets.push(`is_public = $${vals.length}`); }
    if (req.body.sort_order !== undefined && Number.isInteger(Number(req.body.sort_order))) { vals.push(Number(req.body.sort_order)); sets.push(`sort_order = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
    vals.push(row.id);
    const r = await pool.query(`UPDATE property_panoramas SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, title, sort_order, is_public, width, height`, vals);
    res.json({ success: true, item: r.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const row = await loadForEdit(req, res); if (!row) return;
    await pool.query('DELETE FROM property_panoramas WHERE id = $1', [row.id]);
    await logAudit({ user: req.user, action: 'panorama.deleted', entityType: 'plot', entityId: row.plot_id, changes: { photo: { from: row.title } } });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

module.exports = router;
