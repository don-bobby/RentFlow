// backend/utils/rentLedger.js
//
// ONE definition of "how much rent does this tenant owe?", used everywhere
// that shows or stores a balance. Before this, two different formulas ran
// side by side: a SQL total (months since move-in x rent - ALL payments,
// failed ones and prepaid future months included) behind the Tenants list
// and tenants.balance, and a month-by-month ledger behind the Record Payment
// form and arrears. They disagreed (e.g. KES 2,500 in the list while the
// form said "No arrears").
//
// The rule, month by month:
//   - Billing starts in the move-in month, at the full rent.
//   - Every month up to and including the current one is owed in full.
//   - A payment counts toward the month it is allocated to (for_year /
//     for_month; payment_date's month for older rows without one).
//   - A month's balance is rent minus what was paid for it, never below 0.
//     Paying ahead for a future month never hides an older unpaid month.
//   - Failed and pending payments, and auto 'balance_charge' rows, never
//     count as money received.

const VALID_PAYMENT_SQL = `status NOT IN ('failed', 'pending') AND COALESCE(method, '') != 'balance_charge'`;

// Months owed from move-in to `now` (inclusive of both), oldest first.
// paidMap is { 'YYYY-M': amountPaid }.
function computeLedger({ rent, moveInDate, paidMap = {}, now = new Date() }) {
  const rentAmount = parseFloat(rent || 0);
  const unpaidMonths = [];
  if (!rentAmount || !moveInDate) return { unpaidMonths, totalOwed: 0 };

  const moveIn = new Date(moveInDate);
  let y = moveIn.getFullYear();
  let m = moveIn.getMonth() + 1;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    const paid = paidMap[`${y}-${m}`] || 0;
    const balance = rentAmount - paid;
    if (balance > 0) {
      unpaidMonths.push({
        year: y, month: m,
        label: new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' }),
        rent: rentAmount, paid, balance, partial: paid > 0,
      });
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return { unpaidMonths, totalOwed: unpaidMonths.reduce((s, mo) => s + mo.balance, 0) };
}

// { tenantId: { 'YYYY-M': amount } } for the given tenants, valid payments only.
async function loadPaidMaps(db, tenantIds) {
  const maps = {};
  if (!tenantIds.length) return maps;
  const r = await db.query(
    `SELECT tenant_id,
            COALESCE(for_year,  EXTRACT(YEAR  FROM payment_date)::int) AS year,
            COALESCE(for_month, EXTRACT(MONTH FROM payment_date)::int) AS month,
            SUM(COALESCE(amount_allocated, amount)) AS total_paid
     FROM payments
     WHERE tenant_id = ANY($1) AND ${VALID_PAYMENT_SQL}
     GROUP BY tenant_id, year, month`,
    [tenantIds]
  );
  for (const row of r.rows) {
    (maps[row.tenant_id] ||= {})[`${row.year}-${row.month}`] = parseFloat(row.total_paid || 0);
  }
  return maps;
}

// Recomputes one tenant's stored tenants.balance from the ledger above and
// saves it. Returns the new balance.
async function refreshTenantBalance(db, tenantId) {
  const t = await db.query(
    `SELECT t.move_in_date, h.rent_amount
     FROM tenants t LEFT JOIN houses h ON t.house_id = h.id WHERE t.id = $1`,
    [tenantId]
  );
  if (!t.rows[0]) return 0;
  const maps = await loadPaidMaps(db, [tenantId]);
  const { totalOwed } = computeLedger({
    rent: t.rows[0].rent_amount, moveInDate: t.rows[0].move_in_date, paidMap: maps[tenantId] || {},
  });
  await db.query('UPDATE tenants SET balance = $1 WHERE id = $2', [totalOwed, tenantId]);
  return totalOwed;
}

module.exports = { computeLedger, loadPaidMaps, refreshTenantBalance, VALID_PAYMENT_SQL };
