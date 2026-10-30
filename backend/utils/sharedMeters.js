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
    db.query(`SELECT smu.*, h.unit_number, t.id AS tenant_id, t.full_name AS tenant_name, t.phone AS tenant_phone
              FROM shared_meter_units smu JOIN houses h ON h.id = smu.house_id
              LEFT JOIN tenants t ON t.house_id = h.id AND t.is_active = true
              WHERE smu.meter_id = $1 ORDER BY h.unit_number`, [meterId]),
    db.query('SELECT * FROM shared_bills WHERE meter_id = $1 ORDER BY billing_month ASC', [meterId]),
    db.query(`SELECT s.*, h.unit_number, t.full_name AS tenant_name, t.phone AS tenant_phone
              FROM shared_bill_shares s JOIN shared_bills b ON b.id = s.bill_id JOIN houses h ON h.id = s.house_id
              LEFT JOIN tenants t ON t.id = s.tenant_id WHERE b.meter_id = $1`, [meterId]),
  ]);
  // Extra payers (a second business sharing a unit) — absent until migration 030 is run.
  let payerRows = [];
  if ((await db.query(`SELECT to_regclass('shared_meter_payers') AS t`)).rows[0].t) {
    payerRows = (await db.query(`SELECT p.*, h.unit_number FROM shared_meter_payers p JOIN houses h ON h.id = p.house_id WHERE p.meter_id = $1 AND p.active = true ORDER BY h.unit_number, p.id`, [meterId])).rows;
  }
  const houseIds = [...new Set([...units.rows.map(u => u.house_id), ...shares.rows.map(s => s.house_id)])];
  const paidRows = houseIds.length ? (await db.query(
    `SELECT house_id, COALESCE(SUM(amount),0) AS total FROM utility_payments
     WHERE house_id = ANY($1) AND utility_type = $2 AND payment_date >= $3::date GROUP BY house_id`,
    [houseIds, m.utility_type, `${m.start_month}-01`])).rows : [];
  const remaining = new Map(paidRows.map(r => [`h${r.house_id}`, parseFloat(r.total)]));
  const allPayerIds = [...new Set([...payerRows.map(p => p.id), ...shares.rows.filter(x => x.payer_id).map(x => x.payer_id)])];
  if (allPayerIds.length) {
    const pp = await db.query(`SELECT payer_id, COALESCE(SUM(amount),0) AS total FROM shared_meter_payments WHERE payer_id = ANY($1) AND payment_date >= $2::date GROUP BY payer_id`, [allPayerIds, `${m.start_month}-01`]);
    pp.rows.forEach(r => remaining.set(`p${r.payer_id}`, parseFloat(r.total)));
  }
  const totalPaid = new Map(remaining);
  const payerInfo = new Map();
  if (allPayerIds.length) (await db.query('SELECT id, name, phone FROM shared_meter_payers WHERE id = ANY($1)', [allPayerIds])).rows.forEach(r => payerInfo.set(r.id, r));

  const sharesByBill = new Map();
  for (const s of shares.rows) { if (!sharesByBill.has(s.bill_id)) sharesByBill.set(s.bill_id, []); sharesByBill.get(s.bill_id).push(s); }

  const lastRowByKey = new Map();
  const outBills = bills.rows.map(b => {
    const rows = (sharesByBill.get(b.id) || []).sort((a, c) => String(a.unit_number).localeCompare(String(c.unit_number), undefined, { numeric: true })).map(s => {
      const key = s.payer_id ? `p${s.payer_id}` : `h${s.house_id}`;
      const pinfo = s.payer_id ? payerInfo.get(s.payer_id) : null;
      const rem = remaining.get(key) || 0;
      const share = parseFloat(s.share);
      const applied = round2(Math.min(rem, share));
      remaining.set(key, round2(rem - applied));
      const row = { key, house_id: s.house_id, payer_id: s.payer_id || null, unit_number: s.unit_number, category: s.category || null, tenant_id: s.payer_id ? null : s.tenant_id, tenant_name: pinfo ? pinfo.name : s.tenant_name, tenant_phone: pinfo ? pinfo.phone : s.tenant_phone,
               weight: parseFloat(s.weight), share, paid: applied, extra: 0, received: applied, balance: round2(share - applied), status: applied >= share ? 'paid' : applied > 0 ? 'partial' : 'unpaid' };
      lastRowByKey.set(key, row);
      return row;
    });
    const target = parseFloat(b.amount);
    const funded = round2(rows.reduce((a, r) => a + r.paid, 0));
    const expected = round2(rows.reduce((a, r) => a + r.share, 0));
    return { id: b.id, billing_month: b.billing_month, amount: target, category_rates: b.category_rates || null, expected, gap: round2(target - expected), due_date: b.due_date, reference: b.reference, notes: b.notes, provider_paid_on: b.provider_paid_on,
             funded, outstanding: round2(target - funded), pct: target > 0 ? Math.min(100, Math.round((funded / target) * 1000) / 10) : 0,
             counts: { paid: rows.filter(r => r.status === 'paid').length, partial: rows.filter(r => r.status === 'partial').length, unpaid: rows.filter(r => r.status === 'unpaid').length },
             rows };
  });
  // Money left over after every bill (an overpayment) is shown on that unit's latest row, so the
  // Paid column reads as the exact amount received; it still counts as credit for the next bill.
  for (const [key, row] of lastRowByKey) {
    const left = remaining.get(key) || 0;
    if (left > 0) { row.extra = round2(left); row.received = round2(row.paid + left); }
    delete row.key;
  }
  const credits = [...remaining.entries()].filter(([k, v]) => k.startsWith('h') && v > 0).map(([k, credit]) => ({ house_id: Number(k.slice(1)), credit: round2(credit) }));
  return {
    meter: { id: m.id, plot_id: m.plot_id, utility_type: m.utility_type, meter_number: m.meter_number, account_number: m.account_number, start_month: m.start_month, active: m.active, split_mode: m.split_mode || 'weight' },
    units: units.rows.map(u => ({ house_id: u.house_id, unit_number: u.unit_number, weight: parseFloat(u.weight), category: u.category || null, tenant_id: u.tenant_id, tenant_name: u.tenant_name, tenant_phone: u.tenant_phone,
                                  total_paid: round2(totalPaid.get(`h${u.house_id}`) || 0), credit: round2(remaining.get(`h${u.house_id}`) || 0) })),
    payers: payerRows.map(p => ({ id: p.id, house_id: p.house_id, unit_number: p.unit_number, name: p.name, phone: p.phone, category: p.category || null, weight: parseFloat(p.weight),
                                  total_paid: round2(totalPaid.get(`p${p.id}`) || 0), credit: round2(remaining.get(`p${p.id}`) || 0) })),
    bills: outBills.reverse(), // newest first
    credits,
  };
}

module.exports = { splitBill, computeMeter, round2 };
