import { useState, useMemo } from 'react';
import { hexToRgba, initialsAvatar, inputStyle } from './formKit';

// ── Tenant helpers (shared by Record Payment, STK push and Reconcile) ─────
export const tName = t => t.full_name || t.name || `Tenant #${t.id}`;
export const tUnit = t => t.unit_number || t.house_number || t.house_id || '';
// Placeholder phones like 00000004 (tenants with no real number) are just noise.
export const realPhone = p => (p && !/^0{4,}/.test(String(p).replace(/\D/g, ''))) ? String(p) : '';

// GET /tenants returns the plot's NAME but not its id, so properties are
// grouped by name. A tenant's property comes from (in order): the tenant record,
// the tenant's unit (via /houses), or any payment of theirs (payments carry plot_name).
export function buildPlotLookup(payments = [], houses = []) {
  const byTenant = {}, byHouse = {};
  payments.forEach(p => {
    if (p.tenant_id && p.plot_name && !byTenant[String(p.tenant_id)]) byTenant[String(p.tenant_id)] = p.plot_name;
  });
  houses.forEach(h => { if (h.plot_name) byHouse[String(h.id)] = h.plot_name; });
  return { byTenant, byHouse };
}

function plotInfo(t, lookup) {
  const name = t.plot_name || t.property_name || lookup.byHouse[String(t.house_id)] || lookup.byTenant[String(t.id)] || null;
  return name ? { id: `n:${name}`, name } : { id: 'none', name: 'Unassigned' };
}

// Searchable tenant finder, grouped by property. Replaces the flat <select>.
//   value    tenant id ('' = nothing picked)      onSelect(tenantObject)
//   lazy     only show the list once the search box is focused/typed in (for
//            screens that render many pickers, e.g. Reconcile)
export default function TenantPicker({ tenants, lookup, value, onSelect, autoFocus = false, lazy = false, maxListHeight = 240, rememberKey }) {
  const [q, setQ]             = useState('');
  const [focused, setFocused] = useState(false);
  const [changing, setChanging] = useState(false);
  const [plot, setPlot]       = useState(() => {
    try { return (rememberKey && localStorage.getItem(rememberKey)) || 'all'; } catch { return 'all'; }
  });

  const rows  = useMemo(() => tenants.map(t => ({ t, ...plotInfo(t, lookup) })), [tenants, lookup]);
  const plots = useMemo(
    () => Array.from(new Map(rows.map(r => [r.id, r.name])).entries()).sort((a, b) => a[1].localeCompare(b[1])),
    [rows]
  );
  const activePlot = plots.some(([id]) => id === plot) ? plot : 'all';
  const selected   = value ? rows.find(r => String(r.t.id) === String(value)) : null;

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    const map = new Map();
    rows.forEach(r => {
      if (activePlot !== 'all' && r.id !== activePlot) return;
      if (needle) {
        const hay      = `${tName(r.t)} ${tUnit(r.t)} ${r.name}`.toLowerCase();
        const phoneHit = digits.length >= 3 && String(r.t.phone || '').replace(/\D/g, '').includes(digits);
        if (!hay.includes(needle) && !phoneHit) return;
      }
      if (!map.has(r.id)) map.set(r.id, { name: r.name, list: [] });
      map.get(r.id).list.push(r);
    });
    return Array.from(map.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(g => ({
        ...g,
        // natural sort: A2 before A10
        list: g.list.sort((a, b) => String(tUnit(a.t)).localeCompare(String(tUnit(b.t)), undefined, { numeric: true })),
      }));
  }, [rows, activePlot, q]);

  const matchCount = groups.reduce((s, g) => s + g.list.length, 0);
  const showHeaders = plots.length > 1;

  function pick(r) {
    setQ(''); setFocused(false); setChanging(false);
    onSelect(r.t);
  }
  function changePlot(v) {
    setPlot(v);
    if (rememberKey) { try { localStorage.setItem(rememberKey, v); } catch { /* ignore */ } }
  }

  // ── A tenant is picked: show a compact summary card ──
  if (selected && !changing) {
    const t = selected.t;
    const phone = realPhone(t.phone);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
        {(() => {
          const { initials, color } = initialsAvatar(tName(t));
          return <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: hexToRgba(color, 0.18), color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{initials}</div>;
        })()}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tName(t)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tUnit(t) ? `Unit ${tUnit(t)}` : 'No unit'}{selected.id !== 'none' ? ` · ${selected.name}` : ''}{phone ? ` · ${phone}` : ''}
          </div>
        </div>
        {t.rent_amount ? (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Rent / month</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary, #1b6b45)' }}>KES {parseFloat(t.rent_amount).toLocaleString()}</div>
          </div>
        ) : null}
        <button type="button" onClick={() => setChanging(true)}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>Change</button>
      </div>
    );
  }

  // ── Finder: property filter + search + grouped list ──
  const showList = !lazy || focused || q;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        {plots.length > 1 && (
          <select value={activePlot} onChange={e => changePlot(e.target.value)} title="Filter by property"
            style={{ ...inputStyle, width: 'auto', maxWidth: '45%', flexShrink: 0, fontWeight: 600 }}>
            <option value="all">All properties</option>
            {plots.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <input
          data-no-submit="1"
          type="search" value={q} autoFocus={autoFocus}
          onChange={e => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={e => {
            // Esc clears the search first; only an Esc on an empty box reaches the modal's close handler
            if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQ(''); return; }
            if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation();
              const first = groups[0]?.list[0];
              if (first) pick(first);
            }
          }}
          placeholder="Search name, unit or phone…"
          style={{ ...inputStyle, flex: 1, minWidth: 0 }}
        />
      </div>

      {showList && (
        <div style={{ marginTop: 8, maxHeight: maxListHeight, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
          {matchCount === 0 ? (
            <div style={{ padding: '18px 14px', textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>No tenants match “{q}”.</div>
          ) : groups.map(g => (
            <div key={g.name}>
              {showHeaders && (
                <div style={{ position: 'sticky', top: 0, zIndex: 1, padding: '6px 12px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{g.name}</span><span>{g.list.length}</span>
                </div>
              )}
              {g.list.map(r => {
                const owes = parseFloat(r.t.balance) > 0;
                const phone = realPhone(r.t.phone);
                return (
                  <button key={r.t.id} type="button"
                    onMouseDown={e => e.preventDefault() /* keep focus in the search box so the click lands */}
                    onClick={() => pick(r)}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}>
                    <span style={{ minWidth: 44, textAlign: 'center', padding: '2px 8px', borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{tUnit(r.t) || '—'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tName(r.t)}</span>
                      {phone && <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{phone}</span>}
                    </span>
                    {owes && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--red, #dc2626)', flexShrink: 0 }}>owes KES {parseFloat(r.t.balance).toLocaleString()}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {showList && matchCount > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{matchCount} tenant{matchCount === 1 ? '' : 's'}{q ? ' match' : ''} · press Enter to pick the first</div>
      )}
      {changing && selected && (
        <button type="button" onClick={() => setChanging(false)} style={{ marginTop: 6, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Keep {tName(selected.t)}</button>
      )}
    </div>
  );
}
