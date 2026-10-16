// Behavioral test for GET /api/auth/my-plot-permissions (backend/routes/auth.js)
// — the new endpoint the Reports page uses to trim report data by property
// instead of hiding the whole report. Covers:
//   - super_admin / 'ALL' visibility gets {} (nothing to trim, '*' already
//     covers everything on the frontend)
//   - an agent with specific visible plots gets a real per-plot map, with
//     a property-specific override correctly layered on top of their role
//     default for just that one plot
process.env.JWT_SECRET = 'test-secret';

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./backend/database/db.js');

// Must patch scope.js's export BEFORE auth.js is required, so the
// destructured `getVisiblePlotIds` reference inside auth.js picks up the
// patched function (same cached module instance — see require() caching).
const scope = require('./backend/middleware/scope.js');
let visiblePlotsForTest = 'ALL';
scope.getVisiblePlotIds = async () => visiblePlotsForTest;

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
  const adminToken = tokenFor({ id: 1 });
  const agentToken = tokenFor({ id: 3 });

  // --- admin / 'ALL' visibility: nothing to compute, returns {} ---
  db.__reset();
  db.__setUser(1, { name: 'Admin', email: 'admin@rentflow.co.ke', role: 'admin', is_approved: true, agent_id: null, plot_id: null });
  db.__setResponse(/FROM role_permissions WHERE profile = \$1/, []); // shouldn't even be queried for admin
  db.__setResponse(/FROM user_permission_overrides WHERE user_id = \$1/, []);
  visiblePlotsForTest = 'ALL';

  const adminRes = await request(app).get('/api/auth/my-plot-permissions').set('Authorization', `Bearer ${adminToken}`);
  check('admin (ALL visibility) gets 200', adminRes.status === 200, adminRes.status);
  check('admin gets an empty map', Object.keys(adminRes.body.data || {}).length === 0, JSON.stringify(adminRes.body));

  // --- agent with two visible plots, one with a property-specific revoke ---
  // Fresh db state — the stub matches responses in registration order, so
  // the admin phase's (empty) role_permissions response would otherwise
  // still win here and mask the real one being tested.
  db.__reset();
  db.__setUser(3, { name: 'William Ogola', email: 'wogola@gmail.com', role: 'agent', is_approved: true, agent_id: null, plot_id: null });
  visiblePlotsForTest = [5, 9];
  db.__setResponse(/FROM role_permissions WHERE profile = \$1/, [
    { permission: 'payments.view' },
    { permission: 'reports.unpaid_rent' },
  ]);
  db.__setResponse(/FROM user_permission_overrides WHERE user_id = \$1/, [
    { plot_id: 9, permission: 'reports.unpaid_rent', effect: 'revoke' }, // only plot 9 loses this report
  ]);

  const agentRes = await request(app).get('/api/auth/my-plot-permissions').set('Authorization', `Bearer ${agentToken}`);
  check('agent gets 200', agentRes.status === 200, agentRes.status);
  const map = agentRes.body.data || {};
  check('map has an entry for both visible plots', '5' in map && '9' in map, JSON.stringify(map));
  check('plot 5 keeps reports.unpaid_rent (role default, no override)', (map['5'] || []).includes('reports.unpaid_rent'));
  check('plot 9 lost reports.unpaid_rent (property-specific revoke)', !(map['9'] || []).includes('reports.unpaid_rent'));
  check('plot 9 keeps an unrelated permission (payments.view)', (map['9'] || []).includes('payments.view'));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run();
