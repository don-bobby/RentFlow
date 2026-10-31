// Rent passport maths: month by month, was the rent paid in full and on time?
// A month counts as "on time" when the payments allocated to it reached the full rent
// on or before (rent due day + grace days) of that month. Paying ahead is on time.
// The current month is left out until it has ended, so a tenant is never marked late early.
// The tenant's current rent is used for every month: rent changes are not stored per month.

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toDate = (v) => (v instanceof Date ? v : new Date(String(v).slice(0, 10) + 'T00:00:00'));

// payments: [{ amount, payment_date, year, month }]  (valid ones only)
function buildPassport({ rent, moveIn, dueDay, grace, payments, now = new Date() }) {
  const rentAmt = Number(rent || 0);
  const out = { months: [], summary: null };
  if (!rentAmt || !moveIn) return out;
  const start = toDate(moveIn);
  const byMonth = {};
  for (const p of payments) (byMonth[`${p.year}-${p.month}`] ||= []).push({ amount: Number(p.amount), date: toDate(p.payment_date) });
  let y = start.getFullYear(), m = start.getMonth() + 1;
  const dd = Math.min(Math.max(parseInt(dueDay, 10) || 5, 1), 28);
  while (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)) {
    const list = (byMonth[`${y}-${m}`] || []).sort((a, b) => a.date - b.date);
    const paid = list.reduce((s, p) => s + p.amount, 0);
    const deadline = new Date(y, m - 1, dd + grace);
    let cum = 0, fullOn = null;
    for (const p of list) { cum += p.amount; if (cum >= rentAmt - 0.005) { fullOn = p.date; break; } }
    let status = 'unpaid', daysLate = 0;
    if (fullOn) {
      daysLate = Math.max(0, Math.round((fullOn - deadline) / 86400000));
      status = daysLate === 0 ? 'on_time' : 'late';
    } else if (paid > 0) status = 'partial';
    out.months.push({ year: y, month: m, label: new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'short', year: 'numeric' }), rent: rentAmt, paid, status, days_late: daysLate, paid_on: fullOn ? ymd(fullOn) : null });
    m++; if (m > 12) { m = 1; y++; }
  }
  const n = out.months.length;
  const count = (s) => out.months.filter(x => x.status === s).length;
  const late = out.months.filter(x => x.status === 'late');
  let streak = 0, best = 0;
  for (const x of out.months) { if (x.status === 'on_time') { streak++; best = Math.max(best, streak); } else streak = 0; }
  let current = 0; for (let i = n - 1; i >= 0 && out.months[i].status === 'on_time'; i--) current++;
  out.summary = {
    months: n, on_time: count('on_time'), late: late.length, partial: count('partial'), unpaid: count('unpaid'),
    paid_in_full: count('on_time') + late.length,
    on_time_pct: n ? Math.round((count('on_time') / n) * 100) : 0,
    avg_days_late: late.length ? Math.round(late.reduce((s, x) => s + x.days_late, 0) / late.length) : 0,
    best_streak: best, current_streak: current,
    total_paid: out.months.reduce((s, x) => s + Math.min(x.paid, x.rent), 0),
  };
  return out;
}

module.exports = { buildPassport };
