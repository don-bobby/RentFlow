// Puts one incoming payment (e.g. a Paybill notice) against a tenant's rent:
// oldest unpaid month first, then any leftover as rent paid in advance (same
// rule as a manual payment). Runs on the caller's transaction client.
// Rows are written with transaction_id NULL and the M-Pesa code in receipt_no,
// because one payment can span several months.
const { computeLedger, loadPaidMaps } = require('./rentLedger');

async function allocateRentPayment(db, { tenantId, houseId, amount, paymentDate, method, reference, notes }) {
  const t = (await db.query(
    `SELECT t.move_in_date, h.rent_amount FROM tenants t LEFT JOIN houses h ON t.house_id = h.id WHERE t.id = $1`, [tenantId])).rows[0];
  const rows = [];
  const insert = async (amt, y, m, status, note) => {
    const r = await db.query(
      `INSERT INTO payments (tenant_id, house_id, amount, amount_allocated, payment_date, method, receipt_no, notes, status, match_score, for_year, for_month)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,95,$10,$11) RETURNING id, amount, for_year, for_month, status`,
      [tenantId, houseId, amt, amt, paymentDate, method, reference, note, status, y, m]);
    rows.push(r.rows[0]);
  };
  let remaining = Math.round(parseFloat(amount) * 100) / 100;
  const rent = t ? parseFloat(t.rent_amount || 0) : 0;
  if (!t || !rent || !t.move_in_date) { await insert(remaining, null, null, 'matched', notes); return rows; }

  const maps = await loadPaidMaps(db, [tenantId]);
  const { unpaidMonths } = computeLedger({ rent, moveInDate: t.move_in_date, paidMap: maps[tenantId] || {} });
  for (const mo of unpaidMonths) {
    if (remaining <= 0) break;
    const a = Math.min(remaining, mo.balance);
    await insert(a, mo.year, mo.month, 'matched', notes);
    remaining = Math.round((remaining - a) * 100) / 100;
  }
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth() + 1;
  if (unpaidMonths.length) { const last = unpaidMonths[unpaidMonths.length - 1]; y = last.year; m = last.month; }
  let cap = 24;
  while (remaining > 0 && cap-- > 0) {
    m++; if (m > 12) { m = 1; y++; }
    const paid = maps[tenantId]?.[`${y}-${m}`] || 0;
    const room = Math.max(rent - paid, 0);
    if (room <= 0) continue;
    const a = Math.min(remaining, room);
    await insert(a, y, m, 'matched', `${notes || ''} Paid in advance.`.trim());
    remaining = Math.round((remaining - a) * 100) / 100;
  }
  if (remaining > 0) await insert(remaining, null, null, 'review', `${notes || ''} Unusually large payment, please verify and assign months manually.`.trim());
  return rows;
}
module.exports = { allocateRentPayment };
