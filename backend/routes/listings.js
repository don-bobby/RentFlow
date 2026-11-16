const express = require('express');
const router  = express.Router();
const pool    = require('../database/db');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
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

// ── Where listing photos/videos are stored ────────────────────────────────────
// On Railway the server's disk is wiped on every restart, so in production files go to
// Supabase Storage. Set these three variables on the backend to turn that on:
//   SUPABASE_URL                 e.g. https://abcd1234.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    server-side secret, never put it in the frontend
//   SUPABASE_BUCKET              bucket name (default: listing-media) — create it as a PUBLIC bucket
// With none of them set (your laptop) files stay in backend/uploads/listings as before.
// New Supabase files are saved in plot_media.filename as "supabase:<object key>", so old
// local files and new cloud files can live side by side with no database change.
const SB_URL    = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SB_BUCKET = process.env.SUPABASE_BUCKET || 'listing-media';
const useSupabase = !!(SB_URL && SB_KEY);
const SB_PREFIX = 'supabase:';

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};

// The address the browser should use for a stored file
function mediaUrl(filename) {
  if (String(filename).startsWith(SB_PREFIX)) {
    return `${SB_URL}/storage/v1/object/public/${SB_BUCKET}/${filename.slice(SB_PREFIX.length)}`;
  }
  return `/uploads/listings/${filename}`;
}

// Older keys (service_role) are JWTs and go in both headers; new sb_secret_ keys go in apikey only
const sbHeaders = (extra = {}) => ({
  apikey: SB_KEY,
  ...(SB_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SB_KEY}` } : {}),
  ...extra,
});

async function sbUpload(key, buffer, contentType) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${SB_BUCKET}/${key}`, {
    method: 'POST',
    headers: sbHeaders({ 'Content-Type': contentType, 'x-upsert': 'false' }),
    body: buffer,
  });
  if (!r.ok) throw new Error(`Storage upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

async function sbDelete(key) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${SB_BUCKET}/${key}`, {
    method: 'DELETE',
    headers: sbHeaders(),
  });
  if (!r.ok) throw new Error(`Storage delete failed (${r.status})`);
}

