import { useState, useEffect } from 'react';
import API from '../services/api';

/* ------------------------------------------------------------------
   Styling lives in one scoped stylesheet so we can use :hover, media
   queries and the light/dark theme (Layout sets data-theme on <html>).
   Every colour has a fallback, so nothing disappears if a theme
   variable (e.g. --primary, --blue-light) isn't defined.
------------------------------------------------------------------- */
const STYLES = `
.mt-page {
  --mt-text: var(--text, #0f172a);
  --mt-muted: var(--muted, #64748b);
  --mt-surface: var(--surface, #ffffff);
  --mt-surface2: var(--surface2, #f1f5f9);
  --mt-border: var(--border, #e2e8f0);
  --mt-primary: var(--primary, #7c3aed);
  --mt-low: #3b82f6;  --mt-med: #f59e0b;  --mt-high: #ef4444;  --mt-ok: #10b981;
  --mt-low-t: #1d4ed8; --mt-med-t: #b45309; --mt-high-t: #b91c1c; --mt-ok-t: #047857;
  --mt-shadow: 0 1px 2px rgba(15,23,42,.04), 0 6px 20px rgba(15,23,42,.06);
  --mt-shadow-hover: 0 2px 4px rgba(15,23,42,.06), 0 14px 34px rgba(15,23,42,.12);
  color: var(--mt-text);
}
:root[data-theme="dark"] .mt-page {
  --mt-text: var(--text, #e5e7eb);
  --mt-muted: var(--muted, #94a3b8);
  --mt-surface: var(--surface, #1a1d2e);
  --mt-surface2: var(--surface2, #232740);
  --mt-border: var(--border, rgba(255,255,255,.08));
  --mt-low-t: #93c5fd; --mt-med-t: #fcd34d; --mt-high-t: #fca5a5; --mt-ok-t: #6ee7b7;
  --mt-shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
  --mt-shadow-hover: 0 2px 4px rgba(0,0,0,.4), 0 16px 36px rgba(0,0,0,.5);
}

.mt-page * { box-sizing: border-box; }
.mt-page button { font-family: inherit; cursor: pointer; }
.mt-page button:focus-visible,
.mt-page select:focus-visible,
.mt-page textarea:focus-visible { outline: 2px solid var(--mt-primary); outline-offset: 2px; }

/* Header */
.mt-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 22px; }
.mt-title { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 10px; color: var(--mt-text); }
.mt-stats { display: flex; gap: 8px; flex-wrap: wrap; }
.mt-stat { display: inline-flex; align-items: center; gap: 7px; padding: 5px 12px; border-radius: 99px; font-size: 13px; font-weight: 600; color: var(--mt-muted); background: var(--mt-surface); border: 1px solid var(--mt-border); }
.mt-dot { width: 8px; height: 8px; border-radius: 50%; }

.mt-new { display: inline-flex; align-items: center; gap: 8px; padding: 11px 20px; border-radius: 12px; border: none; background: var(--mt-primary); color: #fff; font-weight: 600; font-size: 14px; box-shadow: 0 6px 16px rgba(124,58,237,.28); transition: transform .15s, box-shadow .15s; }
.mt-new:hover { transform: translateY(-1px); box-shadow: 0 10px 22px rgba(124,58,237,.34); }
.mt-fab { display: none; }

/* Filters */
.mt-filters { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 12px; margin: 0 -2px 10px; scrollbar-width: none; }
.mt-filters::-webkit-scrollbar { display: none; }
.mt-chip { flex: none; display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 99px; border: 1px solid var(--mt-border); background: var(--mt-surface); color: var(--mt-muted); font-weight: 600; font-size: 13px; transition: background .15s, color .15s, border-color .15s; }
.mt-chip:hover { color: var(--mt-text); border-color: var(--mt-muted); }
.mt-chip[aria-pressed="true"] { background: var(--mt-primary); border-color: var(--mt-primary); color: #fff; }
.mt-chip-n { font-size: 12px; opacity: .75; }

/* Cards */
.mt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 16px; }
.mt-card { position: relative; display: flex; flex-direction: column; min-height: 176px; padding: 20px 20px 16px 24px; overflow: hidden;
  background: var(--mt-surface); border: 1px solid var(--mt-border); border-radius: 16px; box-shadow: var(--mt-shadow);
  transition: box-shadow .2s ease, transform .2s ease; }
.mt-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--mt-accent, var(--mt-border)); }
.mt-card:hover, .mt-card:focus-within { box-shadow: var(--mt-shadow-hover); transform: translateY(-2px); }
.mt-card-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; }
.mt-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.mt-id { font-size: 12px; color: var(--mt-muted); font-variant-numeric: tabular-nums; }
.mt-issue { margin: 0 0 8px; font-size: 16px; font-weight: 600; line-height: 1.45; color: var(--mt-text); word-break: break-word; }
.mt-who { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 13.5px; font-weight: 500; color: var(--mt-text); }
.mt-unit { padding: 2px 10px; border-radius: 8px; background: var(--mt-surface2); border: 1px solid var(--mt-border); font-size: 12px; font-weight: 600; white-space: nowrap; }
.mt-meta { font-size: 12.5px; color: var(--mt-muted); line-height: 1.5; }

.mt-badge { padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.mt-b-low,  .mt-b-in_progress { background: rgba(59,130,246,.14);  color: var(--mt-low-t); }
.mt-b-medium, .mt-b-pending   { background: rgba(245,158,11,.16);  color: var(--mt-med-t); }
.mt-b-high { background: rgba(239,68,68,.14);   color: var(--mt-high-t); }
.mt-b-completed { background: rgba(16,185,129,.15); color: var(--mt-ok-t); }

/* Quick actions: revealed on hover (mouse) or focus, always visible on touch */
.mt-actions { display: flex; gap: 8px; margin-top: auto; padding-top: 14px; }
.mt-act { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 10px; border-radius: 10px; border: none; font-weight: 600; font-size: 13px; transition: filter .15s, transform .1s; }
.mt-act:hover:not(:disabled) { filter: brightness(1.08); }
.mt-act:active:not(:disabled) { transform: scale(.97); }
.mt-act:disabled { opacity: .5; cursor: default; }
.mt-act-start { background: rgba(59,130,246,.14);  color: var(--mt-low-t); }
.mt-act-done  { background: rgba(16,185,129,.15); color: var(--mt-ok-t); }
@media (hover: hover) and (pointer: fine) {
  .mt-actions { opacity: 0; transform: translateY(6px); transition: opacity .18s ease, transform .18s ease; }
  .mt-card:hover .mt-actions, .mt-card:focus-within .mt-actions { opacity: 1; transform: none; }
}

/* Loading + empty */
.mt-skel { min-height: 176px; border-radius: 16px; border: 1px solid var(--mt-border); background: var(--mt-surface); animation: mt-pulse 1.3s ease-in-out infinite; }
@keyframes mt-pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
.mt-empty { padding: 56px 20px; text-align: center; color: var(--mt-muted); border: 1px dashed var(--mt-border); border-radius: 16px; background: var(--mt-surface); }
.mt-empty strong { display: block; color: var(--mt-text); font-size: 16px; margin-bottom: 6px; }

/* Modal (glass backdrop; bottom sheet on phones) */
.mt-overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(8,10,20,.45); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.mt-modal { width: 100%; max-width: 480px; max-height: 92vh; overflow-y: auto; padding: 26px; background: var(--mt-surface); border: 1px solid var(--mt-border); border-radius: 20px; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
.mt-modal h2 { font-family: 'Space Grotesk', sans-serif; font-size: 20px; font-weight: 700; margin: 0 0 18px; color: var(--mt-text); }
.mt-label { display: block; font-size: 13px; font-weight: 600; color: var(--mt-muted); margin-bottom: 6px; }
.mt-input { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid var(--mt-border); background: var(--mt-surface2); font-size: 14px; font-family: inherit; color: var(--mt-text); }
.mt-error { background: rgba(239,68,68,.14); color: var(--mt-high-t); padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; font-size: 13px; }
.mt-banner { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
.mt-banner button { background: none; border: none; color: inherit; font-size: 20px; line-height: 1; padding: 0 4px; }
.mt-modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 22px; }
.mt-btn { padding: 11px 20px; border-radius: 10px; font-weight: 600; font-size: 14px; border: 1px solid var(--mt-border); background: var(--mt-surface); color: var(--mt-text); }
.mt-btn-primary { background: var(--mt-primary); border-color: var(--mt-primary); color: #fff; }
.mt-btn:disabled { opacity: .6; cursor: default; }

/* Phones */
@media (max-width: 640px) {
  .mt-title { font-size: 24px; margin-bottom: 8px; }
  .mt-head { margin-bottom: 16px; }
  .mt-new { display: none; }
  .mt-fab { display: inline-flex; align-items: center; gap: 8px; position: fixed; right: 16px; bottom: calc(80px + env(safe-area-inset-bottom, 0px)); z-index: 40;
    padding: 14px 20px; border-radius: 99px; border: none; background: var(--mt-primary); color: #fff; font-weight: 600; font-size: 15px; box-shadow: 0 10px 26px rgba(124,58,237,.4); }
  .mt-grid { gap: 12px; }
  .mt-overlay { align-items: flex-end; padding: 0; }
  .mt-modal { max-width: none; border-radius: 20px 20px 0 0; padding: 22px 18px calc(22px + env(safe-area-inset-bottom, 0px)); }
  .mt-modal-actions .mt-btn { flex: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .mt-card, .mt-actions, .mt-new, .mt-act { transition: none; }
  .mt-card:hover, .mt-card:focus-within { transform: none; }
  .mt-skel { animation: none; }
}
`;

