const express = require('express');
const router  = express.Router();
const { authMiddleware: auth } = require('../middleware/auth');
const { logStaffActivity } = require('../utils/staffActivity');

// POST /api/staff-activity/report-viewed — fired by the frontend each time
// a staff member opens a report tab in Reports.jsx. `report` is just a
// label for the breakdown ("Unpaid Rent", "Audit Trail", etc.) — this
// endpoint doesn't validate it against a fixed list since it's
// informational only, not a permission check. Any logged-in staff member
// can call it for themselves (authMiddleware already re-checks they're a
// live, non-suspended account); there's nothing here to scope by property.
router.post('/report-viewed', auth, async (req, res) => {
  const { report } = req.body;
  await logStaffActivity({ userId: req.user.id, action: 'report_viewed', detail: report ? String(report).slice(0, 100) : null });
  res.json({ success: true });
});

module.exports = router;
