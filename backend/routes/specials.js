// Specials: Airbnb-style stays and properties for sale. Admin posts them; the
// public listings page shows the active ones.
//   GET    /api/specials                       public: active specials
//   GET    /api/specials/photo/:photoId        public: a photo of an ACTIVE special
//   GET    /api/specials/admin                 admin: everything
//   POST   /api/specials/admin                 admin: create
//   PUT    /api/specials/admin/:id             admin: edit / change status
//   DELETE /api/specials/admin/:id
//   POST   /api/specials/admin/:id/photos      admin: add a photo (multipart "file")
//   DELETE /api/specials/admin/photos/:photoId
//   PUT    /api/specials/admin/:id/cover/:photoId  admin: make this photo the first one
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const pool    = require('../database/db');
const { authMiddleware: auth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const MAX_PHOTOS = 12;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

const adminOnly = (req, res, next) =>
  ['admin', 'super_admin'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Admin only.' });

function sniffMime(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.length > 12 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

const LIST_SQL = `
  SELECT s.id, s.kind, s.title, s.description, s.price, s.price_unit, s.location, s.lat, s.lng,
         s.bedrooms, s.bathrooms, s.contact_phone, s.status, s.created_at,
         COALESCE((SELECT array_agg(p.id ORDER BY p.sort_order, p.id) FROM special_photos p WHERE p.special_id = s.id), '{}') AS photos
  FROM special_listings s`;
const shape = (r) => ({ ...r, price: r.price == null ? null : parseFloat(r.price) });

// Turns the request body into clean column values, or returns { error }.
function clean(body) {
  const out = {};
  const kind = body.kind === 'sale' ? 'sale' : 'stay';
  out.kind = kind;
  const title = String(body.title ?? '').replace(/[\u0000-\u001f<>]/g, '').trim();
  if (!title) return { error: 'Give the listing a title.' };
  out.title = title.slice(0, 120);
  out.description = String(body.description ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/g, '').trim().slice(0, 4000) || null;
  if (body.price === '' || body.price == null) out.price = null;
  else { const n = Number(body.price); if (!Number.isFinite(n) || n < 0 || n > 1e10) return { error: 'Price is not valid.' }; out.price = n; }
  out.price_unit = kind === 'sale' ? 'total' : (['night', 'month'].includes(body.price_unit) ? body.price_unit : 'night');
  out.location = String(body.location ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 200) || null;
  const hasLat = body.lat !== '' && body.lat != null, hasLng = body.lng !== '' && body.lng != null;
  if (hasLat !== hasLng) return { error: 'Give both latitude and longitude, or neither.' };
  if (hasLat) {
    const la = Number(body.lat), ln = Number(body.lng);
    if (!(la >= -90 && la <= 90 && ln >= -180 && ln <= 180)) return { error: 'Coordinates are not valid.' };
    out.lat = la; out.lng = ln;
  } else { out.lat = null; out.lng = null; }
  const small = (v, label) => { if (v === '' || v == null) return null; const n = parseInt(v, 10); if (!(n >= 0 && n <= 50)) throw new Error(`${label} is not valid.`); return n; };
  try { out.bedrooms = small(body.bedrooms, 'Bedrooms'); out.bathrooms = small(body.bathrooms, 'Bathrooms'); }
  catch (e) { return { error: e.message }; }
  out.contact_phone = String(body.contact_phone ?? '').replace(/[^\d+\s-]/g, '').trim().slice(0, 30) || null;
  out.status = ['active', 'hidden', 'closed'].includes(body.status) ? body.status : 'active';
  return { out };
}
const COLS = ['kind', 'title', 'description', 'price', 'price_unit', 'location', 'lat', 'lng', 'bedrooms', 'bathrooms', 'contact_phone', 'status'];

// ── public ──
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`${LIST_SQL} WHERE s.status = 'active' ORDER BY s.created_at DESC LIMIT 200`);
    res.json({ success: true, data: r.rows.map(({ status, ...x }) => shape(x)) });
  } catch (err) { res.json({ success: true, data: [] }); } // table not created yet: show nothing
});
router.get('/photo/:photoId', async (req, res) => {
  try {
    const id = parseInt(req.params.photoId, 10);
    if (!id) return res.status(400).end();
    const r = await pool.query(`SELECT p.mime, p.data FROM special_photos p JOIN special_listings s ON s.id = p.special_id WHERE p.id = $1 AND s.status = 'active'`, [id]);
    if (!r.rows[0]) return res.status(404).end();
    res.set('Content-Type', r.rows[0].mime);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(r.rows[0].data);
  } catch (err) { res.status(500).end(); }
});

