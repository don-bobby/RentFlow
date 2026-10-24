// frontend/src/pages/Expenses.jsx
//
// Talks to backend/routes/expenses.js. Every action button is gated by the
// live permission list from AuthContext, same pattern as Properties.jsx:
//   view          -> page only renders once expenses.view is confirmed
//   expenses.add    -> "+ Add Expense" button + form
//   expenses.edit   -> Edit action per row
//   expenses.delete -> Delete action per row (danger-styled, confirms first)
//
// A plot_id is required from the person's own visible plots — the backend
// scope check (getVisiblePlotIds) is the real enforcement; this just avoids
// offering choices that would be rejected anyway.

import { useState, useEffect, useRef } from 'react';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = ['Repairs', 'Water', 'Electricity', 'Garbage Collection', 'Utilities', 'Cleaning', 'Security', 'Salaries', 'Insurance', 'Rates', 'Other'];

const CATEGORY_STYLE = {
  Repairs:   { icon: '🔧', color: 'var(--amber, #d97706)',   bg: 'var(--amber-light, #fef3c7)' },
  Water:      { icon: '💧', color: '#0891b2',                 bg: 'rgba(8,145,178,0.12)'        },
  Electricity:{ icon: '⚡', color: 'var(--amber, #d97706)',   bg: 'var(--amber-light, #fef3c7)' },
  'Garbage Collection': { icon: '🗑️', color: 'var(--green, #16a34a)', bg: 'var(--green-light, #dcfce7)' },
  Utilities: { icon: '💡', color: 'var(--blue, #2563eb)',    bg: 'var(--blue-light, #dbeafe)'  },
  Cleaning:  { icon: '🧹', color: 'var(--green, #16a34a)',   bg: 'var(--green-light, #dcfce7)' },
  Security:  { icon: '🛡️', color: 'var(--red, #dc2626)',     bg: 'var(--red-light, #fee2e2)'   },
  Salaries:  { icon: '💼', color: 'var(--primary, #7c3aed)', bg: 'var(--primary-light, #ede9fe)' },
  Insurance: { icon: '🛟', color: '#0891b2',                 bg: 'rgba(8,145,178,0.12)'        },
  Rates:     { icon: '🏛️', color: '#4f46e5',                 bg: 'rgba(79,70,229,0.12)'        },
  Other:     { icon: '📦', color: 'var(--muted)',            bg: 'var(--surface2)'             },
};

