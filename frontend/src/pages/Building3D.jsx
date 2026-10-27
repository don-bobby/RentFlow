// 3D building view: every unit of a property as a block, stacked by floor and
// coloured by this month's payment state. Data comes from
// GET /api/houses/building/:plotId. If WebGL isn't available (or the user
// prefers it) the same data is drawn as a flat 2D floor grid.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import API from '../services/api';
import { computePlacement, draftFrom, applyDraft } from '../utils/buildingLayout';
import LayoutEditor from '../components/LayoutEditor';
import { buildBuilding, skyTexture, STATES, H, FLOOR_H, SKY_HORIZON } from '../utils/buildingScene';

const kes = (n) => `KES ${Math.round(parseFloat(n || 0)).toLocaleString()}`;

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
  const [details, setDetails] = useState(true);       // windows, doors, roof caps
  const [quality, setQuality] = useState(() => {       // 'high' = shadows + textures, 'basic' = light on phones
    try { const q = localStorage.getItem('rf_3d_quality'); if (q === 'high' || q === 'basic') return q; } catch { /* storage unavailable */ }
    return typeof window !== 'undefined' && window.innerWidth < 700 ? 'basic' : 'high';
  });
  const toggleQuality = () => setQuality(q => { const n = q === 'high' ? 'basic' : 'high'; try { localStorage.setItem('rf_3d_quality', n); } catch { /* ignore */ } return n; });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const camMemory = useRef(null);                  // keeps the camera where the user left it across rebuilds

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
    setLoading(true); setError(''); setSelectedId(null); setFilterState(null); setEditing(false); camMemory.current = null;
    API.get(`/houses/building/${plotId}`)
      .then(r => setInfo(r.data.data))
      .catch(e => setError(e.response?.data?.error || 'Could not load this building.'))
      .finally(() => setLoading(false));
  }, [plotId]);

  const units = useMemo(() => info?.units || [], [info]);
  const viewUnits = useMemo(() => (editing && draft ? applyDraft(units, draft) : units), [units, editing, draft]);
  const viewExtras = editing && draft ? draft.extras : (info?.extras || []);
  const layout = useMemo(() => computePlacement(viewUnits, viewExtras, perFloor), [viewUnits, viewExtras, perFloor]); // eslint-disable-line react-hooks/exhaustive-deps
  // While editing, wait a moment after the last change before rebuilding the 3D scene
  // (painting a fence changes the layout on every square).
  const [sceneLayout, setSceneLayout] = useState(layout);
  useEffect(() => {
    if (!editing) { setSceneLayout(layout); return undefined; }
    const t = setTimeout(() => setSceneLayout(layout), 140);
    return () => clearTimeout(t);
  }, [layout, editing]);
  const selected = viewUnits.find(u => u.id === selectedId) || null;
  const counts = info?.summary || {};
  const owed = units.reduce((a, u) => a + (u.balance || 0), 0);

  // ── 3D scene: rebuilt when the layout or mode changes ──
  useEffect(() => {
    const layout = sceneLayout;
    if (mode !== '3d' || !mountRef.current || !layout.items.length) return undefined;
    const el = mountRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch { setWebglOk(false); setMode('2d'); return undefined; }
    setWebglOk(true);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const hi = quality === 'high';
    renderer.shadowMap.enabled = hi; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = skyTexture();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x6b8e4e, 0.85));

    const { group, meshes, totalW, totalD, maxFloor } = buildBuilding(layout, { details, quality });
    const span = Math.max(totalW, totalD);
    const groundR = span * 1.6 + 14;
    scene.fog = new THREE.Fog(SKY_HORIZON, groundR * 0.55, groundR * 1.02);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
    sun.position.set(span * 0.7 + 8, span * 1.1 + 14, span * 0.45 + 6);
    if (hi) {
      sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
      const e = span * 0.75 + 8, sc = sun.shadow.camera;
      sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.near = 1; sc.far = span * 3 + 60;
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    }
    scene.add(sun);
    scene.add(group);
    const height = (maxFloor + 1) * FLOOR_H;
    const target = new THREE.Vector3(0, height / 2, 0);
    const radius = Math.max(totalW, totalD, height * 1.3) * 0.85 + 3.5;
    const home = new THREE.Vector3(radius * 0.8, height * 0.7 + radius * 0.45, radius * 0.9);
    const mem = camMemory.current;
    if (mem) camera.position.set(...mem.pos); else camera.position.copy(home);
    const controls = new OrbitControls(camera, renderer.domElement);
    if (mem) controls.target.set(...mem.target); else controls.target.copy(target);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.05; controls.minDistance = 4; controls.maxDistance = radius * 3 + 20;
    controls.autoRotate = !mem; controls.autoRotateSpeed = 0.9;
    controls.addEventListener('start', () => { controls.autoRotate = false; setAutoRotate(false); });
    controls.update();

    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
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
      if (m !== hovered) { hovered = m; renderer.domElement.style.cursor = m ? 'pointer' : 'grab'; }
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
    const handlers = { pointermove: onMove, pointerdown: onDown, pointerup: onUp, pointerleave: onLeave };
    Object.entries(handlers).forEach(([n, f]) => renderer.domElement.addEventListener(n, f));

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight || 1;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      meshes.forEach(m => { // gentle hover lift
        const targetY = m.userData.baseY ?? (m.userData.baseY = m.position.y);
        m.position.y += ((hovered === m ? targetY + 0.12 : targetY) - m.position.y) * 0.25;
        m.userData.sprite.position.y = m.position.y + H / 2 + 0.28;
      });
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    sceneRef.current = { meshes, outline, controls, camera, home, target };
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      camMemory.current = { pos: camera.position.toArray(), target: controls.target.toArray() };
      controls.dispose();
      Object.entries(handlers).forEach(([n, f]) => renderer.domElement.removeEventListener(n, f));
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      sceneRef.current = {};
    };
  }, [sceneLayout, mode, details, quality]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter dimming + selection outline (cheap, no scene rebuild)
  useEffect(() => {
    const { meshes, outline } = sceneRef.current;
    if (!meshes) return;
    meshes.forEach(m => {
      const dim = filterState && m.userData.unit.state !== filterState;
      m.material.opacity = dim ? 0.1 : m.userData.baseOpacity;
      (m.userData.detail || []).forEach(x => { x.opacity = dim ? 0.08 : x.userData.base; });
      m.userData.sprite.material.opacity = dim ? 0.15 : 1;
    });
    const sel = meshes.find(m => m.userData.unit.id === selectedId);
    if (sel) {
      const [w, h, d] = sel.userData.dims;
      outline.scale.set(w + 0.12, h + 0.12, d + 0.12);
      outline.visible = true; outline.position.copy(sel.position);
    } else outline.visible = false;
  }, [filterState, selectedId, sceneLayout, mode, details, quality]);

  useEffect(() => { const c = sceneRef.current.controls; if (c) c.autoRotate = autoRotate; }, [autoRotate]);

  function startEdit() {
    setDraft(draftFrom(units, info.extras || [], perFloor));
    setSaveError(''); setSelectedId(null); setEditing(true);
  }
  function autoArrange() {
    setDraft(d => draftFrom(units.map(u => ({ ...u, layout_x: null })), d ? d.extras : [], perFloor));
  }
  function cancelEdit() { setEditing(false); setDraft(null); setSaveError(''); }
  async function saveLayout() {
    setSaving(true); setSaveError('');
    try {
      await API.put(`/houses/layout/${plotId}`, {
        units: units.map(u => ({ id: u.id, ...draft.units[u.id] })),
        extras: draft.extras,
      });
      const r = await API.get(`/houses/building/${plotId}`);
      setInfo(r.data.data); setEditing(false); setDraft(null);
    } catch (e) {
      setSaveError(e.response?.data?.error || 'Could not save the layout.');
    } finally { setSaving(false); }
  }

  function resetView() {
    const { camera, controls, home, target } = sceneRef.current;
    if (!camera) return;
    camera.position.copy(home); controls.target.copy(target); controls.update(); camMemory.current = null; setAutoRotate(true);
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
          {mode === '3d' && <button style={btn} onClick={toggleQuality} title="Realistic adds shadows and textures; Basic is lighter on phones">{quality === 'high' ? '✨ Realistic' : '⚡ Basic'}</button>}
          {mode === '3d' && <button style={btn} onClick={() => setDetails(d => !d)}>{details ? '🪟 Hide windows & doors' : '🪟 Show windows & doors'}</button>}
          {mode === '3d' && <button style={btn} onClick={resetView}>⌂ Reset view</button>}
          {info?.can_edit_layout && !editing && <button style={{ ...btn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' }} onClick={() => { setMode('3d'); startEdit(); }}>✏️ Edit layout</button>}
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
              {layout.items.length === 0 && <div style={{ padding: 40, color: 'var(--muted)' }}>This property has no approved units yet.</div>}

              {mode === '3d' && <div ref={mountRef} style={{ position: 'absolute', inset: 0, cursor: 'grab' }} />}
              {mode === '3d' && hover && (
                <div style={{ position: 'absolute', left: Math.min(hover.x + 14, 9999), top: hover.y + 14, pointerEvents: 'none', background: '#0f172a', color: '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.5, zIndex: 3, boxShadow: '0 6px 20px rgba(0,0,0,.3)' }}>
                  <div style={{ fontWeight: 700 }}>Unit {hover.unit.unit_number} · {STATES[hover.unit.state]?.label}</div>
                  {hover.unit.tenant && <div>{hover.unit.tenant.name}</div>}
                  {hover.unit.balance > 0 && <div style={{ color: '#fca5a5' }}>Owes {kes(hover.unit.balance)}</div>}
                </div>
              )}
              {mode === '3d' && layout.items.length > 0 && <div style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 11.5, color: 'var(--muted)', pointerEvents: 'none' }}>Drag to rotate · scroll to zoom · click a unit for details</div>}

              {mode === '2d' && (
                <div style={{ padding: 16, overflow: 'auto', maxHeight: 620 }}>
                  {[...new Set(layout.items.map(i => i.floor))].sort((x, y) => y - x).map(f => (
                    <div key={f} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{layout.anyFloor ? (f === 0 ? 'Ground floor' : `Floor ${f}`) : `Row ${f + 1}`}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {layout.items.filter(i => i.floor === f).sort((a, b) => a.z - b.z || a.x - b.x).map(({ unit: u }) => {
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
                  {!layout.custom && !layout.anyFloor && mode === '3d' && !editing && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Units per floor: {perFloor}</div>
                      <input type="range" min="2" max="12" value={perFloor} onChange={e => setPerFloor(parseInt(e.target.value))} style={{ width: '100%' }} />
                      <div style={{ fontSize: 11.5, marginTop: 4 }}>No floors are set on these units, so they are stacked automatically. Set a floor on each unit (Properties → edit unit), or use Edit layout to place each unit exactly.</div>
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
          {editing && draft && (
            <LayoutEditor units={units} draft={draft} setDraft={setDraft} onSave={saveLayout} onCancel={cancelEdit} onAuto={autoArrange} saving={saving} error={saveError} />
          )}
          {layout.custom && layout.unplaced > 0 && !editing && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 10 }}>{layout.unplaced} unit{layout.unplaced > 1 ? 's are' : ' is'} not placed yet and shown in a row in front of the building.</div>
          )}
        </>
      )}
    </div>
  );
}