// ── Multer: files land in a temp folder first when using Supabase ─────────────
const LOCAL_DIR = path.join(__dirname, '..', 'uploads', 'listings');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = useSupabase ? os.tmpdir() : LOCAL_DIR;
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `unit_${req.params.houseId}_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  // Supabase's free plan accepts files up to 50 MB; raise this if you upgrade
  limits: { fileSize: (useSupabase ? 50 : 100) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, !!MIME[ext]);
  },
});

// ── Who should a visitor contact about a property? ────────────────────────────
// The person who handles the property day to day:
//   property has an agent  ->  the agent, then the admin as a fallback
//   self-managed           ->  the assigned caretaker, then the landlord, then the admin
// Only a phone number and a ROLE are ever sent to the public, never a name.
const hasPhone = (v) => !!(v && String(v).trim());

function chooseContact(plot, ctx) {
  const adminPhone = ctx.adminPhone;
  const agent = plot.manager_agent_id != null ? ctx.agents.get(plot.manager_agent_id) : null;
  if (agent) {                                    // an agent manages this property
    if (hasPhone(agent.phone)) return { role: 'agent', phone: agent.phone };
    return hasPhone(adminPhone) ? { role: 'admin', phone: adminPhone } : null;
  }
  const caretakerPhone = ctx.caretakers.get(plot.id);   // self-managed
  if (hasPhone(caretakerPhone)) return { role: 'caretaker', phone: caretakerPhone };
  if (hasPhone(plot.landlord_phone)) return { role: 'landlord', phone: plot.landlord_phone };
  return hasPhone(adminPhone) ? { role: 'admin', phone: adminPhone } : null;
}

async function loadContactContext(plotRows) {
  const plotIds  = plotRows.map(p => p.id);
  const agentIds = [...new Set(plotRows.map(p => p.manager_agent_id).filter(id => id != null))];

  // First assigned caretaker (with a phone) for each plot. Uses caretaker_plots, and the older users.plot_id link as a backup.
  const ct = await pool.query(`
    SELECT DISTINCT ON (plot_id) plot_id, phone FROM (
      SELECT cp.plot_id, u.phone, 0 AS ord, u.id
        FROM caretaker_plots cp JOIN users u ON u.id = cp.caretaker_id
       WHERE cp.plot_id = ANY($1) AND u.role = 'caretaker'
         AND COALESCE(u.is_approved, true) AND COALESCE(u.phone, '') <> ''
      UNION ALL
      SELECT u.plot_id, u.phone, 1 AS ord, u.id
        FROM users u
       WHERE u.plot_id = ANY($1) AND u.role = 'caretaker'
         AND COALESCE(u.is_approved, true) AND COALESCE(u.phone, '') <> ''
    ) c ORDER BY plot_id, ord, id
  `, [plotIds]);

  // Only real agents count (a landlord whose agent_id points at an admin is treated as self-managed)
  const ag = agentIds.length
    ? await pool.query(`SELECT id, phone FROM users WHERE id = ANY($1) AND role = 'agent'`, [agentIds])
    : { rows: [] };

  const ad = await pool.query(`
    SELECT phone FROM users
     WHERE role IN ('admin', 'super_admin') AND COALESCE(is_approved, true) AND COALESCE(phone, '') <> ''
     ORDER BY id LIMIT 1
  `);

  return {
    caretakers: new Map(ct.rows.map(r => [r.plot_id, r.phone])),
    agents:     new Map(ag.rows.map(r => [r.id, r])),
    adminPhone: ad.rows[0]?.phone || null,
  };
}

// ── GET /api/listings — public, no auth ───────────────────────────────────────
// Returns all plots that have at least one vacant unit, with units + media
router.get('/', async (req, res) => {
  try {
    // All plots with vacant units
    const plotsRes = await pool.query(`
      SELECT DISTINCT p.id, p.name, p.location, p.description, p.gps_lat, p.gps_lng,
             p.agent_id AS manager_agent_id,   -- the agent assigned to THIS property (not the landlord's default agent)
             u.phone AS landlord_phone
      FROM plots p
      JOIN houses h ON h.plot_id = p.id
      LEFT JOIN users u ON p.user_id = u.id
      WHERE h.status = 'vacant' AND h.listed = true AND COALESCE(h.is_approved, true)
      ORDER BY p.name
    `);

    if (plotsRes.rows.length === 0) return res.json({ success: true, data: [] });

    const plotIds = plotsRes.rows.map(p => p.id);

    // Vacant units for those plots
    const unitsRes = await pool.query(`
      SELECT h.id, h.plot_id, h.unit_number, h.house_type,
             h.rent_amount, h.deposit, h.status, h.description,
             h.tags, h.furnishing, h.water_type, h.electricity_type, h.floor,
             to_char(h.available_from, 'YYYY-MM-DD') AS available_from,
             -- read through to_jsonb so the query still works even if a column is missing
             (to_jsonb(h) ->> 'status_changed_at') AS status_changed_at,
             (to_jsonb(h) ->> 'created_at')        AS created_at
      FROM houses h
      WHERE h.plot_id = ANY($1) AND h.status = 'vacant' AND h.listed = true AND COALESCE(h.is_approved, true)
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

    // Public 360 photo counts (quietly empty if the panoramas migration has not been run yet)
    const panoCounts = {};
    try {
      const pc = await pool.query('SELECT plot_id, COUNT(*)::int AS n FROM property_panoramas WHERE plot_id = ANY($1) AND is_public = true GROUP BY plot_id', [plotIds]);
      pc.rows.forEach(r => { panoCounts[r.plot_id] = r.n; });
    } catch { /* table missing */ }

    // Contact person per property (never breaks the listings if this lookup fails)
    let contactCtx = null;
    try { contactCtx = await loadContactContext(plotsRes.rows); }
    catch (e) { console.error('[listings] contact lookup failed:', e.message); }

    const listings = plotsRes.rows.map(({ gps_lat, gps_lng, manager_agent_id, landlord_phone, ...plot }) => {
      const contact = contactCtx ? chooseContact({ ...plot, manager_agent_id, landlord_phone }, contactCtx) : null;
      return {
      ...plot,
      contact_role:  contact ? contact.role  : null,   // 'agent' | 'caretaker' | 'landlord' | 'admin'
      contact_phone: contact ? contact.phone : null,
      // Coordinates power the "Get directions" buttons (null when the property has no pin yet)
      pano_count: panoCounts[plot.id] || 0,
      lat: gps_lat == null ? null : parseFloat(gps_lat),
      lng: gps_lng == null ? null : parseFloat(gps_lng),
      units: (unitsByPlot[plot.id] || []).map(u => ({
        ...u,
        media: (mediaByUnit[u.id] || []).map(m => ({
          ...m,
          url: mediaUrl(m.filename),
        })),
      })),
      };
    });

    res.json({ success: true, data: listings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/listings/tag-presets — suggested tags for the staff tag editor ───
router.get('/tag-presets', staffAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT tag, category FROM listing_tag_presets ORDER BY category NULLS LAST, tag');
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/listings/media/:houseId — upload photo or video ─────────────────
router.post('/media/:houseId', staffAuth, requirePermission('listings.publish'), upload.array('files', 20), async (req, res) => {
  const { houseId } = req.params;
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded.' });
  if (!(await assertHouseInScope(req, houseId))) {
    return res.status(403).json({ error: 'You do not have access to this unit.' });
  }

  const inserted = [];
  try {
    for (const file of req.files) {
      const ext       = path.extname(file.originalname).toLowerCase();
      const mediaType = ['.mp4', '.mov', '.webm'].includes(ext) ? 'video' : 'photo';
      let stored = file.filename;                       // local file name (laptop)

      if (useSupabase) {                                // production: send it to Supabase Storage
        const key = `unit_${houseId}/${file.filename}`;
        await sbUpload(key, await fs.promises.readFile(file.path), MIME[ext]);
        await fs.promises.unlink(file.path).catch(() => {});
        stored = SB_PREFIX + key;
      }

      const result = await pool.query(
        `INSERT INTO plot_media (house_id, filename, media_type) VALUES ($1, $2, $3) RETURNING *`,
        [houseId, stored, mediaType]
      );
      inserted.push({ ...result.rows[0], url: mediaUrl(stored) });
    }
    res.json({ success: true, data: inserted });
  } catch (err) {
    // clean up any temp files that were not sent yet
    if (useSupabase) for (const f of req.files) fs.promises.unlink(f.path).catch(() => {});
    console.error('[listings] media upload failed:', err.message);
    res.status(500).json({ error: inserted.length ? `Only ${inserted.length} file(s) were saved. ${err.message}` : err.message });
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

    // Delete the actual file (cloud or local, depending on where it was saved)
    const stored = result.rows[0].filename;
    if (String(stored).startsWith(SB_PREFIX)) {
      if (useSupabase) sbDelete(stored.slice(SB_PREFIX.length)).catch(e => console.error('[listings]', e.message));
    } else {
      fs.unlink(path.join(LOCAL_DIR, stored), () => {}); // ignore if already gone
    }

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
    const media = result.rows.map(m => ({ ...m, url: mediaUrl(m.filename) }));
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