function ActionMenu({ id, openMenu, setOpenMenu, items }) {
  const btnRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const isOpen = openMenu === id;

  if (!items.length) return null;

  function toggle(e) {
    e.stopPropagation();
    if (!isOpen && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.right });
    }
    setOpenMenu(isOpen ? null : id);
  }

  return (
    <div style={{ display: 'inline-block' }}>
      <button ref={btnRef} onClick={toggle} style={{
        padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--surface)', fontSize: 11, fontWeight: 600, color: 'var(--text)',
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>
        Actions <span style={{ fontSize: 9 }}>▾</span>
      </button>
      {isOpen && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: 'var(--shadow-lg)', minWidth: 140, zIndex: 500, overflow: 'hidden',
        }}>
          {items.map((it, i) => (
            <button key={i} onClick={() => { it.onClick(); setOpenMenu(null); }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{ display: 'block', width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', fontSize: 13, fontWeight: it.danger ? 700 : 500, color: it.danger ? 'var(--red, #dc2626)' : 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 };
const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13 };

export default function Expenses() {
  const { can } = useAuth();

  const [expenses, setExpenses] = useState([]);
  const [plots, setPlots]       = useState([]);
  const [houses, setHouses]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null); // expense being edited, or null for "add"
  const blankForm = { plot_id: '', house_id: '', category: CATEGORIES[0], description: '', amount: '', expense_date: '', receipt_url: '' };
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  // Recurring expense templates (garbage collection, water, electricity,
  // etc.) — a daily backend job turns each active one into a real expense
  // row once a month. This is just template CRUD; the generated expenses
  // themselves show up in the regular table above with a 🔁 badge.
  const [utilReceipts, setUtilReceipts]     = useState([]); // utility money recovered from tenants
  const [showUtil, setShowUtil]             = useState(false);
  const [utilPlot, setUtilPlot]             = useState('all');
  const [utilMonth, setUtilMonth]           = useState('all'); // 'all' or 'YYYY-MM'
  const [recurring, setRecurring]           = useState([]);
  const [showRecurring, setShowRecurring]   = useState(false);
  const [showRecForm, setShowRecForm]       = useState(false);
  const [editingRec, setEditingRec]         = useState(null);
  const blankRecForm = { plot_id: '', house_id: '', category: CATEGORIES[0], description: '', amount: '', day_of_month: 1 };
  const [recForm, setRecForm]               = useState(blankRecForm);
  const [recSaving, setRecSaving]           = useState(false);
  const [recError, setRecError]             = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const canEditSomething = can('expenses.add') || can('expenses.edit');
        const requests = [API.get('/expenses'), API.get('/recurring-expenses')];
        if (canEditSomething) { requests.push(API.get('/plots')); requests.push(API.get('/houses')); }
        const [er, rr, pr, hr] = await Promise.all(requests);
        setExpenses(er.data.data || []);
        setRecurring(rr.data.data || []);
        try { const ur = await API.get('/utilities'); setUtilReceipts(ur.data.data || []); } catch { setUtilReceipts([]); }
        setPlots(pr ? (Array.isArray(pr.data) ? pr.data : pr.data.data || []) : []);
        setHouses(hr ? (Array.isArray(hr.data) ? hr.data : hr.data.data || []) : []);
      } catch (e) {
        setError(e.response?.data?.error || 'Failed to load expenses.');
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const close = () => setOpenMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  function openAdd() {
    setEditing(null);
    setForm(blankForm);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(exp) {
    setEditing(exp);
    setForm({
      plot_id: exp.plot_id || '',
      house_id: exp.house_id || '',
      category: exp.category || CATEGORIES[0],
      description: exp.description || '',
      amount: exp.amount ?? '',
      expense_date: exp.expense_date ? exp.expense_date.slice(0, 10) : '',
      receipt_url: exp.receipt_url || '',
    });
    setFormError(null);
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.amount || !form.expense_date) {
      setFormError('Amount and date are required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      ...form,
      plot_id: form.plot_id === '' ? null : form.plot_id,
      house_id: form.house_id === '' ? null : form.house_id,
      amount: parseFloat(form.amount),
    };
    try {
      if (editing) {
        const res = await API.put(`/expenses/${editing.id}`, payload);
        setExpenses(list => list.map(x => x.id === editing.id ? res.data.data : x));
      } else {
        const res = await API.post('/expenses', payload);
        setExpenses(list => [res.data.data, ...list]);
      }
      setShowForm(false);
    } catch (e) {
      setFormError(e.response?.data?.error || 'Failed to save expense.');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm(exp) {
    try {
      const res = await API.patch(`/expenses/${exp.id}/confirm`);
      setExpenses(list => list.map(x => x.id === exp.id ? res.data.data : x));
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to confirm expense.');
    }
  }

  async function handleDelete(exp) {
    if (!window.confirm(`Delete this ${exp.category || 'expense'} of KES ${Number(exp.amount).toLocaleString()}?`)) return;
    try {
      await API.delete(`/expenses/${exp.id}`);
      setExpenses(list => list.filter(x => x.id !== exp.id));
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to delete expense.');
    }
  }

  function openAddRecurring() {
    setEditingRec(null);
    setRecForm(blankRecForm);
    setRecError(null);
    setShowRecForm(true);
  }

  function openEditRecurring(tmpl) {
    setEditingRec(tmpl);
    setRecForm({
      plot_id: tmpl.plot_id || '',
      house_id: tmpl.house_id || '',
      category: tmpl.category || CATEGORIES[0],
      description: tmpl.description || '',
      amount: tmpl.amount ?? '',
      day_of_month: tmpl.day_of_month || 1,
    });
    setRecError(null);
    setShowRecForm(true);
  }

  async function handleSaveRecurring(e) {
    e.preventDefault();
    if (!recForm.plot_id || !recForm.amount) {
      setRecError('Property and amount are required.');
      return;
    }
    setRecSaving(true);
    setRecError(null);
    const payload = {
      ...recForm,
      house_id: recForm.house_id === '' ? null : recForm.house_id,
      amount: parseFloat(recForm.amount),
      day_of_month: parseInt(recForm.day_of_month, 10) || 1,
    };
    try {
      if (editingRec) {
        const res = await API.put(`/recurring-expenses/${editingRec.id}`, payload);
        setRecurring(list => list.map(x => x.id === editingRec.id ? res.data.data : x));
      } else {
        const res = await API.post('/recurring-expenses', payload);
        setRecurring(list => [res.data.data, ...list]);
      }
      setShowRecForm(false);
    } catch (e) {
      setRecError(e.response?.data?.error || 'Failed to save recurring expense.');
    } finally {
      setRecSaving(false);
    }
  }

  async function handleToggleRecurring(tmpl) {
    try {
      const res = await API.patch(`/recurring-expenses/${tmpl.id}/toggle`);
      setRecurring(list => list.map(x => x.id === tmpl.id ? res.data.data : x));
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to update recurring expense.');
    }
  }

  async function handleDeleteRecurring(tmpl) {
    if (!window.confirm(`Stop the recurring ${tmpl.category} of KES ${Number(tmpl.amount).toLocaleString()}/month? Expenses it already generated are kept.`)) return;
    try {
      await API.delete(`/recurring-expenses/${tmpl.id}`);
      setRecurring(list => list.filter(x => x.id !== tmpl.id));
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to delete recurring expense.');
    }
  }

  const total = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
  const filtered = categoryFilter === 'all' ? expenses : expenses.filter(e => e.category === categoryFilter);
  const filteredTotal = filtered.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
  const UTILITY_CATS = ['Water', 'Electricity', 'Garbage Collection', 'Utilities'];
  const ym = (d) => String(d || '').slice(0, 7);
  const inUtilScope = (plotId, date) =>
    (utilPlot === 'all' || String(plotId) === utilPlot) && (utilMonth === 'all' || ym(date) === utilMonth);
  const utilExpenses = expenses.filter(e => UTILITY_CATS.includes(e.category) && inUtilScope(e.plot_id, e.expense_date));
  const utilScoped   = utilReceipts.filter(u => inUtilScope(u.plot_id, u.payment_date));
  const utilityCost = utilExpenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
  const utilityRecovered = utilScoped.reduce((sum, u) => sum + parseFloat(u.amount || 0), 0);
  const utilPlotOptions = [...new Map([...expenses, ...utilReceipts].filter(x => x.plot_id).map(x => [String(x.plot_id), x.plot_name || `Plot ${x.plot_id}`])).entries()];
  const utilMonthOptions = [...new Set([
    ...expenses.filter(e => UTILITY_CATS.includes(e.category)).map(e => ym(e.expense_date)),
    ...utilReceipts.map(u => ym(u.payment_date)),
  ].filter(Boolean))].sort().reverse();
  const categoriesPresent = CATEGORIES.filter(c => expenses.some(e => e.category === c));

  if (error) return <div style={{ padding: 24, color: 'var(--red, #dc2626)' }}>{error}</div>;

  return (
    <div style={{ padding: 4 }} onClick={() => setOpenMenu(null)}>
      <style>{`
        .ex-row { transition: background 0.12s ease; }
        .ex-row:hover { background: var(--primary-light, #ede9fe) !important; }
        .ex-skel { background: var(--surface2); border-radius: 6px; animation: ex-pulse 1.3s ease-in-out infinite; }
        @keyframes ex-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .ex-row, .ex-skel { transition: none; animation: none; } }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', color: 'var(--text)' }}>Expenses</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
            {expenses.length} record{expenses.length !== 1 ? 's' : ''} · KES {total.toLocaleString()} total
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {(can('expenses.add') || can('expenses.edit')) && (
            <button onClick={() => setShowRecurring(true)} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              🔁 Recurring{recurring.filter(r => r.is_active).length > 0 ? ` (${recurring.filter(r => r.is_active).length})` : ''}
            </button>
          )}
          {can('expenses.add') && (
            <button onClick={openAdd} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              + Add Expense
            </button>
          )}
        </div>
      </div>

      {!loading && (expenses.some(e => UTILITY_CATS.includes(e.category)) || utilReceipts.length > 0) && (
        <div style={{ marginBottom: 20, padding: 16, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <select value={utilPlot} onChange={e => setUtilPlot(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12 }}>
              <option value="all">All properties</option>
              {utilPlotOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={utilMonth} onChange={e => setUtilMonth(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12 }}>
              <option value="all">All months</option>
              {utilMonthOptions.map(m => <option key={m} value={m}>{new Date(m + '-01').toLocaleString('en-KE', { month: 'long', year: 'numeric' })}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
            <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Utility bills paid</div><div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>KES {utilityCost.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Recovered from tenants</div><div style={{ fontWeight: 700, fontSize: 18, color: 'var(--green, #16a34a)' }}>KES {utilityRecovered.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Net utility cost</div><div style={{ fontWeight: 700, fontSize: 18, color: (utilityCost - utilityRecovered) > 0 ? 'var(--red, #dc2626)' : 'var(--green, #16a34a)' }}>KES {(utilityCost - utilityRecovered).toLocaleString()}</div></div>
            {utilScoped.length > 0 && (
              <button onClick={() => setShowUtil(v => !v)} style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                {showUtil ? 'Hide' : 'View'} tenant receipts ({utilScoped.length})
              </button>
            )}
          </div>
          {showUtil && (
            <div style={{ marginTop: 14, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  {['Date', 'Tenant', 'Unit', 'Utility', 'Amount', 'Method'].map(h => <th key={h} style={{ padding: '6px 8px', fontWeight: 600 }}>{h}</th>)}
                </tr></thead>
                <tbody>{utilScoped.map(u => (
                  <tr key={u.id} style={{ borderTop: '1px solid var(--border)', color: 'var(--text)' }}>
                    <td style={{ padding: '6px 8px' }}>{String(u.payment_date).slice(0, 10)}</td>
                    <td style={{ padding: '6px 8px' }}>{u.tenant_name}</td>
                    <td style={{ padding: '6px 8px' }}>{u.plot_name}{u.unit_number ? ` · ${u.unit_number}` : ''}</td>
                    <td style={{ padding: '6px 8px' }}>{u.utility_type}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>KES {parseFloat(u.amount).toLocaleString()}</td>
                    <td style={{ padding: '6px 8px' }}>{u.method || '—'}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading && categoriesPresent.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <button onClick={() => setCategoryFilter('all')} style={{ padding: '7px 16px', borderRadius: 99, border: '1px solid var(--border)', background: categoryFilter === 'all' ? 'var(--primary, #7c3aed)' : 'var(--surface)', color: categoryFilter === 'all' ? '#fff' : 'var(--muted)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>All</button>
          {categoriesPresent.map(c => (
            <button key={c} onClick={() => setCategoryFilter(c)} style={{ padding: '7px 16px', borderRadius: 99, border: '1px solid var(--border)', background: categoryFilter === c ? (CATEGORY_STYLE[c]?.color || 'var(--primary)') : 'var(--surface)', color: categoryFilter === c ? '#fff' : 'var(--muted)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              {CATEGORY_STYLE[c]?.icon} {c}
            </button>
          ))}
          {categoryFilter !== 'all' && (
            <div style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--primary, #7c3aed)', fontSize: 14, display: 'flex', alignItems: 'center' }}>
              KES {filteredTotal.toLocaleString()}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius, 10px)', padding: 20 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0' }}>
              <div className="ex-skel" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
              <div className="ex-skel" style={{ height: 14, width: `${35 + (i * 9) % 35}%` }} />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 'var(--radius, 10px)' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🧾</div>
          {expenses.length === 0 ? 'No expenses recorded yet.' : `No ${categoryFilter} expenses.`}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius, 10px)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Property</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Category</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Description</th>
                <th style={{ textAlign: 'right', padding: '10px 14px' }}>Amount</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Status</th>
                <th style={{ padding: '10px 14px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(exp => {
                const cat = CATEGORY_STYLE[exp.category] || CATEGORY_STYLE.Other;
                return (
                <tr key={exp.id} className="ex-row" style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 14px', color: 'var(--text)' }}>{exp.expense_date ? new Date(exp.expense_date).toLocaleDateString('en-KE') : '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text)' }}>
                    {exp.plot_name || <span style={{ color: 'var(--muted)' }}>General</span>}
                    {exp.unit_number && <span style={{ color: 'var(--muted)', fontSize: 12 }}> · Unit {exp.unit_number}</span>}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {exp.category ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cat.bg, color: cat.color, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                        {cat.icon} {exp.category}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>
                    {exp.description || '—'}
                    {exp.recurring_expense_id && (
                      <span title="Generated from a recurring template" style={{ marginLeft: 6, fontSize: 11, color: 'var(--primary, #7c3aed)' }}>🔁</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>KES {Number(exp.amount).toLocaleString()}</td>
                  <td style={{ padding: '10px 14px' }}>
                    {exp.status === 'pending' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--amber-light, #fef3c7)', color: 'var(--amber, #d97706)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
                        ⏳ Pending{exp.created_by_name ? ` · ${exp.created_by_name}` : ''}
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--green-light, #dcfce7)', color: 'var(--green, #16a34a)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
                        ✓ Confirmed
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <ActionMenu id={exp.id} openMenu={openMenu} setOpenMenu={setOpenMenu} items={[
                      ...(exp.status === 'pending' && can('expenses.edit') ? [{ label: 'Confirm', onClick: () => handleConfirm(exp) }] : []),
                      ...(can('expenses.edit')   ? [{ label: 'Edit',   onClick: () => openEdit(exp) }] : []),
                      ...(can('expenses.delete') ? [{ label: exp.status === 'pending' ? 'Reject (delete)' : 'Delete', onClick: () => handleDelete(exp), danger: true }] : []),
                    ]} />
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div onClick={() => setShowForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}>
          <form onClick={e => e.stopPropagation()} onSubmit={handleSave} style={{ background: 'var(--surface)', borderRadius: 14, padding: 28, width: 420, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>{editing ? 'Edit Expense' : 'Add Expense'}</h3>
            {formError && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', fontSize: 13, marginBottom: 14 }}>{formError}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Property</label>
                <select value={form.plot_id} onChange={e => setForm(f => ({ ...f, plot_id: e.target.value, house_id: '' }))} style={inputStyle}>
                  <option value="">— General (not tied to a property) —</option>
                  {plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Unit <span style={{ textTransform: 'none', fontWeight: 400 }}>— optional</span></label>
                <select value={form.house_id} onChange={e => setForm(f => ({ ...f, house_id: e.target.value }))} style={inputStyle} disabled={!form.plot_id}>
                  <option value="">— Whole property —</option>
                  {houses.filter(h => String(h.plot_id) === String(form.plot_id)).map(h => (
                    <option key={h.id} value={h.id}>Unit {h.unit_number}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Category</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Amount (KES)</label>
                <input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={inputStyle} placeholder="e.g. Plumbing repair — Unit 4" />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Date</label>
              <input type="date" value={form.expense_date} onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} style={inputStyle} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Receipt URL <span style={{ textTransform: 'none', fontWeight: 400 }}>— optional</span></label>
              <input value={form.receipt_url} onChange={e => setForm(f => ({ ...f, receipt_url: e.target.value }))} style={inputStyle} placeholder="https://…" />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setShowForm(false)} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={saving} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Recurring Expenses panel — lists every template (active + paused) */}
      {showRecurring && (
        <div onClick={() => setShowRecurring(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, width: 640, maxWidth: '92vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>Recurring Expenses</h3>
              {can('expenses.add') && (
                <button onClick={openAddRecurring} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  + Add Recurring
                </button>
              )}
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 14px' }}>
              Bills like garbage collection, water, or electricity that repeat every month — a background job creates each month's expense automatically on its due day.
            </p>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {recurring.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 10 }}>
                  No recurring expenses set up yet.
                </div>
              ) : (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  {recurring.map((tmpl, i) => {
                    const cat = CATEGORY_STYLE[tmpl.category] || CATEGORY_STYLE.Other;
                    return (
                      <div key={tmpl.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderTop: i === 0 ? 'none' : '1px solid var(--border)', opacity: tmpl.is_active ? 1 : 0.55 }}>
                        <span style={{ fontSize: 18 }}>{cat.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
                            {tmpl.category} — KES {Number(tmpl.amount).toLocaleString()}/mo
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {tmpl.plot_name || 'General'}{tmpl.unit_number ? ` · Unit ${tmpl.unit_number}` : ' · Whole property'} · Day {tmpl.day_of_month} of each month
                          </div>
                        </div>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
                          background: tmpl.is_active ? 'var(--green-light, #dcfce7)' : 'var(--surface2)',
                          color: tmpl.is_active ? 'var(--green, #16a34a)' : 'var(--muted)',
                        }}>
                          {tmpl.is_active ? 'Active' : 'Paused'}
                        </span>
                        {can('expenses.edit') && (
                          <>
                            <button onClick={() => handleToggleRecurring(tmpl)} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
                              {tmpl.is_active ? 'Pause' : 'Resume'}
                            </button>
                            <button onClick={() => openEditRecurring(tmpl)} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, fontWeight: 600, color: 'var(--primary, #7c3aed)', cursor: 'pointer' }}>
                              Edit
                            </button>
                          </>
                        )}
                        {can('expenses.delete') && (
                          <button onClick={() => handleDeleteRecurring(tmpl)} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, fontWeight: 700, color: 'var(--red, #dc2626)', cursor: 'pointer' }}>
                            Delete
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setShowRecurring(false)} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontWeight: 600, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Recurring Expense form */}
      {showRecForm && (
        <div onClick={() => setShowRecForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 450 }}>
          <form onClick={e => e.stopPropagation()} onSubmit={handleSaveRecurring} style={{ background: 'var(--surface)', borderRadius: 14, padding: 28, width: 420, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>{editingRec ? 'Edit Recurring Expense' : 'Add Recurring Expense'}</h3>
            {recError && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', fontSize: 13, marginBottom: 14 }}>{recError}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Property</label>
                <select value={recForm.plot_id} onChange={e => setRecForm(f => ({ ...f, plot_id: e.target.value, house_id: '' }))} style={inputStyle}>
                  <option value="">— Select property —</option>
                  {plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Unit <span style={{ textTransform: 'none', fontWeight: 400 }}>— optional</span></label>
                <select value={recForm.house_id} onChange={e => setRecForm(f => ({ ...f, house_id: e.target.value }))} style={inputStyle} disabled={!recForm.plot_id}>
                  <option value="">— Whole property —</option>
                  {houses.filter(h => String(h.plot_id) === String(recForm.plot_id)).map(h => (
                    <option key={h.id} value={h.id}>Unit {h.unit_number}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Category</label>
                <select value={recForm.category} onChange={e => setRecForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Amount (KES/month)</label>
                <input type="number" min="0" step="0.01" value={recForm.amount} onChange={e => setRecForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Description <span style={{ textTransform: 'none', fontWeight: 400 }}>— optional</span></label>
                <input value={recForm.description} onChange={e => setRecForm(f => ({ ...f, description: e.target.value }))} style={inputStyle} placeholder="e.g. County garbage levy" />
              </div>
              <div>
                <label style={labelStyle}>Day of month</label>
                <input type="number" min="1" max="28" value={recForm.day_of_month} onChange={e => setRecForm(f => ({ ...f, day_of_month: e.target.value }))} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setShowRecForm(false)} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={recSaving} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: recSaving ? 'default' : 'pointer', opacity: recSaving ? 0.7 : 1 }}>
                {recSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
