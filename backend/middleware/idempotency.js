// Makes retried writes safe. The app sends an X-Client-Op-Id header on payments, maintenance and meter
// readings. The first request with a given id runs normally and its response is stored; a later request
// with the same id (a retry after lost signal) gets the stored response and does not run again.
// Without the header, or before migration 034 has run, requests pass through untouched.
const jwt  = require('jsonwebtoken');
const pool = require('../database/db');

module.exports = async function idempotency(req, res, next) {
  const id = req.get('x-client-op-id');
  if (!id || !['POST', 'PATCH'].includes(req.method) || !/^[A-Za-z0-9-]{16,64}$/.test(id)) return next();
  let uid;
  try { uid = jwt.verify((req.headers.authorization || '').split(' ')[1], process.env.JWT_SECRET).id; } catch { return next(); }
  if (!uid) return next();
  try {
    const ins = await pool.query(
      'INSERT INTO op_log (op_id, user_id, method, path) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING op_id',
      [id, uid, req.method, String(req.originalUrl).slice(0, 200)]);
    if (!ins.rows.length) {
      const r = (await pool.query('SELECT user_id, status, response FROM op_log WHERE op_id = $1', [id])).rows[0];
      if (!r || r.user_id !== uid) return res.status(409).json({ error: 'Duplicate operation id.' });
      if (r.status == null) return res.status(409).json({ error: 'That request is still being processed. Try again shortly.', in_progress: true });
      res.set('X-Replayed', '1');
      return res.status(r.status).json(r.response);
    }
  } catch (e) { return next(); }   // never block a request because of this table

  let recorded = false;
  const json = res.json.bind(res);
  res.json = (body) => {
    if (!recorded) {
      recorded = true;
      if (res.statusCode < 500) pool.query('UPDATE op_log SET status = $2, response = $3 WHERE op_id = $1', [id, res.statusCode, JSON.stringify(body)]).catch(() => {});
      else pool.query('DELETE FROM op_log WHERE op_id = $1', [id]).catch(() => {});
    }
    return json(body);
  };
  // Not a JSON reply, or the connection dropped: forget it so a retry can run.
  res.on('close', () => { if (!recorded) { recorded = true; pool.query('DELETE FROM op_log WHERE op_id = $1', [id]).catch(() => {}); } });
  if (Math.random() < 0.01) pool.query("DELETE FROM op_log WHERE created_at < NOW() - INTERVAL '30 days'").catch(() => {});
  next();
};
