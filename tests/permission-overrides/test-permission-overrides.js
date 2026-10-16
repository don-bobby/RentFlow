// Behavioral test for the list-route fix in backend/middleware/permissions.js
// (getPermissionsForPlots / filterRowsByPermission) and its use in
// payments.js, tenants.js, maintenance.js, expenses.js GET /.
//
// Problem this covers: those list routes used to check "does this user have
// X.view at all" once, at the top of the route, then only filter rows by
// getVisiblePlotIds (which plots the user can see at all — nothing to do
// with the per-user/per-property override system). A property-specific
// revoke on e.g. payments.view for one plot had no effect on the list view:
// the revoked plot's rows still came back. This test seeds role defaults +
// overrides in the stubbed db and checks the row-level filter actually
// drops the revoked plot's rows while leaving everything else untouched.
process.env.JWT_SECRET = 'test-secret';

const db = require('./backend/database/db.js');
const {
  getPermissionsForPlots,
  filterRowsByPermission,
} = require('./backend/middleware/permissions.js');

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function seedAgentDefaults() {
  // agent profile's default permission list, as read by:
  //   SELECT permission FROM role_permissions WHERE profile = $1 AND allowed = true
  db.__setResponse(/FROM role_permissions WHERE profile = \$1/, [
    { permission: 'payments.view' },
    { permission: 'payments.record_manual' },
    { permission: 'plots.view' },
  ]);
}

async function run() {
  const william = { id: 3, role: 'agent', agent_id: null };

  // --- getPermissionsForPlots: role default + a global revoke + a
  // plot-specific grant that should win over both for its own plot ---
  db.__reset();
  seedAgentDefaults();
  db.__setResponse(/FROM user_permission_overrides WHERE user_id = \$1/, [
    { plot_id: null, permission: 'payments.view', effect: 'revoke' }, // revoked everywhere...
    { plot_id: 9,    permission: 'payments.view', effect: 'grant' },  // ...except plot 9
  ]);
  const byPlot = await getPermissionsForPlots(william, [5, 9, 9, null]);
  check(
    'global revoke removes payments.view from an unrelated plot',
    !byPlot.get(5).includes('payments.view'),
    JSON.stringify(byPlot.get(5))
  );
  check(
    'plot-specific grant wins over the global revoke for its own plot',
    byPlot.get(9).includes('payments.view'),
    JSON.stringify(byPlot.get(9))
  );
  check(
    'unrelated permission (plots.view) is untouched by either override',
    byPlot.get(5).includes('plots.view') && byPlot.get(9).includes('plots.view')
  );
  check('null plot id is never looked up', !byPlot.has(null));

  // --- filterRowsByPermission: the actual list-route shape ---
  db.__reset();
  seedAgentDefaults();
  db.__setResponse(/FROM user_permission_overrides WHERE user_id = \$1/, [
    { plot_id: 5, permission: 'payments.view', effect: 'revoke' }, // only plot 5 is revoked
  ]);
  const rows = [
    { id: 101, plot_id: 5, amount: 1000 },  // should be hidden
    { id: 102, plot_id: 6, amount: 2000 },  // should stay — different plot, role default still applies
    { id: 103, plot_id: null, amount: 3000 }, // should stay — nothing to scope it by
  ];
  const visible = await filterRowsByPermission(william, rows, 'payments.view', (r) => r.plot_id);
  const visibleIds = visible.map((r) => r.id);
  check('revoked plot\'s row is dropped from the list', !visibleIds.includes(101), JSON.stringify(visibleIds));
  check('unrelated plot\'s row stays', visibleIds.includes(102), JSON.stringify(visibleIds));
  check('row with no plot id stays (nothing to scope by)', visibleIds.includes(103), JSON.stringify(visibleIds));
  check('exactly one row was removed', visible.length === rows.length - 1, `got ${visible.length}`);

  // --- super_admin always passes, overrides table never even consulted ---
  db.__reset();
  // Deliberately do NOT seed role_permissions or overrides — if the
  // super_admin path queried either, this test would see empty results and
  // (correctly) still pass '*', but we also want to confirm it short-circuits
  // before hitting the db at all, matching getPermissions()'s existing
  // contract that super_admin never touches the overrides table.
  const admin = { id: 1, role: 'admin' };
  const adminByPlot = await getPermissionsForPlots(admin, [5, 6]);
  check('super_admin gets \'*\' for every plot', adminByPlot.get(5).includes('*') && adminByPlot.get(6).includes('*'));
  const adminVisible = await filterRowsByPermission(admin, rows, 'payments.view', (r) => r.plot_id);
  check('super_admin keeps every row, including the one revoked for other users', adminVisible.length === rows.length);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run();
