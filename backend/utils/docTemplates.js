// Plain-text notice and lease templates. Each template has a list of `fields` the
// user may change and a `build(ctx, p)` that returns { title, body }. In `body`,
// a line starting with "# " is a heading; blank lines separate paragraphs.
// These are general starting points, not legal advice.

const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const long = (v) => {
  if (!v) return '____________';
  const i = iso(v); if (!i) return '____________';
  const d = new Date(i + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
// pg returns DATE columns as Date objects (local midnight); turn either form into YYYY-MM-DD.
const iso = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : null;
};
const today = () => new Date().toISOString().slice(0, 10);
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const str = (v, d = '') => (v == null || v === '' ? d : String(v).slice(0, 300));

const head = (c) =>
  `Date: ${long(c.today)}\n\nTo: ${c.tenant.full_name}\nUnit ${c.unit}, ${c.plot_name}${c.plot_location ? ', ' + c.plot_location : ''}\n\nFrom: ${c.landlord_name}`;

const sign = (c) => `Yours faithfully,\n\n\n______________________\n${c.landlord_name}\nLandlord / Authorised agent`;

const TEMPLATES = {
  arrears_notice: {
    label: 'Rent arrears notice',
    description: 'Formal request to clear unpaid rent by a set date.',
    fields: [{ key: 'pay_by', label: 'Pay by', type: 'date' }, { key: 'arrears', label: 'Amount owed (KES)', type: 'number' }],
    defaults: (c) => ({ pay_by: addDays(c.today, 7), arrears: Math.max(0, num(c.tenant.balance, 0)) }),
    build(c, p) {
      return {
        title: 'NOTICE OF RENT ARREARS',
        body: `${head(c)}\n\n# RE: RENT ARREARS, UNIT ${c.unit}\n\nOur records show that rent of ${kes(p.arrears)} is outstanding on the above unit. The monthly rent is ${kes(c.rent)}, due on the ${ordinal(num(c.tenant.rent_due_day, 5))} of each month.\n\nYou are requested to pay the outstanding amount of ${kes(p.arrears)} on or before ${long(p.pay_by)}. Payment can be made through the channels you normally use, quoting your unit number.\n\nIf you have already paid, please send us the payment reference so that we can correct our records. If you are unable to pay in full, please contact us before the date above to discuss a plan.\n\nIf the amount remains unpaid after that date, we may take the further steps allowed under your tenancy agreement and the law.\n\n${sign(c)}`,
      };
    },
  },

  vacate_notice: {
    label: 'Notice to vacate',
    description: 'Landlord asks the tenant to leave by a given date.',
    fields: [{ key: 'vacate_on', label: 'Vacate by', type: 'date' }, { key: 'reason', label: 'Reason', type: 'text' }],
    defaults: (c) => ({ vacate_on: addMonths(c.today, 1), reason: 'the end of the tenancy' }),
    build(c, p) {
      return {
        title: 'NOTICE TO VACATE',
        body: `${head(c)}\n\n# RE: NOTICE TO VACATE, UNIT ${c.unit}\n\nThis is formal notice that your tenancy of the above unit will end on ${long(p.vacate_on)}, because of ${p.reason}.\n\nYou are asked to vacate and hand over the unit, with all keys, in a clean condition and free of your belongings, by that date. Please arrange a handover inspection with us beforehand.\n\nAny rent due up to the date you leave remains payable. Your deposit of ${kes(c.tenant.deposit_paid)} will be settled after the handover inspection, less any amounts owed or damage beyond normal wear and tear.\n\nPlease note that the notice period required can depend on your tenancy agreement and on whether the unit is residential or commercial. If you believe this notice is not correct, contact us as soon as possible.\n\n${sign(c)}`,
      };
    },
  },

  rent_increase: {
    label: 'Rent increase notice',
    description: 'Tells the tenant the new rent and when it starts.',
    fields: [{ key: 'new_rent', label: 'New monthly rent (KES)', type: 'number' }, { key: 'effective', label: 'Effective from', type: 'date' }],
    defaults: (c) => ({ new_rent: num(c.rent, 0), effective: addMonths(c.today, 2) }),
    build(c, p) {
      return {
        title: 'NOTICE OF RENT REVIEW',
        body: `${head(c)}\n\n# RE: RENT REVIEW, UNIT ${c.unit}\n\nWe write to inform you that the monthly rent for the above unit will change from ${kes(c.rent)} to ${kes(p.new_rent)} with effect from ${long(p.effective)}.\n\nAll other terms of your tenancy stay the same. The new rent will be due on the same day each month, starting with the first rent payment after the date above.\n\nIf you have any questions or concerns, please contact us. Please check your tenancy agreement for any notice or review terms that apply.\n\n${sign(c)}`,
      };
    },
  },

  entry_notice: {
    label: 'Notice of inspection / entry',
    description: 'Advance notice that the landlord or caretaker will visit the unit.',
    fields: [{ key: 'visit_on', label: 'Visit date', type: 'date' }, { key: 'time', label: 'Time', type: 'text' }, { key: 'purpose', label: 'Purpose', type: 'text' }],
    defaults: (c) => ({ visit_on: addDays(c.today, 3), time: '10:00 am', purpose: 'a routine inspection of the unit' }),
    build(c, p) {
      return {
        title: 'NOTICE OF ENTRY',
        body: `${head(c)}\n\n# RE: VISIT TO UNIT ${c.unit}\n\nPlease be informed that we, or a person we authorise, will visit the above unit on ${long(p.visit_on)} at ${p.time} for ${p.purpose}.\n\nWe will try to cause as little disturbance as possible. If the time is not convenient, please let us know as soon as you can so that we can agree on another time.\n\n${sign(c)}`,
      };
    },
  },

  lease: {
    label: 'Residential tenancy agreement',
    description: 'A simple one-unit tenancy agreement with signature blocks.',
    fields: [
      { key: 'start', label: 'Start date', type: 'date' }, { key: 'months', label: 'Term (months)', type: 'number' },
      { key: 'rent', label: 'Monthly rent (KES)', type: 'number' }, { key: 'deposit', label: 'Deposit (KES)', type: 'number' },
      { key: 'due_day', label: 'Rent due day of month', type: 'number' }, { key: 'notice_months', label: 'Notice period (months)', type: 'number' },
    ],
    defaults: (c) => ({ start: iso(c.tenant.move_in_date) || c.today, months: 12, rent: num(c.rent, 0), deposit: num(c.tenant.deposit_paid, 0) || num(c.rent, 0), due_day: num(c.tenant.rent_due_day, 5), notice_months: 1 }),
    build(c, p) {
      const end = addMonths(iso(p.start) || c.today, Math.round(num(p.months, 12)));
      return {
        title: 'TENANCY AGREEMENT',
        body: `This agreement is made on ${long(c.today)} between:\n\nLANDLORD: ${c.landlord_name}${c.landlord_phone ? ' (Tel: ' + c.landlord_phone + ')' : ''}\n\nTENANT: ${c.tenant.full_name}\nID No: ${c.national_id || '____________'}    Tel: ${c.tenant.phone || '____________'}\n\n# 1. The premises\nThe Landlord lets to the Tenant Unit ${c.unit} at ${c.plot_name}${c.plot_location ? ', ' + c.plot_location : ''} (the "Premises") for residential use only.\n\n# 2. Term\nThe tenancy starts on ${long(p.start)} and runs for ${num(p.months, 12)} months, to ${long(end)}, unless ended earlier under clause 8.\n\n# 3. Rent\nThe Tenant shall pay rent of ${kes(p.rent)} per month, in advance, on or before the ${ordinal(num(p.due_day, 5))} day of each month, through the payment channels given by the Landlord.\n\n# 4. Deposit\nThe Tenant has paid or shall pay a deposit of ${kes(p.deposit)}. It is held as security for unpaid rent, unpaid utilities and damage beyond normal wear and tear, and is refunded after the Tenant leaves and the Premises are inspected. The deposit is not to be treated as rent for the last month.\n\n# 5. Utilities\nThe Tenant shall pay for electricity, water and any other utilities used at the Premises, including any share of a shared meter, as billed. These are separate from rent.\n\n# 6. The Tenant agrees to\n(a) use the Premises as a home only;\n(b) keep the Premises clean and in good condition and report faults promptly;\n(c) not sublet, share or part with possession without written consent;\n(d) not cause nuisance or disturbance to neighbours;\n(e) allow the Landlord or caretaker to enter after reasonable notice to inspect or carry out repairs;\n(f) not make alterations without written consent.\n\n# 7. The Landlord agrees to\n(a) allow the Tenant quiet enjoyment of the Premises;\n(b) carry out repairs to the structure and common areas;\n(c) give reasonable notice before entering the Premises.\n\n# 8. Ending the tenancy\nEither party may end this tenancy by giving ${num(p.notice_months, 1)} month(s) written notice. The Tenant shall return the Premises and all keys in good condition, fair wear and tear excepted.\n\n# 9. Late payment\nIf rent is unpaid after the due date, the Landlord may give written notice and take the steps allowed by law.\n\n# 10. Other\nThis agreement is the whole agreement between the parties. Changes must be in writing and signed by both. It is governed by the laws of Kenya.\n\nSigned by the parties:\n\n\nLANDLORD: ______________________    Date: ____________\n${c.landlord_name}\n\n\nTENANT: ______________________    Date: ____________\n${c.tenant.full_name}\n\n\nWITNESS: ______________________    Name: ____________`,
      };
    },
  },
};

function list() { return Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, description: t.description, fields: t.fields })); }

// Parses submitted field values using the template's declared types so nothing odd gets into the text.
function cleanParams(key, raw, ctx) {
  const t = TEMPLATES[key]; const def = t.defaults(ctx); const out = {};
  for (const f of t.fields) {
    const v = raw?.[f.key];
    if (v == null || v === '') out[f.key] = def[f.key];
    else if (f.type === 'number') out[f.key] = num(v, def[f.key]);
    else if (f.type === 'date') out[f.key] = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : def[f.key];
    else out[f.key] = str(v, def[f.key]);
  }
  return out;
}

module.exports = { TEMPLATES, list, cleanParams, today };
