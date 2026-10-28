// The real map of the estate: every property that has coordinates is a pin,
// coloured by how its rent is doing. Click a pin to fly into its 3D model.
// Admins can drag pins to the exact spot, or place pins for properties that
// have none yet. Tiles: OpenStreetMap (street) or Esri World Imagery (satellite).
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const LAYERS = {
  street: { label: 'Street', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
  satellite: { label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community' },
};

// Colour of a property's pin: worst thing happening in it.
export function plotHealth(p) {
  const c = {};
  p.units.forEach(u => { c[u.state] = (c[u.state] || 0) + 1; });
  const behind = (c.overdue || 0) + (c.unpaid || 0) + (c.partial || 0);
  if (!p.units.length) return { color: '#9ca3af', label: 'No units', behind: 0 };
  if (c.overdue) return { color: '#dc2626', label: 'Has overdue units', behind };
  if (behind) return { color: '#f97316', label: 'Some units behind', behind };
  return { color: '#22c55e', label: 'All up to date', behind: 0 };
}

const pinIcon = (p, active) => {
  const h = plotHealth(p);
  return L.divIcon({
    className: '',
    iconSize: [38, 46], iconAnchor: [19, 44], popupAnchor: [0, -40],
    html: `<div style="position:relative;width:38px;height:46px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.35))">
      <div style="position:absolute;left:3px;top:0;width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${h.color};border:3px solid ${active ? '#0f172a' : '#fff'};box-sizing:border-box"></div>
      <div style="position:absolute;left:3px;top:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:#fff;font:700 13px sans-serif">${p.units.length}</div>
    </div>`,
  });
};

function FitAll({ points, nonce }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) { map.setView(points[0], 16); return; }
    map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 17 });
  }, [nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
function Placer({ active, onPlace }) {
  useMapEvents({ click: (e) => { if (active) onPlace(e.latlng.lat, e.latlng.lng); } });
  return null;
}
function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 17), { duration: 1.2 }); }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function EstateRealMap({ plots, admin, onFly, onOpen, onSavePin, height = 520 }) {
  const [layer, setLayer] = useState('satellite');
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState(null);      // plot id waiting for a click on the map
  const [active, setActive] = useState(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [focus, setFocus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const placed = useMemo(() => plots.filter(p => p.plot.lat != null && p.plot.lng != null), [plots]);
  const unplaced = useMemo(() => plots.filter(p => p.plot.lat == null || p.plot.lng == null), [plots]);
  const points = useMemo(() => placed.map(p => [p.plot.lat, p.plot.lng]), [placed]);
  const L0 = LAYERS[layer];
  const center = points[0] || [-1.286389, 36.817223];     // Nairobi until pins exist

  async function savePin(id, lat, lng) {
    setBusy(true); setErr('');
    try { await onSavePin(id, lat, lng); }
    catch (e) { setErr(e.response?.data?.error || 'Could not save that pin.'); }
    finally { setBusy(false); }
  }

  const btn = { padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' };
  const seg = (on) => ({ ...btn, borderRadius: 0, border: 'none', background: on ? 'var(--text)' : 'var(--surface)', color: on ? 'var(--surface)' : 'var(--text)' });

  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 560px', position: 'relative', minHeight: height, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
        <div style={{ position: 'absolute', inset: 0, isolation: 'isolate' }}>
          <MapContainer center={center} zoom={points.length ? 14 : 11} maxZoom={19} style={{ height: '100%', width: '100%', cursor: placing ? 'crosshair' : undefined }} scrollWheelZoom>
            <TileLayer key={layer} url={L0.url} attribution={L0.attribution} maxZoom={L0.max} />
            <FitAll points={points} nonce={fitNonce} />
            <FlyTo target={focus} />
            <Placer active={placing != null} onPlace={(lat, lng) => { const id = placing; setPlacing(null); savePin(id, lat, lng); }} />
            {placed.map(p => {
              const h = plotHealth(p);
              return (
                <Marker key={p.plot.id} position={[p.plot.lat, p.plot.lng]} icon={pinIcon(p, active === p.plot.id)}
                  draggable={editing}
                  eventHandlers={{
                    click: () => setActive(p.plot.id),
                    popupclose: () => setActive(a => (a === p.plot.id ? null : a)),
                    dragend: (e) => { const ll = e.target.getLatLng(); savePin(p.plot.id, ll.lat, ll.lng); },
                  }}>
                  <Popup minWidth={210}>
                    <div style={{ fontFamily: 'sans-serif' }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{p.plot.name}</div>
                      {p.plot.location && <div style={{ fontSize: 12, color: '#64748b' }}>{p.plot.location}</div>}
                      <div style={{ margin: '6px 0 8px', fontSize: 12.5 }}>
                        <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, background: h.color, marginRight: 6 }} />
                        {h.label} · {p.units.length} units{h.behind ? ` · ${h.behind} behind` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button onClick={() => onFly(p.plot.id)} style={{ padding: '7px 11px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>🧊 Fly into 3D</button>
                        <button onClick={() => onOpen(p.plot.id)} style={{ padding: '7px 11px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>Open</button>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>

        <div style={{ position: 'absolute', top: 10, left: 54, zIndex: 1000, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', borderRadius: 9, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>
            {Object.entries(LAYERS).map(([k, v]) => <button key={k} style={seg(layer === k)} onClick={() => setLayer(k)}>{v.label}</button>)}
          </div>
          <button style={{ ...btn, boxShadow: '0 2px 8px rgba(0,0,0,.2)' }} onClick={() => setFitNonce(n => n + 1)} disabled={!points.length}>⌂ All properties</button>
          {admin && <button style={{ ...btn, boxShadow: '0 2px 8px rgba(0,0,0,.2)', background: editing ? 'var(--text)' : 'var(--surface)', color: editing ? 'var(--surface)' : 'var(--text)' }}
            onClick={() => { setEditing(e => !e); setPlacing(null); }}>{editing ? '✓ Done moving pins' : '📍 Move pins'}</button>}
        </div>
        {(editing || placing != null || err || busy) && (
          <div style={{ position: 'absolute', left: 54, right: 14, bottom: 14, zIndex: 1000, background: 'rgba(15,23,42,.88)', color: '#fff', padding: '8px 14px', borderRadius: 10, fontSize: 13 }}>
            {err ? <span style={{ color: '#fca5a5' }}>{err}</span>
              : busy ? 'Saving pin…'
              : placing != null ? `Click the map where "${plots.find(p => p.plot.id === placing)?.plot.name}" is.`
              : 'Drag a pin to the exact spot of the property. Each move is saved straight away.'}
          </div>
        )}
      </div>

      <div style={{ flex: '0 1 300px', minWidth: 260, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)', padding: 18, maxHeight: height + 40, overflow: 'auto' }}>
        <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Properties on the map</div>
        {placed.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>No property has a location yet. Place each one below.</div>}
        {placed.map(p => {
          const h = plotHealth(p);
          return (
            <div key={p.plot.id} style={{ padding: '8px 10px', marginBottom: 6, borderRadius: 10, border: '1px solid var(--border)', background: active === p.plot.id ? 'var(--surface2)' : 'var(--surface)' }}>
              <button onClick={() => { setActive(p.plot.id); setFocus({ lat: p.plot.lat, lng: p.plot.lng, k: Date.now() }); }} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
                <div style={{ fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: h.color, flex: 'none' }} />{p.plot.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 18 }}>{p.units.length} units{h.behind ? ` · ${h.behind} behind on rent` : ' · all up to date'}</div>
              </button>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, marginLeft: 18 }}>
                <button style={{ ...btn, padding: '4px 9px', fontSize: 12 }} onClick={() => onFly(p.plot.id)}>🧊 Fly into 3D</button>
              </div>
            </div>
          );
        })}

        {unplaced.length > 0 && (
          <>
            <div style={{ fontWeight: 700, color: 'var(--text)', margin: '14px 0 6px' }}>Not on the map yet ({unplaced.length})</div>
            {unplaced.map(p => (
              <div key={p.plot.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text)' }}>
                <span>{p.plot.name}</span>
                {admin
                  ? <button style={{ ...btn, padding: '4px 9px', fontSize: 12, background: placing === p.plot.id ? 'var(--text)' : 'var(--surface)', color: placing === p.plot.id ? 'var(--surface)' : 'var(--text)' }}
                      onClick={() => { setEditing(false); setPlacing(placing === p.plot.id ? null : p.plot.id); }}>📍 {placing === p.plot.id ? 'Cancel' : 'Place pin'}</button>
                  : null}
              </div>
            ))}
          </>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5 }}>
          Pin colour: <b style={{ color: '#22c55e' }}>green</b> all up to date · <b style={{ color: '#f97316' }}>orange</b> some behind · <b style={{ color: '#dc2626' }}>red</b> overdue units. The number is how many units the property has.
        </div>
      </div>
    </div>
  );
}
