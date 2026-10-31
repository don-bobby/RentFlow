// KRA Monthly Rental Income (MRI) maths. Pure functions, no database access.
// MRI = a flat % of GROSS residential rent received in the month, no deductions.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const COMMERCIAL_WORDS = /shop|office|saloon|salon|barber|store|stall|commercial|restaurant|hotel|hall|clinic|godown|warehouse/i;

// Is this unit's rent residential (covered by MRI) or commercial (not covered)?
// Order: the unit's own setting, then the property's setting, then the unit type.
function classify(house, plot) {
  if (house.use_type) return { use: house.use_type, reason: 'set on this unit' };
  if (plot.rental_use === 'residential' || plot.rental_use === 'commercial') return { use: plot.rental_use, reason: `property is ${plot.rental_use}` };
  if (COMMERCIAL_WORDS.test(house.house_type || '')) return { use: 'commercial', reason: `unit type "${house.house_type}"` };
  return { use: 'residential', reason: house.house_type ? `unit type "${house.house_type}"` : 'default' };
}

const pad = (n) => String(n).padStart(2, '0');
const nextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; };
// The return and payment for rent received in `ym` fall due in the following month.
const dueDate = (ym, dueDay) => `${nextMonth(ym)}-${pad(Math.min(Math.max(dueDay, 1), 28))}`;
const daysBetween = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);

// Estimated penalties. A step is "late" if its date (or today, if not done yet) is after the due date.
function penalties({ tax, due, filedOn, paidOn, today, s }) {
  const none = { filing: 0, payment: 0, interest: 0, total: 0, months_late: 0, late_filing: false, late_payment: false };
  if (!(tax > 0)) return none;
  const fd = filedOn || today, pd = paidOn || today;
  const lateFiling = fd > due, latePayment = pd > due;
  const filing = lateFiling ? round2(Math.max(Number(s.late_filing_min), tax * Number(s.late_filing_pct) / 100)) : 0;
  const payment = latePayment ? round2(tax * Number(s.late_payment_pct) / 100) : 0;
  const months = latePayment ? Math.max(1, Math.ceil(daysBetween(due, pd) / 30.4)) : 0; // part of a month counts as a month
  const interest = round2(months * tax * Number(s.late_interest_pct) / 100);
  return { filing, payment, interest, total: round2(filing + payment + interest), months_late: months, late_filing: lateFiling, late_payment: latePayment };
}

module.exports = { round2, classify, nextMonth, dueDate, penalties, daysBetween };
