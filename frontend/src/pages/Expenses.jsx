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

const CATEGORIES = ['Repairs', 'Utilities', 'Cleaning', 'Security', 'Salaries', 'Insurance', 'Rates', 'Other'];

const CATEGORY_STYLE = {
  Repairs:   { icon: '🔧', color: 'var(--amber, #d97706)',   bg: 'var(--amber-light, #fef3c7)' },
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
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null); // expense being edited, or null for "add"
  const blankForm = { plot_id: '', category: CATEGORIES[0], description: '', amount: '', expense_date: '', receipt_url: '' };
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const requests = [API.get('/expenses')];
        if (can('expenses.add') || can('expenses.edit')) requests.push(API.get('/plots'));
        const [er, pr] = await Promise.all(requests);
        setExpenses(er.data.data || []);
        setPlots(pr ? (Array.isArray(pr.data) ? pr.data : pr.data.data || []) : []);
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

  async function handleDelete(exp) {
    if (!window.confirm(`Delete this ${exp.category || 'expense'} of KES ${Number(exp.amount).toLocaleString()}?`)) return;
    try {
      await API.delete(`/expenses/${exp.id}`);
      setExpenses(list => list.filter(x => x.id !== exp.id));
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to delete expense.');
    }
  }

  const total = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
  const filtered = categoryFilter === 'all' ? expenses : expenses.filter(e => e.category === categoryFilter);
  const filteredTotal = filtered.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
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
        {can('expenses.add') && (
          <button onClick={openAdd} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            + Add Expense
          </button>
        )}
      </div>

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
                <th style={{ padding: '10px 14px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(exp => {
                const cat = CATEGORY_STYLE[exp.category] || CATEGORY_STYLE.Other;
                return (
                <tr key={exp.id} className="ex-row" style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 14px', color: 'var(--text)' }}>{exp.expense_date ? new Date(exp.expense_date).toLocaleDateString('en-KE') : '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text)' }}>{exp.plot_name || <span style={{ color: 'var(--muted)' }}>General</span>}</td>
                  <td style={{ padding: '10px 14px' }}>
                    {exp.category ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: cat.bg, color: cat.color, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                        {cat.icon} {exp.category}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>{exp.description || '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>KES {Number(exp.amount).toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <ActionMenu id={exp.id} openMenu={openMenu} setOpenMenu={setOpenMenu} items={[
                      ...(can('expenses.edit')   ? [{ label: 'Edit',   onClick: () => openEdit(exp) }] : []),
                      ...(can('expenses.delete') ? [{ label: 'Delete', onClick: () => handleDelete(exp), danger: true }] : []),
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

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Property</label>
              <select value={form.plot_id} onChange={e => setForm(f => ({ ...f, plot_id: e.target.value }))} style={inputStyle}>
                <option value="">— General (not tied to a property) —</option>
                {plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
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
    </div>
  );
}
