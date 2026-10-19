import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';

function getUser() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return null; }
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Tracks the light/dark theme Layout.jsx sets via document.documentElement's
// data-theme attribute.
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

// A single "Actions" button that opens a small dropdown menu, replacing a row
// of separate buttons (Add Unit / Edit / Delete, or Edit / Delete). Renders
// the menu with position:fixed (computed from the button's own position) so
// it isn't clipped by the plot card's overflow:hidden.
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
        Actions <span style={{ fontSize: 9 }}>▾</span>
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

export default function Properties() {
  const [plots,     setPlots]     = useState([]);
  const [houses,    setHouses]    = useState([]);
  const [tenants,   setTenants]   = useState([]); // for showing occupant name/phone/balance on occupied unit cards
  const [landlords, setLandlords] = useState([]);
  const [caretakers, setCaretakers] = useState([]);
  const [agents,     setAgents]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null);
  const [editing,   setEditing]   = useState(null);
  const [form,      setForm]      = useState({});
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search,          setSearch]          = useState('');
  const [ownerFilter,     setOwnerFilter]     = useState('all'); // 'all' | owner id
  const [caretakerFilter, setCaretakerFilter] = useState('all'); // 'all' | 'none' | caretaker id
  const [agentFilter,     setAgentFilter]     = useState('all'); // 'all' | 'none' | agent id

  // Let Esc close the Add/Edit Plot/Unit modal, same as clicking Cancel
  useEffect(() => {
    if (!modal) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') { setModal(null); setEditing(null); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modal]);

  // Backing state for openMediaManager/handleMediaUpload/deleteMedia below —
  // these were referencing undeclared variables (a no-undef build error).
  // Currently unused by any button/modal in this file; declared here just to
  // fix the compile error without inventing a UI that wasn't asked for.
  const [mediaUnit, setMediaUnit] = useState(null);
  const [media,     setMedia]     = useState([]);
  const [mediaErr,  setMediaErr]  = useState('');
  const [uploading, setUploading] = useState(false);

  const user = getUser();
  const location = useLocation();
  const navigate = useNavigate();
  const plotRefs = useRef({}); // plot.id -> DOM node, for scrollIntoView
  const houseRefs = useRef({}); // house.id -> DOM node, for scrollIntoView
  const [highlightPlotId, setHighlightPlotId] = useState(location.state?.highlightPlotId || null);
  const [highlightHouseId, setHighlightHouseId] = useState(location.state?.highlightHouseId || null);
  const [expandedPlotIds, setExpandedPlotIds] = useState(() => new Set());
  const isAdmin    = user?.role === 'admin';
  const isAgent    = user?.role === 'agent';
  const isCaretaker = user?.role === 'caretaker';
  const isDark      = useIsDarkMode();
  const [openMenu, setOpenMenu] = useState(null);

  useEffect(() => {
    function closeMenus() { setOpenMenu(null); }
    document.addEventListener('click', closeMenus);
    return () => document.removeEventListener('click', closeMenus);
  }, []);



  // Previously this page fetched GET /auth/me itself and built its own
  // can() from the flat permissions list — which never saw per-property
  // overrides at all, not even global ones. AuthContext (already used by
  // Tenants/Payments/Users/Notices) has all of this from the same /me
  // call the whole app already makes once on load, so this both drops a
  // duplicate request and fixes that blind spot.
  const { can } = useAuth();

  async function load() {
    setLoading(true);
    try {
      const requests = [API.get('/plots'), API.get('/houses')];
      // Agents need this too — it's where their own landlord list (for the
      // "Assign to Landlord" field) comes from, not just admin's owner/
      // caretaker/agent filters.
      if (isAdmin || isAgent) requests.push(API.get('/auth/users'));
      const [pr, hr, ur] = await Promise.all(requests);
      setPlots(Array.isArray(pr.data) ? pr.data : (pr.data.data || []));
      setHouses(Array.isArray(hr.data) ? hr.data : (hr.data.data || []));
      if (ur) {
        const users = ur.data.data || [];
        setLandlords(users.filter(u => u.role === 'landlord' && u.is_approved));
        setCaretakers(users.filter(u => u.role === 'caretaker'));
        setAgents(users.filter(u => u.role === 'agent'));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }

    // Tenant info for occupied-unit cards (name/phone/rent balance) — fetched
    // separately so a permissions hiccup here (role lacks tenants.view)
    // doesn't block plots/houses from loading; cards just show no tenant info.
    try {
      const tr = await API.get('/tenants');
      setTenants(Array.isArray(tr.data) ? tr.data : (tr.data.data || []));
    } catch (e) { setTenants([]); }
  }

  // Intentionally run once on mount only — `load` is a plain function
  // recreated every render, so including it in the deps array would refetch
  // on every render instead of just once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  // Scroll to the plot flagged by the dashboard alert's "Review" button, once
  // its card actually exists in the DOM. Highlight fades after a few seconds
  // so it doesn't linger forever if the landlord/agent just leaves it open.
  useEffect(() => {
    if (!highlightPlotId || plots.length === 0) return;
    const node = plotRefs.current[highlightPlotId];
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlightPlotId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightPlotId, plots]);

  // Same idea, but for a specific UNIT — this is what the "Review" button on
  // the floating pending-approval toast now uses, so it drops the admin right
  // onto the unit that actually needs approving instead of just the page.
  useEffect(() => {
    if (!highlightHouseId || houses.length === 0) return;
    const house = houses.find(h => String(h.id) === String(highlightHouseId));
    if (house) setExpandedPlotIds(prev => prev.has(house.plot_id) ? prev : new Set(prev).add(house.plot_id));
  }, [highlightHouseId, houses]);

  useEffect(() => {
    if (!highlightHouseId) return;
    const node = houseRefs.current[highlightHouseId];
    if (!node) return; // not rendered yet — the effect above expands its plot, this re-runs once it is
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlightHouseId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightHouseId, houses, expandedPlotIds]);

  function togglePlotExpanded(plotId) {
    setExpandedPlotIds(prev => {
      const next = new Set(prev);
      if (next.has(plotId)) next.delete(plotId); else next.add(plotId);
      return next;
    });
  }

  function openAddPlot() {
    setEditing(null);
    // Admin's blank owner_id means "— Admin (self) —", a valid choice, so
    // defaulting it to the first landlord is just a convenience. An agent
    // has no such self-own option — blank is only ever a placeholder they
    // must change — so don't pre-pick landlords[0] for them; leave it blank
    // and let the required "— Select landlord —" placeholder force an
    // actual, deliberate selection instead of one chosen by load order.
    setForm({ name: '', location: '', description: '', owner_id: isAgent ? '' : (landlords[0]?.id || ''), gps_lat: '', gps_lng: '' });
    setModal('plot'); setError('');
  }

  function openEditPlot(plot) {
    setEditing(plot);
    setForm({
      name:        plot.name,
      location:    plot.location    || '',
      description: plot.description || '',
      owner_id:    plot.user_id     || '',
      gps_lat:     plot.gps_lat     != null ? String(plot.gps_lat) : '',
      gps_lng:     plot.gps_lng     != null ? String(plot.gps_lng) : '',
    });
    setModal('plot'); setError('');
  }

  function openAddHouse(plotId) {
    setEditing(null);
    setForm({ unit_number: '', house_type: 'Bedsitter', rent_amount: '', deposit: '', plot_id: String(plotId || plots[0]?.id || ''), status: 'vacant', description: '' });
    setModal('house'); setError('');
  }

  function openEditHouse(house) {
    setEditing(house);
    // house.description comes from the same PATCH /houses/:id/description
    // endpoint used below — this is the unit's public listing blurb, shown
    // as-is on the public vacant-units page. There was previously no field
    // anywhere in this form to see or change it, so whatever ended up in
    // that column (including leftover test text) stayed stuck there with
    // no way to clear it short of editing the database directly.
    setForm({ unit_number: house.unit_number, house_type: house.house_type, rent_amount: house.rent_amount, deposit: house.deposit || '', plot_id: house.plot_id, status: house.status, meter_no: house.meter_no || '', description: house.description || '' });
    setModal('house'); setError('');
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      if (modal === 'plot') {
        const plotPayload = {
          ...form,
          gps_lat: form.gps_lat === '' || form.gps_lat == null ? null : parseFloat(form.gps_lat),
          gps_lng: form.gps_lng === '' || form.gps_lng == null ? null : parseFloat(form.gps_lng),
        };
        if (editing) {
          await API.put(`/plots/${editing.id}`, plotPayload);
        } else {
          await API.post('/plots', plotPayload);
        }
      } else {
        const housePayload = {
          plot_id:    form.plot_id,
          unit_number: form.unit_number,
          house_type: form.house_type,
          rent_amount: form.rent_amount,
          deposit:    form.deposit,
          status:     form.status,
          meter_no:   form.meter_no || '',
        };
        let houseId = editing?.id;
        if (editing) {
          await API.put(`/houses/${editing.id}`, housePayload);
        } else {
          const createRes = await API.post('/houses', housePayload);
          houseId = createRes.data?.data?.id;
        }
        // Separate endpoint — the main create/update above never touches
        // `description` (confirmed in backend/routes/houses.js: neither
        // POST / nor PUT /:id destructure it from the body), only
        // PATCH /houses/:id/description does. Only staff who could already
        // see this field (gated below on houses.edit, against this same
        // plot) can call it. form.plot_id is this house's property either
        // way — the plot picker above sets it on a new unit, and
        // openEditHouse seeds it from the existing house on edit.
        if (can('houses.edit', form.plot_id) && houseId) {
          await API.patch(`/houses/${houseId}/description`, { description: form.description || null });
        }
      }
      await load();
      setModal(null);
      setEditing(null);
    } catch (e) {
      setError(e.response?.data?.error || (typeof e.message === 'string' ? e.message : 'Failed to save'));
    } finally { setSaving(false); }
  }

  async function handleDeletePlot(id) {
    if (!window.confirm('Delete this plot? All units inside will also be deleted.')) return;
    try {
      await API.delete(`/plots/${id}`);
      await load();
    } catch (e) { alert(e.response?.data?.error || 'Failed to delete plot'); }
  }

  async function handleDeleteHouse(id) {
    if (!window.confirm('Delete this unit?')) return;
    try {
      await API.delete(`/houses/${id}`);
      await load();
    } catch (e) { alert(e.response?.data?.error || 'Failed to delete unit'); }
  }

  // Caretakers: a plot can have several. Matched via the admin-only
  // `caretakers` list when available (admin sees every caretaker's full
  // plot assignment string) — but that list is never fetched at all for
  // landlord/agent, who'd otherwise always see "None assigned" even when a
  // caretaker genuinely is assigned. Falls back to plot.caretaker_name,
  // which GET /plots now returns directly, already scoped correctly for
  // every role, same pattern plotAgent() below already used successfully.
  const plotCaretakers = (plot) => {
    const matched = caretakers.filter(c =>
      String(c.plot_id) === String(plot.id) ||
      (c.caretaker_plots || '').split(',').map(n => n.trim()).includes(plot.name)
    );
    if (matched.length > 0) return matched;
    return plot.caretaker_name ? [{ name: plot.caretaker_name }] : [];
  };

  // Agent: derived live by the backend from the owning landlord's own
  // agent_id (GET /plots), never stored independently per plot anymore — a
  // plot can no longer show an agent the landlord themselves isn't actually
  // assigned to, which previously let a self-managed landlord look
  // agent-managed on this page while having full create/edit/delete rights
  // underneath.
  const plotAgent = (plot) => {
    if (plot.agent_id == null) return undefined;
    return agents.find(a => String(a.id) === String(plot.agent_id))
        || (plot.agent_name ? { id: plot.agent_id, name: plot.agent_name } : undefined);
  };

  // Owners that actually have plots (works for any role, since each plot
  // carries its owner's id and name).
  const ownerOptions = Array.from(
    new Map(plots.map(pl => [String(pl.user_id), { id: pl.user_id, name: pl.owner_name || 'Admin' }])).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const q = search.trim().toLowerCase();
  const visiblePlots = plots.filter(plot => {
    if (q && !`${plot.name} ${plot.location || ''}`.toLowerCase().includes(q)) return false;
    if (ownerFilter !== 'all' && String(plot.user_id) !== String(ownerFilter)) return false;

    const cts = plotCaretakers(plot);
    if (caretakerFilter === 'none' && cts.length > 0) return false;
    if (caretakerFilter !== 'all' && caretakerFilter !== 'none' &&
        !cts.some(c => String(c.id) === String(caretakerFilter))) return false;

    const ag = plotAgent(plot);
    if (agentFilter === 'none' && ag) return false;
    if (agentFilter !== 'all' && agentFilter !== 'none' &&
        !(ag && String(ag.id) === String(agentFilter))) return false;

    return true;
  });

  const filtersActive = !!q || ownerFilter !== 'all' || statusFilter !== 'all' || caretakerFilter !== 'all' || agentFilter !== 'all';
  function clearFilters() { setSearch(''); setOwnerFilter('all'); setStatusFilter('all'); setCaretakerFilter('all'); setAgentFilter('all'); }
  const statusCounts = {
    all: houses.length,
    vacant: houses.filter(h => h.status === 'vacant').length,
    occupied: houses.filter(h => h.status === 'occupied').length,
    maintenance: houses.filter(h => h.status === 'maintenance').length,
  };

  const allPlotHouses = (plotId) => houses.filter(h => h.plot_id === plotId);
  const plotHouses = (plotId) => allPlotHouses(plotId).filter(h => statusFilter === 'all' || h.status === statusFilter);

  // Active tenant currently occupying a unit, for the occupied-unit card's
  // name/phone/balance block. Rent balance only — deposit status lives on
  // the Tenants page, not here, to avoid the "paid up: rent or deposit?"
  // ambiguity that came up before.
  const tenantForHouse = (houseId) => tenants.find(t => String(t.house_id) === String(houseId) && t.is_active !== false);

  async function approveHouse(houseId) {
    try {
      await API.patch(`/houses/${houseId}/approve`);
      setHouses(hs => hs.map(h => h.id === houseId ? { ...h, is_approved: true, rejection_reason: null } : h));
      // Tell Layout's sidebar badge (and the dashboard banner) to recount
      // immediately, instead of leaving them stuck until the next 30s poll.
      window.dispatchEvent(new Event('pending-units-changed'));
    } catch (e) { console.error(e); }
  }

  async function rejectHouse(houseId, reason) {
    try {
      await API.patch(`/houses/${houseId}/reject`, { reason });
      setHouses(hs => hs.map(h => h.id === houseId ? { ...h, is_approved: false, rejection_reason: reason || 'Rejected' } : h));
      window.dispatchEvent(new Event('pending-units-changed'));
    } catch (e) { console.error(e); }
  }

  async function openMediaManager(house) {
    setMediaUnit(house);
    setMediaErr('');
    try {
      const res = await API.get(`/listings/media/${house.id}`);
      setMedia(res.data.data || []);
    } catch { setMedia([]); }
  }

  async function handleMediaUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true); setMediaErr('');
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    try {
      const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000/api'}/listings/media/${mediaUnit.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      const data = await res.json();
      if (data.success) setMedia(m => [...m, ...data.data]);
      else setMediaErr(data.error || 'Upload failed');
    } catch { setMediaErr('Upload failed. Please try again.'); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function deleteMedia(id) {
    try {
      await API.delete(`/listings/media/${id}`);
      setMedia(m => m.filter(x => x.id !== id));
    } catch { setMediaErr('Failed to delete.'); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>Properties</h1>
          <p style={{ color: isDark ? 'var(--blue, #2563eb)' : 'var(--muted)', fontSize: 14 }}>{plots.length} plots · {houses.length} units</p>
        </div>
        {can('plots.create') && (
          <button onClick={openAddPlot} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--red, #dc2626)', color: '#fff', fontWeight: 600, fontSize: 14 }}>+ Add Plot</button>
        )}
      </div>

      {/* Filter bar */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div>
            <div style={filterLabelStyle}>Unit status</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['all', 'All'], ['vacant', 'Vacant'], ['occupied', 'Occupied'], ['maintenance', 'Maintenance']].map(([val, label]) => {
                const on = statusFilter === val;
                return (
                  <button key={val} onClick={() => setStatusFilter(val)} style={{
                    padding: '7px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--primary, #7c3aed)' : 'var(--border)'}`,
                    background: on ? 'var(--primary, #7c3aed)' : 'var(--surface)',
                    color: on ? '#fff' : 'var(--text)',
                  }}>
                    {label} <span style={{ opacity: 0.7, marginLeft: 2 }}>{statusCounts[val]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {ownerOptions.length > 1 && (
            <FilterSelect label="Owner" value={ownerFilter} onChange={setOwnerFilter}
              allLabel="All owners" options={ownerOptions} />
          )}

          {isAdmin && (
            <>
              <FilterSelect label="Caretaker" value={caretakerFilter} onChange={setCaretakerFilter}
                allLabel="All caretakers" noneLabel="No caretaker" options={caretakers} />
              <FilterSelect label="Agent" value={agentFilter} onChange={setAgentFilter}
                allLabel="All agents" noneLabel="No agent" options={agents} />
            </>
          )}

          <ExpandableSearch value={search} onChange={setSearch} />

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Showing {visiblePlots.length} of {plots.length} plots</span>
            {filtersActive && (
              <button onClick={clearFilters} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>Clear filters</button>
            )}
          </div>
        </div>
      </div>

      {loading ? <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading...</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {plots.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>No properties yet. Add your first plot to get started.</div>}
          {plots.length > 0 && visiblePlots.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>No plots match your filters.</div>}
          {visiblePlots.map(plot => {
            const expanded = expandedPlotIds.has(plot.id);
            return (
            <div key={plot.id} ref={el => { plotRefs.current[plot.id] = el; }} style={{
              background: 'var(--surface, #ffffff)', borderRadius: 'var(--radius)',
              boxShadow: String(plot.id) === String(highlightPlotId) ? '0 0 0 3px var(--amber, #d97706), 0 4px 20px rgba(217,119,6,0.35)' : 'var(--shadow, 0 2px 8px rgba(0,0,0,0.10))',
              border: String(plot.id) === String(highlightPlotId) ? '1.5px solid var(--amber, #d97706)' : '1.5px solid var(--border, #94a3b8)',
              overflow: 'hidden', transition: 'box-shadow 0.4s ease, border-color 0.4s ease',
            }}>
              {/* Plot header */}
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border, #cbd5e1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2, #f1f5f9)' }}>
                <div>
                  <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 17, marginBottom: 8, color: 'var(--text)' }}>{plot.name}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: isDark ? 'var(--blue, #2563eb)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: 64 }}>Location</span>
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>📍 {plot.location || '—'}</span>
                    </div>
                    {(isAdmin || isAgent || isCaretaker) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: isDark ? 'var(--blue, #2563eb)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: 64 }}>Owner</span>
                        {/* landlords.find(...) only ever resolves for admin, since that list is
                            admin-only fetched — plot.owner_name (from GET /plots directly) works
                            correctly for every role, same fix as caretaker/agent above. */}
                        <span style={{ fontSize: 13, color: 'var(--text)' }}>👤 {landlords.find(l => l.id === plot.user_id)?.name || plot.owner_name || 'Admin'}</span>
                      </div>
                    )}
                    {!isCaretaker && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: isDark ? 'var(--blue, #2563eb)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: 64 }}>Caretaker</span>
                        {(() => {
                          const cts = plotCaretakers(plot);
                          return cts.length
                            ? <span style={{ fontSize: 13, color: 'var(--text)' }}>🧑‍🔧 {cts.map(c => c.name).join(', ')}</span>
                            : <span style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>None assigned</span>;
                        })()}
                      </div>
                    )}
                    {/* Hidden when the viewer IS the agent shown — "Agent: you" is useless;
                        they need the Owner row above instead, which agents can now see. */}
                    {String(plot.agent_id) !== String(user?.id) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: isDark ? 'var(--blue, #2563eb)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: 64 }}>Agent</span>
                        {(() => {
                          const ag = plotAgent(plot);
                          return ag
                            ? <span style={{ fontSize: 13, color: 'var(--text)' }}>🤝 {ag.name}</span>
                            : <span style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>None assigned</span>;
                        })()}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={() => togglePlotExpanded(plot.id)} aria-label={expanded ? 'Collapse units' : 'Expand units'} title={expanded ? 'Collapse units' : 'Expand units'} style={{
                    width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text)', flexShrink: 0,
                  }}>
                    <span style={{ display: 'inline-block', fontSize: 11, transition: 'transform 0.2s ease', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
                  </button>
                  <span style={{ background: isDark ? 'rgba(124,58,237,0.25)' : 'var(--primary-light)', color: isDark ? '#c4b5fd' : 'var(--primary)', padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                    {allPlotHouses(plot.id).length} units
                  </span>
                  {/* Gated on actual permissions, not role — a role-based check
                      (e.g. !isCaretaker) still shows this menu to someone like
                      landlord_with_agent, who the backend will reject on click.
                      Showing an action a click would just 403 on is worse than
                      not showing it; the menu itself disappears when nothing
                      in it is actually allowed. */}
                  {(() => {
                    // All three checked against THIS plot specifically
                    // (plot.id) — POST /houses and PUT/DELETE /plots/:id
                    // all resolve the permission the same way, against the
                    // same plot.
                    const items = [
                      ...(can('houses.create', plot.id) ? [{ label: '+ Add Unit', onClick: () => openAddHouse(plot.id) }] : []),
                      ...(can('plots.edit', plot.id)    ? [{ label: 'Edit', onClick: () => openEditPlot(plot) }] : []),
                      ...(can('plots.delete', plot.id)  ? [{ label: 'Delete', onClick: () => handleDeletePlot(plot.id), danger: true }] : []),
                    ];
                    return items.length > 0
                      ? <ActionMenu id={`plot-${plot.id}`} openMenu={openMenu} setOpenMenu={setOpenMenu} items={items} />
                      : null;
                  })()}
                </div>
              </div>

              {/* Units grid — collapsed by default; clicking the chevron
                  toggles this per property, independent of every other one. */}
              {expanded && (plotHouses(plot.id).length === 0 ? (
                <div style={{ padding: '20px 24px', color: 'var(--muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, background: isDark ? 'var(--surface2)' : 'transparent' }}>
                  {allPlotHouses(plot.id).length === 0 ? (
                    <>
                      No units added yet.
                      <button onClick={() => openAddHouse(plot.id)} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: 'var(--primary)', fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer' }}>+ Add Unit</button>
                    </>
                  ) : (
                    <>No units match this filter.</>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, padding: 16 }}>
                  {plotHouses(plot.id).map(house => (
                    <div key={house.id} ref={el => { houseRefs.current[house.id] = el; }} style={{
                      padding: '14px 16px', borderRadius: 10,
                      border: String(house.id) === String(highlightHouseId) ? '1.5px solid var(--amber, #d97706)' : '1px solid var(--border)',
                      boxShadow: String(house.id) === String(highlightHouseId) ? '0 0 0 3px var(--amber, #d97706), 0 4px 20px rgba(217,119,6,0.35)' : 'none',
                      background: house.status === 'vacant' ? 'var(--surface2)' : house.status === 'maintenance' ? hexToRgba('#dc2626', 0.15) : hexToRgba('#39FF14', 0.18),
                      transition: 'box-shadow 0.4s ease, border-color 0.4s ease',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>Unit {house.unit_number}</div>
                        {(() => {
                          // Checked against THIS house's own property
                          // (house.plot_id) — PUT/DELETE /houses/:id now
                          // resolve the permission the same way.
                          const items = [
                            ...(can('houses.edit', house.plot_id)   ? [{ label: 'Edit', onClick: () => openEditHouse(house) }] : []),
                            ...(can('houses.delete', house.plot_id) ? [{ label: 'Delete', onClick: () => handleDeleteHouse(house.id), danger: true }] : []),
                          ];
                          return items.length > 0
                            ? <ActionMenu id={`house-${house.id}`} size="sm" openMenu={openMenu} setOpenMenu={setOpenMenu} items={items} />
                            : null;
                        })()}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{house.house_type}</div>
                      <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 14 }}>KES {parseFloat(house.rent_amount).toLocaleString()}/mo</div>
                      {house.status === 'occupied' && (() => {
                        const tenant = tenantForHouse(house.id);

                        // "Occupied" with no matching active tenant row means the status
                        // was set without a real tenant behind it (or one was removed
                        // without freeing the unit) — a data gap, not a rendering bug.
                        // Say so plainly instead of silently showing nothing, with a
                        // shortcut to go fix it.
                        if (!tenant) {
                          return (
                            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--amber-light, #fef3c7)', border: '1px dashed var(--amber, #d97706)' }}>
                              <div style={{ fontSize: 11, color: 'var(--amber, #d97706)', fontWeight: 700 }}>⚠️ No tenant record linked</div>
                              {!isCaretaker && (
                                <button onClick={() => navigate('/tenants')} style={{ marginTop: 5, padding: '3px 9px', borderRadius: 6, border: 'none', background: 'var(--amber, #d97706)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                                  + Add tenant
                                </button>
                              )}
                            </div>
                          );
                        }

                        const balance  = parseFloat(tenant.balance || 0);
                        const initials = (tenant.full_name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
                        return (
                          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--primary-light, #ede9fe)', color: 'var(--primary, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                                {initials}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={tenant.full_name}>
                                  {tenant.full_name}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={tenant.phone}>
                                  📞 {tenant.phone}
                                </div>
                              </div>
                            </div>
                            <span style={{
                              display: 'inline-block', marginTop: 6, padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700,
                              background: balance > 0 ? 'var(--amber-light, #fef3c7)' : 'var(--green-light, #dcfce7)',
                              color: balance > 0 ? 'var(--amber, #d97706)' : 'var(--green, #16a34a)',
                            }}>
                              {balance > 0 ? `KES ${balance.toLocaleString()} rent owed` : 'Rent Paid Up'}
                            </span>
                          </div>
                        );
                      })()}
                      {house.rejection_reason && (
                        <div style={{ fontSize: 11, color: 'var(--red, #dc2626)', marginTop: 4, fontStyle: 'italic' }}>"{house.rejection_reason}"</div>
                      )}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        <span style={{ display: 'inline-block', background: house.status === 'vacant' ? 'var(--green-light, #dcfce7)' : house.status === 'maintenance' ? 'var(--red-light, #fee2e2)' : 'var(--amber-light, #fef3c7)', color: house.status === 'vacant' ? 'var(--green, #16a34a)' : house.status === 'maintenance' ? 'var(--red, #dc2626)' : 'var(--amber, #d97706)', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{house.status}</span>
                        {house.is_approved !== true && !house.rejection_reason && (
                          <span style={{ display: 'inline-block', background: 'var(--amber-light, #fef3c7)', color: 'var(--amber, #d97706)', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>⏳ Pending Approval</span>
                        )}
                        {house.rejection_reason && (
                          <span style={{ display: 'inline-block', background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>❌ Rejected</span>
                        )}
                        {house.is_approved !== true && can('houses.approve', house.plot_id) && (
                          <>
                            <button onClick={() => approveHouse(house.id)} style={{ padding: '2px 8px', borderRadius: 6, border: 'none', background: 'var(--green, #16a34a)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>✓ Approve</button>
                            <button onClick={() => { setRejectTarget(house.id); setRejectReason(''); }} style={{ padding: '2px 8px', borderRadius: 6, border: 'none', background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>✗ Reject</button>
                          </>
                        )}
                        {/* Inline reject reason */}
                        {rejectTarget === house.id && (
                          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                              placeholder="Reason (optional)..."
                              style={{ flex: 1, minWidth: 120, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, color: 'var(--text)', outline: 'none' }} />
                            <button onClick={() => { rejectHouse(house.id, rejectReason); setRejectTarget(null); }}
                              style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: 'var(--red, #dc2626)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Confirm</button>
                            <button onClick={() => setRejectTarget(null)}
                              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>Cancel</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 20, color: 'var(--text)' }}>
              {editing ? 'Edit' : 'Add'} {modal === 'plot' ? 'Plot' : 'Unit'}
            </h2>
            {error && <div style={{ background: 'var(--red-light, #fee2e2)', color: 'var(--red, #dc2626)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {modal === 'plot' ? (<>
                <Field label="Plot Name"   value={form.name}        onChange={v => setForm(f => ({ ...f, name: v }))}        placeholder="e.g. Westlands Apartments" />
                <Field label="Location"    value={form.location}    onChange={v => setForm(f => ({ ...f, location: v }))}    placeholder="e.g. Westlands, Nairobi" />
                <Field label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Optional notes" />

                {/* ── GPS Coordinates (optional) ──────────────────────────
                    Admin can type/paste coordinates directly.
                    Non-admins see the current values read-only so they know
                    whether the plot has been geocoded yet.                  */}
                <div>
                  <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                    GPS Coordinates
                    <span style={{ fontSize: 10, fontWeight: 500, color: isDark ? 'rgba(255,255,255,0.38)' : '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>
                      — optional · auto-filled from location if left blank
                    </span>
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {/* Latitude */}
                    <div>
                      <label style={{ ...labelStyle, fontSize: 10, marginBottom: 4 }}>Latitude</label>
                      {isAdmin ? (
                        <input
                          type="number"
                          step="any"
                          value={form.gps_lat}
                          onChange={e => setForm(f => ({ ...f, gps_lat: e.target.value }))}
                          placeholder="-1.2921"
                          style={inputStyle}
                        />
                      ) : (
                        <div style={{ ...inputStyle, background: isDark ? 'rgba(255,255,255,0.04)' : '#f1f5f9', color: 'var(--muted)', cursor: 'not-allowed', fontSize: 13 }}>
                          {form.gps_lat || <span style={{ fontStyle: 'italic' }}>Not set</span>}
                        </div>
                      )}
                    </div>
                    {/* Longitude */}
                    <div>
                      <label style={{ ...labelStyle, fontSize: 10, marginBottom: 4 }}>Longitude</label>
                      {isAdmin ? (
                        <input
                          type="number"
                          step="any"
                          value={form.gps_lng}
                          onChange={e => setForm(f => ({ ...f, gps_lng: e.target.value }))}
                          placeholder="36.8219"
                          style={inputStyle}
                        />
                      ) : (
                        <div style={{ ...inputStyle, background: isDark ? 'rgba(255,255,255,0.04)' : '#f1f5f9', color: 'var(--muted)', cursor: 'not-allowed', fontSize: 13 }}>
                          {form.gps_lng || <span style={{ fontStyle: 'italic' }}>Not set</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Status chip — tells admin whether the plot is already on the map */}
                  {isAdmin && (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {form.gps_lat && form.gps_lng ? (
                        <span style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#34d399' : '#16a34a', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                          Plot will appear on map
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#fbbf24' : '#d97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                          Leave blank — auto-geocodes from Location on save
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {(isAdmin || isAgent) && (
                  <div>
                    <label style={labelStyle}>{editing ? 'Reassign Owner' : 'Assign to Landlord'}</label>
                    <select value={form.owner_id} onChange={e => setForm(f => ({ ...f, owner_id: e.target.value }))} style={inputStyle}>
                      {/* Admin may leave this on "— Admin (self) —" and own the plot
                          themselves; an agent has no such option — the backend
                          requires a real landlord (one actually assigned to this
                          agent) for every plot an agent creates. An agent always
                          gets an explicit "— Select landlord —" placeholder (value
                          "") rather than defaulting to landlords[0]: that default
                          was racy against the landlord list still loading or just
                          having changed, and once the control displays a name with
                          no matching option, the browser shows a selection the
                          submitted form.owner_id state doesn't actually have —
                          exactly the "owner_id is required" rejection seen with a
                          landlord visibly selected. Requiring a real pick here
                          keeps what's shown and what's submitted in sync. */}
                      {isAdmin && <option value="">— Admin (self) —</option>}
                      {isAgent && <option value="">— Select landlord —</option>}
                      {landlords.map(l => <option key={l.id} value={l.id}>{l.name} ({l.email})</option>)}
                    </select>
                  </div>
                )}

                {isAdmin && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                    Agent is set automatically from the plot's owner — reassign the owner's agent from the Users page if it needs to change.
                  </div>
                )}
              </>) : (<>
                <div>
                  <label style={labelStyle}>Plot</label>
                  <select value={form.plot_id} onChange={e => setForm(f => ({ ...f, plot_id: e.target.value }))} style={inputStyle}>
                    {plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <Field label="Unit Number" value={form.unit_number} onChange={v => setForm(f => ({ ...f, unit_number: v }))} placeholder="e.g. A1" />
                <div>
                  <label style={labelStyle}>Type</label>
                  <select value={form.house_type} onChange={e => setForm(f => ({ ...f, house_type: e.target.value }))} style={inputStyle}>
                    {['Single Room','Double Room','Bedsitter','1 Bedroom','2 Bedroom','3 Bedroom','Shop','Studio'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <Field label="Rent (KES)"    value={form.rent_amount} onChange={v => setForm(f => ({ ...f, rent_amount: v }))} placeholder="e.g. 15000" type="number" />
                <Field label="Deposit (KES)" value={form.deposit}     onChange={v => setForm(f => ({ ...f, deposit: v }))}     placeholder="e.g. 15000" type="number" />
                <div>
                  <label style={labelStyle}>Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={inputStyle}>
                    <option value="vacant">Vacant</option>
                    <option value="occupied">Occupied</option>
                    <option value="maintenance">Under Maintenance</option>
                  </select>
                </div>
                {can('houses.edit', form.plot_id) && (
                  <div>
                    <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                      Public Description
                      <span style={{ fontSize: 10, fontWeight: 500, color: isDark ? 'rgba(255,255,255,0.38)' : '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>
                        — optional · shown as-is on the public listings page
                      </span>
                    </label>
                    <textarea
                      value={form.description || ''}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="e.g. Bright corner unit with balcony, newly tiled."
                      rows={3}
                      style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                    />
                  </div>
                )}
              </>)}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => { setModal(null); setEditing(null); }} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {saving ? 'Saving...' : editing ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const filterLabelStyle = { fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 };
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none' };

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

function FilterSelect({ label, value, onChange, allLabel, noneLabel, options }) {
  const active = value !== 'all';
  return (
    <div style={{ minWidth: 170 }}>
      <div style={filterLabelStyle}>{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', outline: 'none',
        border: `1px solid ${active ? 'var(--primary, #7c3aed)' : 'var(--border)'}`,
        background: 'var(--surface)', color: 'var(--text)',
      }}>
        <option value="all">{allLabel}</option>
        {noneLabel && <option value="none">{noneLabel}</option>}
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
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
    <div style={{
      display: 'flex', alignItems: 'center', flexShrink: 0, overflow: 'hidden',
      height: 40, width: expanded ? 240 : 40, maxWidth: '100%',
      transition: 'width 0.2s ease, border-color 0.15s',
      borderRadius: 10, background: 'var(--surface)',
      border: `1px solid ${expanded ? 'var(--primary, #7c3aed)' : 'var(--border)'}`,
    }}>
      <button type="button" onClick={openIt} aria-label="Search plots" title="Search plots"
        style={{ width: 38, height: 38, flex: 'none', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15 }}>🔍</button>
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => { if (e.key === 'Escape') { onChange(''); setOpen(false); e.currentTarget.blur(); } }}
        placeholder="Search plots…"
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
