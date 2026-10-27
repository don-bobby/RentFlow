// 3D building view: every unit of a property as a block, stacked by floor and
// coloured by this month's payment state. Data comes from
// GET /api/houses/building/:plotId. If WebGL isn't available (or the user
// prefers it) the same data is drawn as a flat 2D floor grid.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import API from '../services/api';

const STATES = {
  paid:     { label: 'Paid up',          color: '#22c55e' },
  partial:  { label: 'Partly paid',      color: '#f59e0b' },
  pending:  { label: 'Not yet due',      color: '#60a5fa' },
  unpaid:   { label: 'Unpaid (late)',    color: '#f97316' },
  overdue:  { label: 'Overdue 2+ months', color: '#dc2626' },
  vacant:   { label: 'Vacant',           color: '#9ca3af' },
  occupied: { label: 'Occupied',         color: '#6366f1' },
  other:    { label: 'Other',            color: '#a78bfa' },
};
const kes = (n) => `KES ${Math.round(parseFloat(n || 0)).toLocaleString()}`;
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

// Decide which floor each unit sits on and where. If no unit has a floor set,
// units are chunked into floors of `perFloor` in unit-number order.
function layoutUnits(units, perFloor) {
  const anyFloor = units.some(u => u.floor != null);
  const sorted = [...units].sort((a, b) => natural(a.unit_number, b.unit_number));
  const floors = {};
  if (anyFloor) sorted.forEach(u => { (floors[u.floor ?? 0] ||= []).push(u); });
  else sorted.forEach((u, i) => { (floors[Math.floor(i / perFloor)] ||= []).push(u); });
  const floorKeys = Object.keys(floors).map(Number).sort((a, b) => a - b);
  const maxCount = Math.max(1, ...floorKeys.map(f => floors[f].length));
  // A compact footprint: units are laid out in a few rows rather than one long strip.
  const rowsMax = Math.max(1, Math.round(Math.sqrt(maxCount / 2)));
  const cols = Math.ceil(maxCount / rowsMax);
  return { floors, floorKeys, cols, rowsMax, anyFloor };
}

