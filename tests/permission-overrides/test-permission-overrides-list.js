// Behavioral test for GET /api/auth/permission-overrides (backend/routes/auth.js)
// — the new system-wide list behind the PermissionOverrides.jsx page. Covers:
//   - non-admin is rejected (requireAdmin gate)
//   - admin gets back every row the query returns, shaped the way the
//     frontend table expects (user_name, plot_name, granted_by_name joined in)
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
  db.__reset();
  db.__setUser(1, { name: 'Admin', email: 'admin@rentflow.co.ke', role: 'admin', is_approved: true, agent_id: null, plot_id: null });
  db.__setUser(3, { name: 'William Ogola', email: 'wogola@gmail.com', role: 'agent', is_approved: true, agent_id: null, plot_id: null });
  const adminToken = tokenFor({ id: 1 });
  const agentToken = tokenFor({ id: 3 });

  // --- non-admin is rejected ---
  const deniedRes = await request(app).get('/api/auth/permission-overrides').set('Authorization', `Bearer ${agentToken}`);
  check('agent (non-admin) gets 403', deniedRes.status === 403, deniedRes.status);

  // --- admin gets the joined rows back as-is ---
  db.__setResponse(/FROM user_permission_overrides o\s+JOIN users u/, [
    {
      id: 7, user_id: 3, user_name: 'William Ogola', user_role: 'agent',
      plot_id: null, plot_name: null, permission: 'plots.delete', effect: 'revoke',
      created_at: '2026-10-10T00:00:00.000Z', granted_by_name: 'Admin',
    },
    {
      id: 8, user_id: 3, user_name: 'William Ogola', user_role: 'agent',
      plot_id: 9, plot_name: 'Garden View Flats', permission: 'reports.unpaid_rent', effect: 'revoke',
      created_at: '2026-10-15T00:00:00.000Z', granted_by_name: 'Admin',
    },
  ]);

  const adminRes = await request(app).get('/api/auth/permission-overrides').set('Authorization', `Bearer ${adminToken}`);
  check('admin gets 200', adminRes.status === 200, adminRes.status);
  const rows = adminRes.body.data || [];
  check('gets back both rows', rows.length === 2, JSON.stringify(rows));
  check('a global override has plot_id null and no plot_name', rows[0].plot_id === null && rows[0].plot_name === null);
  check('a property-specific override carries its plot name through', rows[1].plot_name === 'Garden View Flats');
  check('user_name/user_role/granted_by_name are joined in, not just raw ids', rows[1].user_name === 'William Ogola' && rows[1].user_role === 'agent' && rows[1].granted_by_name === 'Admin');

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run();
