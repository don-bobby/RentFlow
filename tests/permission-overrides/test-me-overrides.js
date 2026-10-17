// Behavioral test for GET /api/auth/me (backend/routes/auth.js) — confirms
// the response now includes `overrides`, which AuthContext.jsx's
// can(permission, plotId) depends on entirely to check anything
// property-specific. Before this fix, /me never sent this field, so every
// property-specific grant/revoke was silently invisible to the frontend's
// per-property checks (they always fell back to the flat global list).
process.env.JWT_SECRET = 'test-secret';

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./backend/database/db.js');
const authRouter = require('./backend/routes/auth.js');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

function tokenFor(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET);
}

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function run() {
  // --- A landlord with one property-specific grant gets it back in `overrides` ---
  db.__reset();
  db.__setUser(5, { name: 'Jane Nyambura', email: 'jane@example.com', role: 'landlord', is_approved: true, agent_id: 3, plot_id: null });
  db.__setResponse(/FROM role_permissions WHERE profile/, [{ permission: 'tenants.view' }, { permission: 'payments.view' }]);
  // getPermissions(req.user) with no plotId — global-overrides-only query
  db.__setResponse(/FROM user_permission_overrides\s+WHERE user_id = \$1 AND \(plot_id IS NULL OR plot_id = \$2\)/, []);
  // The new raw-overrides query /me now runs for AuthContext's per-plot checks
  db.__setResponse(/SELECT plot_id, permission, effect FROM user_permission_overrides WHERE user_id = \$1/, [
    { plot_id: 9, permission: 'tenants.create', effect: 'grant' },
  ]);
  db.__setResponse(/SELECT name FROM users WHERE id = \$1/, [{ name: 'William Ogola' }]);

  const janeToken = tokenFor({ id: 5 });
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${janeToken}`);
  check('200 OK', res.status === 200, res.status);
  const data = res.body.data || {};
  check('response has an overrides array', Array.isArray(data.overrides), JSON.stringify(data));
  check('the property-specific grant is in it', (data.overrides || []).some(o => o.plot_id === 9 && o.permission === 'tenants.create' && o.effect === 'grant'), JSON.stringify(data.overrides));
  check('flat permissions list is unaffected (still just role defaults)', Array.isArray(data.permissions) && data.permissions.includes('tenants.view'));

  // --- admin gets an empty overrides array, never a query against the table ---
  db.__reset();
  db.__setUser(1, { name: 'Admin', email: 'admin@rentflow.co.ke', role: 'admin', is_approved: true, agent_id: null, plot_id: null });
  const adminToken = tokenFor({ id: 1 });
  const adminRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
  check('admin: 200 OK', adminRes.status === 200, adminRes.status);
  check('admin: overrides is an empty array, not missing/undefined', Array.isArray(adminRes.body.data?.overrides) && adminRes.body.data.overrides.length === 0, JSON.stringify(adminRes.body.data));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run();
