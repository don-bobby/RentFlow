// Shared-meter maths. One meter serves many units; each month's bill is split by
// unit weight among the occupied units. Tenants' utility receipts (same utility,
// same unit) fund it. Money is allocated oldest bill first, so a shortfall
// carries forward and any over-payment rolls into the next bill as credit.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Split `amount` by weight into cents; the leftover cents go to the largest remainders
// so the shares always add up to exactly the bill.
function splitBill(amount, units) {
  const totalW = units.reduce((a, u) => a + Number(u.weight), 0);
  if (!units.length || totalW <= 0) return [];
  const cents = Math.round(amount * 100);
  const raw = units.map(u => (cents * Number(u.weight)) / totalW);
  const floor = raw.map(Math.floor);
  let left = cents - floor.reduce((a, b) => a + b, 0);
  raw.map((r, i) => ({ i, f: r - floor[i] })).sort((a, b) => b.f - a.f).forEach(({ i }) => { if (left > 0) { floor[i] += 1; left -= 1; } });
  return units.map((u, i) => ({ ...u, share: floor[i] / 100 }));
}

async function computeMeter(db, meterId) {
  const m = (await db.query('SELECT * FROM shared_meters WHERE id = $1', [meterId])).rows[0];
  if (!m) return null;
  const [units, bills, shares] = await Promise.all([
    db.query(`SELECT smu.house_id, smu.weight, h.unit_number, t.id AS tenant_id, t.full_name AS tenant_name, t.phone AS tenant_phone
              FROM shared_meter_units smu JOIN houses h ON h.id = smu.house_id
              LEFT JOIN tenants t ON t.house_id = h.id AND t.is_active = true
              WHERE smu.meter_id = $1 ORDER BY h.unit_number`, [meterId]),
    db.query('SELECT * FROM shared_bills WHERE meter_id = $1 ORDER BY billing_month ASC', [meterId]),
    db.query(`SELECT s.*, h.unit_number, t.full_name AS tenant_name, t.phone AS tenant_phone
              FROM shared_bill_shares s JOIN shared_bills b ON b.id = s.bill_id JOIN houses h ON h.id = s.house_id
              LEFT JOIN tenants t ON t.id = s.tenant_id WHERE b.meter_id = $1`, [meterId]),
  ]);
  const houseIds = [...new Set([...units.rows.map(u => u.house_id), ...shares.rows.map(s => s.house_id)])];
  const paidRows = houseIds.length ? (await db.query(
    `SELECT house_id, COALESCE(SUM(amount),0) AS total FROM utility_payments
     WHERE house_id = ANY($1) AND utility_type = $2 AND payment_date >= $3::date GROUP BY house_id`,
    [houseIds, m.utility_type, `${m.start_month}-01`])).rows : [];
  const remaining = new Map(paidRows.map(r => [r.house_id, parseFloat(r.total)]));
  const totalPaid = new Map(remaining);

  const sharesByBill = new Map();
  for (const s of shares.rows) { if (!sharesByBill.has(s.bill_id)) sharesByBill.set(s.bill_id, []); sharesByBill.get(s.bill_id).push(s); }

  const outBills = bills.rows.map(b => {
    const rows = (sharesByBill.get(b.id) || []).sort((a, c) => String(a.unit_number).localeCompare(String(c.unit_number), undefined, { numeric: true })).map(s => {
      const rem = remaining.get(s.house_id) || 0;
      const share = parseFloat(s.share);
      const applied = round2(Math.min(rem, share));
      remaining.set(s.house_id, round2(rem - applied));
      return { house_id: s.house_id, unit_number: s.unit_number, tenant_id: s.tenant_id, tenant_name: s.tenant_name, tenant_phone: s.tenant_phone,
               weight: parseFloat(s.weight), share, paid: applied, balance: round2(share - applied), status: applied >= share ? 'paid' : applied > 0 ? 'partial' : 'unpaid' };
    });
    const target = parseFloat(b.amount);
    const funded = round2(rows.reduce((a, r) => a + r.paid, 0));
    return { id: b.id, billing_month: b.billing_month, amount: target, due_date: b.due_date, reference: b.reference, notes: b.notes, provider_paid_on: b.provider_paid_on,
             funded, outstanding: round2(target - funded), pct: target > 0 ? Math.min(100, Math.round((funded / target) * 1000) / 10) : 0,
             counts: { paid: rows.filter(r => r.status === 'paid').length, partial: rows.filter(r => r.status === 'partial').length, unpaid: rows.filter(r => r.status === 'unpaid').length },
             rows };
  });
  const credits = [...remaining.entries()].filter(([, v]) => v > 0).map(([house_id, credit]) => ({ house_id, credit: round2(credit) }));
  return {
    meter: { id: m.id, plot_id: m.plot_id, utility_type: m.utility_type, meter_number: m.meter_number, account_number: m.account_number, start_month: m.start_month, active: m.active },
    units: units.rows.map(u => ({ house_id: u.house_id, unit_number: u.unit_number, weight: parseFloat(u.weight), tenant_id: u.tenant_id, tenant_name: u.tenant_name, tenant_phone: u.tenant_phone,
                                  total_paid: round2(totalPaid.get(u.house_id) || 0), credit: round2(remaining.get(u.house_id) || 0) })),
    bills: outBills.reverse(), // newest first
    credits,
  };
}

module.exports = { splitBill, computeMeter, round2 };