// ── admin ──
router.get('/admin', auth, adminOnly, async (req, res) => {
  try {
    const r = await pool.query(`${LIST_SQL} ORDER BY s.created_at DESC`);
    res.json({ success: true, data: r.rows.map(shape), max_photos: MAX_PHOTOS });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// Admin preview of a photo (any status).
router.get('/admin/photo/:photoId', auth, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.photoId, 10);
    const r = id ? await pool.query('SELECT mime, data FROM special_photos WHERE id = $1', [id]) : { rows: [] };
    if (!r.rows[0]) return res.status(404).end();
    res.set('Content-Type', r.rows[0].mime); res.set('Cache-Control', 'private, max-age=300');
    res.send(r.rows[0].data);
  } catch (err) { res.status(500).end(); }
});

router.post('/admin', auth, adminOnly, async (req, res) => {
  try {
    const { out, error } = clean(req.body || {});
    if (error) return res.status(400).json({ error });
    const r = await pool.query(
      `INSERT INTO special_listings (${COLS.join(',')}, created_by) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(',')}, $${COLS.length + 1}) RETURNING id`,
      [...COLS.map(c => out[c]), req.user.id || null]);
    await logAudit({ user: req.user, action: 'special.created', entityType: 'special', entityId: r.rows[0].id, changes: { title: { to: out.title } } });
    res.json({ success: true, id: r.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.put('/admin/:id', auth, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid listing.' });
    const { out, error } = clean(req.body || {});
    if (error) return res.status(400).json({ error });
    const r = await pool.query(
      `UPDATE special_listings SET ${COLS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${COLS.length + 1} RETURNING id`,
      [...COLS.map(c => out[c]), id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Listing not found.' });
    await logAudit({ user: req.user, action: 'special.updated', entityType: 'special', entityId: id, changes: { status: { to: out.status } } });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.delete('/admin/photos/:photoId', auth, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.photoId, 10);
    if (!id) return res.status(400).json({ error: 'Invalid photo.' });
    await pool.query('DELETE FROM special_photos WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/admin/:id', auth, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid listing.' });
    const r = await pool.query('DELETE FROM special_listings WHERE id = $1 RETURNING title', [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Listing not found.' });
    await logAudit({ user: req.user, action: 'special.deleted', entityType: 'special', entityId: id, changes: { title: { from: r.rows[0].title } } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/:id/photos', auth, adminOnly, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That photo is too large (8 MB maximum).' : 'Upload failed.' });
  });
}, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid listing.' });
    if (!req.file) return res.status(400).json({ error: 'No photo received.' });
    const mime = sniffMime(req.file.buffer);
    if (!mime) return res.status(400).json({ error: 'Only JPEG, PNG or WebP photos are accepted.' });
    const own = await pool.query('SELECT 1 FROM special_listings WHERE id = $1', [id]);
    if (!own.rows[0]) return res.status(404).json({ error: 'Listing not found.' });
    const c = (await pool.query('SELECT COUNT(*)::int AS n, COALESCE(MAX(sort_order), -1) AS top FROM special_photos WHERE special_id = $1', [id])).rows[0];
    if (c.n >= MAX_PHOTOS) return res.status(400).json({ error: `Up to ${MAX_PHOTOS} photos per listing.` });
    const r = await pool.query('INSERT INTO special_photos (special_id, sort_order, mime, data) VALUES ($1,$2,$3,$4) RETURNING id', [id, Number(c.top) + 1, mime, req.file.buffer]);
    res.json({ success: true, id: r.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.put('/admin/:id/cover/:photoId', auth, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10), pid = parseInt(req.params.photoId, 10);
    if (!id || !pid) return res.status(400).json({ error: 'Invalid request.' });
    const low = (await pool.query('SELECT COALESCE(MIN(sort_order), 0) AS m FROM special_photos WHERE special_id = $1', [id])).rows[0].m;
    await pool.query('UPDATE special_photos SET sort_order = $1 WHERE id = $2 AND special_id = $3', [Number(low) - 1, pid, id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
