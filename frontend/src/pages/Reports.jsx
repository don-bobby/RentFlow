import { useState, useEffect, useRef } from 'react';
import { exportReportPdf } from '../utils/pdfReport';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';

// ── Report definitions ────────────────────────────────────────────────────────
// `permission` is the reports.* string this report is gated by (matches a
// row in role_permissions / user_permission_overrides, same as every other
// permission in the system) — only set on the 10 report types that actually
// have one today. A report with no `permission` field is left exactly as it
// was before this change: visible to anyone who can open the Reports page
// (`adminAgentOnly` is the one existing exception to that, for 'assignments').
const REPORTS = [
  { id: 'payments',       icon: '💳', label: 'Payment Collection',    desc: 'All rent payments received',           color: 'var(--green)',   light: 'var(--green-light)',   permission: 'reports.payment_collection' },
  { id: 'paymenthistory', icon: '🧾', label: 'Payment History',       desc: 'One tenant\'s full rent + deposit timeline', color: 'var(--primary)', light: 'var(--primary-light)', permission: 'reports.payment_collection' },
  { id: 'unpaid',         icon: '⚠️', label: 'Unpaid Rent',           desc: 'Outstanding balances, with aging',     color: 'var(--red)',     light: 'var(--red-light)',     permission: 'reports.unpaid_rent' },
  { id: 'tenants',        icon: '👥', label: 'Tenant List',           desc: 'All active and inactive tenants',      color: 'var(--primary)', light: 'var(--primary-light)', permission: 'reports.tenant_list' },
  { id: 'arrearsrisk',    icon: '🚨', label: 'Arrears Aging & Risk',  desc: 'Who owes, how long, and who is likely to fall behind', color: 'var(--red)', light: 'var(--red-light)', permission: 'reports.unpaid_rent' },
  { id: 'maintperf',      icon: '🛠️', label: 'Maintenance Performance', desc: 'Resolution time, cost and repeat issues per property', color: 'var(--amber)', light: 'var(--amber-light)', permission: 'reports.maintenance' },
  { id: 'maintenance',    icon: '🔧', label: 'Maintenance Records',   desc: 'All maintenance requests by status',   color: 'var(--amber)',   light: 'var(--amber-light)',   permission: 'reports.maintenance' },
  { id: 'properties',     icon: '🏢', label: 'Property Summary',      desc: 'Plots, units, occupancy overview',     color: 'var(--blue)',    light: 'var(--blue-light)',    permission: 'reports.property_summary' },
  { id: 'occupancy',      icon: '📊', label: 'Occupancy Report',      desc: 'Vacant vs occupied units over time',   color: '#8b5cf6',       light: '#ede9fe',              permission: 'reports.occupancy' },
  { id: 'expenses',       icon: '💸', label: 'Expenses Report',       desc: 'All property expenses by category',   color: '#f97316',       light: '#fff7ed',              permission: 'reports.expenses' },
  { id: 'utilities',      icon: '💧', label: 'Utility Receipts',      desc: 'Utility money recovered from tenants vs bills paid', color: 'var(--blue)', light: 'var(--blue-light)', permission: 'reports.expenses' },
  { id: 'revenue',        icon: '📈', label: 'Revenue Summary',       desc: 'Monthly and yearly revenue totals',    color: 'var(--green)',   light: 'var(--green-light)',   permission: 'reports.revenue_summary' },
  { id: 'moveins',        icon: '🏠', label: 'Move-in / Move-out',    desc: 'Tenant movement history',              color: 'var(--primary)', light: 'var(--primary-light)', permission: 'reports.move_in_out' },
  { id: 'expiring',       icon: '📅', label: 'Expiring Leases',       desc: 'Tenants with leases 11+ months old',   color: 'var(--amber)',   light: 'var(--amber-light)',   permission: 'reports.expiring_leases' },
  { id: 'rentroll',       icon: '📋', label: 'Rent Roll',             desc: 'Snapshot of every occupied unit',      color: 'var(--blue)',    light: 'var(--blue-light)'    },
  { id: 'paymentmethods', icon: '🏦', label: 'Payment Methods',       desc: 'Collections by mpesa / bank / cash',   color: '#8b5cf6',        light: '#ede9fe'              },
  { id: 'performance',    icon: '🏆', label: 'Property Performance', desc: 'Plots ranked by occupancy & revenue',  color: 'var(--blue)',    light: 'var(--blue-light)'    },
  { id: 'assignments',    icon: '🗂️', label: 'Property Assignments',  desc: 'Which landlord, agent and caretaker runs each property', color: 'var(--primary)', light: 'var(--primary-light)', adminAgentOnly: true },
  { id: 'tenure',         icon: '⏳', label: 'Tenant Tenure',         desc: 'How long each active tenant has stayed', color: 'var(--primary)', light: 'var(--primary-light)' },
  { id: 'caretakerload',  icon: '🧑‍🔧', label: 'Caretaker Workload',   desc: 'Maintenance requests per caretaker',   color: 'var(--amber)',   light: 'var(--amber-light)'   },
  { id: 'comparison',     icon: '🔁', label: 'Period Comparison',     desc: 'This month vs last, or year vs year',  color: 'var(--green)',   light: 'var(--green-light)'   },
  { id: 'depositledger',  icon: '🔐', label: 'Deposit Ledger',        desc: 'Deposits collected, refunded, forfeited', color: 'var(--blue)',  light: 'var(--blue-light)'    },
  { id: 'profitloss',    icon: '💹', label: 'Profit & Loss by Plot',  desc: 'Income vs expenses and net per plot',    color: 'var(--green)'   },
  { id: 'collection',    icon: '🎯', label: 'Collection Efficiency',  desc: 'Rent expected vs collected, by month',   color: 'var(--blue)'    },
  { id: 'agentscore',    icon: '🧑‍💼', label: 'Agent Scorecard',        desc: 'Plots, occupancy and collections per agent', color: 'var(--primary)' },
  { id: 'vacancyloss',   icon: '🕳️', label: 'Vacancy Loss',           desc: 'Rent lost to empty units',               color: 'var(--red)'     },
  { id: 'dataquality',   icon: '🧹', label: 'Data Quality Exceptions', desc: 'Missing or conflicting records to fix', color: 'var(--amber)'   },
  { id: 'audittrail',     icon: '🕵️', label: 'Audit Trail',           desc: 'Who changed what, and when (admin only)', color: '#8b5cf6',      light: '#ede9fe'              },
  { id: 'useractivity',   icon: '🕓', label: 'User Activity',         desc: 'Logins and activity across tenants and staff (admin only)', color: 'var(--primary)', light: 'var(--primary-light)' },
];

function getThisYear()  { return new Date().getFullYear(); }
function getThisMonth() { return new Date().getMonth() + 1; }

// Reports that don't use the period/month selectors at all — they're either
// current-state snapshots (rentroll, performance, tenure) or have their own
// dedicated month/year controls (comparison).
const NO_PERIOD_FILTER = ['properties', 'occupancy', 'expiring', 'revenue', 'rentroll', 'performance', 'tenure', 'comparison', 'depositledger', 'audittrail', 'useractivity', 'collection', 'agentscore', 'vacancyloss', 'dataquality', 'paymenthistory', 'arrearsrisk', 'assignments'];

function daysBetween(a, b) { return Math.floor((a - b) / (1000 * 60 * 60 * 24)); }

function agingBucket(days) {
  if (days <= 30) return '0–30 days';
  if (days <= 60) return '31–60 days';
  if (days <= 90) return '61–90 days';
  return '90+ days';
}

