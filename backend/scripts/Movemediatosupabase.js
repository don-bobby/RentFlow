// backend/scripts/moveMediaToSupabase.js
// One-off helper: copies listing photos/videos that are still on this computer's disk
// (backend/uploads/listings) into Supabase Storage and updates plot_media to point at them.
//
//   node scripts/moveMediaToSupabase.js          -> only shows what WOULD be moved (safe)
//   node scripts/moveMediaToSupabase.js --go     -> really uploads and updates the database
//
// Needs the same variables as the backend: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_BUCKET, plus your normal DB_* settings. Local files are NOT deleted.
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('../database/db');

const SB_URL    = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SB_BUCKET = process.env.SUPABASE_BUCKET || 'listing-media';
const GO        = process.argv.includes('--go');
const DIR       = path.join(__dirname, '..', 'uploads', 'listings');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
               '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

(async () => {
  if (!SB_URL || !SB_KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.'); process.exit(1); }
  const rows = (await pool.query(
    "SELECT id, house_id, filename FROM plot_media WHERE filename NOT LIKE 'supabase:%' ORDER BY id")).rows;
  console.log(`${rows.length} file(s) still stored locally.${GO ? '' : '  (dry run: add --go to move them)'}`);

  let moved = 0, missing = 0, failed = 0;
  for (const r of rows) {
    const file = path.join(DIR, r.filename);
    if (!fs.existsSync(file)) { console.log(`  missing on disk: ${r.filename}`); missing++; continue; }
    if (!GO) { console.log(`  would move: ${r.filename}`); continue; }
    try {
      const key = `unit_${r.house_id}/${r.filename}`;
      const resp = await fetch(`${SB_URL}/storage/v1/object/${SB_BUCKET}/${key}`, {
        method: 'POST',
        headers: { apikey: SB_KEY,
                   ...(SB_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SB_KEY}` } : {}),
                   'Content-Type': MIME[path.extname(r.filename).toLowerCase()] || 'application/octet-stream',
                   'x-upsert': 'true' },
        body: await fs.promises.readFile(file),
      });
      if (!resp.ok) throw new Error(`${resp.status} ${(await resp.text()).slice(0, 120)}`);
      await pool.query('UPDATE plot_media SET filename = $1 WHERE id = $2', ['supabase:' + key, r.id]);
      console.log(`  moved: ${r.filename}`); moved++;
    } catch (e) { console.log(`  FAILED ${r.filename}: ${e.message}`); failed++; }
  }
  console.log(`Done. moved ${moved}, missing ${missing}, failed ${failed}.`);
  await pool.end();
})();