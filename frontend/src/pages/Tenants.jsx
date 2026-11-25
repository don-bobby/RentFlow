import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';
import Icon, { Caret } from '../components/Icon';
import TenantFormModal from '../components/TenantFormModal';

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Tracks the light/dark theme Layout.jsx sets via document.documentElement's
// data-theme attribute — same helper used on Dashboard.jsx and Properties.jsx.
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(el.getAttribute('data-theme') === 'dark'));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

// Collapses the per-row Edit/Set PIN/Deactivate/Erase buttons into a single
// "Actions ▾" dropdown — four always-visible buttons per row (plus a red
// Erase button only Bob's account sees) was cluttered, especially with 27
// rows on screen at once. Copied verbatim from Properties.jsx, which uses
// the same pattern for its plot/unit row actions.
function ActionMenu({ id, openMenu, setOpenMenu, items, size = 'md' }) {
  const btnRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const isOpen = openMenu === id;

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
        padding: size === 'sm' ? '4px 10px' : '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--surface)', fontSize: size === 'sm' ? 11 : 12, fontWeight: 600, color: 'var(--text)',
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>
        Actions <Caret />
      </button>
      {isOpen && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: 'var(--shadow-lg)', minWidth: 150, zIndex: 500, overflow: 'hidden',
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

export default function Tenants() {
  const [tenants,  setTenants]  = useState([]);
  const [allHouses,setAllHouses]= useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null); // null | 'add' | 'edit'
  const [editing,  setEditing]  = useState(null);
  const [search,   setSearch]   = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [statusFilter,   setStatusFilter]   = useState('all');
  const [moveInFrom,     setMoveInFrom]     = useState('');
  const [moveInTo,       setMoveInTo]       = useState('');
  const [moveInPreset,   setMoveInPreset]   = useState('any'); // any | month | 3m | year | custom
  const [owingIds,       setOwingIds]       = useState([]);   // set when arriving from the dashboard's "tenants with an outstanding balance"

  const [pinModal,  setPinModal]  = useState(null); // tenant object
  const [pin,       setPin]       = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError,  setPinError]  = useState('');
  const [pinSuccess,setPinSuccess]= useState('');

  const [deactivatingId, setDeactivatingId] = useState(null);

  // Erase modal — typing the tenant's own name is the confirmation gate,
  // since a plain window.confirm() is too easy to click through for
  // something this irreversible (unlike Deactivate, which just flips a
  // flag and can be undone by re-editing the tenant).
  const [eraseModal,   setEraseModal]   = useState(null); // tenant object
  const [eraseConfirm, setEraseConfirm] = useState('');
  const [eraseSaving,  setEraseSaving]  = useState(false);
  const [eraseError,   setEraseError]   = useState('');

  const { can, user } = useAuth();
  const [openMenu, setOpenMenu] = useState(null);
  // A flat global check misses a property-specific GRANT — someone whose
  // role doesn't have tenants.create at all, but who was given it for just
  // one property via an override, has no entry in user.permissions and so
  // would never see this button even though they're allowed to add a
  // tenant to that one property. So: show the button if tenants.create is
  // true for ANY property this user can see a unit in (global permission
  // included — can() already falls back to it when there's no per-plot
  // override), using the same per-plot allHouses data the row-level
  // Edit/Set PIN buttons below already check against.
  const addablePlotIds = [...new Set(allHouses.map(h => h.plot_id).filter(id => id != null))]
    .filter(plotId => can('tenants.create', plotId));
  const canAdd = addablePlotIds.length > 0;
  const isDark    = useIsDarkMode();
  const location  = useLocation();
  useEffect(() => { if (location.state?.search) setSearch(location.state.search); }, [location.state]); // from Ctrl+K quick search
  const navigate  = useNavigate();

  // From the dashboard ("N tenants have an outstanding balance"): show exactly those
  // tenants, highlighted, and scroll to the first one.
  useEffect(() => {
    const ids = location.state?.highlightTenantIds;
    if (ids?.length) {
      setOwingIds(ids);
      setSearch(''); setPropertyFilter('all'); setStatusFilter('all');
      setMoveInFrom(''); setMoveInTo(''); setMoveInPreset('any');
    }
  }, [location.state]);
  useEffect(() => {
    if (!owingIds.length || loading) return;
    const tm = setTimeout(() => document.getElementById(`tenant-row-${owingIds[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    return () => clearTimeout(tm);
  }, [owingIds, loading]);

  async function load() {
    setLoading(true);
    try {
      const [tr, hr] = await Promise.all([API.get('/tenants'), API.get('/houses')]);
      setTenants(Array.isArray(tr.data) ? tr.data : (tr.data.data || []));
      const ah = Array.isArray(hr.data) ? hr.data : (hr.data.data || []);
      setAllHouses(ah);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    function closeMenus() { setOpenMenu(null); }
    document.addEventListener('click', closeMenus);
    return () => document.removeEventListener('click', closeMenus);
  }, []);

  // Dashboard's "+ Add Tenant" quick action used to just navigate here and
  // leave the user to find and click "+ Add Tenant" again themselves on an
  // often-empty list. It now passes { openAddModal: true } in router state
  // (same convention Properties.jsx uses for highlightPlotId/highlightHouseId).
  // Gated on `!loading` because openAdd() seeds the unit dropdown from
  // `houses`, which isn't populated until load() finishes — opening earlier
  // would show an empty "— Select unit —" list with nothing else in it.
  // The replace-with-cleared-state afterward stops this from reopening the
  // modal on a back-navigation or refresh.
  useEffect(() => {
    if (location.state?.openAddModal && !loading && canAdd) {
      openAdd();
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, loading]);

  function openAdd() {
    setEditing(null);
    setModal('add');
  }

  function openEdit(tenant) {
    setEditing(tenant);
    setModal('edit');
  }

  async function handleSetPin() {
    if (!pin || pin.length < 4) { setPinError('PIN must be at least 4 digits.'); return; }
    setPinSaving(true); setPinError(''); setPinSuccess('');
    try {
      await API.patch(`/auth/tenants/${pinModal.id}/set-pin`, { pin });
      setPinSuccess(`PIN set successfully for ${pinModal.full_name}. They can now log in at /tenant/login`);
      setPin('');
    } catch (e) {
      setPinError(e.response?.data?.error || 'Failed to set PIN.');
    } finally { setPinSaving(false); }
  }

  async function handleDeactivate(t) {
    if (!window.confirm(`Deactivate ${t.full_name}? This frees their unit and blocks their tenant portal login. Their payment and maintenance history is kept, and this can be undone later by re-editing the tenant.`)) return;
    setDeactivatingId(t.id);
    try {
      await API.delete(`/tenants/${t.id}`);
      await load();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to deactivate tenant.');
    } finally {
      setDeactivatingId(null);
    }
  }

  function openErase(t) {
    setEraseModal(t);
    setEraseConfirm('');
    setEraseError('');
  }

  async function handleErase() {
    if (!eraseModal) return;
    if (eraseConfirm.trim() !== eraseModal.full_name) {
      setEraseError('Type the tenant\'s full name exactly to confirm.');
      return;
    }
    setEraseSaving(true); setEraseError('');
    try {
      await API.delete(`/tenants/${eraseModal.id}/permanent`);
      setEraseModal(null);
      await load();
    } catch (e) {
      // e.response?.data?.error is the server's own message when it
      // responded at all — if there's no response (route not reachable,
      // CORS, timeout, backend not yet restarted with this route), fall
      // back to axios's own e.message instead of a fixed generic string,
      // since that's usually the actual clue (e.g. "Network Error" vs.
      // "Request failed with status code 404" vs. a real server message).
      setEraseError(e.response?.data?.error || e.message || 'Failed to erase tenant.');
    } finally {
      setEraseSaving(false);
    }
  }

  function tenantPlotName(t) {
    return t.plot_name || allHouses.find(h => h.id === t.house_id)?.plot_name || '—';
  }

  // GET /tenants doesn't send back a numeric plot id (only the plot's
  // name, for display) — but /houses does, and it's already loaded here.
  // Needed so each row's Edit/Set PIN buttons can be checked against a
  // plot-specific permission override (can(permission, plotId)), matching
  // how the backend now checks these same two routes.
  function tenantPlotId(t) {
    return allHouses.find(h => h.id === t.house_id)?.plot_id ?? null;
  }

  // Whether this role can EVER manage a tenant row, regardless of
  // property — decides whether the table shows an Actions column at all
  // (vs. "Last Payment"). The per-row buttons below check the SAME
  // permission again, but for that row's specific property, since an
  // override could grant or revoke it for just one — so a particular row
  // can still end up with no buttons even when this is true.
  const canDeactivateAny = can('tenants.deactivate');
  // Not a permissions.includes() check like everything else here — this is
  // deliberately hardcoded to one specific login, per Bob's instruction
  // that permanent erase belongs to his account alone, not the admin role
  // (so another admin account, if one is ever created, does NOT get this).
  const isEraseAdmin = user?.email?.toLowerCase() === 'cfcbobby@tutamail.com';
  const canManageAny = can('tenants.edit') || can('tenants.set_pin') || canDeactivateAny || isEraseAdmin;

  const propertyOptions = [...new Set(allHouses.map(h => h.plot_name).filter(Boolean))].sort();

  const filtered = tenants.filter(t => {
    const matchesSearch = t.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.phone?.includes(search) ||
      t.email?.toLowerCase().includes(search.toLowerCase());
    const matchesProperty = propertyFilter === 'all' || tenantPlotName(t) === propertyFilter;
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? t.is_active : !t.is_active);
    const matchesMoveIn = (!moveInFrom || (t.move_in_date && t.move_in_date.slice(0, 10) >= moveInFrom)) &&
      (!moveInTo || (t.move_in_date && t.move_in_date.slice(0, 10) <= moveInTo));
    const matchesOwing = !owingIds.length || owingIds.includes(t.id);
    return matchesSearch && matchesProperty && matchesStatus && matchesMoveIn && matchesOwing;
  });
  if (owingIds.length) filtered.sort((a, b) => parseFloat(b.balance || 0) - parseFloat(a.balance || 0));
  if (owingIds.length) filtered.sort((a, b) => parseFloat(b.balance || 0) - parseFloat(a.balance || 0));   // largest balances first


  // ── Owing tenants: summary, CSV download and printable list ──────────────────
  const owingNowIds = tenants.filter(x => x.is_active && parseFloat(x.balance || 0) > 0).map(x => x.id);
  const owingRows   = filtered;                       // already sorted biggest balance first while the owing view is on
  const owingTotal  = owingRows.reduce((a, x) => a + parseFloat(x.balance || 0), 0);
  const todayStamp  = new Date().toISOString().slice(0, 10);

  // How far behind each tenant is: balance divided by their unit's monthly rent.
  const rentOf       = (x) => parseFloat(allHouses.find(h => h.id === x.house_id)?.rent_amount || 0);
  const monthsBehind = (x) => { const r = rentOf(x); return r > 0 ? parseFloat(x.balance || 0) / r : null; };
  const sevOf        = (x) => { const m = monthsBehind(x); return m == null ? 'red' : m >= 2 ? 'red' : m >= 1 ? 'amber' : 'low'; };
  const SEV = {
    red:   { bar: '#b42318', bg: 'var(--red-light, #fdecea)',     fg: 'var(--red, #b42318)',     label: '2+ months behind' },
    amber: { bar: '#b45309', bg: 'var(--amber-light, #fef3c7)',   fg: 'var(--amber, #b45309)',   label: '1 to 2 months behind' },
    low:   { bar: '#8a9a90', bg: 'var(--surface2, #f7faf7)',      fg: 'var(--text)',             label: 'Under 1 month' },
  };
  const sevCounts = owingRows.reduce((a, x) => { const k = sevOf(x); a[k] = (a[k] || 0) + 1; return a; }, {});
  const monthsText = (x) => { const m = monthsBehind(x); if (m == null) return ''; if (m < 0.95) return 'less than 1 month'; const r = Math.round(m * 10) / 10; return `about ${r} month${r === 1 ? '' : 's'}`; };

  function downloadOwingCsv() {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cols = ['Tenant', 'Phone', 'Email', 'Property', 'Unit', 'Move-in date', 'Rent due day', 'Monthly rent (KES)', 'Months behind', 'Rent balance (KES)'];
    const lines = [cols.map(q).join(',')];
    owingRows.forEach(x => lines.push([
      q(x.full_name), `="${String(x.phone || '').replace(/"/g, '')}"`, q(x.email), q(tenantPlotName(x)),
      q(x.unit_number ? `Unit ${x.unit_number}` : ''), q(x.move_in_date ? String(x.move_in_date).slice(0, 10) : ''),
      q(x.rent_due_day || ''), rentOf(x) || '', monthsBehind(x) == null ? '' : Math.round(monthsBehind(x) * 10) / 10, parseFloat(x.balance || 0),
    ].join(',')));
    lines.push([q('TOTAL'), '', '', '', '', '', '', '', '', owingTotal].join(','));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tenants-owing-${todayStamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function printOwing() {
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = owingRows.map((x, i) => `<tr><td>${i + 1}</td><td><b>${esc(x.full_name)}</b></td><td>${esc(x.phone)}</td><td>${esc(tenantPlotName(x))}</td><td>${esc(x.unit_number ? 'Unit ' + x.unit_number : '')}</td><td>${esc(monthsText(x))}</td><td style="text-align:right"><b>KES ${parseFloat(x.balance || 0).toLocaleString()}</b></td></tr>`).join('');
    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to print this list.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Tenants with outstanding balances</title>
      <style>body{font-family:'DM Sans',Arial,sans-serif;color:#0f1f17;margin:32px}h1{font-size:22px;margin:0 0 4px}p{margin:0 0 18px;color:#55645b;font-size:13px}
      table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#55645b;border-bottom:2px solid #cdd8d0;padding:8px}
      td{padding:8px;border-bottom:1px solid #e3e9e4}tfoot td{border-top:2px solid #0f1f17;border-bottom:0;font-size:14px}</style></head><body>
      <h1>Tenants with outstanding balances</h1>
      <p>${owingRows.length} tenant${owingRows.length !== 1 ? 's' : ''} &middot; KES ${owingTotal.toLocaleString()} in total &middot; ${new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <table><thead><tr><th>#</th><th>Tenant</th><th>Phone</th><th>Property</th><th>Unit</th><th>Behind</th><th style="text-align:right">Balance</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="6"><b>Total</b></td><td style="text-align:right"><b>KES ${owingTotal.toLocaleString()}</b></td></tr></tfoot></table></body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => w.print(), 300);
  }

  function toggleOwing() {
    if (owingIds.length) { setOwingIds([]); navigate(location.pathname, { replace: true, state: {} }); return; }
    setOwingIds(owingNowIds);
    setSearch(''); setPropertyFilter('all'); setStatusFilter('all'); setMoveInFrom(''); setMoveInTo(''); setMoveInPreset('any');
  }

  // ── Filter bar helpers ──────────────────────────────────────────────
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function applyMoveInPreset(preset) {
    setMoveInPreset(preset);
    const now = new Date();
    if (preset === 'any') { setMoveInFrom(''); setMoveInTo(''); }
    else if (preset === 'month') {
      setMoveInFrom(ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
      setMoveInTo(ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    } else if (preset === '3m') {
      setMoveInFrom(ymd(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())));
      setMoveInTo(ymd(now));
    } else if (preset === 'year') {
      setMoveInFrom(ymd(new Date(now.getFullYear(), 0, 1)));
      setMoveInTo(ymd(new Date(now.getFullYear(), 11, 31)));
    }
    // 'custom' keeps the current dates so they can be edited
  }

  const filtersActive = !!search.trim() || propertyFilter !== 'all' || statusFilter !== 'all' || moveInPreset !== 'any';
  function clearFilters() {
    setSearch(''); setPropertyFilter('all'); setStatusFilter('all'); applyMoveInPreset('any');
  }
  const statusCounts = {
    all: tenants.length,
    active: tenants.filter(t => t.is_active).length,
    inactive: tenants.filter(t => !t.is_active).length,
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 26, fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>Tenants</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{statusCounts.active} active tenants</p>
        </div>
        {canAdd && (
          <button onClick={openAdd}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary, #1b6b45)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
            + Add Tenant
          </button>
        )}
      </div>

      {/* Filter bar */}
      <style>{`.tenant-search-input::placeholder { color: ${isDark ? '#ffffff' : '#6b7280'}; opacity: ${isDark ? 0.75 : 1}; }`}</style>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>

          <div>
            <div style={filterLabelStyle}>Status</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([val, label]) => {
                const on = statusFilter === val && !owingIds.length;
                return (
                  <button key={val} onClick={() => { setStatusFilter(val); if (owingIds.length) { setOwingIds([]); navigate(location.pathname, { replace: true, state: {} }); } }} style={{
                    padding: '7px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--primary, #1b6b45)' : 'var(--border)'}`,
                    background: on ? 'var(--primary, #1b6b45)' : 'var(--surface)',
                    color: on ? '#fff' : 'var(--text)',
                  }}>
                    {label} <span style={{ opacity: 0.7, marginLeft: 2 }}>{statusCounts[val]}</span>
                  </button>
                );
              })}
              {owingNowIds.length > 0 && (
                <button onClick={toggleOwing} aria-pressed={owingIds.length > 0} style={{
                  padding: '7px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${owingIds.length ? 'var(--red, #b42318)' : 'var(--border)'}`,
                  background: owingIds.length ? 'var(--red-light, #fdecea)' : 'var(--surface)',
                  color: 'var(--red, #b42318)',
                }}>
                  Owing <span style={{ opacity: 0.8, marginLeft: 2 }}>{owingNowIds.length}</span>
                </button>
              )}
            </div>
          </div>

          <div style={{ minWidth: 170 }}>
            <div style={filterLabelStyle}>Property</div>
            <select value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}
              style={{ ...selectStyle, borderColor: propertyFilter !== 'all' ? 'var(--primary, #1b6b45)' : 'var(--border)' }}>
              <option value="all">All properties</option>
              {propertyOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div style={{ minWidth: 170 }}>
            <div style={filterLabelStyle}>Move-in date</div>
            <select value={moveInPreset} onChange={e => applyMoveInPreset(e.target.value)}
              style={{ ...selectStyle, borderColor: moveInPreset !== 'any' ? 'var(--primary, #1b6b45)' : 'var(--border)' }}>
              <option value="any">Any time</option>
              <option value="month">This month</option>
              <option value="3m">Last 3 months</option>
              <option value="year">This year</option>
              <option value="custom">Custom range…</option>
            </select>
          </div>

          {moveInPreset === 'custom' && (
            <>
              <div>
                <div style={filterLabelStyle}>From</div>
                <input type="date" value={moveInFrom} onChange={e => setMoveInFrom(e.target.value)} style={{ ...selectStyle, minWidth: 150 }} />
              </div>
              <div>
                <div style={filterLabelStyle}>To</div>
                <input type="date" value={moveInTo} onChange={e => setMoveInTo(e.target.value)} style={{ ...selectStyle, minWidth: 150 }} />
              </div>
            </>
          )}

          <ExpandableSearch value={search} onChange={setSearch} />

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Showing {filtered.length} of {tenants.length} tenants</span>
            {filtersActive && (
              <button onClick={clearFilters} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>Clear filters</button>
            )}
          </div>
        </div>
      </div>

      {owingIds.length > 0 && (
        <section role="status" aria-label="Tenants with an outstanding balance" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '4px solid var(--red, #b42318)', borderRadius: 14, padding: '18px 22px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 28 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Tenants owing</div>
              <div style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 28, color: 'var(--text)', lineHeight: 1.15 }}>{owingRows.length}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Total outstanding</div>
              <div style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 28, color: 'var(--red, #b42318)', lineHeight: 1.15 }}>KES {owingTotal.toLocaleString()}</div>
            </div>
            {owingRows[0] && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Largest balance</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginTop: 4 }}>{owingRows[0].full_name} · KES {parseFloat(owingRows[0].balance || 0).toLocaleString()}</div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button onClick={downloadOwingCsv} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 18px', borderRadius: 10, border: 'none', background: 'var(--primary, #1b6b45)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>Download CSV
            </button>
            <button onClick={printOwing} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              <Icon name="🖨️" size={16} />Print / PDF
            </button>
            <button onClick={toggleOwing} style={{ minHeight: 44, padding: '0 14px', border: 'none', background: 'none', color: 'var(--primary, #1b6b45)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Show all tenants</button>
          </div>
          <div style={{ flex: '1 0 100%', display: 'flex', flexWrap: 'wrap', gap: 20, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--muted)' }}>
            {['red', 'amber', 'low'].filter(k => sevCounts[k]).map(k => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <i aria-hidden="true" style={{ width: 4, height: 16, borderRadius: 2, background: SEV[k].bar, display: 'inline-block' }} />
                <b style={{ color: 'var(--text)' }}>{sevCounts[k]}</b> {SEV[k].label}
              </span>
            ))}
            <span>Left bar colour shows how far behind each tenant is (balance divided by monthly rent).</span>
          </div>
        </section>
      )}

      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>No tenants found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['Name', 'Phone', 'Unit', 'Property', 'Move-in', 'Rent Balance', 'Deposit', 'Status', ...(canManageAny ? [''] : ['Last Payment'])].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}{owingIds.length > 0 && /balance/i.test(h) ? ' \u2193' : ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                // Per-row, per-property check — a plot-specific override can
                // grant or revoke either of these for just this tenant's
                // property, separately from the role's normal default.
                const plotId     = tenantPlotId(t);
                const canEditRow = can('tenants.edit', plotId);
                const canSetPin  = can('tenants.set_pin', plotId);
                const canDeactivateRow = can('tenants.deactivate', plotId);
                const canManageRow = canEditRow || canSetPin || canDeactivateRow || isEraseAdmin;
                return (
                <tr key={t.id} id={`tenant-row-${t.id}`} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)', boxShadow: owingIds.includes(t.id) ? `inset 4px 0 0 ${SEV[sevOf(t)].bar}` : 'none' }}>
                  <td style={{ padding: '13px 20px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>{t.full_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.email}</div>
                  </td>
                  <td style={{ padding: '13px 20px', color: 'var(--muted)' }}>{t.phone}</td>
                  <td style={{ padding: '13px 20px', fontWeight: 600, color: 'var(--text)' }}>
                    {t.unit_number ? `Unit ${t.unit_number}` : `#${t.house_id}`}
                  </td>
                  <td style={{ padding: '13px 20px', color: 'var(--muted)' }}>{tenantPlotName(t)}</td>
                  <td style={{ padding: '13px 20px', color: 'var(--muted)', fontSize: 13, fontWeight: 500 }}>
                    {t.move_in_date ? new Date(t.move_in_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td style={{ padding: '13px 20px' }}>
                    {parseFloat(t.balance) > 0 ? (
                      <div>
                        <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 99, background: SEV[sevOf(t)].bg, color: SEV[sevOf(t)].fg, fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', border: sevOf(t) === 'low' ? '1px solid var(--border)' : '1px solid transparent' }}>
                          KES {parseFloat(t.balance).toLocaleString()}
                        </span>
                        {monthsText(t) && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{monthsText(t)} behind</div>}
                      </div>
                    ) : (
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--muted)' }}>KES 0</span>
                    )}
                  </td>
                  <td style={{ padding: '13px 20px', fontSize: 12 }}>
                    {(() => {
                      // required_deposit comes from the unit (houses.deposit); deposit_paid
                      // is what this tenant actually paid — two independent figures that
                      // used to have no visible relationship to each other at all.
                      const required = t.required_deposit != null ? parseFloat(t.required_deposit) : null;
                      const paid     = parseFloat(t.deposit_paid || 0);
                      if (required == null || required <= 0) {
                        return <span style={{ color: 'var(--muted)' }}>KES {paid.toLocaleString()}</span>;
                      }
                      const short = required - paid;
                      return short > 0 ? (
                        <span style={{ fontWeight: 700, color: 'var(--amber, #d97706)' }}>
                          KES {paid.toLocaleString()} / {required.toLocaleString()} — short {short.toLocaleString()}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--green, #16a34a)' }}>
                          KES {paid.toLocaleString()} / {required.toLocaleString()}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ padding: '13px 20px' }}>
                    <span style={{
                      background: isDark ? (t.is_active ? hexToRgba('#16a34a', 0.22) : hexToRgba('#dc2626', 0.22)) : (t.is_active ? 'var(--green-light)' : 'var(--red-light)'),
                      color: isDark ? (t.is_active ? '#4ade80' : '#f87171') : (t.is_active ? 'var(--green)' : 'var(--red)'),
                      padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                    }}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canManageAny ? (
                    <td style={{ padding: '13px 20px' }}>
                      {(() => {
                        const items = [
                          canEditRow && { label: 'Edit', onClick: () => openEdit(t) },
                          canSetPin && { label: 'Set PIN', onClick: () => { setPinModal(t); setPin(''); setPinError(''); setPinSuccess(''); } },
                          canDeactivateRow && t.is_active && {
                            label: deactivatingId === t.id ? 'Deactivating...' : 'Deactivate',
                            onClick: () => handleDeactivate(t),
                          },
                          isEraseAdmin && { label: 'Erase', onClick: () => openErase(t), danger: true },
                        ].filter(Boolean);
                        return items.length > 0
                          ? <ActionMenu id={t.id} size="sm" openMenu={openMenu} setOpenMenu={setOpenMenu} items={items} />
                          : null;
                      })()}
                    </td>
                  ) : (
                    <td style={{ padding: '13px 20px' }}>
                      {t.last_payment_amount ? (
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--green, #16a34a)' }}>
                            KES {parseFloat(t.last_payment_amount).toLocaleString()}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {t.last_payment_date ? new Date(t.last_payment_date).toLocaleDateString('en-KE') : ''}
                            {t.last_payment_method ? ` · ${t.last_payment_method}` : ''}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>No payments yet</span>
                      )}
                    </td>
                  )}
                </tr>
              );})}
            </tbody>
          </table>
        )}
      </div>

      {/* Set PIN Modal */}
      {pinModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 400, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 18, marginBottom: 6, color: 'var(--text)' }}>Set Portal PIN</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
              Setting PIN for <strong>{pinModal.full_name}</strong> ({pinModal.phone}). They will use this PIN to log into the tenant portal.
            </p>
            {pinError   && <div style={{ background: isDark ? hexToRgba('#dc2626', 0.2) : 'var(--red-light)',   color: isDark ? '#f87171' : 'var(--red)',   padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{pinError}</div>}
            {pinSuccess && <div style={{ background: isDark ? hexToRgba('#16a34a', 0.2) : 'var(--green-light)', color: isDark ? '#4ade80' : 'var(--green)', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{pinSuccess}</div>}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>New PIN (min 4 digits)</label>
              <input
                type="password" value={pin} onChange={e => setPin(e.target.value)}
                placeholder="e.g. 1234" maxLength={10}
                style={{ ...inputStyle, fontSize: 20, letterSpacing: 6, textAlign: 'center' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setPinModal(null)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Close</button>
              <button onClick={handleSetPin} disabled={pinSaving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary, #1b6b45)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {pinSaving ? 'Saving...' : 'Set PIN'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Erase Modal — admin-only (cfcbobby@tutamail.com), gated
          behind typing the tenant's exact full name since this is the one
          irreversible action in the whole app: the tenant row itself is
          deleted outright, not deactivated, and (per explicit instruction)
          their payments and maintenance requests are deleted along with
          them rather than kept — the whole trail disappears, not just the
          person record. */}
      {eraseModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-lg)', border: '2px solid var(--red, #dc2626)' }}>
            <h2 style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 18, marginBottom: 6, color: 'var(--red, #dc2626)' }}>
              Permanently Erase Tenant
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
              This deletes <strong>{eraseModal.full_name}</strong>'s record outright, along with all of their payment history and maintenance requests. It cannot be undone — unlike Deactivate.
            </p>
            {eraseError && <div style={{ background: isDark ? hexToRgba('#dc2626', 0.2) : 'var(--red-light)', color: isDark ? '#f87171' : 'var(--red)', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{eraseError}</div>}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Type <strong>{eraseModal.full_name}</strong> to confirm</label>
              <input
                type="text" value={eraseConfirm} onChange={e => setEraseConfirm(e.target.value)}
                placeholder={eraseModal.full_name}
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setEraseModal(null)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Cancel</button>
              <button
                onClick={handleErase}
                disabled={eraseSaving || eraseConfirm.trim() !== eraseModal.full_name}
                style={{
                  padding: '10px 20px', borderRadius: 10, border: 'none',
                  background: 'var(--red, #dc2626)', color: '#fff', fontWeight: 600, fontSize: 14,
                  opacity: (eraseConfirm.trim() !== eraseModal.full_name) ? 0.5 : 1,
                  cursor: (eraseConfirm.trim() !== eraseModal.full_name) ? 'not-allowed' : 'pointer',
                }}
              >
                {eraseSaving ? 'Erasing...' : 'Erase Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Modal — shared with the Dashboard (components/TenantFormModal.jsx) */}
      {modal && (
        <TenantFormModal
          mode={modal}
          tenant={editing}
          houses={allHouses}
          onClose={() => { setModal(null); setEditing(null); }}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none' };
const filterLabelStyle = { fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 };
const selectStyle = { width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: 'pointer', outline: 'none' };

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
    <div style={{
      display: 'flex', alignItems: 'center', flexShrink: 0, overflow: 'hidden',
      height: 40, width: expanded ? 260 : 40, maxWidth: '100%',
      transition: 'width 0.2s ease, border-color 0.15s',
      borderRadius: 10, background: 'var(--surface)',
      border: `1px solid ${expanded ? 'var(--primary, #1b6b45)' : 'var(--border)'}`,
    }}>
      <button type="button" onClick={openIt} aria-label="Search tenants" title="Search tenants"
        style={{ width: 38, height: 38, flex: 'none', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}><Icon name="🔍" size={18} /></button>
      <input
        ref={inputRef}
        className="tenant-search-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => { if (e.key === 'Escape') { onChange(''); setOpen(false); e.currentTarget.blur(); } }}
        placeholder="Name, phone or email…"
        tabIndex={expanded ? 0 : -1}
        style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 13, paddingRight: value ? 0 : 10 }}
      />
      {value && (
        <button type="button" onClick={() => { onChange(''); inputRef.current?.focus(); }} aria-label="Clear search"
          style={{ width: 30, height: 30, flex: 'none', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}>×</button>
      )}
    </div>
  );
}