function pctChange(current, previous) {
  if (!previous) return current > 0 ? '+100%' : '0%';
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// Turns a formatted cell value ("KES 12,000", "Jan 2026", "Alice") into
// something comparable for sorting — numeric where possible, else lowercase text.
function sortableValue(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  const numeric = s.replace(/[^0-9.\-]/g, '');
  if (numeric && /\d/.test(numeric) && !/[a-zA-Z]{2,}/.test(s.replace(/KES|%/g, ''))) {
    const n = parseFloat(numeric);
    if (!isNaN(n)) return n;
  }
  return s.toLowerCase();
}

// Small dependency-free bar chart — used for the Revenue trend and the
// Period Comparison view. Avoids pulling in a charting library.
function MiniBarChart({ data, color = 'var(--primary, #7c3aed)' }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90, marginBottom: 4 }}>
      {data.map((d, i) => (
        <div key={i} title={`${d.label}: ${d.value.toLocaleString()}`}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ width: '100%', maxWidth: 36, background: color, borderRadius: '4px 4px 0 0', height: `${Math.max(3, (d.value / max) * 70)}px` }} />
          <div style={{ fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}


// ── Theme-safe colours ───────────────────────────────────────────────────────
// The report definitions and summary cards use theme variables (--green,
// --blue, ...) that vanish or turn dark on a dark background. `tone` maps them
// to scoped, theme-aware colours; `soft` makes a translucent tint of any colour.
const TONES = {
  'var(--green)': 'var(--rp-green)', 'var(--red)': 'var(--rp-red)', 'var(--blue)': 'var(--rp-blue)',
  'var(--amber)': 'var(--rp-amber)', 'var(--primary)': 'var(--rp-primary)', 'var(--muted)': 'var(--rp-muted)',
};
const tone = (c) => TONES[c] || c;
const soft = (c, pct = 16) => `color-mix(in srgb, ${tone(c)} ${pct}%, transparent)`;

const statusKind = (v) =>
  ['Active', 'matched', 'completed', 'Paid Up'].includes(v) ? 'green' :
  ['Inactive', 'Moved Out', 'Owing', 'High'].includes(v) ? 'red' :
  ['Low'].includes(v) ? 'blue' : 'amber';

// Money columns that represent a cost/shortfall are shown in red.
const isNegativeCol = (c) => /Arrears|Loss|Expenses|Gap/.test(c);

const STYLES = `
.rp-page {
  --rp-text: var(--text, #0f172a);
  --rp-muted: var(--muted, #64748b);
  --rp-surface: var(--surface, #ffffff);
  --rp-surface2: var(--surface2, #f1f5f9);
  --rp-border: var(--border, #e2e8f0);
  --rp-accent: var(--primary, #7c3aed);
  --rp-primary: #7c3aed; --rp-green: #15803d; --rp-red: #dc2626; --rp-blue: #2563eb; --rp-amber: #b45309;
  --rp-shadow: 0 1px 2px rgba(15,23,42,.04), 0 6px 20px rgba(15,23,42,.06);
  color: var(--rp-text);
}
:root[data-theme="dark"] .rp-page {
  --rp-text: var(--text, #e8eaf6);
  --rp-muted: var(--muted, #8b91b0);
  --rp-surface: var(--surface, #1a1d27);
  --rp-surface2: var(--surface2, #21253a);
  --rp-border: var(--border, #2a2f45);
  --rp-primary: #a78bfa; --rp-green: #4ade80; --rp-red: #f87171; --rp-blue: #60a5fa; --rp-amber: #fbbf24;
  --rp-shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
}
.rp-page * { box-sizing: border-box; }
.rp-page button { font-family: inherit; cursor: pointer; }
.rp-page button:focus-visible, .rp-page select:focus-visible, .rp-page input:focus-visible { outline: 2px solid var(--rp-accent); outline-offset: 2px; }

.rp-head { margin-bottom: 22px; }
.rp-title { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 4px; color: var(--rp-text); }
.rp-sub { margin: 0; font-size: 14px; color: var(--rp-muted); }

.rp-layout { display: flex; gap: 20px; align-items: flex-start; }
.rp-main { flex: 1; min-width: 0; }
.rp-card { background: var(--rp-surface); border: 1px solid var(--rp-border); border-radius: 16px; box-shadow: var(--rp-shadow); }

/* Report picker */
.rp-list { width: 248px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; padding: 10px;
  position: sticky; top: 76px; max-height: calc(100vh - 100px); overflow-y: auto;
  background: var(--rp-surface); border: 1px solid var(--rp-border); border-radius: 16px; box-shadow: var(--rp-shadow); }
.rp-group { font-size: 12px; font-weight: 600; color: var(--rp-muted); padding: 6px 8px 2px; }
.rp-sep { height: 1px; background: var(--rp-border); margin: 6px 4px; }
.rp-item { position: relative; display: flex; align-items: center; border-radius: 12px; border: 1px solid transparent; transition: background .15s, border-color .15s; }
.rp-item:hover { background: var(--rp-surface2); }
.rp-item.on { background: var(--rp-tint); border-color: var(--rp-tone); }
.rp-item-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 8px 6px 8px 8px; border: none; background: transparent; color: var(--rp-text); text-align: left; }
.rp-ico { flex: none; width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 16px; background: var(--rp-tint); }
.rp-item-text { min-width: 0; }
.rp-item-label { font-size: 13px; font-weight: 600; color: var(--rp-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-item-desc { font-size: 11px; color: var(--rp-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.rp-star { flex: none; width: 30px; height: 30px; margin-right: 4px; border: none; background: transparent; border-radius: 8px; font-size: 15px; color: var(--rp-muted); opacity: 0; transition: opacity .15s; }
.rp-item:hover .rp-star, .rp-item:focus-within .rp-star, .rp-star.pinned { opacity: 1; }
.rp-star.pinned { color: var(--rp-amber); }
@media (hover: none) { .rp-star { opacity: 1; } }

/* Report header */
.rp-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; padding: 16px 20px; margin-bottom: 16px; }
.rp-top-title { display: flex; align-items: center; gap: 12px; min-width: 0; }
.rp-chip { flex: none; width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; background: var(--rp-tint); }
.rp-h2 { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 18px; color: var(--rp-text); }
.rp-desc { font-size: 12.5px; color: var(--rp-muted); margin-top: 2px; }
.rp-controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.rp-select { padding: 8px 12px; height: 38px; border-radius: 10px; border: 1px solid var(--rp-border); background: var(--rp-surface2); font-size: 13px; font-weight: 500; color: var(--rp-text); outline: none; cursor: pointer; }
.rp-to { color: var(--rp-muted); font-size: 13px; }
.rp-btn { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--rp-border); background: var(--rp-surface); color: var(--rp-text); font-weight: 600; font-size: 13px; transition: background .15s; }
.rp-btn:hover:not(:disabled) { background: var(--rp-surface2); }
.rp-btn-primary { border-color: transparent; background: var(--rp-accent); color: #fff; }
.rp-btn-primary:hover:not(:disabled) { background: var(--rp-accent); filter: brightness(1.08); }
.rp-btn:disabled { opacity: .55; cursor: default; }

/* Expandable search */
.rp-search { display: flex; align-items: center; height: 38px; width: 38px; flex: none; overflow: hidden; border-radius: 10px; border: 1px solid var(--rp-border); background: var(--rp-surface); transition: width .2s ease, border-color .15s; }
.rp-search.open { width: 240px; max-width: 100%; border-color: var(--rp-accent); }
.rp-search button { flex: none; width: 36px; height: 36px; border: none; background: transparent; font-size: 15px; color: var(--rp-muted); }
.rp-search input { flex: 1; min-width: 0; border: none; background: transparent; outline: none; color: var(--rp-text); font-size: 13px; padding-right: 8px; }
.rp-search input::placeholder { color: var(--rp-muted); }

/* Summary cards */
.rp-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.rp-kpi { position: relative; overflow: hidden; padding: 14px 18px 14px 20px; }
.rp-kpi::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--rp-tone); }
.rp-kpi-label { font-size: 12.5px; color: var(--rp-muted); margin-bottom: 4px; }
.rp-kpi-value { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 22px; line-height: 1.2; color: var(--rp-tone); word-break: break-word; }

.rp-chart { padding: 16px 20px; margin-bottom: 16px; }
.rp-chart-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.rp-chart-title { font-size: 13px; font-weight: 600; color: var(--rp-text); }
.rp-legend { display: flex; gap: 14px; font-size: 12px; color: var(--rp-muted); }
.rp-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.rp-hbars { display: flex; flex-direction: column; gap: 10px; }
.rp-hrow { display: grid; grid-template-columns: 140px 1fr; gap: 12px; align-items: center; }
.rp-hlabel { font-size: 12.5px; color: var(--rp-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-hlines { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.rp-hline { display: flex; align-items: center; gap: 8px; height: 12px; }
.rp-hbar { height: 10px; border-radius: 5px; transition: width .4s ease; flex: none; max-width: calc(100% - 70px); }
.rp-hval { font-size: 11px; color: var(--rp-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* Audit trail */
.au td { vertical-align: top; }
.rp-table.au tbody tr:nth-child(even) { background: transparent; }
.au-day td { background: var(--rp-surface2); padding: 8px 16px; font-size: 12px; font-weight: 600; color: var(--rp-muted); border-top: 1px solid var(--rp-border); }
.au-time { font-weight: 600; font-variant-numeric: tabular-nums; }
.au-ago { font-size: 11px; color: var(--rp-muted); margin-top: 1px; }
.au-user { display: flex; align-items: center; gap: 8px; font-weight: 500; }
.au-avatar { flex: none; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; background: color-mix(in srgb, var(--rp-accent) 22%, transparent); color: var(--rp-primary); }
.au-rec { display: inline-block; padding: 2px 9px; border-radius: 8px; background: var(--rp-surface2); border: 1px solid var(--rp-border); font-size: 12px; font-weight: 600; }
.au-changes { display: flex; flex-direction: column; gap: 5px; white-space: normal; min-width: 260px; }
.au-change { font-size: 12.5px; line-height: 1.6; }
.au-field { color: var(--rp-muted); margin-right: 8px; }
.au-old, .au-new { display: inline-block; padding: 0 7px; border-radius: 6px; max-width: 220px; vertical-align: bottom; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.au-old { text-decoration: line-through; color: var(--rp-red); background: color-mix(in srgb, var(--rp-red) 12%, transparent); }
.au-new { color: var(--rp-green); background: color-mix(in srgb, var(--rp-green) 13%, transparent); font-weight: 600; }
.au-arrow { margin: 0 5px; color: var(--rp-muted); }
.au-muted { color: var(--rp-muted); }
.au-more { align-self: flex-start; background: none; border: none; padding: 0; color: var(--rp-accent); font-size: 12px; font-weight: 600; }
.rp-chart-note, .rp-note { margin-top: 10px; font-size: 12px; color: var(--rp-muted); }
.rp-note { margin: 0 0 14px; padding: 10px 14px; border-radius: 12px; border: 1px dashed var(--rp-border); }

/* Table */
.rp-table-card { overflow: hidden; }
.rp-scroll { overflow-x: auto; }
.rp-table { width: 100%; border-collapse: collapse; min-width: 600px; }
.rp-table th { padding: 11px 16px; text-align: left; font-size: 12px; font-weight: 600; color: var(--rp-muted); white-space: nowrap; cursor: pointer; user-select: none; background: var(--rp-surface2); }
.rp-table th:hover { color: var(--rp-text); }
.rp-table th.static { cursor: default; }
.rp-table td { padding: 11px 16px; font-size: 13px; color: var(--rp-text); white-space: nowrap; border-top: 1px solid var(--rp-border); }
.rp-table tbody tr:nth-child(even) { background: color-mix(in srgb, var(--rp-surface2) 55%, transparent); }
.rp-table tbody tr:hover { background: color-mix(in srgb, var(--rp-accent) 9%, transparent); }
.rp-money { font-weight: 700; color: var(--rp-green); }
.rp-money.neg { color: var(--rp-red); }
.rp-badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; }
.rp-badge-green { background: color-mix(in srgb, var(--rp-green) 16%, transparent); color: var(--rp-green); }
.rp-badge-red   { background: color-mix(in srgb, var(--rp-red) 16%, transparent);   color: var(--rp-red); }
.rp-badge-blue  { background: color-mix(in srgb, var(--rp-blue) 16%, transparent);  color: var(--rp-blue); }
.rp-badge-amber { background: color-mix(in srgb, var(--rp-amber) 18%, transparent); color: var(--rp-amber); }
.rp-mini { padding: 4px 10px; border-radius: 8px; border: 1px solid var(--rp-border); background: var(--rp-surface2); color: var(--rp-accent); font-size: 12px; font-weight: 600; }
.rp-state { padding: 56px 20px; text-align: center; color: var(--rp-muted); font-size: 14px; }
.rp-state strong { display: block; color: var(--rp-text); font-size: 16px; margin-bottom: 4px; }
.rp-skel { height: 14px; border-radius: 6px; background: var(--rp-surface2); animation: rp-pulse 1.3s ease-in-out infinite; }
@keyframes rp-pulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }
.rp-count { margin-top: 8px; font-size: 12px; color: var(--rp-muted); text-align: right; }

/* Tablet / phone: report picker becomes a swipeable row of chips */
@media (max-width: 900px) {
  .rp-layout { flex-direction: column; gap: 14px; }
  .rp-list { width: 100%; position: static; max-height: none; flex-direction: row; align-items: center; gap: 8px; padding: 8px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
  .rp-list::-webkit-scrollbar { display: none; }
  .rp-group, .rp-sep, .rp-item-desc { display: none; }
  .rp-item { flex: none; border-color: var(--rp-border); }
  .rp-item.on { border-color: var(--rp-tone); }
  .rp-item-main { padding: 6px 8px; }
  .rp-ico { width: 26px; height: 26px; font-size: 14px; border-radius: 8px; }
  .rp-star { display: none; }
  .rp-main { width: 100%; }
}
@media (max-width: 640px) {
  .rp-title { font-size: 24px; }
  .rp-top { padding: 14px; }
  .rp-controls { width: 100%; }
  .rp-btn { flex: 1; justify-content: center; }
  .rp-kpis { grid-template-columns: repeat(2, 1fr); }
  .rp-hrow { grid-template-columns: 96px 1fr; gap: 8px; }
}

@media (prefers-reduced-motion: reduce) { .rp-search, .rp-item, .rp-star, .rp-skel { transition: none; animation: none; } }

/* Printing: always black on white, no shadows, no UI chrome */
@media print {
  .no-print { display: none !important; }
  :root .rp-page, :root[data-theme] .rp-page {
    --rp-text: #111; --rp-muted: #555; --rp-surface: #fff; --rp-surface2: #f3f4f6; --rp-border: #d1d5db;
    --rp-primary: #6d28d9; --rp-green: #15803d; --rp-red: #b91c1c; --rp-blue: #1d4ed8; --rp-amber: #b45309; --rp-shadow: none;
  }
  .rp-layout { display: block; }
  .rp-card { box-shadow: none; }
}
`;

// ── Audit trail helpers ──────────────────────────────────────────────────────
const SENSITIVE_FIELD = /(^|_)(pin|password|passwd|token|secret|hash|otp)(_|$)/i;
const MONEY_FIELD = /amount|balance|rent|price|total|deposit|cost/i;

const prettify = (s) => {
  const t = String(s ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '—';
};

function actionKind(action) {
  const a = String(action || '');
  if (/delet|remov|archiv/i.test(a)) return 'red';
  if (/creat|add|insert|record|register/i.test(a)) return 'green';
  if (/updat|edit|chang|assign|move/i.test(a)) return 'blue';
  return 'amber';
}

// Audit log actions are stored as "entity.verb" (e.g. "plot.update") — fine
// for the backend, but shown raw it reads as code ("Plot.update") instead of
// English. Known codes get an exact, hand-picked phrase; anything else falls
// back to a generic "Verb + Entity" composition rather than the raw code.
const ACTION_LABELS = {
  'plot.create':         'Added plot',
  'plot.update':         'Updated plot',
  'plot.delete':         'Deleted plot',
  'user.approve':        'Approved user',
  'user.reject':         'Suspended user',
  'user.set_agent':      'Changed agent',
  'house.update':        'Updated unit',
  'house.approve':       'Approved unit',
  'house.reject':        'Rejected unit',
  'payment.record':      'Recorded payment',
  'payment.allocate':    'Allocated payment',
  'deposit.collected':   'Collected deposit',
  'tenant.update':       'Updated tenant',
  'permissions.toggle':  'Changed permission',
  'maintenance.status_change': 'Changed maintenance status',
};
const ACTION_VERBS = {
  create: 'Added', add: 'Added', insert: 'Added', register: 'Registered',
  update: 'Updated', edit: 'Updated', change: 'Changed', assign: 'Assigned', move: 'Moved',
  delete: 'Deleted', remove: 'Removed', archive: 'Archived',
  approve: 'Approved', reject: 'Rejected', collected: 'Collected',
  record: 'Recorded', allocate: 'Allocated', toggle: 'Changed',
  set_agent: 'Changed',
};
const ENTITY_LABELS = {
  plot: 'plot', house: 'unit', payment: 'payment', deposit: 'deposit',
  tenant: 'tenant', user: 'user', role_permissions: 'permission', maintenance: 'maintenance request',
};
function actionLabel(action) {
  const a = String(action || '');
  if (ACTION_LABELS[a]) return ACTION_LABELS[a];
  const [entity, verb] = a.split('.');
  if (!verb) return prettify(a);
  const verbLabel   = ACTION_VERBS[verb] || prettify(verb);
  const entityLabel = ENTITY_LABELS[entity] || prettify(entity).toLowerCase();
  return `${verbLabel} ${entityLabel}`;
}

// Labels for the User Activity report's breakdown entries. Tracked action
// types (logins' own subsequent actions) get a fixed, friendly phrase;
// audit_log-sourced entries arrive prefixed "audit:" and reuse the same
// actionLabel() the Audit Trail report already uses, so "updated a tenant"
// reads the same way in both places.
const ACTIVITY_ACTION_LABELS = {
  maintenance_request:         'Submitted maintenance request',
  message_sent:                'Sent a message',
  notice_read:                 'Read a notice',
  statement_viewed:            'Viewed tenant statement',
  report_viewed:               'Opened a report',
  bulk_statements_downloaded:  'Downloaded bulk statements',
};
function activityActionLabel(action) {
  if (action.startsWith('audit:')) return actionLabel(action.slice(6));
  return ACTIVITY_ACTION_LABELS[action] || prettify(action);
}

// Formats one audit value for display. Anything that looks like a secret is masked.
function fmtVal(field, v) {
  if (SENSITIVE_FIELD.test(field)) return '••••••';
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  const str = String(v);
  if (MONEY_FIELD.test(field) && /^-?\d+(\.\d+)?$/.test(str)) return `KES ${Number(str).toLocaleString()}`;
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(str)) { const d = new Date(str); if (!isNaN(d)) return d.toLocaleDateString('en-KE'); }
  return str.length > 48 ? `${str.slice(0, 45)}…` : str;
}

function changesText(changes) {
  if (!changes || typeof changes !== 'object') return '—';
  const parts = Object.entries(changes).map(([f, v]) => {
    const isDiff = v && typeof v === 'object' && ('from' in v || 'to' in v);
    if (!isDiff) return `${prettify(f)}: ${fmtVal(f, v)}`;
    const hasFrom = v.from != null && v.from !== '';
    return hasFrom ? `${prettify(f)}: ${fmtVal(f, v.from)} → ${fmtVal(f, v.to)}` : `${prettify(f)}: ${fmtVal(f, v.to)}`;
  });
  return parts.length ? parts.join('; ') : '—';
}

function timeAgo(d) {
  const sec = Math.floor((Date.now() - d) / 1000);
  if (sec < 60) return 'Just now';
  const m = Math.floor(sec / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
  const days = Math.floor(h / 24); if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return d.toLocaleDateString('en-KE');
}

function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  if (+day === +today) return 'Today';
  if (+day === +yesterday) return 'Yesterday';
  return day.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

function AuditChanges({ changes, expanded, onToggle }) {
  const entries = changes && typeof changes === 'object' ? Object.entries(changes) : [];
  if (!entries.length) return <span className="au-muted">—</span>;
  const shown = expanded ? entries : entries.slice(0, 3);
  return (
    <div className="au-changes">
      {shown.map(([field, v]) => {
        const isDiff = v && typeof v === 'object' && ('from' in v || 'to' in v);
        const hasFrom = isDiff && v.from != null && v.from !== '';
        const hasTo = isDiff ? (v.to != null && v.to !== '') : true;
        const to = isDiff ? v.to : v;
        return (
          <div className="au-change" key={field}>
            <span className="au-field">{prettify(field)}</span>
            {hasFrom && <span className="au-old" title={SENSITIVE_FIELD.test(field) ? undefined : String(v.from)}>{fmtVal(field, v.from)}</span>}
            {hasFrom && hasTo && <span className="au-arrow">→</span>}
            {hasTo ? <span className="au-new" title={SENSITIVE_FIELD.test(field) ? undefined : String(to)}>{fmtVal(field, to)}</span>
                   : (!hasFrom && <span className="au-muted">empty</span>)}
          </div>
        );
      })}
      {entries.length > 3 && (
        <button type="button" className="au-more" onClick={onToggle}>{expanded ? 'Show less' : `+${entries.length - 3} more`}</button>
      )}
    </div>
  );
}

// Activity feed: grouped by day, with a readable before → after view of every change.
function AuditTable({ rows, open, toggle }) {
  let lastDay = '';
  return (
    <div className="rp-scroll">
      <table className="rp-table au">
        <thead>
          <tr>
            {['Time', 'User', 'Action', 'Record', 'Changes'].map(h => <th key={h} className="static">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.flatMap(r => {
            const a = r._entry;
            const out = [];
            const day = dayLabel(a._d);
            if (day !== lastDay) {
              lastDay = day;
              out.push(<tr className="au-day" key={`day-${day}`}><td colSpan={5}>{day}</td></tr>);
            }
            out.push(
              <tr key={a._id}>
                <td>
                  <div className="au-time">{a._d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</div>
                  <div className="au-ago" title={a._d.toLocaleString('en-KE')}>{timeAgo(a._d)}</div>
                </td>
                <td>
                  <div className="au-user"><span className="au-avatar" aria-hidden="true">{initials(r._user)}</span>{r._user}</div>
                </td>
                <td><span className={`rp-badge rp-badge-${actionKind(a.action)}`} title={a.action}>{actionLabel(a.action)}</span></td>
                <td>
                  <span className="au-rec">{prettify(a.entity_type)}{a.entity_id ? ` #${a.entity_id}` : ''}</span>
                </td>
                <td><AuditChanges changes={a.changes} expanded={!!open[a._id]} onToggle={() => toggle(a._id)} /></td>
              </tr>
            );
            return out;
          })}
        </tbody>
      </table>
    </div>
  );
}

// Compact horizontal bar chart: one or two bars per row (e.g. income vs expenses).
// data: [{ label, values: [n, ...] }], series: [{ name, color }]
function HBarChart({ title, data, series, format = (v) => Number(v).toLocaleString(), max: maxProp, note }) {
  const rowsData = data.slice(0, 8);
  const max = maxProp || Math.max(1, ...rowsData.flatMap(d => d.values));
  return (
    <div>
      <div className="rp-chart-head">
        <div className="rp-chart-title">{title}</div>
        {series.length > 1 && (
          <div className="rp-legend">
            {series.map(sr => (
              <span key={sr.name}><i style={{ background: tone(sr.color) }} />{sr.name}</span>
            ))}
          </div>
        )}
      </div>
      <div className="rp-hbars">
        {rowsData.map(d => (
          <div className="rp-hrow" key={d.label}>
            <div className="rp-hlabel" title={d.label}>{d.label}</div>
            <div className="rp-hlines">
              {d.values.map((v, i) => (
                <div className="rp-hline" key={i}>
                  <div className="rp-hbar" style={{ width: `${v > 0 ? Math.max(2, (v / max) * 100) : 0}%`, background: tone(series[i].color) }} />
                  <span className="rp-hval">{format(v)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {(data.length > 8 || note) && <div className="rp-chart-note">{data.length > 8 ? `Top 8 of ${data.length}. ` : ''}{note}</div>}
    </div>
  );
}

export default function Reports() {
  const { user: me, can } = useAuth();
  const isAdminOrAgent = me?.role === 'admin' || me?.role === 'super_admin' || me?.role === 'agent';
  const [active,   setActive]   = useState('payments');
  const [data,     setData]     = useState({});
  const [loading,  setLoading]  = useState(false);
  const [filters,  setFilters]  = useState({
    period: 'month', month: getThisMonth(), year: getThisYear(), status: 'all',
    propertyName: 'all', location: 'all', fromDate: '', toDate: '', comparisonMode: 'mom', landlord: 'all',
    agent: 'all', caretaker: 'all',
  });
  const [tableSearch, setTableSearch] = useState('');
  // Audit trail has its own filters (kept out of `filters` so changing them doesn't refetch everything)
  const [audit, setAudit] = useState({ range: '30d', action: 'all', entity: 'all', user: 'all' });
  // User Activity report's own role filter (kept out of `filters` for the same reason `audit` is)
  const [activityRole, setActivityRole] = useState('all');
  const [historyTenantId, setHistoryTenantId] = useState('');
  const [auditOpen, setAuditOpen] = useState({});
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [pinned, setPinned] = useState(() => {
    try { return JSON.parse(localStorage.getItem('report_pins') || '[]'); } catch { return []; }
  });

  const report = REPORTS.find(r => r.id === active);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadReport(); }, [active, filters]);

  // Fire-and-forget: tells the backend a staff member opened this report
  // tab, for the User Activity report's "checked" breakdown. Swallowed on
  // failure (non-admin accounts can still open reports; this call isn't
  // what gates that) and never blocks the UI.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const label = REPORTS.find(r => r.id === active)?.label || active;
    API.post('/staff-activity/report-viewed', { report: label }).catch(() => {});
  }, [active]);

  function togglePin(id) {
    setPinned(p => {
      const next = p.includes(id) ? p.filter(x => x !== id) : [...p, id];
      try { localStorage.setItem('report_pins', JSON.stringify(next)); } catch {}
      return next;
    });
  }

  async function loadReport() {
    setLoading(true);
    try {
      const [tr, pr, hr, mr, plr, er] = await Promise.all([
        API.get('/tenants'),
        API.get('/payments'),
        API.get('/houses'),
        API.get('/maintenance'),
        API.get('/plots'),
        API.get('/expenses'),
      ]);
      // Caretaker workload needs the user list (for plot assignment); fetched
      // separately and swallowed on failure so it never breaks other reports
      // for users without permission to list all users.
      let users = [];
      try {
        const ur = await API.get('/auth/users');
        users = arr(ur.data);
      } catch { users = []; }

      // Real multi-plot assignment per caretaker, via the caretaker_plots
      // junction table your backend already exposes at /auth/users/:id/plots —
      // the plain /auth/users list only carries the single legacy plot_id.
      let caretakerPlots = {};
      try {
        const caretakers = users.filter(u => u.role === 'caretaker');
        const plotLists = await Promise.all(caretakers.map(c => API.get(`/auth/users/${c.id}/plots`).then(r => arr(r.data)).catch(() => [])));
        caretakers.forEach((c, i) => { caretakerPlots[c.id] = plotLists[i]; });
      } catch { caretakerPlots = {}; }

      let deposits = [];
      try {
        const dr = await API.get('/deposits');
        deposits = arr(dr.data);
      } catch { deposits = []; }

      // Per-property permission map — { plotId: ['permission', ...] } — for
      // reports that need to trim out just one property's rows rather than
      // show or hide the whole report (see canForPlot below). Swallowed on
      // failure same as the other best-effort fetches above: a report just
      // falls back to its un-trimmed, role-level behavior if this fails.
      let plotPermissions = {};
      try {
        const ppr = await API.get('/auth/my-plot-permissions');
        plotPermissions = ppr.data?.data || {};
      } catch { plotPermissions = {}; }

      let auditLog = [], auditDenied = false;
      try {
        const ar = await API.get('/audit-log');
        auditLog = arr(ar.data);
      } catch (e) { auditLog = []; auditDenied = e?.response?.status === 403; } // 403 for non-admins — expected, not an error

      let riskData = [];
      try { riskData = arr((await API.get('/tenants/arrears-risk')).data); } catch { riskData = []; }
      let utilities = [];
      try { utilities = arr((await API.get('/utilities')).data); } catch { utilities = []; }

      let userActivity = [], userActivityDenied = false;
      try {
        const uar = await API.get('/user-activity');
        userActivity = arr(uar.data);
      } catch (e) { userActivity = []; userActivityDenied = e?.response?.status === 403; } // 403 for non-admins — expected, not an error

      setData({
        tenants: arr(tr.data), payments: arr(pr.data), houses: arr(hr.data),
        requests: arr(mr.data), plots: arr(plr.data), expenses: arr(er.data), utilities, riskData, users, deposits, auditLog, auditDenied, caretakerPlots,
        plotPermissions, userActivity, userActivityDenied,
      });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function arr(d) { return Array.isArray(d) ? d : (d?.data || []); }

  // Per-property check for report data trimming: "may I see THIS permission
  // for THIS specific property", as opposed to `can()` which only answers
  // "do I have this permission at all, anywhere". A role-level '*' (or the
  // flat permission itself, when no plot is involved) short-circuits before
  // ever looking at the per-plot map, same precedence as the backend.
  // Falls back to the flat `can()` check when a plot's entry isn't in the
  // map (e.g. the fetch failed, or the row has no plot) — same as "no
  // override exists, use the role default".
  function canForPlot(permission, plotId, plotPermissions) {
    if (me?.permissions?.includes('*')) return true;
    if (plotId == null || !plotPermissions || !(plotId in plotPermissions)) return can(permission);
    return plotPermissions[plotId].includes(permission);
  }

  function filterByPeriod(items, dateField) {
    return items.filter(item => {
      if (!item[dateField]) return true;
      const d = new Date(item[dateField]);
      if (filters.period === 'month') return d.getMonth() + 1 === filters.month && d.getFullYear() === filters.year;
      if (filters.period === 'year')  return d.getFullYear() === filters.year;
      if (filters.period === 'range') {
        if (filters.fromDate && d < new Date(filters.fromDate)) return false;
        if (filters.toDate   && d > new Date(`${filters.toDate}T23:59:59`)) return false;
        return true;
      }
      return true; // 'all'
    });
  }

  function periodText() {
    if (NO_PERIOD_FILTER.includes(active)) return 'Current snapshot';
    const mn = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    if (filters.period === 'month') return `${mn[(filters.month || 1) - 1]} ${filters.year}`;
    if (filters.period === 'year')  return `Year ${filters.year}`;
    if (filters.period === 'range') return `${filters.fromDate || 'start'} to ${filters.toDate || 'today'}`;
    return 'All time';
  }

  function downloadPDF(cols, rowsToExport, summaryItems, reportTitle) {
    exportReportPdf({
      title: reportTitle || 'Report', columns: cols, rows: rowsToExport, summary: summaryItems,
      periodLabel: periodText(), filename: active, generatedBy: me?.name,
    });
  }

  function downloadCSV(rows, filename) {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]).filter(h => !h.startsWith('_'));
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadStatement(tenantId, name) {
    if (!tenantId) return;
    try {
      const res = await API.get(`/statements/${tenantId}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement_${String(name || 'tenant').replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); alert('Could not generate statement.'); }
  }

  const [ownerMonth, setOwnerMonth] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); });
  async function downloadOwnerStatement() {
    try {
      const res = await API.get(`/statements/landlord?month=${ownerMonth}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `owner_statement_${ownerMonth}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); alert('Could not generate the owner statement (you may not have access to financial reports for these properties).'); }
  }

  async function downloadAllStatements() {
    try {
      const res = await API.get('/statements/bulk/all.zip', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `tenant_statements_${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); alert('Could not generate statements.'); }
  }

  const years  = Array.from({ length: 5 }, (_, i) => getThisYear() - i);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ── Compute report rows ────────────────────────────────────────────────────
  let rows = [], columns = [], title = '', summary = null, chart = null, note = '';
  let auditOptions = { actions: [], entities: [], users: [] };

  if (data.payments) {
    const { tenants, payments, houses, requests, plots, expenses, utilities = [], riskData = [], users, deposits, auditLog, caretakerPlots, plotPermissions, userActivity } = data;

    // Shared lookups for the analytical reports below
    const houseById = Object.fromEntries(houses.map(h => [h.id, h]));
    const plotById  = Object.fromEntries(plots.map(p => [p.id, p]));
    const landlordOK = (plot) => filters.landlord === 'all' || (plot && plot.owner_name === filters.landlord);
    const plotOfHouse = (houseId) => { const h = houseById[houseId]; return h ? plotById[h.plot_id] : undefined; };
    const num = (v) => parseFloat(v || 0);
    // Several reports below sum raw payment amounts as "revenue" or
    // "collected" without looking at the payment's status — which meant a
    // "pending" STK push (tenant hasn't entered their PIN yet, so no money
    // has moved) or a "failed" one (never went through at all) got added to
    // the total right alongside real, received payments. That overstates
    // how much rent actually came in, in some of the numbers landlords
    // rely on most: Payment Collection, Revenue Summary, Payment Methods,
    // Collection Efficiency, Profit & Loss, Agent Scorecard and the Period
    // Comparison report. "unmatched"/"review" payments are left in — that
    // money genuinely arrived, it's just not matched to a tenant/month yet.
    const isCollected = (p) => p.status !== 'pending' && p.status !== 'failed';

    // ── Profit & Loss by plot ───────────────────────────────────────────────
    if (active === 'profitloss') {
      const byPlot = {};
      const bucket = (key, name) => (byPlot[key] = byPlot[key] || { name, owner: '', income: 0, expense: 0 });
      plots.filter(pl => landlordOK(pl)).forEach(pl => { bucket(pl.id, pl.name).owner = pl.owner_name || '—'; });

      filterByPeriod(payments.filter(isCollected), 'payment_date').forEach(pay => {
        const pl = plotOfHouse(pay.house_id);
        if (pl) { if (landlordOK(pl)) bucket(pl.id, pl.name).income += num(pay.amount); }
        else if (filters.landlord === 'all') bucket('none', 'Unassigned').income += num(pay.amount);
      });
      filterByPeriod(expenses, 'expense_date').forEach(e => {
        const pl = e.plot_id != null ? plotById[e.plot_id] : plots.find(x => x.name === e.plot_name);
        if (pl) { if (landlordOK(pl)) bucket(pl.id, pl.name).expense += num(e.amount); }
        else if (filters.landlord === 'all') bucket('none', 'Unassigned').expense += num(e.amount);
      });

      const list = Object.values(byPlot).map(b => ({ ...b, net: b.income - b.expense })).sort((a, b) => b.net - a.net);
      const totalIncome = list.reduce((s, b) => s + b.income, 0);
      const totalExpense = list.reduce((s, b) => s + b.expense, 0);
      const net = totalIncome - totalExpense;
      columns = ['Plot', 'Owner', 'Income (KES)', 'Expenses (KES)', 'Net (KES)', 'Margin'];
      rows = list.map(b => ({
        Plot: b.name, Owner: b.owner || '—',
        'Income (KES)': b.income.toLocaleString(), 'Expenses (KES)': b.expense.toLocaleString(),
        'Net (KES)': b.net.toLocaleString(),
        Margin: b.income ? `${Math.round((b.net / b.income) * 100)}%` : '—',
      }));
      summary = [
        { label: 'Income', value: `KES ${totalIncome.toLocaleString()}`, color: 'var(--green)' },
        { label: 'Expenses', value: `KES ${totalExpense.toLocaleString()}`, color: 'var(--red)' },
        { label: 'Net Profit', value: `KES ${net.toLocaleString()}`, color: net >= 0 ? 'var(--green)' : 'var(--red)' },
        { label: 'Margin', value: totalIncome ? `${Math.round((net / totalIncome) * 100)}%` : '—', color: 'var(--blue)' },
      ];
      chart = <HBarChart title="Income vs expenses by plot" series={[{ name: 'Income', color: 'var(--green)' }, { name: 'Expenses', color: 'var(--red)' }]}
        data={[...list].sort((a, b) => b.income - a.income).filter(b => b.income || b.expense).map(b => ({ label: b.name, values: [b.income, b.expense] }))}
        format={v => `KES ${v.toLocaleString()}`} />;
      title = 'Profit & Loss by Plot';
      note = 'Income is rent payments recorded in the selected period, matched to a plot through the unit. Expenses are matched by plot. Anything that cannot be matched appears under "Unassigned".';
    }

    // ── Collection efficiency (expected vs collected, by month) ─────────────
    if (active === 'collection') {
      const yr = filters.year, now = new Date();
      const lastMonth = yr < now.getFullYear() ? 11 : yr > now.getFullYear() ? -1 : now.getMonth();
      const list = [];
      months.forEach((m, i) => {
        if (i > lastMonth) return;
        const endOfMonth = new Date(yr, i + 1, 0, 23, 59, 59);
        let expected = 0, collected = 0;
        tenants.forEach(t => {
          if (!t.is_active || !t.move_in_date || new Date(t.move_in_date) > endOfMonth) return;
          const h = houseById[t.house_id];
          if (h && landlordOK(plotById[h.plot_id])) expected += num(h.rent_amount);
        });
        payments.filter(isCollected).forEach(pay => {
          const d = new Date(pay.payment_date);
          if (d.getFullYear() !== yr || d.getMonth() !== i) return;
          const pl = plotOfHouse(pay.house_id);
          if (filters.landlord !== 'all' && !(pl && pl.owner_name === filters.landlord)) return;
          collected += num(pay.amount);
        });
        list.push({ m, expected, collected });
      });
      const totalExp = list.reduce((s, x) => s + x.expected, 0);
      const totalCol = list.reduce((s, x) => s + x.collected, 0);
      const eff = totalExp ? Math.round((totalCol / totalExp) * 100) : 0;
      columns = ['Month', 'Expected (KES)', 'Collected (KES)', 'Gap (KES)', 'Efficiency'];
      rows = list.map(x => ({
        Month: `${x.m} ${yr}`,
        'Expected (KES)': x.expected.toLocaleString(),
        'Collected (KES)': x.collected.toLocaleString(),
        'Gap (KES)': (x.expected - x.collected).toLocaleString(),
        Efficiency: x.expected ? `${Math.round((x.collected / x.expected) * 100)}%` : '—',
      }));
      summary = [
        { label: 'Expected', value: `KES ${totalExp.toLocaleString()}`, color: 'var(--blue)' },
        { label: 'Collected', value: `KES ${totalCol.toLocaleString()}`, color: 'var(--green)' },
        { label: 'Shortfall', value: `KES ${(totalExp - totalCol).toLocaleString()}`, color: 'var(--red)' },
        { label: 'Efficiency', value: totalExp ? `${eff}%` : '—', color: eff >= 90 ? 'var(--green)' : eff >= 70 ? 'var(--amber)' : 'var(--red)' },
      ];
      chart = <HBarChart title={`Expected vs collected, ${yr}`} series={[{ name: 'Expected', color: 'var(--blue)' }, { name: 'Collected', color: 'var(--green)' }]}
        data={list.map(x => ({ label: x.m, values: [x.expected, x.collected] }))} format={v => `KES ${v.toLocaleString()}`} />;
      title = `Collection Efficiency ${yr}`;
      note = 'Expected rent is estimated from currently active tenants and their move-in dates. Tenants who have since moved out are not included, so earlier months may be understated. Over 100% means arrears or advance payments were received.';
    }

    // ── Agent scorecard ─────────────────────────────────────────────────────
    if (active === 'agentscore') {
      const now = new Date();
      const agents = {};
      const agentRow = (id, name) => {
        const k = id == null ? 'none' : String(id);
        if (!agents[k]) agents[k] = { name: id == null ? 'No agent assigned' : name, plots: 0, units: 0, occupied: 0, rentRoll: 0, collected: 0, arrears: 0, open: 0 };
        return agents[k];
      };
      (users || []).filter(u => u.role === 'agent').forEach(u => agentRow(u.id, u.name));
      const agentOfPlot = (pl) => pl ? (pl.agent_id != null ? agentRow(pl.agent_id, pl.agent_name || `Agent #${pl.agent_id}`) : agentRow(null)) : null;

      plots.forEach(pl => { agentOfPlot(pl).plots += 1; });
      houses.forEach(h => {
        const a = agentOfPlot(plotById[h.plot_id]); if (!a) return;
        a.units += 1;
        if (h.status === 'occupied') { a.occupied += 1; a.rentRoll += num(h.rent_amount); }
      });
      tenants.forEach(t => {
        if (!t.is_active) return;
        const a = agentOfPlot(plotOfHouse(t.house_id)); if (a) a.arrears += num(t.balance);
      });
      payments.filter(isCollected).forEach(pay => {
        const d = new Date(pay.payment_date);
        if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return;
        const a = agentOfPlot(plotOfHouse(pay.house_id)); if (a) a.collected += num(pay.amount);
      });
      requests.forEach(r => {
        if (r.status === 'completed') return;
        const a = agentOfPlot(plotOfHouse(r.house_id)); if (a) a.open += 1;
      });

      const list = Object.values(agents).filter(a => a.name !== 'No agent assigned' || a.plots > 0).sort((a, b) => b.rentRoll - a.rentRoll);
      const roll = list.reduce((s, a) => s + a.rentRoll, 0), coll = list.reduce((s, a) => s + a.collected, 0);
      columns = ['Agent', 'Plots', 'Units', 'Occupancy', 'Rent Roll (KES)', 'Collected This Month (KES)', 'Collection Rate', 'Arrears (KES)', 'Open Requests'];
      rows = list.map(a => ({
        Agent: a.name, Plots: a.plots, Units: a.units,
        Occupancy: a.units ? `${Math.round((a.occupied / a.units) * 100)}%` : '—',
        'Rent Roll (KES)': a.rentRoll.toLocaleString(),
        'Collected This Month (KES)': a.collected.toLocaleString(),
        'Collection Rate': a.rentRoll ? `${Math.round((a.collected / a.rentRoll) * 100)}%` : '—',
        'Arrears (KES)': a.arrears.toLocaleString(),
        'Open Requests': a.open,
      }));
      summary = [
        { label: 'Agents with plots', value: list.filter(a => a.plots > 0 && a.name !== 'No agent assigned').length, color: 'var(--primary)' },
        { label: 'Plots managed', value: list.filter(a => a.name !== 'No agent assigned').reduce((s, a) => s + a.plots, 0), color: 'var(--blue)' },
        { label: 'Collection rate (this month)', value: roll ? `${Math.round((coll / roll) * 100)}%` : '—', color: 'var(--green)' },
        { label: 'Total arrears', value: `KES ${list.reduce((s, a) => s + a.arrears, 0).toLocaleString()}`, color: 'var(--red)' },
      ];
      chart = <HBarChart title="Rent roll vs collected this month" series={[{ name: 'Rent roll', color: 'var(--blue)' }, { name: 'Collected', color: 'var(--green)' }]}
        data={list.filter(a => a.rentRoll || a.collected).map(a => ({ label: a.name, values: [a.rentRoll, a.collected] }))} format={v => `KES ${v.toLocaleString()}`} />;
      title = 'Agent Scorecard';
      note = 'Each plot belongs to the agent assigned on the plot. Collection rate compares this month\'s payments with the monthly rent of occupied units. Plots without an agent are grouped under "No agent assigned".';
    }

    // ── Vacancy loss ────────────────────────────────────────────────────────
    if (active === 'vacancyloss') {
      const now = new Date();
      const items = houses.filter(h => h.status === 'vacant' && landlordOK(plotById[h.plot_id])).map(h => {
        const days = h.status_changed_at ? Math.max(0, daysBetween(now, new Date(h.status_changed_at))) : null;
        const rent = num(h.rent_amount);
        return { h, rent, days, loss: days != null ? Math.round((rent * days) / 30) : null, plotName: h.plot_name || plotById[h.plot_id]?.name || '—' };
      }).sort((a, b) => (b.loss ?? -1) - (a.loss ?? -1));
      columns = ['Plot', 'Unit', 'Type', 'Rent (KES)', 'Days Vacant', 'Est. Loss (KES)'];
      rows = items.map(x => ({
        Plot: x.plotName, Unit: `Unit ${x.h.unit_number}`, Type: x.h.house_type || '—',
        'Rent (KES)': x.rent.toLocaleString(),
        'Days Vacant': x.days ?? '—',
        'Est. Loss (KES)': x.loss != null ? x.loss.toLocaleString() : '—',
      }));
      const dated = items.filter(x => x.days != null);
      const longest = dated.length ? dated.reduce((a, b) => (b.days > a.days ? b : a)) : null;
      summary = [
        { label: 'Vacant units', value: items.length, color: 'var(--amber)' },
        { label: 'Rent idle per month', value: `KES ${items.reduce((s, x) => s + x.rent, 0).toLocaleString()}`, color: 'var(--blue)' },
        { label: 'Estimated loss so far', value: `KES ${items.reduce((s, x) => s + (x.loss || 0), 0).toLocaleString()}`, color: 'var(--red)' },
        ...(longest ? [{ label: 'Longest vacant', value: `${longest.days} days`, color: 'var(--red)' }] : []),
      ];
      const lossByPlot = {};
      items.forEach(x => { lossByPlot[x.plotName] = (lossByPlot[x.plotName] || 0) + (x.loss || 0); });
      chart = <HBarChart title="Estimated rent lost to vacancy, by plot" series={[{ name: 'Estimated loss', color: 'var(--red)' }]}
        data={Object.entries(lossByPlot).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([label, v]) => ({ label, values: [v] }))}
        format={v => `KES ${v.toLocaleString()}`} />;
      title = 'Vacancy Loss';
      note = 'Estimated as monthly rent × days vacant ÷ 30, counted from when each unit was last marked vacant. Units with no recorded vacancy date show — and are not included in the loss.';
    }

    // ── Data quality exceptions ─────────────────────────────────────────────
    if (active === 'dataquality') {
      const issues = [];
      const add = (Severity, Issue, Record, Plot, Detail) => issues.push({ Severity, Issue, Record, Plot: Plot || '—', Detail: Detail || '—' });
      const activeTenants = tenants.filter(t => t.is_active);
      const blank = (v) => !(v && String(v).trim());

      activeTenants.forEach(t => {
        const plotName = t.plot_name || plotOfHouse(t.house_id)?.name;
        if (blank(t.phone) && blank(t.email)) add('High', 'No contact details', t.full_name, plotName, 'No phone number or email on file');
        else if (blank(t.phone)) add('Medium', 'Missing phone number', t.full_name, plotName);
        else if (blank(t.email)) add('Low', 'Missing email', t.full_name, plotName);
        if (!t.move_in_date) add('Medium', 'No move-in date', t.full_name, plotName, 'Rent balance cannot be calculated without it');
        if (t.house_id == null) add('High', 'No unit assigned', t.full_name, plotName, 'Active tenant is not linked to a unit');
      });

      const byPhone = {};
      activeTenants.forEach(t => { const ph = String(t.phone || '').replace(/\s+/g, ''); if (ph) (byPhone[ph] = byPhone[ph] || []).push(t); });
      Object.entries(byPhone).forEach(([ph, list]) => {
        if (list.length > 1) add('Medium', 'Duplicate phone number', list.map(t => t.full_name).join(', '), null, ph);
      });

      const activeByHouse = {};
      activeTenants.forEach(t => { if (t.house_id != null) (activeByHouse[t.house_id] = activeByHouse[t.house_id] || []).push(t); });
      houses.forEach(h => {
        const pl = plotById[h.plot_id]?.name, unit = `Unit ${h.unit_number}`, here = activeByHouse[h.id] || [];
        if (h.status === 'occupied' && here.length === 0) add('High', 'Occupied unit has no tenant', unit, pl, 'Marked occupied, but no active tenant is linked');
        if (h.status === 'vacant' && here.length > 0) add('High', 'Vacant unit has a tenant', unit, pl, `${here.map(t => t.full_name).join(', ')} linked to a unit marked vacant`);
        if (here.length > 1) add('Medium', 'Several active tenants in one unit', unit, pl, here.map(t => t.full_name).join(', '));
        if (!(num(h.rent_amount) > 0)) add('Medium', 'Unit has no rent amount', unit, pl);
      });

      // Staffing gaps. The caretaker check needs the user list (admin only).
      const caretakerCovered = new Set();
      (users || []).filter(u => u.role === 'caretaker').forEach(u => {
        if (u.plot_id != null) caretakerCovered.add(u.plot_id);
        ((caretakerPlots || {})[u.id] || []).forEach(x => caretakerCovered.add(x.id ?? x.plot_id));
      });
      plots.forEach(pl => {
        if (pl.agent_id == null) add('Low', 'Plot has no agent', pl.name, pl.name, 'No agent assigned to this plot');
        if ((users || []).length && !caretakerCovered.has(pl.id)) add('Low', 'Plot has no caretaker', pl.name, pl.name, 'No caretaker assigned to this plot');
      });

      const order = { High: 0, Medium: 1, Low: 2 };
      issues.sort((a, b) => order[a.Severity] - order[b.Severity] || a.Issue.localeCompare(b.Issue));
      columns = ['Severity', 'Issue', 'Record', 'Plot', 'Detail'];
      rows = issues;
      const count = (sev) => issues.filter(i => i.Severity === sev).length;
      summary = [
        { label: 'Total issues', value: issues.length, color: 'var(--primary)' },
        { label: 'High', value: count('High'), color: 'var(--red)' },
        { label: 'Medium', value: count('Medium'), color: 'var(--amber)' },
        { label: 'Low', value: count('Low'), color: 'var(--blue)' },
      ];
      const byIssue = {};
      issues.forEach(i => { byIssue[i.Issue] = (byIssue[i.Issue] || 0) + 1; });
      chart = <HBarChart title="Issues by type" series={[{ name: 'Issues', color: 'var(--amber)' }]}
        data={Object.entries(byIssue).sort((a, b) => b[1] - a[1]).map(([label, v]) => ({ label, values: [v] }))} format={v => v} />;
      title = 'Data Quality Exceptions';
      note = 'High: breaks balances, billing or reporting. Medium: should be fixed soon. Low: housekeeping. The caretaker check only runs when the user list is available (admin).';
    }

    if (active === 'payments') {
      // See canForPlot above — a property-specific revoke of
      // reports.payment_collection trims that property's transactions out
      // rather than hiding the whole report.
      const visiblePayments = payments.filter(p => canForPlot('reports.payment_collection', p.plot_id, plotPermissions));
      const filtered = filterByPeriod(visiblePayments, 'payment_date');
      // The table below still lists every transaction, pending and failed
      // ones included, so staff can see what was attempted — but the
      // headline "Total Collected" figure only counts money that actually
      // came in.
      const total    = filtered.filter(isCollected).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      columns = ['Tenant', 'Amount (KES)', 'Method', 'Reference', 'Status', 'Date'];
      rows    = filtered.map(p => ({
        Tenant: p.tenant_name || '—',
        'Amount (KES)': parseFloat(p.amount || 0).toLocaleString(),
        Method: p.method || 'mpesa',
        Reference: p.receipt_no || '—',
        Status: p.status,
        Date: new Date(p.payment_date).toLocaleDateString('en-KE'),
      }));
      summary = [{ label: 'Total Collected', value: `KES ${total.toLocaleString()}`, color: 'var(--green)' }, { label: 'Transactions', value: filtered.length, color: 'var(--blue)' }];
      title = `Payment Collection Report`;
    }

    if (active === 'paymenthistory') {
      // Same gate as Payment Collection — this shows the same money, per tenant
      // (see canForPlot above for the per-property version).
      const tenant = (tenants || []).filter(t => canForPlot('reports.payment_collection', t.plot_id, plotPermissions)).find(t => String(t.id) === String(historyTenantId));
      if (!tenant) {
        columns = []; rows = []; summary = [];
        title = 'Payment History';
      } else {
        const monthName = (y, m) => new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'long', year: 'numeric' });

        // Rent side — every payment row for this tenant, whatever its status,
        // so a failed or unallocated one is still visible in their history,
        // not silently hidden.
        const rentRows = (payments || [])
          .filter(p => String(p.tenant_id) === String(tenant.id))
          .map(p => ({
            _date: new Date(p.payment_date),
            Date: new Date(p.payment_date).toLocaleDateString('en-KE'),
            Type: 'Rent',
            'Amount (KES)': parseFloat(p.amount || 0).toLocaleString(),
            'Allocated To': (p.for_year && p.for_month) ? monthName(p.for_year, p.for_month) : '—',
            Method: p.method || 'mpesa',
            Reference: p.receipt_no || p.transaction_id || '—',
            Status: p.status,
          }));

        // Deposit side — collected/refunded/forfeited, same tenant.
        const depositRows = (deposits || [])
          .filter(d => String(d.tenant_id) === String(tenant.id))
          .map(d => ({
            _date: new Date(d.created_at),
            Date: new Date(d.created_at).toLocaleDateString('en-KE'),
            Type: `Deposit — ${d.type.charAt(0).toUpperCase()}${d.type.slice(1)}`,
            'Amount (KES)': parseFloat(d.amount || 0).toLocaleString(),
            'Allocated To': 'Security Deposit',
            Method: '—',
            Reference: '—',
            Status: '—',
          }));

        const combined = [...rentRows, ...depositRows].sort((a, b) => a._date - b._date);
        columns = ['Date', 'Type', 'Amount (KES)', 'Allocated To', 'Method', 'Reference', 'Status'];
        rows = combined.map(({ _date, ...r }) => r);

        const totalRent     = rentRows.filter(r => r.Status === 'matched').reduce((s, r) => s + parseFloat(r['Amount (KES)'].replace(/,/g, '')), 0);
        const depositNet    = (deposits || []).filter(d => String(d.tenant_id) === String(tenant.id))
          .reduce((s, d) => s + (d.type === 'collected' ? 1 : -1) * parseFloat(d.amount || 0), 0);
        summary = [
          { label: 'Total Rent Paid', value: `KES ${totalRent.toLocaleString()}`, color: 'var(--green)' },
          { label: 'Deposit Held (Net)', value: `KES ${depositNet.toLocaleString()}`, color: 'var(--blue)' },
          { label: 'Current Balance', value: `KES ${parseFloat(tenant.balance || 0).toLocaleString()}`, color: parseFloat(tenant.balance || 0) > 0 ? 'var(--red)' : 'var(--green)' },
        ];
        title = `Payment History — ${tenant.full_name}`;
      }
    }

    if (active === 'unpaid') {
      // Aging is approximate: it's based on each tenant's most recent recorded
      // payment (matched by name), or their move-in date if they have never
      // paid. There's no monthly rent-charge history table, so this can't
      // reflect exactly which month(s) are unpaid — only how long it's been
      // since money was last seen from them.
      const lastPaymentByTenant = {};
      payments.forEach(p => {
        if (!p.tenant_name) return;
        const d = new Date(p.payment_date);
        if (!lastPaymentByTenant[p.tenant_name] || d > lastPaymentByTenant[p.tenant_name]) lastPaymentByTenant[p.tenant_name] = d;
      });
      // A property-specific revoke of reports.unpaid_rent hides just that
      // property's tenants from this report (trims the data, doesn't hide
      // the whole report) — see canForPlot above.
      const visibleTenants = tenants.filter(t => canForPlot('reports.unpaid_rent', t.plot_id, plotPermissions));
      const unpaid = filterByPeriod(visibleTenants.filter(t => t.is_active && parseFloat(t.balance || 0) > 0), 'move_in_date');
      const total  = unpaid.reduce((s, t) => s + parseFloat(t.balance || 0), 0);
      const now = new Date();
      const withAging = unpaid.map(t => {
        const baseline = lastPaymentByTenant[t.full_name] || (t.move_in_date ? new Date(t.move_in_date) : now);
        const days = Math.max(0, daysBetween(now, baseline));
        return { t, days, bucket: agingBucket(days) };
      });
      columns = ['Tenant', 'Phone', 'Unit', 'Plot', 'Balance (KES)', 'Days Overdue', 'Aging Bucket', 'Move-in', 'Due Day'];
      rows    = withAging.map(({ t, days, bucket }) => ({
        Tenant: t.full_name,
        Phone: t.phone || '—',
        Unit: t.unit_number || `#${t.house_id}`,
        Plot: t.plot_name || '—',
        'Balance (KES)': parseFloat(t.balance).toLocaleString(),
        'Days Overdue': days,
        'Aging Bucket': bucket,
        'Move-in': t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE') : '—',
        'Due Day': t.rent_due_day || '—',
      }));
      const bucketCount = b => withAging.filter(x => x.bucket === b).length;
      summary = [
        { label: 'Tenants Owing', value: unpaid.length, color: 'var(--red)' },
        { label: 'Total Unpaid', value: `KES ${total.toLocaleString()}`, color: 'var(--red)' },
        { label: '0–30 days', value: bucketCount('0–30 days'), color: 'var(--green)' },
        { label: '31–60 days', value: bucketCount('31–60 days'), color: 'var(--amber)' },
        { label: '61–90 days', value: bucketCount('61–90 days'), color: '#f97316' },
        { label: '90+ days', value: bucketCount('90+ days'), color: 'var(--red)' },
      ];
      title = 'Unpaid Rent Report';
      chart = <HBarChart title="Tenants by aging bucket" series={[{ name: 'Tenants', color: 'var(--red)' }]}
        data={['0–30 days', '31–60 days', '61–90 days', '90+ days'].map(b => ({ label: b, values: [bucketCount(b)] }))} format={v => v} />;
    }

    if (active === 'tenants') {
      // See canForPlot above — a property-specific revoke of
      // reports.tenant_list trims that property's tenants out rather than
      // hiding the whole report.
      const filtered = tenants
        .filter(t => canForPlot('reports.tenant_list', t.plot_id, plotPermissions))
        .filter(t => filters.status === 'all' || (filters.status === 'active' ? t.is_active : !t.is_active))
        .filter(t => filters.landlord === 'all' || t.owner_name === filters.landlord);
      columns = ['Name', 'Phone', 'Email', 'Unit', 'Plot', 'Move-in', 'Balance (KES)', 'Status'];
      rows    = filtered.map(t => ({
        Name: t.full_name,
        Phone: t.phone || '—',
        Email: t.email || '—',
        Unit: t.unit_number || `#${t.house_id}`,
        Plot: t.plot_name || '—',
        'Move-in': t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE') : '—',
        'Balance (KES)': parseFloat(t.balance || 0).toLocaleString(),
        Status: t.is_active ? 'Active' : 'Inactive',
      }));
      summary = [{ label: 'Total Tenants', value: filtered.length, color: 'var(--primary)' }, { label: 'Active', value: filtered.filter(t=>t.is_active).length, color: 'var(--green)' }];
      title = 'Tenant List Report';
    }

    if (active === 'maintenance') {
      // See canForPlot above — a property-specific revoke of
      // reports.maintenance trims that property's requests out rather than
      // hiding the whole report.
      const visibleRequests = requests.filter(r => canForPlot('reports.maintenance', r.plot_id, plotPermissions));
      const filtered = filterByPeriod(visibleRequests, 'reported_at').filter(r => filters.status === 'all' || r.status === filters.status);
      columns = ['#', 'Issue', 'Priority', 'Status', 'Unit', 'Reported', 'Resolved'];
      rows    = filtered.map(r => ({
        '#': r.id,
        Issue: r.issue,
        Priority: r.priority,
        Status: r.status,
        Unit: r.unit_number || `#${r.house_id}`,
        Reported: new Date(r.reported_at).toLocaleDateString('en-KE'),
        Resolved: r.resolved_at ? new Date(r.resolved_at).toLocaleDateString('en-KE') : '—',
      }));
      summary = [{ label: 'Total', value: filtered.length, color: 'var(--amber)' }, { label: 'Pending', value: filtered.filter(r=>r.status==='pending').length, color: 'var(--red)' }, { label: 'Completed', value: filtered.filter(r=>r.status==='completed').length, color: 'var(--green)' }];
      title = 'Maintenance Records Report';
    }

    if (active === 'arrearsrisk') {
      const vis = riskData.filter(t => canForPlot('reports.unpaid_rent', t.plot_id, plotPermissions));
      const LV = { Critical: '🔴 Critical', High: '🟠 High', Medium: '🟡 Medium', Low: '🟢 Low' };
      const bucket = d => d <= 30 ? '0–30 days' : d <= 60 ? '31–60 days' : d <= 90 ? '61–90 days' : '90+ days';
      const owing = vis.filter(t => t.balance > 0);
      columns = ['Tenant', 'Phone', 'Property / Unit', 'Balance (KES)', 'Months Owed', 'Oldest Unpaid', 'Days Overdue', 'Aging', 'Late Payments (last 6)', 'Risk Score', 'Risk'];
      rows = vis.map(t => ({
        Tenant: t.full_name, Phone: t.phone || '—',
        'Property / Unit': `${t.plot_name || '—'}${t.unit_number ? ' · ' + t.unit_number : ''}`,
        'Balance (KES)': t.balance.toLocaleString(), 'Months Owed': t.months_owed,
        'Oldest Unpaid': t.oldest_label || '—', 'Days Overdue': t.balance > 0 ? t.oldest_days : '—',
        Aging: t.balance > 0 ? bucket(t.oldest_days) : '—',
        'Late Payments (last 6)': t.paid_months_checked ? `${t.late_months}/${t.paid_months_checked}${t.late_months ? ` (avg ${t.avg_days_late}d late)` : ''}` : '—',
        'Risk Score': t.risk_score, Risk: LV[t.risk_level] || t.risk_level,
      }));
      const sum = (arr2) => arr2.reduce((x, t) => x + t.balance, 0);
      summary = [
        { label: 'Tenants Owing', value: owing.length, color: 'var(--red)' },
        { label: 'Total Arrears', value: `KES ${sum(owing).toLocaleString()}`, color: 'var(--red)' },
        { label: 'Critical / High risk', value: vis.filter(t => ['Critical', 'High'].includes(t.risk_level)).length, color: 'var(--amber)' },
        { label: '90+ days owed', value: owing.filter(t => t.oldest_days > 90).length, color: 'var(--red)' },
      ];
      title = 'Arrears Aging & Risk';
      const buckets = ['0–30 days', '31–60 days', '61–90 days', '90+ days'];
      chart = <HBarChart title="Arrears by age (KES)" series={[{ name: 'Owed', color: 'var(--red)' }]}
        data={buckets.map(b => ({ label: b, values: [sum(owing.filter(t => bucket(t.oldest_days) === b))] }))} format={v => `KES ${v.toLocaleString()}`} />;
    }

    if (active === 'maintperf') {
      const vis = requests.filter(r => canForPlot('reports.maintenance', r.plot_id, plotPermissions));
      const fr = filterByPeriod(vis, 'reported_at');
      const plotName = Object.fromEntries(plots.map(p => [p.id, p.name]));
      const costByReq = {};
      expenses.forEach(e => { if (e.maintenance_request_id) costByReq[e.maintenance_request_id] = (costByReq[e.maintenance_request_id] || 0) + parseFloat(e.amount || 0); });
      const now = new Date();
      const norm = r => `${r.house_id}|${String(r.issue || '').toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/).slice(0, 3).join(' ')}`;
      const counts = {};
      fr.forEach(r => { const k = norm(r); counts[k] = (counts[k] || 0) + 1; });
      const groups = {};
      fr.forEach(r => {
        const g = (groups[r.plot_id] ||= { name: plotName[r.plot_id] || `Plot ${r.plot_id}`, total: 0, done: 0, days: [], open7: 0, urgent: 0, cost: 0, repeats: 0 });
        g.total++;
        if (r.status === 'completed') { g.done++; if (r.resolved_at) g.days.push((new Date(r.resolved_at) - new Date(r.reported_at)) / 86400000); }
        else if ((now - new Date(r.reported_at)) / 86400000 > 7) g.open7++;
        if (['high', 'urgent'].includes(String(r.priority).toLowerCase()) && r.status !== 'completed') g.urgent++;
        g.cost += costByReq[r.id] || 0;
        if (counts[norm(r)] > 1) g.repeats++;
      });
      const list = Object.values(groups).sort((a, b) => b.total - a.total);
      const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
      columns = ['Property', 'Requests', 'Completed', 'Completion %', 'Avg Days to Resolve', 'Open > 7 days', 'Urgent Open', 'Repeat Issues', 'Cost (KES)'];
      rows = list.map(g => ({
        Property: g.name, Requests: g.total, Completed: g.done,
        'Completion %': g.total ? `${Math.round((g.done / g.total) * 100)}%` : '—',
        'Avg Days to Resolve': avg(g.days) != null ? avg(g.days).toFixed(1) : '—',
        'Open > 7 days': g.open7, 'Urgent Open': g.urgent, 'Repeat Issues': g.repeats, 'Cost (KES)': g.cost.toLocaleString(),
      }));
      const allDays = list.flatMap(g => g.days);
      summary = [
        { label: 'Requests', value: fr.length, color: 'var(--amber)' },
        { label: 'Avg days to resolve', value: avg(allDays) != null ? avg(allDays).toFixed(1) : '—', color: 'var(--green)' },
        { label: 'Open > 7 days', value: list.reduce((x, g) => x + g.open7, 0), color: 'var(--red)' },
        { label: 'Repair cost', value: `KES ${list.reduce((x, g) => x + g.cost, 0).toLocaleString()}`, color: 'var(--red)' },
      ];
      title = 'Maintenance Performance';
      chart = <HBarChart title="Average days to resolve" series={[{ name: 'Days', color: 'var(--amber)' }]}
        data={list.filter(g => g.days.length).map(g => ({ label: g.name, values: [Number(avg(g.days).toFixed(1))] }))} format={v => `${v} days`} />;
    }

    if (active === 'properties') {
      // See canForPlot above — a property-specific revoke of
      // reports.property_summary drops that one property's row rather than
      // hiding the whole report. Here the plot IS the row, so it's the
      // plot's own id being checked, not a joined plot_id field.
      const filteredPlots = plots
        .filter(p => canForPlot('reports.property_summary', p.id, plotPermissions))
        .filter(p =>
          (filters.propertyName === 'all' || p.name === filters.propertyName) &&
          (filters.location === 'all' || p.location === filters.location) &&
          (filters.landlord === 'all' || p.owner_name === filters.landlord)
        );
      columns = ['Plot', 'Location', 'Total Units', 'Occupied', 'Vacant', 'Monthly Revenue (KES)'];
      rows    = filteredPlots.map(p => {
        const units    = houses.filter(h => h.plot_id === p.id);
        const occupied = units.filter(h => h.status === 'occupied');
        const vacant   = units.filter(h => h.status === 'vacant');
        const revenue  = occupied.reduce((s, h) => s + parseFloat(h.rent_amount || 0), 0);
        return {
          Plot: p.name,
          Location: p.location || '—',
          'Total Units': units.length,
          Occupied: occupied.length,
          Vacant: vacant.length,
          'Monthly Revenue (KES)': revenue.toLocaleString(),
        };
      });
      summary = [{ label: 'Total Plots', value: filteredPlots.length, color: 'var(--blue)' }, { label: 'Total Units', value: filteredPlots.reduce((s, p) => s + houses.filter(h => h.plot_id === p.id).length, 0), color: 'var(--primary)' }];
      title = 'Property Summary Report';
    }

    if (active === 'occupancy') {
      // See canForPlot above — a property-specific revoke of
      // reports.occupancy drops that property's units out rather than
      // hiding the whole report.
      const visibleHouses = houses.filter(h => canForPlot('reports.occupancy', h.plot_id, plotPermissions));
      const occupied = visibleHouses.filter(h => h.status === 'occupied');
      const vacant   = visibleHouses.filter(h => h.status === 'vacant');
      const rate     = visibleHouses.length > 0 ? Math.round((occupied.length / visibleHouses.length) * 100) : 0;
      const now = new Date();
      columns = ['Unit', 'Type', 'Plot', 'Rent (KES)', 'Status', 'Days Vacant'];
      rows    = visibleHouses.map(h => ({
        Unit: `Unit ${h.unit_number}`,
        Type: h.house_type,
        Plot: h.plot_name || '—',
        'Rent (KES)': parseFloat(h.rent_amount || 0).toLocaleString(),
        Status: h.status,
        'Days Vacant': h.status === 'vacant' && h.status_changed_at ? Math.max(0, daysBetween(now, new Date(h.status_changed_at))) : '—',
      }));
      const vacantWithDays = vacant.filter(h => h.status_changed_at);
      const avgDaysVacant  = vacantWithDays.length
        ? Math.round(vacantWithDays.reduce((s, h) => s + Math.max(0, daysBetween(now, new Date(h.status_changed_at))), 0) / vacantWithDays.length)
        : null;
      summary = [
        { label: 'Occupancy Rate', value: `${rate}%`, color: 'var(--green)' },
        { label: 'Occupied', value: occupied.length, color: 'var(--amber)' },
        { label: 'Vacant', value: vacant.length, color: 'var(--blue)' },
        ...(avgDaysVacant !== null ? [{ label: 'Avg Days Vacant', value: avgDaysVacant, color: 'var(--red)' }] : []),
      ];
      title = 'Occupancy Report';
    }

    if (active === 'expenses') {
      // See canForPlot above — a property-specific revoke of
      // reports.expenses trims that property's expenses out rather than
      // hiding the whole report.
      const visibleExpenses = expenses.filter(e => canForPlot('reports.expenses', e.plot_id, plotPermissions));
      const filtered = filterByPeriod(visibleExpenses, 'expense_date');
      const total    = filtered.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
      columns = ['Plot', 'Category', 'Description', 'Amount (KES)', 'Date'];
      rows    = filtered.map(e => ({
        Plot: e.plot_name || '—',
        Category: e.category || '—',
        Description: e.description || '—',
        'Amount (KES)': parseFloat(e.amount || 0).toLocaleString(),
        Date: e.expense_date ? new Date(e.expense_date).toLocaleDateString('en-KE') : '—',
      }));
      summary = [{ label: 'Total Expenses', value: `KES ${total.toLocaleString()}`, color: 'var(--red)' }, { label: 'Records', value: filtered.length, color: 'var(--muted)' }];
      title = 'Expenses Report';
      const byCategory = {};
      filtered.forEach(e => { const k = e.category || 'Uncategorised'; byCategory[k] = (byCategory[k] || 0) + parseFloat(e.amount || 0); });
      chart = <HBarChart title="Expenses by category" series={[{ name: 'Expenses', color: 'var(--red)' }]}
        data={Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([label, v]) => ({ label, values: [v] }))} format={v => `KES ${v.toLocaleString()}`} />;
    }

    if (active === 'utilities') {
      const UTIL_CATS = ['Water', 'Electricity', 'Garbage Collection', 'Utilities'];
      const visUtil = utilities.filter(u => canForPlot('reports.expenses', u.plot_id, plotPermissions));
      const fUtil   = filterByPeriod(visUtil, 'payment_date');
      const bills   = filterByPeriod(expenses.filter(e => UTIL_CATS.includes(e.category) && canForPlot('reports.expenses', e.plot_id, plotPermissions)), 'expense_date');
      const recovered = fUtil.reduce((s, u) => s + parseFloat(u.amount || 0), 0);
      const billed    = bills.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
      columns = ['Date', 'Tenant', 'Property / Unit', 'Utility', 'Amount (KES)', 'Method', 'Reference'];
      rows    = fUtil.map(u => ({
        Date: u.payment_date ? new Date(u.payment_date).toLocaleDateString('en-KE') : '—',
        Tenant: u.tenant_name || '—',
        'Property / Unit': `${u.plot_name || '—'}${u.unit_number ? ' · ' + u.unit_number : ''}`,
        Utility: u.utility_type || '—',
        'Amount (KES)': parseFloat(u.amount || 0).toLocaleString(),
        Method: u.method || '—',
        Reference: u.reference || '—',
      }));
      summary = [
        { label: 'Recovered from tenants', value: `KES ${recovered.toLocaleString()}`, color: 'var(--green)' },
        { label: 'Utility bills paid', value: `KES ${billed.toLocaleString()}`, color: 'var(--red)' },
        { label: 'Net utility cost', value: `KES ${(billed - recovered).toLocaleString()}`, color: (billed - recovered) > 0 ? 'var(--red)' : 'var(--green)' },
        { label: 'Receipts', value: fUtil.length, color: 'var(--muted)' },
      ];
      title = 'Utility Receipts';
      const byType = {};
      fUtil.forEach(u => { const k = u.utility_type || 'Other'; byType[k] = (byType[k] || 0) + parseFloat(u.amount || 0); });
      chart = <HBarChart title="Recovered by utility" series={[{ name: 'Recovered', color: 'var(--green)' }]}
        data={Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([label, v]) => ({ label, values: [v] }))} format={v => `KES ${v.toLocaleString()}`} />;
    }

    if (active === 'revenue') {
      // See canForPlot above — a property-specific revoke of
      // reports.revenue_summary leaves that property's payments out of the
      // totals rather than hiding the whole report.
      const visiblePayments = payments.filter(p => canForPlot('reports.revenue_summary', p.plot_id, plotPermissions));
      const byMonth = {};
      visiblePayments.filter(isCollected).filter(p => new Date(p.payment_date).getFullYear() === filters.year).forEach(p => {
        const m = new Date(p.payment_date).getMonth();
        if (!byMonth[m]) byMonth[m] = 0;
        byMonth[m] += parseFloat(p.amount || 0);
      });
      columns = ['Month', 'Revenue (KES)', 'Transactions'];
      rows    = months.map((m, i) => ({
        Month: `${m} ${filters.year}`,
        'Revenue (KES)': (byMonth[i] || 0).toLocaleString(),
        Transactions: visiblePayments.filter(isCollected).filter(p => new Date(p.payment_date).getMonth() === i && new Date(p.payment_date).getFullYear() === filters.year).length,
      }));
      const total = Object.values(byMonth).reduce((s, v) => s + v, 0);
      summary = [{ label: `Total ${filters.year}`, value: `KES ${total.toLocaleString()}`, color: 'var(--green)' }];
      title = `Revenue Summary ${filters.year}`;
      chart = <MiniBarChart data={months.map((m, i) => ({ label: m, value: byMonth[i] || 0 }))} color="var(--green, #16a34a)" />;
    }

    if (active === 'moveins') {
      // See canForPlot above — a property-specific revoke of
      // reports.move_in_out trims that property's tenants out rather than
      // hiding the whole report.
      const visibleTenants = tenants.filter(t => canForPlot('reports.move_in_out', t.plot_id, plotPermissions));
      const filtered = filterByPeriod(visibleTenants.filter(t => t.move_in_date), 'move_in_date');
      columns = ['Tenant', 'Phone', 'Unit', 'Plot', 'Move-in Date', 'Status'];
      rows    = filtered.map(t => ({
        Tenant: t.full_name,
        Phone: t.phone || '—',
        Unit: t.unit_number || `#${t.house_id}`,
        Plot: t.plot_name || '—',
        'Move-in Date': new Date(t.move_in_date).toLocaleDateString('en-KE'),
        Status: t.is_active ? 'Active' : 'Moved Out',
      }));
      summary = [{ label: 'Records', value: filtered.length, color: 'var(--primary)' }];
      title = 'Move-in / Move-out Report';
    }

    if (active === 'expiring') {
      // See canForPlot above — a property-specific revoke of
      // reports.expiring_leases trims that property's tenants out rather
      // than hiding the whole report.
      const visibleTenants = tenants.filter(t => canForPlot('reports.expiring_leases', t.plot_id, plotPermissions));
      const elevenMonthsAgo = new Date(); elevenMonthsAgo.setMonth(elevenMonthsAgo.getMonth() - 11);
      const expiring = visibleTenants.filter(t => t.is_active && t.move_in_date && new Date(t.move_in_date) <= elevenMonthsAgo);
      columns = ['Tenant', 'Phone', 'Unit', 'Plot', 'Move-in Date', 'Tenancy'];
      rows    = expiring.map(t => {
        const tenureMonths = Math.floor((new Date() - new Date(t.move_in_date)) / (1000 * 60 * 60 * 24 * 30));
        return {
          Tenant: t.full_name, Phone: t.phone || '—',
          Unit: t.unit_number || `#${t.house_id}`, Plot: t.plot_name || '—',
          'Move-in Date': new Date(t.move_in_date).toLocaleDateString('en-KE'),
          Tenancy: `${tenureMonths}m`,
        };
      });
      summary = [{ label: 'Expiring', value: expiring.length, color: 'var(--amber)' }];
      title = 'Expiring Leases Report';
    }

    if (active === 'rentroll') {
      const occupied = houses.filter(h => h.status === 'occupied' && (filters.landlord === 'all' || h.owner_name === filters.landlord));
      columns = ['Unit', 'Tenant', 'Plot', 'Rent (KES)', 'Balance (KES)', 'Status'];
      rows = occupied.map(h => {
        const t = tenants.find(t => t.house_id === h.id);
        return {
          Unit: `Unit ${h.unit_number}`,
          Tenant: t?.full_name || '—',
          Plot: h.plot_name || '—',
          'Rent (KES)': parseFloat(h.rent_amount || 0).toLocaleString(),
          'Balance (KES)': t ? parseFloat(t.balance || 0).toLocaleString() : '—',
          Status: t ? (parseFloat(t.balance || 0) > 0 ? 'Owing' : 'Paid Up') : 'No Tenant Record',
          _tenantId: t?.id || null,
        };
      });
      const totalRent = occupied.reduce((s, h) => s + parseFloat(h.rent_amount || 0), 0);
      const totalOwed = rows.reduce((s, r) => s + (parseFloat(String(r['Balance (KES)']).replace(/,/g, '')) || 0), 0);
      summary = [{ label: 'Occupied Units', value: occupied.length, color: 'var(--blue)' }, { label: 'Monthly Rent Roll', value: `KES ${totalRent.toLocaleString()}`, color: 'var(--green)' }, { label: 'Outstanding', value: `KES ${totalOwed.toLocaleString()}`, color: 'var(--red)' }];
      title = 'Rent Roll';
    }

    if (active === 'paymentmethods') {
      const filtered = filterByPeriod(payments.filter(isCollected), 'payment_date');
      const byMethod = {};
      filtered.forEach(p => {
        const m = p.method || 'mpesa';
        if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
        byMethod[m].count += 1;
        byMethod[m].total += parseFloat(p.amount || 0);
      });
      const grandTotal = filtered.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      columns = ['Method', 'Transactions', 'Total (KES)', '% of Total'];
      rows = Object.entries(byMethod).map(([method, v]) => ({
        Method: method,
        Transactions: v.count,
        'Total (KES)': v.total.toLocaleString(),
        '% of Total': grandTotal ? `${((v.total / grandTotal) * 100).toFixed(1)}%` : '0%',
      }));
      summary = [{ label: 'Total Collected', value: `KES ${grandTotal.toLocaleString()}`, color: 'var(--green)' }, { label: 'Transactions', value: filtered.length, color: 'var(--blue)' }];
      title = 'Payment Method Breakdown';
      chart = <HBarChart title="Collections by payment method" series={[{ name: 'Collected', color: 'var(--green)' }]}
        data={Object.entries(byMethod).sort((a, b) => b[1].total - a[1].total).map(([label, v]) => ({ label, values: [v.total] }))} format={v => `KES ${v.toLocaleString()}`} />;
    }

    if (active === 'performance') {
      const ranked = plots.filter(p => filters.landlord === 'all' || p.owner_name === filters.landlord).map(p => {
        const units    = houses.filter(h => h.plot_id === p.id);
        const occupied = units.filter(h => h.status === 'occupied');
        const revenue   = occupied.reduce((s, h) => s + parseFloat(h.rent_amount || 0), 0);
        const rate      = units.length ? Math.round((occupied.length / units.length) * 100) : 0;
        return { plot: p, units: units.length, revenue, rate };
      }).sort((a, b) => b.rate - a.rate || b.revenue - a.revenue);
      columns = ['Rank', 'Plot', 'Location', 'Occupancy Rate', 'Units', 'Monthly Revenue (KES)'];
      rows = ranked.map((r, i) => ({
        Rank: i + 1,
        Plot: r.plot.name,
        Location: r.plot.location || '—',
        'Occupancy Rate': `${r.rate}%`,
        Units: r.units,
        'Monthly Revenue (KES)': r.revenue.toLocaleString(),
      }));
      summary = ranked.length ? [
        { label: 'Best Performing', value: ranked[0].plot.name, color: 'var(--green)' },
        { label: 'Needs Attention', value: ranked[ranked.length - 1].plot.name, color: 'var(--red)' },
      ] : null;
      title = 'Property Performance — Ranked by Occupancy';
      chart = <HBarChart title="Occupancy rate by plot" series={[{ name: 'Occupancy', color: 'var(--blue)' }]} max={100}
        data={ranked.map(r => ({ label: r.plot.name, values: [r.rate] }))} format={v => `${v}%`} />;
    }

    if (active === 'tenure') {
      const active_tenants = tenants.filter(t => t.is_active && t.move_in_date);
      const withTenure = active_tenants.map(t => ({
        t, months: Math.floor((new Date() - new Date(t.move_in_date)) / (1000 * 60 * 60 * 24 * 30)),
      })).sort((a, b) => b.months - a.months);
      columns = ['Tenant', 'Unit', 'Plot', 'Move-in Date', 'Tenure (months)'];
      rows = withTenure.map(({ t, months }) => ({
        Tenant: t.full_name,
        Unit: t.unit_number || `#${t.house_id}`,
        Plot: t.plot_name || '—',
        'Move-in Date': new Date(t.move_in_date).toLocaleDateString('en-KE'),
        'Tenure (months)': months,
      }));
      const avg = withTenure.length ? Math.round(withTenure.reduce((s, x) => s + x.months, 0) / withTenure.length) : 0;
      summary = withTenure.length ? [
        { label: 'Average Tenure', value: `${avg} months`, color: 'var(--primary)' },
        { label: 'Longest-Staying', value: withTenure[0].t.full_name, color: 'var(--green)' },
      ] : null;
      title = 'Tenant Tenure Report';
    }

    if (active === 'assignments') {
      if (!isAdminOrAgent) {
        // Defense in depth — the sidebar already hides this entry for
        // landlord/caretaker, this just covers a stale pin or direct state
        // change. The underlying plots/users data is already scoped by the
        // backend to begin with, so there's no actual data exposure risk
        // either way; this is purely about keeping the menu uncluttered
        // for roles that don't need an org-wide view.
        columns = []; rows = []; summary = [];
        title = 'Property Assignments';
      } else {
        // Invert the caretaker->plots map (fetched per caretaker via
        // /auth/users/:id/plots) into plot->caretaker(s), same data the
        // Caretaker Workload report below already relies on. Falls back to
        // each caretaker's single legacy plot_id if they have no junction
        // rows at all.
        const caretakerByPlot = {};
        Object.entries(caretakerPlots || {}).forEach(([caretakerId, assignedPlots]) => {
          const caretaker = users.find(u => String(u.id) === String(caretakerId));
          const name = caretaker?.name || caretaker?.full_name;
          if (!name) return;
          (assignedPlots || []).forEach(p => {
            (caretakerByPlot[p.id] ||= []).push(name);
          });
        });
        users.filter(u => u.role === 'caretaker' && u.plot_id && !(caretakerPlots?.[u.id]?.length)).forEach(c => {
          (caretakerByPlot[c.plot_id] ||= []).push(c.name || c.full_name);
        });

        const filteredPlots = plots.filter(p =>
          (filters.landlord === 'all' || p.owner_name === filters.landlord) &&
          (filters.agent === 'all' || p.agent_name === filters.agent) &&
          (filters.caretaker === 'all' || (caretakerByPlot[p.id] || []).includes(filters.caretaker))
        );

        columns = ['Property', 'Location', 'Owner (Landlord)', 'Agent', 'Caretaker(s)', 'Units'];
        rows = filteredPlots.map(p => ({
          Property: p.name,
          Location: p.location || '—',
          'Owner (Landlord)': p.owner_name || '—',
          Agent: p.agent_name || '— none —',
          'Caretaker(s)': (caretakerByPlot[p.id] || []).join(', ') || '— none —',
          Units: houses.filter(h => h.plot_id === p.id).length,
        }));

        const withAgent     = filteredPlots.filter(p => p.agent_name).length;
        const withCaretaker = filteredPlots.filter(p => (caretakerByPlot[p.id] || []).length > 0).length;
        summary = [
          { label: 'Properties', value: filteredPlots.length, color: 'var(--primary)' },
          { label: 'With Agent', value: withAgent, color: 'var(--blue)' },
          { label: 'With Caretaker', value: withCaretaker, color: 'var(--green)' },
          { label: 'No Caretaker Yet', value: filteredPlots.length - withCaretaker, color: 'var(--red)' },
        ];
        title = filters.landlord !== 'all' || filters.agent !== 'all' || filters.caretaker !== 'all'
          ? `Property Assignments (filtered)` : 'Property Assignments';
      }
    }

    if (active === 'caretakerload') {
      // Uses the real caretaker_plots junction data (fetched per caretaker via
      // /auth/users/:id/plots), so a caretaker assigned to several properties
      // shows all of them, not just the single legacy plot_id.
      const caretakers = users.filter(u => u.role === 'caretaker');
      const filteredRequests = filterByPeriod(requests, 'reported_at');
      columns = ['Caretaker', 'Assigned Plots', 'Total Requests', 'Pending', 'Completed'];
      rows = caretakers.map(c => {
        const assignedPlots = (caretakerPlots && caretakerPlots[c.id]) || [];
        const plotIds       = assignedPlots.length ? assignedPlots.map(p => p.id) : (c.plot_id ? [c.plot_id] : []);
        const plotHouseIds  = houses.filter(h => plotIds.includes(h.plot_id)).map(h => h.id);
        const myRequests    = filteredRequests.filter(r => plotHouseIds.includes(r.house_id));
        const plotNames     = assignedPlots.length ? assignedPlots.map(p => p.name).join(', ') : (c.plot_name || '— unassigned —');
        return {
          Caretaker: c.name || c.full_name || '—',
          'Assigned Plots': plotNames,
          'Total Requests': myRequests.length,
          Pending: myRequests.filter(r => r.status === 'pending').length,
          Completed: myRequests.filter(r => r.status === 'completed').length,
        };
      });
      summary = [{ label: 'Caretakers', value: caretakers.length, color: 'var(--amber)' }, { label: 'Total Requests', value: filteredRequests.length, color: 'var(--muted)' }];
      title = 'Caretaker Workload';
    }

    if (active === 'depositledger') {
      columns = ['Tenant', 'Unit', 'Plot', 'Type', 'Amount (KES)', 'Date', 'Notes'];
      rows = (deposits || []).map(d => ({
        Tenant: d.tenant_name || '—',
        Unit: d.unit_number ? `Unit ${d.unit_number}` : '—',
        Plot: d.plot_name || '—',
        Type: d.type,
        'Amount (KES)': parseFloat(d.amount || 0).toLocaleString(),
        Date: new Date(d.created_at).toLocaleDateString('en-KE'),
        Notes: d.notes || '—',
      }));
      const collected = (deposits || []).filter(d => d.type === 'collected').reduce((s, d) => s + parseFloat(d.amount || 0), 0);
      const refunded  = (deposits || []).filter(d => d.type === 'refunded').reduce((s, d) => s + parseFloat(d.amount || 0), 0);
      const forfeited = (deposits || []).filter(d => d.type === 'forfeited').reduce((s, d) => s + parseFloat(d.amount || 0), 0);
      summary = [
        { label: 'Collected', value: `KES ${collected.toLocaleString()}`, color: 'var(--green)' },
        { label: 'Refunded', value: `KES ${refunded.toLocaleString()}`, color: 'var(--blue)' },
        { label: 'Forfeited', value: `KES ${forfeited.toLocaleString()}`, color: 'var(--red)' },
        { label: 'Held (Net)', value: `KES ${(collected - refunded - forfeited).toLocaleString()}`, color: 'var(--primary)' },
      ];
      title = 'Deposit Ledger';
    }

    if (active === 'audittrail') {
      const now = new Date();
      const userOf = (x) => x.user_name || (x.user_id != null ? `User #${x.user_id}` : 'System');
      const all = (auditLog || [])
        .map((x, i) => ({ ...x, _d: new Date(x.created_at), _id: x.id ?? `i${i}` }))
        .sort((x, y) => y._d - x._d);

      auditOptions = {
        actions:  [...new Set(all.map(x => x.action).filter(Boolean))].sort(),
        entities: [...new Set(all.map(x => x.entity_type).filter(Boolean))].sort(),
        users:    [...new Set(all.map(userOf))].sort(),
      };

      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const rangeStart = audit.range === 'today' ? todayStart
        : audit.range === '7d' ? new Date(now - 7 * 864e5)
        : audit.range === '30d' ? new Date(now - 30 * 864e5) : null;

      const matches = (x) =>
        (audit.action === 'all' || x.action === audit.action) &&
        (audit.entity === 'all' || x.entity_type === audit.entity) &&
        (audit.user === 'all' || userOf(x) === audit.user);

      const base = all.filter(matches);                                   // ignores the date range (used by the chart)
      const filtered = base.filter(x => !rangeStart || x._d >= rangeStart);

      columns = ['When', 'User', 'Action', 'Record', 'Changes'];
      rows = filtered.map(x => ({
        When: x._d.toLocaleString('en-KE'),
        User: userOf(x),
        Action: prettify(x.action),
        Record: `${prettify(x.entity_type)}${x.entity_id ? ' #' + x.entity_id : ''}`,
        Changes: changesText(x.changes),
        _entry: x, _user: userOf(x),
      }));

      const tally = (keyFn) => {
        const c = {};
        filtered.forEach(x => { const k = keyFn(x); c[k] = (c[k] || 0) + 1; });
        return Object.entries(c).sort((p, q) => q[1] - p[1])[0];
      };
      const topUser = tally(userOf), topEntity = tally(x => prettify(x.entity_type));
      summary = [
        { label: 'Actions', value: filtered.length, color: 'var(--primary)' },
        { label: 'Active users', value: new Set(filtered.map(userOf)).size, color: 'var(--blue)' },
        { label: 'Most active user', value: topUser ? `${topUser[0]} (${topUser[1]})` : '—', color: 'var(--green)' },
        { label: 'Most changed record', value: topEntity ? `${topEntity[0]} (${topEntity[1]})` : '—', color: 'var(--amber)' },
      ];

      const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (13 - i)); return d; });
      chart = (
        <div>
          <div className="rp-chart-head"><div className="rp-chart-title">Activity, last 14 days</div></div>
          <MiniBarChart color="var(--rp-primary)"
            data={days.map(d => ({ label: `${d.getDate()}/${d.getMonth() + 1}`, value: base.filter(x => x._d.toDateString() === d.toDateString()).length }))} />
        </div>
      );
      title = 'Audit Trail';
      note = 'Newest first. PINs, passwords and similar sensitive values are always masked.';
    }

    if (active === 'useractivity') {
      // One row per login "session" across BOTH tenants and staff: the
      // login time plus a count of what that person did afterwards —
      // 'checked' actions (statement views, report views, bulk downloads,
      // notice reads) and 'updated' actions (everything already tracked in
      // Audit Trail) side by side. Deliberately not an estimated session
      // duration — neither the tenant portal nor the staff dashboard track
      // logout (stateless JWTs), so a duration would just be a guess.
      const ROLE_LABELS = { tenant: 'Tenant', admin: 'Admin', landlord: 'Landlord', agent: 'Agent', caretaker: 'Caretaker' };
      const all = (userActivity || [])
        .map((x, i) => ({ ...x, _d: x.login_at ? new Date(x.login_at) : null, _id: i }))
        .sort((a, b) => (b._d || 0) - (a._d || 0));

      const filtered = activityRole === 'all' ? all : all.filter(x => x.role === activityRole);

      columns = ['Name', 'Role', 'Login Time', 'Activity Count', 'Breakdown'];
      rows = filtered.map(s => ({
        Name: s.user_name,
        Role: ROLE_LABELS[s.role] || prettify(s.role),
        'Login Time': s._d ? s._d.toLocaleString('en-KE') : 'Before tracking began',
        'Activity Count': s.activity_count,
        Breakdown: (s.breakdown || [])
          .map(b => `${b.count} ${activityActionLabel(b.action).toLowerCase()}`)
          .join(', ') || '—',
      }));

      const totalLogins = filtered.filter(s => s._d).length;
      const totalActivity = filtered.reduce((sum, s) => sum + s.activity_count, 0);
      const activeUsers = new Set(filtered.map(s => `${s.role}:${s.user_id}`)).size;
      const byUser = {};
      filtered.forEach(s => { const k = s.user_name; byUser[k] = (byUser[k] || 0) + s.activity_count; });
      const topUser = Object.entries(byUser).sort((a, b) => b[1] - a[1])[0];

      summary = [
        { label: 'Total Logins', value: totalLogins, color: 'var(--primary)' },
        { label: 'Users With Activity', value: activeUsers, color: 'var(--blue)' },
        { label: 'Total Activity Events', value: totalActivity, color: 'var(--green)' },
        { label: 'Most Active', value: topUser ? `${topUser[0]} (${topUser[1]})` : '—', color: 'var(--amber)' },
      ];
      title = 'User Activity';
      note = 'Newest login first. Shows login time plus a count of activity since that login — not an estimated session duration.';
    }
    if (active === 'comparison') {
      const periodTotal = (year, month, arrData, dateField) => arrData.filter(x => {
        if (!x[dateField]) return false;
        const d = new Date(x[dateField]);
        return d.getFullYear() === year && (month == null || d.getMonth() + 1 === month);
      }).reduce((s, x) => s + parseFloat(x.amount || 0), 0);

      const periodCount = (year, month, arrData, dateField) => arrData.filter(x => {
        if (!x[dateField]) return false;
        const d = new Date(x[dateField]);
        return d.getFullYear() === year && (month == null || d.getMonth() + 1 === month);
      }).length;

      let currentLabel, previousLabel, curYear, curMonth, prevYear, prevMonth;
      if (filters.comparisonMode === 'mom') {
        curYear = filters.year; curMonth = filters.month;
        prevMonth = curMonth - 1; prevYear = curYear;
        if (prevMonth < 1) { prevMonth = 12; prevYear -= 1; }
        currentLabel  = `${months[curMonth - 1]} ${curYear}`;
        previousLabel = `${months[prevMonth - 1]} ${prevYear}`;
      } else {
        curYear = filters.year; curMonth = null;
        prevYear = filters.year - 1; prevMonth = null;
        currentLabel = `${curYear}`;
        previousLabel = `${prevYear}`;
      }

      const collectedPayments = payments.filter(isCollected);
      const curRevenue  = periodTotal(curYear, curMonth, collectedPayments, 'payment_date');
      const prevRevenue = periodTotal(prevYear, prevMonth, collectedPayments, 'payment_date');
      const curTx  = periodCount(curYear, curMonth, collectedPayments, 'payment_date');
      const prevTx = periodCount(prevYear, prevMonth, collectedPayments, 'payment_date');
      const curExp  = periodTotal(curYear, curMonth, expenses, 'expense_date');
      const prevExp = periodTotal(prevYear, prevMonth, expenses, 'expense_date');

      columns = ['Metric', currentLabel, previousLabel, 'Change'];
      rows = [
        { Metric: 'Revenue (KES)',     [currentLabel]: curRevenue.toLocaleString(), [previousLabel]: prevRevenue.toLocaleString(), Change: pctChange(curRevenue, prevRevenue) },
        { Metric: 'Transactions',      [currentLabel]: curTx,                       [previousLabel]: prevTx,                       Change: pctChange(curTx, prevTx) },
        { Metric: 'Expenses (KES)',    [currentLabel]: curExp.toLocaleString(),     [previousLabel]: prevExp.toLocaleString(),     Change: pctChange(curExp, prevExp) },
      ];
      summary = [
        { label: currentLabel, value: `KES ${curRevenue.toLocaleString()}`, color: 'var(--blue)' },
        { label: previousLabel, value: `KES ${prevRevenue.toLocaleString()}`, color: 'var(--muted)' },
        { label: 'Revenue Change', value: pctChange(curRevenue, prevRevenue), color: curRevenue >= prevRevenue ? 'var(--green)' : 'var(--red)' },
      ];
      title = `Revenue Comparison — ${filters.comparisonMode === 'mom' ? 'Month over Month' : 'Year over Year'}`;
      chart = <MiniBarChart data={[{ label: previousLabel, value: prevRevenue }, { label: currentLabel, value: curRevenue }]} color="var(--blue, #2563eb)" />;
    }
  }

  // ── Generic search + sort, applied to whichever report is active ──────────
  let visibleRows = tableSearch
    ? rows.filter(r => columns.some(c => String(r[c] ?? '').toLowerCase().includes(tableSearch.toLowerCase())))
    : rows;
  if (sortCol && active !== 'audittrail') {
    visibleRows = [...visibleRows].sort((a, b) => {
      const av = sortableValue(a[sortCol]), bv = sortableValue(b[sortCol]);
      const cmp = (typeof av === 'number' && typeof bv === 'number') ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  // A report with a `permission` is hidden unless the user's role (or a
  // per-user override on top of it) grants that reports.* permission — see
  // the comment on REPORTS above. Reports with no `permission` field keep
  // their previous behavior and aren't affected by this check.
  const visibleReports = REPORTS.filter(r => (!r.adminAgentOnly || isAdminOrAgent) && (!r.permission || can(r.permission)));
  const pinnedReports = visibleReports.filter(r => pinned.includes(r.id));
  const otherReports   = visibleReports.filter(r => !pinned.includes(r.id));

  // If the currently-open report just became hidden (permissions changed
  // underneath the user, or they land here with a pinned report they've
  // since lost access to), fall back to the first one they can still see
  // instead of showing a blank/broken panel for a report they can't view.
  useEffect(() => {
    if (visibleReports.length === 0) return;
    if (!visibleReports.some(r => r.id === active)) setActive(visibleReports[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleReports.map(r => r.id).join(',')]);

  function renderReportItem(r) {
    const on = active === r.id;
    const isPinned = pinned.includes(r.id);
    return (
      <div key={r.id} className={`rp-item${on ? ' on' : ''}`} style={{ '--rp-tone': tone(r.color), '--rp-tint': soft(r.color, 16) }}>
        <button type="button" className="rp-item-main" onClick={() => setActive(r.id)} aria-current={on ? 'true' : undefined} title={r.desc}>
          <span className="rp-ico" aria-hidden="true">{r.icon}</span>
          <span className="rp-item-text">
            <div className="rp-item-label">{r.label}</div>
            <div className="rp-item-desc">{r.desc}</div>
          </span>
        </button>
        <button type="button" className={`rp-star${isPinned ? ' pinned' : ''}`} onClick={() => togglePin(r.id)}
          aria-label={isPinned ? `Unpin ${r.label}` : `Pin ${r.label} to top`} title={isPinned ? 'Unpin' : 'Pin to top'}>
          {isPinned ? '★' : '☆'}
        </button>
      </div>
    );
  }

  return (
    <div className="rp-page">
      <style>{STYLES}</style>

      <div className="rp-head no-print">
        <h1 className="rp-title">Reports</h1>
        <p className="rp-sub">Generate, filter and download reports</p>
      </div>

      <div className="rp-layout">

        {/* ── Left: report picker ── */}
        <nav className="rp-list no-print" aria-label="Reports">
          {pinnedReports.length > 0 && (
            <>
              <div className="rp-group">Pinned</div>
              {pinnedReports.map(renderReportItem)}
              <div className="rp-sep" />
              <div className="rp-group">All reports</div>
            </>
          )}
          {otherReports.map(renderReportItem)}
        </nav>

        {/* ── Right: report content ── */}
        <div className="rp-main">

          {/* Header */}
          <div className="rp-card rp-top" style={{ '--rp-tone': tone(report?.color), '--rp-tint': soft(report?.color, 16) }}>
            <div className="rp-top-title">
              <span className="rp-chip" aria-hidden="true">{report?.icon}</span>
              <div>
                <div className="rp-h2">{title || report?.label}</div>
                <div className="rp-desc">{report?.desc}</div>
              </div>
            </div>

            <div className="rp-controls no-print">
              {rows.length > 0 && <ExpandableSearch value={tableSearch} onChange={setTableSearch} />}

          {active === 'audittrail' && (
            <>
              <select className="rp-select" value={audit.range} onChange={e => setAudit(a => ({ ...a, range: e.target.value }))}>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All time</option>
              </select>
              <select className="rp-select" value={audit.action} onChange={e => setAudit(a => ({ ...a, action: e.target.value }))}>
                <option value="all">All actions</option>
                {auditOptions.actions.map(x => <option key={x} value={x}>{prettify(x)}</option>)}
              </select>
              <select className="rp-select" value={audit.entity} onChange={e => setAudit(a => ({ ...a, entity: e.target.value }))}>
                <option value="all">All records</option>
                {auditOptions.entities.map(x => <option key={x} value={x}>{prettify(x)}</option>)}
              </select>
              <select className="rp-select" value={audit.user} onChange={e => setAudit(a => ({ ...a, user: e.target.value }))}>
                <option value="all">All users</option>
                {auditOptions.users.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </>
          )}

          {active === 'useractivity' && (
            <select className="rp-select" value={activityRole} onChange={e => setActivityRole(e.target.value)}>
              <option value="all">All users</option>
              <option value="tenant">Tenants</option>
              <option value="admin">Admins</option>
              <option value="landlord">Landlords</option>
              <option value="agent">Agents</option>
              <option value="caretaker">Caretakers</option>
            </select>
          )}

          {active === 'paymenthistory' && (
            <select className="rp-select" value={historyTenantId} onChange={e => setHistoryTenantId(e.target.value)}>
              <option value="">— Select a tenant —</option>
              {(data.tenants || []).filter(t => canForPlot('reports.payment_collection', t.plot_id, data.plotPermissions)).sort((a, b) => a.full_name.localeCompare(b.full_name)).map(t => (
                <option key={t.id} value={t.id}>{t.full_name} — {t.unit_number ? `Unit ${t.unit_number}` : `#${t.house_id || '—'}`}</option>
              ))}
            </select>
          )}

          {/* Period filter */}
          {!NO_PERIOD_FILTER.includes(active) && (
            <select value={filters.period} onChange={e => setFilters(f => ({ ...f, period: e.target.value }))} className="rp-select">
              <option value="all">All Time</option>
              <option value="month">By Month</option>
              <option value="year">By Year</option>
              <option value="range">Custom Range</option>
            </select>
          )}

          {/* Custom date range */}
          {filters.period === 'range' && !NO_PERIOD_FILTER.includes(active) && (
            <>
              <input type="date" value={filters.fromDate} onChange={e => setFilters(f => ({ ...f, fromDate: e.target.value }))} className="rp-select" />
              <span className="rp-to">to</span>
              <input type="date" value={filters.toDate} onChange={e => setFilters(f => ({ ...f, toDate: e.target.value }))} className="rp-select" />
            </>
          )}

          {/* Month picker */}
          {((filters.period === 'month' && !NO_PERIOD_FILTER.includes(active)) || active === 'comparison') && (
            <select value={filters.month} onChange={e => setFilters(f => ({ ...f, month: parseInt(e.target.value) }))} className="rp-select">
              {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          )}

          {/* Year picker */}
          {((!NO_PERIOD_FILTER.includes(active) && filters.period !== 'all') || ['revenue', 'comparison', 'collection'].includes(active)) && (
            <select value={filters.year} onChange={e => setFilters(f => ({ ...f, year: parseInt(e.target.value) }))} className="rp-select">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}

          {/* Comparison mode */}
          {active === 'comparison' && (
            <select value={filters.comparisonMode} onChange={e => setFilters(f => ({ ...f, comparisonMode: e.target.value }))} className="rp-select">
              <option value="mom">Month over Month</option>
              <option value="yoy">Year over Year</option>
            </select>
          )}

          {/* Property + Location filters for Property Summary */}
          {active === 'properties' && (
            <>
              <select value={filters.propertyName} onChange={e => setFilters(f => ({ ...f, propertyName: e.target.value }))} className="rp-select">
                <option value="all">All Properties</option>
                {[...new Set((data.plots || []).map(p => p.name))].sort().map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <select value={filters.location} onChange={e => setFilters(f => ({ ...f, location: e.target.value }))} className="rp-select">
                <option value="all">All Locations</option>
                {[...new Set((data.plots || []).map(p => p.location).filter(Boolean))].sort().map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </>
          )}

          {/* Landlord filter — only meaningful when more than one landlord's data is visible (admin view) */}
          {['properties', 'tenants', 'performance', 'rentroll', 'profitloss', 'collection', 'vacancyloss', 'assignments'].includes(active) && [...new Set((data.plots || []).map(p => p.owner_name).filter(Boolean))].length > 1 && (
            <select value={filters.landlord} onChange={e => setFilters(f => ({ ...f, landlord: e.target.value }))} className="rp-select">
              <option value="all">All Landlords</option>
              {[...new Set((data.plots || []).map(p => p.owner_name).filter(Boolean))].sort().map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}

          {/* Agent filter — Property Assignments only */}
          {active === 'assignments' && [...new Set((data.plots || []).map(p => p.agent_name).filter(Boolean))].length > 1 && (
            <select value={filters.agent} onChange={e => setFilters(f => ({ ...f, agent: e.target.value }))} className="rp-select">
              <option value="all">All Agents</option>
              {[...new Set((data.plots || []).map(p => p.agent_name).filter(Boolean))].sort().map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}

          {/* Caretaker filter — Property Assignments only */}
          {active === 'assignments' && (data.users || []).filter(u => u.role === 'caretaker').length > 1 && (
            <select value={filters.caretaker} onChange={e => setFilters(f => ({ ...f, caretaker: e.target.value }))} className="rp-select">
              <option value="all">All Caretakers</option>
              {(data.users || []).filter(u => u.role === 'caretaker').map(u => u.name || u.full_name).filter(Boolean).sort().map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}

          {/* Status filter for tenants and maintenance */}
          {active === 'tenants' && (
            <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="rp-select">
              <option value="all">All Tenants</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
          )}
          {active === 'maintenance' && (
            <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="rp-select">
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          )}

              {/* Bulk tenant statements — only where it's meaningful */}
              {active === 'rentroll' && (
                <button type="button" className="rp-btn" onClick={downloadAllStatements}>📄 All statements (ZIP)</button>
              )}

              {['revenue', 'profitloss', 'properties', 'expenses', 'utilities'].includes(active) && (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="month" value={ownerMonth} onChange={e => setOwnerMonth(e.target.value)} className="rp-select" title="Statement month" />
                  <button type="button" className="rp-btn" onClick={downloadOwnerStatement}>🏢 Owner statement (PDF)</button>
                </span>
              )}

              {/* Print / Save as PDF — browsers' print dialog offers "Save as PDF" */}
              <button type="button" className="rp-btn" onClick={() => downloadPDF(columns, visibleRows, summary, title)} disabled={!columns.length}>📄 Download PDF</button>
              <button type="button" className="rp-btn" onClick={() => window.print()} title="Browser print of the on-screen page">🖨️ Print</button>

              {/* Download button */}
              <button type="button" className="rp-btn rp-btn-primary" onClick={() => downloadCSV(visibleRows, active)} disabled={!visibleRows.length}>
                ⬇ Download CSV
              </button>
            </div>
          </div>

          {/* Summary cards */}
          {summary && (
            <div className="rp-kpis">
              {summary.map(sm => (
                <div key={sm.label} className="rp-card rp-kpi" style={{ '--rp-tone': tone(sm.color) }}>
                  <div className="rp-kpi-label">{sm.label}</div>
                  <div className="rp-kpi-value">{sm.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Trend / comparison chart */}
          {chart && <div className="rp-card rp-chart">{chart}</div>}
          {note && <div className="rp-note">ⓘ {note}</div>}

          {/* Table */}
          <div className="rp-card rp-table-card">
            {loading ? (
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }} aria-busy="true">
                {[0, 1, 2, 3, 4].map(i => <div key={i} className="rp-skel" style={{ width: `${95 - i * 9}%` }} />)}
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="rp-state">
                {active === 'audittrail' && data.auditDenied ? (
                  <><strong>Audit trail is admin-only</strong>Your account does not have permission to view it.</>
                ) : active === 'useractivity' && data.userActivityDenied ? (
                  <><strong>User activity is admin-only</strong>Your account does not have permission to view it.</>
                ) : (
                  <>
                    <strong>{tableSearch ? 'No matches' : active === 'audittrail' ? 'No activity found' : active === 'useractivity' ? 'No activity found' : active === 'paymenthistory' ? 'No tenant selected' : active === 'assignments' && !isAdminOrAgent ? 'Not available' : 'No data for these filters'}</strong>
                    {tableSearch ? 'Try a different search term.' : active === 'audittrail' ? 'Try a longer date range or clear a filter.' : active === 'useractivity' ? 'No one has logged in since this feature shipped yet.' : active === 'paymenthistory' ? 'Pick a tenant above to see their payment and deposit history.' : active === 'assignments' && !isAdminOrAgent ? 'This report is only available to admin and agent accounts.' : 'Change the period or filters above to see results.'}
                  </>
                )}
              </div>
            ) : active === 'audittrail' ? (
              <AuditTable rows={visibleRows} open={auditOpen} toggle={(id) => setAuditOpen(o => ({ ...o, [id]: !o[id] }))} />
            ) : (
              <div className="rp-scroll">
                <table className="rp-table">
                  <thead>
                    <tr>
                      {columns.map(c => (
                        <th key={c} onClick={() => handleSort(c)}>
                          {c}{sortCol === c ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                      {active === 'rentroll' && <th className="no-print static">Statement</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, i) => (
                      <tr key={i}>
                        {columns.map(c => (
                          <td key={c}>
                            {c === 'Status' || c === 'Severity' ? (
                              <span className={`rp-badge rp-badge-${statusKind(row[c])}`}>{row[c]}</span>
                            ) : c.includes('KES') || c === 'Balance (KES)' ? (
                              <span className={`rp-money${isNegativeCol(c) || String(row[c]).trim().startsWith('-') ? ' neg' : ''}`}>{row[c]}</span>
                            ) : row[c]}
                          </td>
                        ))}
                        {active === 'rentroll' && (
                          <td className="no-print">
                            {row._tenantId ? (
                              <button type="button" className="rp-mini" onClick={() => downloadStatement(row._tenantId, row.Tenant)}>📄 PDF</button>
                            ) : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="rp-count">
            {visibleRows.length} record{visibleRows.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </div>
  );
}

// A search icon that expands into an input when clicked. Stays open while it
// has text; collapses on blur when empty or on Esc (which also clears it).
function ExpandableSearch({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const expanded = open || !!value;

  function openIt() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className={`rp-search${expanded ? ' open' : ''}`}>
      <button type="button" onClick={openIt} aria-label="Search this report" title="Search this report">🔍</button>
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => { if (e.key === 'Escape') { onChange(''); setOpen(false); e.currentTarget.blur(); } }}
        placeholder="Search this report…"
        tabIndex={expanded ? 0 : -1}
      />
      {value && (
        <button type="button" onClick={() => { onChange(''); inputRef.current?.focus(); }} aria-label="Clear search" style={{ fontSize: 16 }}>×</button>
      )}
    </div>
  );
}
