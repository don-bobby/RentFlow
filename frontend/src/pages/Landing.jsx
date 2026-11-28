import React, { useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import './Landing.css';

/* ---- Edit these, nothing else needs to change ---- */

// Paths as they exist in app.jsx.
const ROUTES = {
  login: '/login',
  register: '/register',
  tenantLogin: '/tenant/login',
  listings: '/listings',
};

// DEVELOPER NOTE: these contact details are placeholders and will be changed later.
// (This note is only in the code. It does not appear on the page.)
const CONTACT = {
  whatsapp: '254722659555', // international format, no + or leading 0
  email: 'cfcbobby@tutamail.com',
};

// Skyline photo from frontend/public/lgn.jpg. Set here (not in the CSS) so webpack does not try to bundle it.
const PHOTO = `${process.env.PUBLIC_URL || ''}/lgn.jpg`;
const heroStyle = { backgroundImage: `linear-gradient(105deg, rgba(7,45,31,.93) 25%, rgba(7,45,31,.6)), url(${PHOTO})`, backgroundSize: 'cover', backgroundPosition: 'center' };
const tenantsStyle = { backgroundImage: `linear-gradient(rgba(7,45,31,.82), rgba(7,45,31,.9)), url(${PHOTO})`, backgroundSize: 'cover', backgroundPosition: 'center' };

/* ---- Content ---- */

const FEATURES = [
  ['Rent and deposits, kept straight', 'Payments settle arrears first, then any outstanding deposit, then count as rent paid in advance. Deposits have their own ledger, with printable receipts.'],
  ['Access you control', 'A live permissions matrix decides what each role can do, with per-user and per-property overrides. Changes apply on the next click.'],
  ['M-Pesa and SMS ready', 'Built around Kenyan payments: STK push, automatic matching by phone, and SMS reminders for rent and PIN resets.'],
  ['Maintenance and vendors', 'Tenants log requests, caretakers update them, and you assign a vendor and see what each one costs you.'],
  ['Reports, tax and notices', '30 reports with CSV export, a KRA MRI tax helper, and ready templates for arrears, rent increase and vacate notices.'],
  ['Works on weak signal', 'Record payments and maintenance offline and they upload later, safely, without duplicates. Android apps included.'],
  ['Public listings with photos', 'Vacant units go online with photos, rent and the right contact person, so you can fill vacancies without extra posting.'],
  ['A clear audit trail', 'Payments, deletions, maintenance changes and property edits are logged with who did it and what changed.'],
];

const ROLES = [
  ['Landlords', 'Run your own properties directly, or hand day-to-day work to an agent and keep a clear view-only dashboard.'],
  ['Agents', "Manage several landlords' properties, tenants, payments and caretakers, each kept separate."],
  ['Caretakers', 'Handle tenants and maintenance on your assigned plots, and post notices scoped to that property only.'],
  ['Tenants', 'A simple portal to check balance, pay rent, report problems and message the people who manage your unit.'],
];

const CHECKS = [
  'Rent and deposits tracked on separate ledgers',
  'Caretakers and agents see only the properties assigned to them',
  'A tenant portal for balances, payments and maintenance requests',
  'Reports, KRA MRI tax helper and printable notices',
];

function Tick() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0e5a3c" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Chip({ kind, children }) {
  return <span className={`lp-chip ${kind}`}>{children}</span>;
}

function Phone({ className, tabs, active, children }) {
  return (
    <div className={`lp-phone ${className}`}>
      <div className="lp-screen">
        <i className="lp-island" />
        <div className="lp-status"><span>9:41</span><span className="lp-sig" /></div>
        <div className="lp-body">{children}</div>
        <div className="lp-tabs">
          {tabs.map((t) => <span key={t} className={t === active ? 'on' : ''}><b />{t}</span>)}
        </div>
      </div>
    </div>
  );
}

// Sample data for illustration only.
function TenantScreen() {
  return (
    <Phone className="front" tabs={['Home', 'Payments', 'Messages', 'Profile']} active="Home">
      <div><p className="lp-hi">Hi, Mary</p><p className="lp-sub">Unit B4, Riverside Court</p></div>
      <div className="lp-bal"><small>Balance due</small><strong>KES 18,500</strong><small>Due 5 Dec</small><div className="lp-pay">Pay now</div></div>
      <div className="lp-sech">Recent payments</div>
      <div className="lp-r2"><div><b>Rent, Oct</b><span>KES 18,500</span></div><Chip kind="ok">Paid</Chip></div>
      <div className="lp-r2"><div><b>Water, Oct</b><span>KES 600</span></div><Chip kind="ok">Paid</Chip></div>
      <div className="lp-r2"><div><b>Rent, Sep</b><span>KES 18,500</span></div><Chip kind="ok">Paid</Chip></div>
    </Phone>
  );
}

function StaffScreen() {
  return (
    <Phone className="back" tabs={['Home', 'Units', 'Payments', 'More']} active="Home">
      <div><p className="lp-hi">Dashboard</p><p className="lp-sub">All properties</p></div>
      <div className="lp-tiles">
        <div className="lp-tile"><strong>12</strong><small>Occupied</small></div>
        <div className="lp-tile"><strong>3</strong><small>Vacant</small></div>
      </div>
      <div className="lp-sech">Units</div>
      <div className="lp-r2"><div><b>A1</b><span>Rent, Nov</span></div><Chip kind="ok">Paid</Chip></div>
      <div className="lp-r2"><div><b>A2</b><span>Rent, Nov</span></div><Chip kind="bad">Overdue</Chip></div>
      <div className="lp-r2"><div><b>A3</b><span>No tenant</span></div><Chip kind="warn">Vacant</Chip></div>
    </Phone>
  );
}