const ACCENT = { low: 'var(--mt-low)', medium: 'var(--mt-med)', high: 'var(--mt-high)' };
const STATUS_LABEL = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' };
const FILTERS = [['all', 'All'], ['pending', 'Pending'], ['in_progress', 'In progress'], ['completed', 'Completed']];

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-KE') : '');
const cap = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);

export default function Maintenance() {
  const [requests, setRequests] = useState([]);
  const [tenants,  setTenants]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [busyId,   setBusyId]   = useState(null);
  const [error,    setError]    = useState('');
  const [actionError, setActionError] = useState('');
  const [filter,   setFilter]   = useState('all');
  const [form,     setForm]     = useState({ tenant_id: '', issue: '', priority: 'medium' });
  const [permissions, setPermissions] = useState([]);
  function can(permission) {
    return permissions.includes('*') || permissions.includes(permission);
  }

  async function load() {
    setLoading(true);
    try {
      const [mr, tr, meR] = await Promise.all([
        API.get('/maintenance'),
        API.get('/tenants'),
        API.get('/auth/me'),
      ]);
      setRequests(Array.isArray(mr.data) ? mr.data : (mr.data.data || []));
      setTenants(Array.isArray(tr.data) ? tr.data : (tr.data.data || []));
      setPermissions(meR.data?.data?.permissions || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  // Run once on mount only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  // Esc closes the modal
  useEffect(() => {
    if (!modal) return;
    const onKey = (e) => { if (e.key === 'Escape') setModal(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  function openNew() {
    setForm({ tenant_id: tenants[0]?.id || '', issue: '', priority: 'medium' });
    setError('');
    setModal(true);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const tenant = tenants.find(t => String(t.id) === String(form.tenant_id));
      await API.post('/maintenance', { ...form, house_id: tenant?.house_id });
      await load();
      setModal(false);
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || e.message || 'Failed to save');
    } finally { setSaving(false); }
  }

  async function updateStatus(id, status) {
    setBusyId(id); setActionError('');
    try {
      const res = await API.patch(`/maintenance/${id}`, { status });
      const updated = res.data?.data;
      // Update the card in place (keeps tenant/unit details and avoids a full reload flash)
      setRequests(rs => rs.map(r => r.id === id ? { ...r, ...(updated || { status }) } : r));
    } catch (e) {
      console.error(e);
      setActionError(e.response?.data?.error || e.response?.data?.message || e.message || 'Could not update the request.');
    } finally { setBusyId(null); }
  }

  const count = (s) => requests.filter(r => r.status === s).length;
  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);
  const filterLabel = FILTERS.find(([v]) => v === filter)?.[1].toLowerCase();

  return (
    <div className="mt-page">
      <style>{STYLES}</style>

      <div className="mt-head">
        <div>
          <h1 className="mt-title">Maintenance</h1>
          <div className="mt-stats">
            <span className="mt-stat"><span className="mt-dot" style={{ background: 'var(--mt-med)' }} />{count('pending')} pending</span>
            <span className="mt-stat"><span className="mt-dot" style={{ background: 'var(--mt-low)' }} />{count('in_progress')} in progress</span>
          </div>
        </div>
        <button type="button" className="mt-new" onClick={openNew}>
          <span aria-hidden="true">+</span> New request
        </button>
      </div>

      <div className="mt-filters" role="group" aria-label="Filter requests by status">
        {FILTERS.map(([value, label]) => (
          <button key={value} type="button" className="mt-chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label} <span className="mt-chip-n">{value === 'all' ? requests.length : count(value)}</span>
          </button>
        ))}
      </div>

      {actionError && (
        <div className="mt-error mt-banner" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError('')} aria-label="Dismiss">×</button>
        </div>
      )}

      {loading ? (
        <div className="mt-grid" aria-busy="true">
          {[0, 1, 2].map(i => <div key={i} className="mt-skel" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-empty">
          <strong>{filter === 'all' ? 'No maintenance requests yet' : `No ${filterLabel} requests`}</strong>
          {filter === 'all' ? 'Select New request to log the first one.' : 'Try a different filter.'}
        </div>
      ) : (
        <div className="mt-grid">
          {filtered.map(r => {
            const busy = busyId === r.id;
            return (
              <article key={r.id} className="mt-card"
                style={{ '--mt-accent': r.status === 'completed' ? 'var(--mt-ok)' : (ACCENT[r.priority] || 'var(--mt-border)') }}>
                <div className="mt-card-top">
                  <div className="mt-badges">
                    <span className={`mt-badge mt-b-${r.priority}`}>{cap(r.priority)} priority</span>
                    <span className={`mt-badge mt-b-${r.status}`}>{STATUS_LABEL[r.status] || cap(r.status?.replace('_', ' '))}</span>
                  </div>
                  <span className="mt-id">#{r.id}</span>
                </div>

                <p className="mt-issue">{r.issue}</p>
                {(r.tenant_name || r.unit_number) && (
                  <div className="mt-who">
                    {r.tenant_name && <span className="mt-tenant">👤 {r.tenant_name}</span>}
                    {r.unit_number && (
                      <span className="mt-unit">{r.plot_name ? `${r.plot_name} · ` : ''}Unit {r.unit_number}</span>
                    )}
                  </div>
                )}
                <div className="mt-meta">
                  <div>
                    Reported {fmtDate(r.reported_at)}
                    {r.resolved_at && ` · Resolved ${fmtDate(r.resolved_at)}`}
                  </div>
                </div>

                {/* Previously shown to anyone regardless of permission — a
                    landlord_with_agent (restricted from maintenance.update)
                    could see and click these buttons, which the backend then
                    had to reject. Gating on can() here means the buttons
                    simply aren't there for someone who can't use them,
                    matching the fix already made on the Properties page. */}
                {r.status !== 'completed' && can('maintenance.update') && (
                  <div className="mt-actions">
                    {r.status === 'pending' && (
                      <button type="button" className="mt-act mt-act-start" disabled={busy} onClick={() => updateStatus(r.id, 'in_progress')}>
                        <span aria-hidden="true">▶</span> Start work
                      </button>
                    )}
                    <button type="button" className="mt-act mt-act-done" disabled={busy} onClick={() => updateStatus(r.id, 'completed')}>
                      <span aria-hidden="true">✓</span> Mark done
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Floating button on phones */}
      <button type="button" className="mt-fab" onClick={openNew} aria-label="New maintenance request">
        <span aria-hidden="true">+</span> New request
      </button>

      {modal && (
        <div className="mt-overlay" onClick={() => setModal(false)}>
          <div className="mt-modal" role="dialog" aria-modal="true" aria-labelledby="mt-modal-title" onClick={e => e.stopPropagation()}>
            <h2 id="mt-modal-title">New maintenance request</h2>
            {error && <div className="mt-error">{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="mt-label" htmlFor="mt-tenant">Tenant</label>
                <select id="mt-tenant" className="mt-input" value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}>
                  {tenants.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.full_name} — Unit {t.unit_number ?? t.house_id}</option>)}
                </select>
              </div>
              <div>
                <label className="mt-label" htmlFor="mt-issue">What needs fixing?</label>
                <textarea id="mt-issue" className="mt-input" rows={4} style={{ resize: 'vertical' }}
                  value={form.issue} onChange={e => setForm(f => ({ ...f, issue: e.target.value }))}
                  placeholder="Describe the issue, e.g. leaking tap in the kitchen" />
              </div>
              <div>
                <label className="mt-label" htmlFor="mt-priority">Priority</label>
                <select id="mt-priority" className="mt-input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                  {['low', 'medium', 'high'].map(p => <option key={p} value={p}>{cap(p)}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-modal-actions">
              <button type="button" className="mt-btn" onClick={() => setModal(false)}>Cancel</button>
              <button type="button" className="mt-btn mt-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
