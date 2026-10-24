// Ctrl+K / Cmd+K quick search: jump to any tenant, unit, property or payment
// reference. Loads its data lazily the first time it opens (the same
// permission-scoped endpoints every page already uses), then filters locally.
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';

const arr = (d) => (Array.isArray(d) ? d : d?.data || []);

export default function QuickSearch() {
  const navigate = useNavigate();
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [active, setActive]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
      else if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-quick-search', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-quick-search', onOpen); };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery(''); setActive(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    if (data || loading) return;
    setLoading(true);
    Promise.allSettled([API.get('/tenants'), API.get('/houses'), API.get('/plots'), API.get('/payments')])
      .then(([t, h, p, pay]) => setData({
        tenants:  t.status === 'fulfilled' ? arr(t.value.data) : [],
        houses:   h.status === 'fulfilled' ? arr(h.value.data) : [],
        plots:    p.status === 'fulfilled' ? arr(p.value.data) : [],
        payments: pay.status === 'fulfilled' ? arr(pay.value.data) : [],
      }))
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const has = (...vals) => vals.some(v => v != null && String(v).toLowerCase().includes(q));
    const out = [];
    data.tenants.filter(t => has(t.full_name, t.phone, t.national_id, t.email)).slice(0, 6).forEach(t =>
      out.push({ key: `t${t.id}`, icon: '👤', title: t.full_name, sub: `Tenant · ${t.plot_name || '—'}${t.unit_number ? ' · ' + t.unit_number : ''}${t.phone ? ' · ' + t.phone : ''}`, to: '/tenants', state: { search: t.full_name } }));
    data.houses.filter(h => has(h.unit_number, h.house_type, h.plot_name)).slice(0, 5).forEach(h =>
      out.push({ key: `h${h.id}`, icon: '🏠', title: `Unit ${h.unit_number}`, sub: `${h.plot_name || '—'} · ${h.status || ''}`, to: '/properties' }));
    data.plots.filter(p => has(p.name, p.location)).slice(0, 4).forEach(p =>
      out.push({ key: `p${p.id}`, icon: '🏢', title: p.name, sub: `Property${p.location ? ' · ' + p.location : ''}`, to: '/properties' }));
    data.payments.filter(p => has(p.receipt_no, p.tenant_name)).slice(0, 5).forEach(p =>
      out.push({ key: `y${p.id}`, icon: '💳', title: `KES ${parseFloat(p.amount || 0).toLocaleString()} · ${p.tenant_name || 'Unmatched'}`, sub: `Payment · ${p.receipt_no || 'no ref'} · ${String(p.payment_date || '').slice(0, 10)}`, to: '/payments', state: p.tenant_id ? { tenantId: p.tenant_id } : undefined }));
    return out;
  }, [data, query]);

  useEffect(() => { setActive(0); }, [query]);

  function go(r) {
    setOpen(false);
    navigate(r.to, r.state ? { state: r.state } : undefined);
  }

  function onInputKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) go(results[active]);
  }

  if (!open) return null;
  return (
    <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, margin: '0 16px', background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onInputKey}
          placeholder="Search tenants, units, properties, payment refs…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '16px 18px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: 15, outline: 'none' }} />
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 18, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>}
          {!loading && query.trim().length < 2 && <div style={{ padding: 18, color: 'var(--muted)', fontSize: 13 }}>Type at least 2 characters. ↑↓ to move, Enter to open, Esc to close.</div>}
          {!loading && query.trim().length >= 2 && results.length === 0 && <div style={{ padding: 18, color: 'var(--muted)', fontSize: 13 }}>No matches.</div>}
          {results.map((r, i) => (
            <div key={r.key} onClick={() => go(r)} onMouseEnter={() => setActive(i)}
              style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 18px', cursor: 'pointer', background: i === active ? 'var(--primary-light, #ede9fe)' : 'transparent' }}>
              <span style={{ fontSize: 18 }}>{r.icon}</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</div>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