export default function Landing() {
  // Load the brand fonts in parallel with the page (replaces the render-blocking CSS @import).
  useEffect(() => {
    if (document.getElementById('rentflow-fonts')) return;
    const link = document.createElement('link');
    link.id = 'rentflow-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=DM+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  // The Android shell loads the site root. Skip marketing and go straight to login there.
  const isNativeApp = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
  if (isNativeApp) return <Navigate to={ROUTES.login} replace />;

  return (
    <div className="lp">
      <header className="lp-top">
        <Link to="/" className="lp-brand">RentFlow</Link>
        <nav aria-label="Main">
          <a className="lp-nl" href="#features">Features</a>
          <a className="lp-nl" href="#roles">Who it's for</a>
          <Link className="lp-vu" to={ROUTES.listings}>Vacant units</Link>
          <Link className="lp-tl" to={ROUTES.tenantLogin}>Tenant login</Link>
          <Link className="lp-btn lp-dark" to={ROUTES.login}>Staff login</Link>
        </nav>
      </header>

      <section className="lp-hero" style={heroStyle}>
        <div className="lp-in lp-hero-in">
          <div className="lp-hero-copy">
            <span className="lp-tag">Rental management, built for Kenya</span>
            <h1>Run every rental from <span>one dashboard.</span></h1>
            <p className="lp-lead">Rent, deposits, maintenance and tenant messages in one place. Give landlords, agents, caretakers and tenants exactly the access they need, and nothing more.</p>
            <div className="lp-row">
              <Link to={ROUTES.register} className="lp-btn lp-sunbtn">Register as a landlord</Link>
              <Link to={ROUTES.listings} className="lp-btn lp-ghost">Browse vacant units</Link>
            </div>
            <p className="lp-hero-note">Tenant? <Link to={ROUTES.tenantLogin}>Log in with your National ID and PIN</Link></p>
          </div>
          <div className="lp-phone-wrap" aria-hidden="true">
            <div className="lp-phones">
              <div className="lp-plat" />
              <StaffScreen />
              <TenantScreen />
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="lp-white-band">
        <div className="lp-in lp-sec lp-stack">
          <div className="lp-head"><span className="lp-tag">Features</span><h2 className="lp-h2">Everything the job needs, nothing scattered across chats.</h2></div>
          <div className="lp-grid">
            {FEATURES.map(([title, text]) => (
              <div className="lp-card" key={title}><h3>{title}</h3><p>{text}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section id="roles" className="lp-in lp-sec lp-stack">
        <div className="lp-head"><span className="lp-tag">Who it's for</span><h2 className="lp-h2">One system, four ways to use it.</h2></div>
        <div className="lp-grid">
          {ROLES.map(([title, text]) => (
            <div className="lp-card" key={title}><h3>{title}</h3><p>{text}</p></div>
          ))}
        </div>
      </section>

      <section id="managers" className="lp-in" style={{ paddingBottom: 20 }}>
        <div className="lp-banner lp-managers">
          <div className="lp-bcopy">
            <span className="lp-tag">For landlords and agents</span>
            <h2>Looking for a property management system?</h2>
            <p>Collect rent, track deposits, handle maintenance and keep every tenant record in one place. Agents can manage several landlords side by side.</p>
            <div className="lp-row" style={{ marginTop: 4 }}>
              <Link to={ROUTES.register} className="lp-btn lp-green">Register as a landlord</Link>
              <Link to={ROUTES.login} className="lp-btn lp-line">Agent or staff sign in</Link>
            </div>
            <p className="lp-small">New landlord accounts are reviewed and approved before access.</p>
            <div className="lp-contact">
              <strong>Running an agency, or want help getting started?</strong>
              <div className="lp-clinks">
                <a className="lp-link" href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noopener noreferrer">Book a demo on WhatsApp &rarr;</a>
                <a className="lp-link" href={`mailto:${CONTACT.email}?subject=RentFlow%20demo`}>Email us &rarr;</a>
              </div>
            </div>
          </div>
          <div className="lp-checks">
            {CHECKS.map((text) => (
              <div className="lp-check" key={text}><Tick /><span>{text}</span></div>
            ))}
          </div>
        </div>
      </section>

      <section id="tenants" className="lp-in" style={{ paddingBottom: 72 }}>
        <div className="lp-banner lp-tenants" style={tenantsStyle}>
          <div className="lp-bcopy">
            <h2>Looking for a place to rent?</h2>
            <p>Browse vacant units with real photos and real rent from landlords on RentFlow. No account needed.</p>
          </div>
          <div className="lp-row">
            <Link to={ROUTES.listings} className="lp-btn lp-white">Browse vacant units</Link>
            <Link to={ROUTES.tenantLogin} className="lp-btn lp-ghost">Tenant login</Link>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <span>RentFlow · Rental management for Kenya</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
          <Link to={ROUTES.tenantLogin}>Tenant login</Link>
          <Link to={ROUTES.login}>Staff login</Link>
          <Link to={ROUTES.register}>Own property? List with us</Link>
        </span>
      </footer>
    </div>
  );
}
