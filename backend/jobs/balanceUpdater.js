const cron = require('node-cron');
const pool = require('../database/db');

// ── Daily balance updater — runs at midnight every day ────────────────────────
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily balance updater...');
  try {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;

    // Find all active tenants whose rent is due today (1st of month)
    if (now.getDate() !== 1) return;

    const tenants = await pool.query(
      `SELECT t.id, t.full_name, t.phone, h.rent_amount, h.unit_number, p.name AS plot_name
       FROM tenants t
       LEFT JOIN houses h ON t.house_id = h.id
       LEFT JOIN plots  p ON h.plot_id  = p.id
       WHERE t.is_active = true AND h.rent_amount IS NOT NULL`
    );

    console.log(`Processing ${tenants.rows.length} tenants for ${month}/${year}`);
  } catch (err) {
    console.error('Balance updater error:', err.message);
  }
});

// ── Monthly SMS reminders — runs at 8AM on the 1st of every month ─────────────
cron.schedule('0 8 1 * *', async () => {
  console.log('Sending monthly rent reminders...');
  try {
    const { sendSMS } = require('./routes/sms');

    const now = new Date();

    const tenants = await pool.query(
      `SELECT t.id, t.full_name, t.phone, t.move_in_date,
              h.rent_amount, h.unit_number, p.name AS plot_name
       FROM tenants t
       LEFT JOIN houses h ON t.house_id = h.id
       LEFT JOIN plots  p ON h.plot_id  = p.id
       WHERE t.is_active = true AND t.move_in_date IS NOT NULL AND t.phone IS NOT NULL`
    );

    const payments = await pool.query(
      `SELECT tenant_id,
              COALESCE(for_year,  EXTRACT(YEAR  FROM payment_date)::int) AS year,
              COALESCE(for_month, EXTRACT(MONTH FROM payment_date)::int) AS month,
              COALESCE(SUM(amount_allocated), SUM(amount)) AS total_paid
       FROM payments WHERE status != 'pending'
       GROUP BY tenant_id, year, month`
    );

    const paidMap = {};
    for (const p of payments.rows) {
      paidMap[`${p.tenant_id}-${p.year}-${p.month}`] = parseFloat(p.total_paid);
    }

    let sent = 0;
    for (const tenant of tenants.rows) {
      if (!tenant.phone) continue;

      const moveIn = new Date(tenant.move_in_date);
      let y = moveIn.getFullYear(); // billing starts in the move-in month itself (full month, no skipping)
      let m = moveIn.getMonth() + 1;

      const unpaidMonths = [];
      while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        const paid    = paidMap[`${tenant.id}-${y}-${m}`] || 0;
        const balance = parseFloat(tenant.rent_amount) - paid;
        if (balance > 0) unpaidMonths.push({ label: new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' }), balance });
        m++; if (m > 12) { m = 1; y++; }
      }

      if (unpaidMonths.length === 0) continue;

      const totalOwed  = unpaidMonths.reduce((s, m) => s + m.balance, 0);
      const monthsList = unpaidMonths.map(m => `${m.label} (KES ${m.balance.toLocaleString()})`).join(', ');
      const message    = `Dear ${tenant.full_name}, rent of KES ${totalOwed.toLocaleString()} is due for: ${monthsList}. Unit ${tenant.unit_number}, ${tenant.plot_name}. Pay via M-Pesa or visit your tenant portal. - RentFlow`;

      try {
        await sendSMS(tenant.phone, message);
        sent++;
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.error(`Reminder failed for ${tenant.full_name}:`, e.message);
      }
    }
    console.log(`✅ Sent ${sent} rent reminders.`);
  } catch (err) {
    console.error('SMS reminder cron error:', err.message);
  }
});

console.log('✅ Cron jobs scheduled: balance updater + SMS reminders');

// ── Monthly emailed Unpaid Rent report — runs 9AM on the 1st of every month ───
// Reuses the same "months since move-in vs paid" logic as the SMS reminder job
// above and tenants.js's /unpaid-months route, but emails a summary table to
// every admin instead of texting tenants.
cron.schedule('0 9 1 * *', async () => {
  console.log('Building and emailing monthly Unpaid Rent report...');
  try {
    const nodemailer = require('nodemailer');
    function getMailer() {
      return nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });
    }

    const tenants = await pool.query(
      `SELECT t.id, t.full_name, t.phone, t.move_in_date,
              h.rent_amount, h.unit_number, p.name AS plot_name
       FROM tenants t
       LEFT JOIN houses h ON t.house_id = h.id
       LEFT JOIN plots  p ON h.plot_id  = p.id
       WHERE t.is_active = true AND t.move_in_date IS NOT NULL`
    );
    const payments = await pool.query(
      `SELECT tenant_id,
              COALESCE(for_year,  EXTRACT(YEAR  FROM payment_date)::int) AS year,
              COALESCE(for_month, EXTRACT(MONTH FROM payment_date)::int) AS month,
              COALESCE(SUM(amount_allocated), SUM(amount)) AS total_paid
       FROM payments WHERE status != 'pending'
       GROUP BY tenant_id, year, month`
    );
    const paidMap = {};
    for (const p of payments.rows) paidMap[`${p.tenant_id}-${p.year}-${p.month}`] = parseFloat(p.total_paid);

    const now = new Date();
    const rows = [];
    for (const tenant of tenants.rows) {
      const moveIn = new Date(tenant.move_in_date);
      let y = moveIn.getFullYear(); // billing starts in the move-in month itself (full month, no skipping)
      let m = moveIn.getMonth() + 1;
      let owed = 0;
      while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        owed += Math.max(0, parseFloat(tenant.rent_amount) - (paidMap[`${tenant.id}-${y}-${m}`] || 0));
        m++; if (m > 12) { m = 1; y++; }
      }
      if (owed > 0) rows.push({ ...tenant, owed });
    }

    if (rows.length === 0) {
      console.log('No unpaid rent this run — skipping email.');
      return;
    }

    const total = rows.reduce((s, r) => s + r.owed, 0);
    const tableRows = rows
      .sort((a, b) => b.owed - a.owed)
      .map(r => `<tr><td>${r.full_name}</td><td>Unit ${r.unit_number || '—'}, ${r.plot_name || '—'}</td><td style="text-align:right">KES ${r.owed.toLocaleString()}</td></tr>`)
      .join('');

    const html = `
      <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
        <h2 style="color:#4f46e5;">Monthly Unpaid Rent Report — ${now.toLocaleString('en-KE', { month: 'long', year: 'numeric' })}</h2>
        <p>${rows.length} tenant(s) owing a total of <strong>KES ${total.toLocaleString()}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:8px;">Tenant</th><th style="padding:8px;">Unit</th><th style="padding:8px;text-align:right;">Owed (KES)</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        <p style="color:#9ca3af;font-size:12px;margin-top:20px;">RentFlow · Automated monthly report</p>
      </div>`;

    const admins = await pool.query(`SELECT id, email FROM users WHERE role = 'admin' AND email IS NOT NULL`);
    if (admins.rows.length === 0) { console.log('No admin email on file — skipping.'); return; }

    const mailer = getMailer();
    await mailer.sendMail({
      from:    `"RentFlow Reports" <${process.env.EMAIL_USER}>`,
      to:      admins.rows.map(a => a.email).join(','),
      subject: `RentFlow — Unpaid Rent Report (${now.toLocaleString('en-KE', { month: 'long', year: 'numeric' })})`,
      html,
    });
    console.log(`✅ Emailed Unpaid Rent report to ${admins.rows.length} admin(s).`);

    // Also drop an in-app alert in Notices, so admins see it without checking
    // email. Uses target_type='all' since notices has no admin-only target
    // type in its current schema — every admin already sees every notice
    // regardless of target_type (see notices.js's GET / query), so this is
    // functionally admin-visible; it will also be visible to landlords and
    // caretakers though, unlike the email. If you'd rather it be admin-only,
    // that needs a small notices.js change to add and filter on a new
    // target_type value (e.g. 'admin').
    try {
      await pool.query(
        `INSERT INTO notices (author_id, title, body, priority, target_type)
         VALUES ($1, $2, $3, 'info', 'all')`,
        [
          admins.rows[0].id,
          `Monthly Unpaid Rent Report — ${now.toLocaleString('en-KE', { month: 'long', year: 'numeric' })}`,
          `${rows.length} tenant(s) owing a total of KES ${total.toLocaleString()}. Full report emailed to admin inbox.`,
        ]
      );
    } catch (e) {
      console.error('Notice creation failed (non-fatal):', e.message);
    }
  } catch (err) {
    console.error('Monthly report email error:', err.message);
  }
});