export default function Building3D() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [plots, setPlots] = useState([]);
  const [plotId, setPlotId] = useState(params.get('plot') || '');
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [perFloor, setPerFloor] = useState(6);
  const [mode, setMode] = useState('3d');           // '3d' | '2d'
  const [webglOk, setWebglOk] = useState(true);
  const [filterState, setFilterState] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [hover, setHover] = useState(null);         // { unit, x, y }
  const [autoRotate, setAutoRotate] = useState(true);

  const mountRef = useRef(null);
  const sceneRef = useRef({});                         // meshes, controls, etc. shared with the update effects

  // Properties the user can see
  useEffect(() => {
    API.get('/plots').then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data.data || []);
      setPlots(list);
      if (!plotId && list.length) setPlotId(String(list[0].id));
    }).catch(() => setError('Could not load properties.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Building data
  useEffect(() => {
    if (!plotId) return;
    setLoading(true); setError(''); setSelectedId(null); setFilterState(null);
    API.get(`/houses/building/${plotId}`)
      .then(r => setInfo(r.data.data))
      .catch(e => setError(e.response?.data?.error || 'Could not load this building.'))
      .finally(() => setLoading(false));
  }, [plotId]);

  const units = info?.units || [];
  const layout = useMemo(() => layoutUnits(units, perFloor), [units, perFloor]);
  const selected = units.find(u => u.id === selectedId) || null;
  const counts = info?.summary || {};
  const owed = units.reduce((a, u) => a + (u.balance || 0), 0);

  // ── 3D scene: rebuilt when the layout or mode changes ──
  useEffect(() => {
    if (mode !== '3d' || !mountRef.current || !units.length) return undefined;
    const el = mountRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch { setWebglOk(false); setMode('2d'); return undefined; }
    setWebglOk(true);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(8, 16, 10); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-8, 6, -10); scene.add(fill);

    const W = 1.7, H = 1.0, D = 1.7, GAP = 0.14, FLOOR_H = 1.3;
    const { floors, floorKeys, cols, rowsMax } = layout;
    const totalW = cols * (W + GAP), totalD = rowsMax * (D + GAP);
    const group = new THREE.Group(); scene.add(group);

    // Ground
    const ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(totalW, totalD) * 0.75 + 2.5, 48),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.18 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; group.add(ground);

    const meshes = [];
    floorKeys.forEach((f, fi) => {
      const list = floors[f];
      const y = fi * FLOOR_H;
      // floor slab
      const slab = new THREE.Mesh(new THREE.BoxGeometry(totalW + 0.2, 0.08, totalD + 0.2),
        new THREE.MeshStandardMaterial({ color: 0x64748b, transparent: true, opacity: 0.55 }));
      slab.position.set(0, y - 0.04, 0); group.add(slab);
      list.forEach((u, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = (col - (cols - 1) / 2) * (W + GAP);
        const z = (row - (rowsMax - 1) / 2) * (D + GAP);
        const color = new THREE.Color(STATES[u.state]?.color || '#999');
        const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: u.state === 'vacant' ? 0.45 : 0.95, roughness: 0.55, metalness: 0.05 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
        mesh.position.set(x, y + H / 2, z);
        mesh.userData = { unit: u, baseOpacity: u.state === 'vacant' ? 0.45 : 0.95 };
        group.add(mesh); meshes.push(mesh);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.35 }));
        edges.position.copy(mesh.position); group.add(edges);
        // label sprite (unit number) on top
        const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
        const cx = cv.getContext('2d');
        cx.fillStyle = 'rgba(15,23,42,0.78)'; cx.fillRect(0, 0, 128, 64);
        cx.fillStyle = '#fff'; cx.font = 'bold 34px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(String(u.unit_number).slice(0, 7), 64, 34);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: true }));
        sprite.scale.set(0.9, 0.45, 1); sprite.position.set(x, y + H + 0.28, z); sprite.renderOrder = 5;
        group.add(sprite); mesh.userData.sprite = sprite;
      });
    });

    const height = floorKeys.length * FLOOR_H;
    const target = new THREE.Vector3(0, height / 2, 0);
    const radius = Math.max(totalW, totalD, height * 1.3) * 0.85 + 3.5;
    const home = new THREE.Vector3(radius * 0.8, height * 0.7 + radius * 0.45, radius * 0.9);
    camera.position.copy(home);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target); controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.05; controls.minDistance = 4; controls.maxDistance = radius * 3;
    controls.autoRotate = true; controls.autoRotateSpeed = 0.9;
    controls.addEventListener('start', () => { controls.autoRotate = false; setAutoRotate(false); });
    controls.update();

    // selection outline
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W + 0.12, H + 0.12, D + 0.12)),
      new THREE.LineBasicMaterial({ color: 0xffffff })); outline.visible = false; scene.add(outline);

    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let hovered = null, downAt = null;
    const pick = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      return hit ? hit.object : null;
    };
    const onMove = (e) => {
      const m = pick(e);
      if (m !== hovered) {
        hovered = m;
        renderer.domElement.style.cursor = m ? 'pointer' : 'grab';
      }
      const r = renderer.domElement.getBoundingClientRect();
      setHover(m ? { unit: m.userData.unit, x: e.clientX - r.left, y: e.clientY - r.top } : null);
    };
    const onDown = (e) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onUp = (e) => {
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return; // it was a drag
      const m = pick(e);
      setSelectedId(m ? m.userData.unit.id : null);
    };
    const onLeave = () => { hovered = null; setHover(null); };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight || 1;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = hovered;
      meshes.forEach(m => { // gentle hover lift
        const targetY = m.userData.baseY ?? (m.userData.baseY = m.position.y);
        m.position.y += ((t === m ? targetY + 0.12 : targetY) - m.position.y) * 0.25;
        m.userData.sprite.position.y = m.position.y + H / 2 + 0.28;
      });
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    sceneRef.current = { meshes, outline, controls, camera, home, target };
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      ['pointermove', 'pointerdown', 'pointerup', 'pointerleave'].forEach(n => renderer.domElement.removeEventListener(n, { pointermove: onMove, pointerdown: onDown, pointerup: onUp, pointerleave: onLeave }[n]));
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      sceneRef.current = {};
    };
  }, [layout, mode, units.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter dimming + selection outline (cheap, no scene rebuild)
  useEffect(() => {
    const { meshes, outline } = sceneRef.current;
    if (!meshes) return;
    meshes.forEach(m => {
      const dim = filterState && m.userData.unit.state !== filterState;
      m.material.opacity = dim ? 0.1 : m.userData.baseOpacity;
      m.userData.sprite.material.opacity = dim ? 0.15 : 1;
    });
    const sel = meshes.find(m => m.userData.unit.id === selectedId);
    if (sel) { outline.visible = true; outline.position.copy(sel.position); } else outline.visible = false;
  }, [filterState, selectedId, layout, mode, units.length]);

  useEffect(() => { const c = sceneRef.current.controls; if (c) c.autoRotate = autoRotate; }, [autoRotate]);

  function resetView() {
    const { camera, controls, home, target } = sceneRef.current;
    if (!camera) return;
    camera.position.copy(home); controls.target.copy(target); controls.update(); setAutoRotate(true);
  }

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)' };
  const btn = { padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' };
  const present = Object.keys(STATES).filter(k => counts[k]);

  return (
    <div style={{ padding: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', color: 'var(--text)' }}>3D Building View</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
            {info ? `${info.plot.name} · ${units.length} units · rent status for ${info.month}` : 'Pick a property to see its units and who has paid.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={plotId} onChange={e => { setPlotId(e.target.value); setParams({ plot: e.target.value }); }} style={{ ...btn, minWidth: 180 }}>
            {plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {webglOk && <button style={btn} onClick={() => setMode(m => (m === '3d' ? '2d' : '3d'))}>{mode === '3d' ? '▦ 2D grid' : '🧊 3D view'}</button>}
          {mode === '3d' && <button style={btn} onClick={() => setAutoRotate(a => !a)}>{autoRotate ? '⏸ Stop rotating' : '⟳ Rotate'}</button>}
          {mode === '3d' && <button style={btn} onClick={resetView}>⌂ Reset view</button>}
        </div>
      </div>

      {error && <div style={{ ...card, padding: 16, color: 'var(--red, #dc2626)' }}>{error}</div>}
      {loading && <div style={{ color: 'var(--muted)', padding: 20 }}>Loading building…</div>}

      {info && !loading && (
        <>
          {/* Legend / filter */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            {present.map(k => (
              <button key={k} onClick={() => setFilterState(f => (f === k ? null : k))}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 99, border: `1px solid ${filterState === k ? STATES[k].color : 'var(--border)'}`, background: filterState === k ? STATES[k].color : 'var(--surface)', color: filterState === k ? '#fff' : 'var(--text)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: STATES[k].color, border: filterState === k ? '1px solid #fff' : 'none' }} />
                {STATES[k].label} · {counts[k]}
              </button>
            ))}
            {info.see_money && owed > 0 && <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted)' }}>Total owed here: <strong style={{ color: 'var(--red, #dc2626)' }}>{kes(owed)}</strong></span>}
          </div>
          {!info.see_money && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Payment colours are hidden because you don't have access to tenant payment details for this property.</div>}

          <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <div style={{ ...card, flex: '1 1 560px', position: 'relative', minHeight: 460, overflow: 'hidden', background: 'linear-gradient(180deg, var(--surface2), var(--surface))' }}>
              {units.length === 0 && <div style={{ padding: 40, color: 'var(--muted)' }}>This property has no approved units yet.</div>}

              {mode === '3d' && <div ref={mountRef} style={{ position: 'absolute', inset: 0, cursor: 'grab' }} />}
              {mode === '3d' && hover && (
                <div style={{ position: 'absolute', left: Math.min(hover.x + 14, 9999), top: hover.y + 14, pointerEvents: 'none', background: '#0f172a', color: '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.5, zIndex: 3, boxShadow: '0 6px 20px rgba(0,0,0,.3)' }}>
                  <div style={{ fontWeight: 700 }}>Unit {hover.unit.unit_number} · {STATES[hover.unit.state]?.label}</div>
                  {hover.unit.tenant && <div>{hover.unit.tenant.name}</div>}
                  {hover.unit.balance > 0 && <div style={{ color: '#fca5a5' }}>Owes {kes(hover.unit.balance)}</div>}
                </div>
              )}
              {mode === '3d' && units.length > 0 && <div style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 11.5, color: 'var(--muted)', pointerEvents: 'none' }}>Drag to rotate · scroll to zoom · click a unit for details</div>}

              {mode === '2d' && (
                <div style={{ padding: 16, overflow: 'auto', maxHeight: 620 }}>
                  {[...layout.floorKeys].reverse().map(f => (
                    <div key={f} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{layout.anyFloor ? (f === 0 ? 'Ground floor' : `Floor ${f}`) : `Row ${f + 1}`}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {layout.floors[f].map(u => {
                          const dim = filterState && u.state !== filterState;
                          return (
                            <button key={u.id} onClick={() => setSelectedId(u.id)}
                              style={{ width: 74, padding: '10px 6px', borderRadius: 10, border: selectedId === u.id ? '2px solid var(--text)' : '1px solid rgba(0,0,0,.12)', background: STATES[u.state]?.color || '#999', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: dim ? 0.2 : (u.state === 'vacant' ? 0.6 : 1) }}>
                              {u.unit_number}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Detail panel */}
            <div style={{ ...card, flex: '0 1 300px', minWidth: 260, padding: 18 }}>
              {!selected && (
                <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Unit details</div>
                  Click a unit in the building to see its tenant, rent and what is owed.
                  {!layout.anyFloor && mode === '3d' && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Units per floor: {perFloor}</div>
                      <input type="range" min="2" max="12" value={perFloor} onChange={e => setPerFloor(parseInt(e.target.value))} style={{ width: '100%' }} />
                      <div style={{ fontSize: 11.5, marginTop: 4 }}>No floors are set on these units, so they are stacked automatically. Set a floor on each unit (Properties → edit unit) for an exact layout.</div>
                    </div>
                  )}
                </div>
              )}
              {selected && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 22, color: 'var(--text)' }}>Unit {selected.unit_number}</div>
                    <button onClick={() => setSelectedId(null)} style={{ border: 'none', background: 'var(--surface2)', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
                  </div>
                  <span style={{ display: 'inline-block', margin: '8px 0 14px', padding: '3px 12px', borderRadius: 99, background: STATES[selected.state]?.color, color: '#fff', fontSize: 12, fontWeight: 700 }}>{STATES[selected.state]?.label}</span>
                  {[
                    ['Type', selected.house_type || '—'],
                    ['Floor', selected.floor != null ? (selected.floor === 0 ? 'Ground' : selected.floor) : 'Not set'],
                    ['Monthly rent', kes(selected.rent_amount)],
                    ...(selected.tenant ? [
                      ['Tenant', selected.tenant.name],
                      ['Phone', selected.tenant.phone || '—'],
                      ['Paid this month', kes(selected.paid_this_month)],
                      ['Balance owed', selected.balance > 0 ? kes(selected.balance) : 'None'],
                      ['Months owed', selected.months_owed || 0],
                      ['Rent due day', selected.due_day],
                    ] : []),
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 600, color: 'var(--text)', textAlign: 'right' }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                    {selected.tenant && <button style={btn} onClick={() => navigate('/tenants', { state: { search: selected.tenant.name } })}>View tenant</button>}
                    {selected.tenant && <button style={{ ...btn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' }} onClick={() => navigate('/payments', { state: { tenantId: selected.tenant.id } })}>Payments</button>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
