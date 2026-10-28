// Admin-only estate map: every property's 3D model on one shared map, with
// free-fly / walk modes and an automatic drone tour. Data: GET /api/estate.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import API from '../services/api';
import { buildBuilding, STATES, CELL } from '../utils/buildingScene';
import { MAP_W, MAP_D, footprint, rotatedSize, resolvePositions, draftFromEstate } from '../utils/estateLayout';
import EstateMapEditor from '../components/EstateMapEditor';
import EstateRealMap from '../components/EstateRealMap';

const kes = (n) => `KES ${Math.round(parseFloat(n || 0)).toLocaleString()}`;
const EYE = 0.62;                      // walking eye height (one storey is 1.0)
const SPEED = { walk: 4, fly: 12 };

export default function EstateMap() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [view, setView] = useState(null);                // 'map' (real map) | '3d'; chosen once the data is in
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(true);
  const [webglOk, setWebglOk] = useState(true);
  const [nav, setNav] = useState('orbit');                 // 'orbit' | 'walk' | 'fly'
  const [tourOn, setTourOn] = useState(false);
  const [tourPaused, setTourPaused] = useState(false);
  const [tourStop, setTourStop] = useState(null);          // { id, name }
  const [filterState, setFilterState] = useState(null);
  const [selected, setSelected] = useState(null);          // { plotId, unitId }
  const [hover, setHover] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const mountRef = useRef(null);
  const sceneRef = useRef({});
  const camMem = useRef(null);
  const navRef = useRef({ mode: 'orbit', keys: new Set(), cmds: [], init: false, yaw: 0, pitch: 0 });

  const load = () => API.get('/estate')
    .then(r => { setData(r.data.data); setError(''); })
    .catch(e => setError(e.response?.data?.error || 'Could not load the estate map.'));
  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  // Open on the real map when at least one property has a location, otherwise straight into 3D.
  useEffect(() => { if (data && view === null) setView(data.plots.some(p => p.plot.lat != null) ? 'map' : '3d'); }, [data, view]);

  // ── derived data ──
  const fps = useMemo(() => (data ? Object.fromEntries(data.plots.map(p => [p.plot.id, footprint(p)])) : {}), [data]);
  const basePositions = useMemo(() => (data ? resolvePositions(data.plots, fps) : {}), [data, fps]);
  const positions = editing && draft ? draft.plots : basePositions;
  const pieces = editing && draft ? draft.pieces : (data?.pieces || []);
  const sceneInput = useMemo(() => (data ? { data, fps, positions, pieces, details } : null), [data, fps, positions, pieces, details]);
  // While editing, wait a moment after the last change before rebuilding the 3D scene.
  const [scene, setScene] = useState(null);
  useEffect(() => {
    if (!editing) { setScene(sceneInput); return undefined; }
    const t = setTimeout(() => setScene(sceneInput), 160);
    return () => clearTimeout(t);
  }, [sceneInput, editing]);

  const totals = useMemo(() => {
    const t = { plots: 0, units: 0, states: {} };
    (data?.plots || []).forEach(p => { t.plots++; p.units.forEach(u => { t.units++; t.states[u.state] = (t.states[u.state] || 0) + 1; }); });
    return t;
  }, [data]);
  const selPlot = selected ? data?.plots.find(p => p.plot.id === selected.plotId) : null;
  const selUnit = selPlot ? selPlot.units.find(u => u.id === selected.unitId) : null;

  // ── commands from the UI to the running scene ──
  const cmd = (c) => navRef.current.cmds.push(c);
  useEffect(() => { navRef.current.mode = nav; navRef.current.init = true; }, [nav]);
  const flyIn = (id) => {
    setSelected(null); setNav('orbit'); setTourOn(false); setTourPaused(false); setTourStop(null);
    navRef.current.cmds.length = 0; navRef.current.cmds.push({ type: 'fly-in', id });
    setView('3d');
  };
  const goMap = () => { setSelected(null); setTourOn(false); setTourPaused(false); setTourStop(null); setNav('orbit'); setView('map'); };
  const savePin = async (id, lat, lng) => {
    const r = await API.put(`/estate/plots/${id}/location`, { lat, lng });
    setData(d => ({ ...d, plots: d.plots.map(p => (p.plot.id === id ? { ...p, plot: { ...p.plot, lat: r.data.lat, lng: r.data.lng } } : p)) }));
  };
  const startTour = () => { setSelected(null); cmd({ type: 'tour-start' }); };
  const stopTour = () => cmd({ type: 'tour-stop' });

  // ── 3D scene ──
  useEffect(() => {
    if (view !== '3d' || !scene || !mountRef.current) return undefined;
    const S = scene, el = mountRef.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { setWebglOk(false); return undefined; }
    setWebglOk(true);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const SKY = 0xbfdcf5;
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(SKY);
    sc.fog = new THREE.Fog(SKY, 90, 340);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 700);
    sc.add(new THREE.HemisphereLight(0xdbeafe, 0x6b8e4e, 0.75));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.95); sun.position.set(60, 90, 40); sc.add(sun);

    // Ground
    const mapW = MAP_W * CELL, mapD = MAP_D * CELL;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x86b36b, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.position.set(mapW / 2, -0.12, mapD / 2); sc.add(grass);
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(mapW, mapD), new THREE.MeshStandardMaterial({ color: 0x9ccc7e, roughness: 1 }));
    lot.rotation.x = -Math.PI / 2; lot.position.set(mapW / 2, -0.1, mapD / 2); sc.add(lot);

    // Roads, trees and ponds (instanced: one draw call per kind)
    const spots = (kind) => S.pieces.filter(p => p.kind === kind);
    const inst = (geo, mat, list, place) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, list.length), m4 = new THREE.Matrix4();
      list.forEach((p, i) => { place(m4, p, i, im); im.setMatrixAt(i, m4); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; sc.add(im); return im;
    };
    inst(new THREE.BoxGeometry(CELL, 0.06, CELL), new THREE.MeshStandardMaterial({ color: 0x52525b, roughness: 0.95 }), spots('road'),
      (m, p) => m.makeTranslation((p.x + 0.5) * CELL, 0.0, (p.z + 0.5) * CELL));
    inst(new THREE.BoxGeometry(CELL, 0.04, CELL), new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.2, metalness: 0.1 }), spots('pond'),
      (m, p) => m.makeTranslation((p.x + 0.5) * CELL, -0.02, (p.z + 0.5) * CELL));
    const trees = spots('tree');
    inst(new THREE.CylinderGeometry(0.08, 0.1, 0.55, 8), new THREE.MeshStandardMaterial({ color: 0x92400e }), trees,
      (m, p) => m.makeTranslation((p.x + 0.5) * CELL, 0.27, (p.z + 0.5) * CELL));
    inst(new THREE.ConeGeometry(0.5, 1.3, 9), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), trees, (m, p, i, im) => {
      const s = 0.8 + ((p.x * 7 + p.z * 13) % 5) / 10;
      m.compose(new THREE.Vector3((p.x + 0.5) * CELL, 0.55 + 0.65 * s, (p.z + 0.5) * CELL), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      im.setColorAt(i, new THREE.Color().setHSL(0.3 + (((p.x + p.z) % 4) / 100), 0.55, 0.28 + (((p.x * 3 + p.z) % 5) / 50)));
    });

    // Properties
    const allMeshes = [], stops = [], labels = [];
    const rectsAll = [];
    const label = (text, sub) => {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
      const c = cv.getContext('2d');
      c.fillStyle = 'rgba(15,23,42,0.82)'; c.beginPath(); c.roundRect?.(4, 4, 504, 120, 22); if (!c.roundRect) c.rect(4, 4, 504, 120); c.fill();
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = 'bold 44px sans-serif'; c.fillText(String(text).slice(0, 20), 256, 50);
      c.font = '28px sans-serif'; c.fillStyle = '#cbd5e1'; c.fillText(sub, 256, 94);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
      sp.scale.set(8, 2, 1); sp.renderOrder = 20; return sp;
    };
    S.data.plots.forEach(p => {
      const id = p.plot.id, fp = S.fps[id], pos = S.positions[id];
      if (!pos) return;
      const r = rotatedSize(fp, pos.rot || 0);
      const cx = (pos.x + r.w / 2) * CELL, cz = (pos.z + r.d / 2) * CELL;
      const holder = new THREE.Group();
      holder.position.set(cx, 0, cz); holder.rotation.y = -(pos.rot || 0) * Math.PI / 2; sc.add(holder);
      let height = 1.3;
      if (fp.empty) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(fp.w * CELL, 0.1, fp.d * CELL), new THREE.MeshStandardMaterial({ color: 0xd4d4d8 }));
        slab.position.y = 0.0; holder.add(slab);
      } else {
        const b = buildBuilding(fp.layout, { details: S.details, ground: false });
        height = b.height;
        holder.add(b.group);
        b.meshes.forEach(m => { m.userData.plotId = id; allMeshes.push(m); });
      }
      const occ = p.units.filter(u => u.state !== 'vacant').length;
      const lab = label(p.plot.name, `${p.units.length} units · ${p.units.length ? Math.round((occ / p.units.length) * 100) : 0}% occupied`);
      lab.position.set(cx, height + 2.6, cz); sc.add(lab); labels.push(lab);
      stops.push({ id, name: p.plot.name, x: cx, z: cz, height, radius: Math.max(r.w, r.d) * CELL * 0.55 + 6 });
      rectsAll.push({ x: pos.x, z: pos.z, w: r.w, d: r.d });
    });
    sc.updateMatrixWorld(true);
    const solids = allMeshes.map(m => new THREE.Box3().setFromObject(m));

    // Stops in a sensible driving order: always go to the nearest property next
    const ordered = [];
    if (stops.length) {
      const left = [...stops]; let cur = left.shift(); ordered.push(cur);
      while (left.length) {
        let bi = 0, bd = Infinity;
        left.forEach((s, i) => { const d = Math.hypot(s.x - cur.x, s.z - cur.z); if (d < bd) { bd = d; bi = i; } });
        cur = left.splice(bi, 1)[0]; ordered.push(cur);
      }
    }

    // Default camera: the whole estate in view
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    rectsAll.forEach(r => { minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.w); minZ = Math.min(minZ, r.z); maxZ = Math.max(maxZ, r.z + r.d); });
    if (!rectsAll.length) { minX = 0; maxX = MAP_W; minZ = 0; maxZ = MAP_D; }
    const centre = new THREE.Vector3(((minX + maxX) / 2) * CELL, 0, ((minZ + maxZ) / 2) * CELL);
    const R = Math.max((maxX - minX) * CELL, (maxZ - minZ) * CELL) * 0.55 + 10;
    const home = centre.clone().add(new THREE.Vector3(R * 0.55, R * 0.75, R * 0.95));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.02; controls.minDistance = 3; controls.maxDistance = 400;
    const mem = camMem.current;
    if (mem) { camera.position.fromArray(mem.pos); controls.target.fromArray(mem.target); }
    else { camera.position.copy(home); controls.target.copy(centre); }
    controls.update();
    const nv = navRef.current;
    if (mem && nv.mode !== 'orbit') camera.quaternion.fromArray(mem.quat);   // keep looking the same way
    nv.yaw = 0; nv.pitch = 0; nv.init = nv.mode !== 'orbit'; nv.last = nv.mode;

    // ── tour ──
    const curLook = new THREE.Vector3().copy(controls.target);
    let tour = null;
    const smooth = (t) => t * t * (3 - 2 * t);
    const poseAt = (stop, a, pos, look) => {
      pos.set(stop.x + Math.cos(a) * stop.radius, stop.height + 3.4, stop.z + Math.sin(a) * stop.radius);
      look.set(stop.x, stop.height * 0.45, stop.z);
    };
    const beginTravel = (i) => {
      const stop = ordered[i];
      tour.i = i; tour.phase = 'travel'; tour.t = 0; tour.dur = 3.8;
      tour.fromPos.copy(camera.position); tour.fromLook.copy(curLook);
      tour.a0 = Math.atan2(camera.position.z - stop.z, camera.position.x - stop.x);
      setTourStop({ id: stop.id, name: stop.name });
    };
    const tp = new THREE.Vector3(), tl = new THREE.Vector3();
    const stepTour = (dt) => {
      if (!tour.paused) tour.t += dt;
      const stop = ordered[tour.i];
      if (tour.phase === 'travel') {
        const e = smooth(Math.min(1, tour.t / tour.dur));
        poseAt(stop, tour.a0, tp, tl);
        const pos = tour.fromPos.clone().lerp(tp, e); pos.y += Math.sin(Math.PI * e) * 4;
        curLook.copy(tour.fromLook).lerp(tl, e); camera.position.copy(pos);
        if (tour.t >= tour.dur) { tour.phase = 'orbit'; tour.t = 0; tour.dur = 11; }
      } else {
        const a = tour.a0 + (tour.t / tour.dur) * Math.PI * 1.15;
        poseAt(stop, a, tp, tl); camera.position.copy(tp); curLook.copy(tl);
        if (tour.t >= tour.dur) beginTravel((tour.i + 1) % ordered.length);
      }
      camera.lookAt(curLook);
    };
    const endTour = () => {
      tour = null; nv.init = true; nv.retarget = true; setTourOn(false); setTourPaused(false); setTourStop(null);
    };

    // ── smooth fly between viewpoints (map -> property, property -> overview) ──
    let fly = null;
    const startFly = (toPos, toTarget, dur = 2.6, done = null) => {
      if (tour) endTour();
      fly = { t: 0, dur, arc: Math.min(14, camera.position.distanceTo(toPos) * 0.12), fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: toPos.clone(), toTarget: toTarget.clone(), done };
    };
    const poseFor = (st) => ({ pos: new THREE.Vector3(st.x + st.radius * 0.7, st.height + st.radius * 0.7, st.z + st.radius * 0.9), target: new THREE.Vector3(st.x, st.height * 0.4, st.z) });

    // ── first-person movement ──
    const fwd = new THREE.Vector3(), right = new THREE.Vector3();
    const blocked = (x, z, y, m = 0.22) => solids.some(b => x > b.min.x - m && x < b.max.x + m && z > b.min.z - m && z < b.max.z + m && y > b.min.y - 0.2 && y < b.max.y + 0.2);
    const stepFree = (dt) => {
      const k = nv.keys, sprint = k.has('shift') ? 2.4 : 1;
      const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      const v = (k.has('e') || k.has('pageup') ? 1 : 0) - (k.has('q') || k.has('pagedown') ? 1 : 0);
      const sp = SPEED[nv.mode] * sprint * dt;
      fwd.set(-Math.sin(nv.yaw), 0, -Math.cos(nv.yaw)); right.set(Math.cos(nv.yaw), 0, -Math.sin(nv.yaw));
      if (nv.mode === 'fly') fwd.set(-Math.sin(nv.yaw) * Math.cos(nv.pitch), Math.sin(nv.pitch), -Math.cos(nv.yaw) * Math.cos(nv.pitch));
      const dx = (fwd.x * f + right.x * s) * sp, dz = (fwd.z * f + right.z * s) * sp, dy = (fwd.y * f + v * 0.8) * sp;
      const p = camera.position;
      if (nv.mode === 'walk') {
        if (!blocked(p.x + dx, p.z, EYE)) p.x += dx;      // slide along walls: test each axis on its own
        if (!blocked(p.x, p.z + dz, EYE)) p.z += dz;
        p.y = EYE;
      } else { p.x += dx; p.z += dz; p.y = Math.max(0.3, p.y + dy); }
      p.x = Math.min(Math.max(p.x, -30), mapW + 30); p.z = Math.min(Math.max(p.z, -30), mapD + 30);
      camera.rotation.set(nv.pitch, nv.yaw, 0, 'YXZ');
    };
    const freeSpot = (x, z) => {                       // nearest square not inside a building
      if (!blocked(x, z, EYE, 1.6)) return [x, z];      // land with a little room around us
      for (let r = 0.5; r < 60; r += 0.5) for (let k = 0; k < 16; k++) {
        const nx = x + Math.cos((k / 16) * Math.PI * 2) * r, nz = z + Math.sin((k / 16) * Math.PI * 2) * r;
        if (!blocked(nx, nz, EYE, 1.6)) return [nx, nz];
      }
      return [x, z];
    };
    const syncMode = (was) => {
      if (nv.mode === 'orbit') {
        if (was !== 'orbit' || nv.retarget) {            // came from walking/flying or a tour: orbit what we are looking at
          const dir = camera.getWorldDirection(new THREE.Vector3());
          const t = camera.position.clone().add(dir.multiplyScalar(Math.max(12, camera.position.y * 1.6))); t.y = 0;
          controls.target.copy(t); controls.update();
        }
      } else {
        const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        nv.yaw = e.y; nv.pitch = nv.mode === 'walk' ? Math.max(-0.4, Math.min(0.4, e.x)) : e.x;
        if (nv.mode === 'walk') {
          if (was === 'orbit' && !nv.retarget) camera.position.set(controls.target.x, EYE, controls.target.z);   // drop in where we were looking
          const [fx, fz] = freeSpot(camera.position.x, camera.position.z);
          camera.position.set(fx, EYE, fz);
        }
      }
      nv.retarget = false;
    };

    // ── pointer: hover, click-to-select, look-around ──
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    let hovered = null, downAt = null, looking = false;
    const pick = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(allMeshes, false)[0];
      return hit ? hit.object : null;
    };
    const onMove = (e) => {
      if (looking && nv.mode !== 'orbit' && !tour) {
        nv.yaw -= (e.movementX || 0) * 0.004; nv.pitch = Math.max(-1.45, Math.min(1.45, nv.pitch - (e.movementY || 0) * 0.004));
      }
      if (e.buttons) { setHover(null); return; }
      const m = pick(e);
      if (m !== hovered) {
        if (hovered) hovered.material.emissive.setHex(0x000000);
        if (m) m.material.emissive.setHex(0x2a2a2a);
        hovered = m; renderer.domElement.style.cursor = m ? 'pointer' : (nv.mode === 'orbit' ? 'grab' : 'crosshair');
      }
      const r = renderer.domElement.getBoundingClientRect();
      setHover(m ? { unit: m.userData.unit, plotId: m.userData.plotId, x: e.clientX - r.left, y: e.clientY - r.top } : null);
    };
    const onDown = (e) => { downAt = { x: e.clientX, y: e.clientY }; looking = true; renderer.domElement.setPointerCapture?.(e.pointerId); };
    const onUp = (e) => {
      looking = false;
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
      const m = pick(e);
      setSelected(m ? { plotId: m.userData.plotId, unitId: m.userData.unit.id } : null);
    };
    const onLeave = () => { setHover(null); };
    const hs = { pointermove: onMove, pointerdown: onDown, pointerup: onUp, pointerleave: onLeave };
    Object.entries(hs).forEach(([n, f]) => renderer.domElement.addEventListener(n, f));

    const typing = (e) => /input|select|textarea/i.test(e.target?.tagName || '');
    const onKey = (e) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { if (tour) endTour(); else if (nv.mode !== 'orbit') setNav('orbit'); return; }
      if (nv.mode === 'orbit' && !tour) return;
      if (['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown'].includes(k)) {
        e.preventDefault();
        if (e.type === 'keydown') nv.keys.add(k); else nv.keys.delete(k);
      }
    };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
    const onBlur = () => nv.keys.clear(); window.addEventListener('blur', onBlur);

    const resize = () => { const w = el.clientWidth, h = el.clientHeight || 1; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    // ── selection outline + sprite culling + loop ──
    let helper = null, raf, frame = 0;
    const clock = new THREE.Clock(), tmp = new THREE.Vector3();
    const spriteMeshes = allMeshes.filter(m => m.userData.sprite);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      // commands from the UI
      while (nv.cmds.length) {
        const c = nv.cmds.shift();
        if (c.type === 'tour-start' && ordered.length) {
          tour = { i: 0, phase: 'travel', t: 0, dur: 3.8, paused: false, a0: 0, fromPos: new THREE.Vector3(), fromLook: new THREE.Vector3() };
          nv.keys.clear(); setTourOn(true); setTourPaused(false);
          if (nv.mode === 'orbit') curLook.copy(controls.target);
          else curLook.copy(camera.getWorldDirection(tmp)).multiplyScalar(10).add(camera.position);
          beginTravel(0);
        } else if (c.type === 'tour-stop' && tour) endTour();
        else if (c.type === 'tour-pause' && tour) { tour.paused = !tour.paused; setTourPaused(tour.paused); }
        else if (c.type === 'tour-next' && tour) beginTravel((tour.i + 1) % ordered.length);
        else if (c.type === 'tour-prev' && tour) beginTravel((tour.i - 1 + ordered.length) % ordered.length);
        else if (c.type === 'focus') {
          const st = stops.find(s => s.id === c.id);
          if (st) {
            if (tour) endTour();
            setNav('orbit'); nv.mode = 'orbit';
            const ps = poseFor(st); startFly(ps.pos, ps.target, 1.8);
          }
        } else if (c.type === 'fly-in') {                 // arrive from the map: start high over the whole estate, then drop onto the property
          const st = stops.find(s => s.id === c.id);
          setNav('orbit'); nv.mode = 'orbit'; nv.init = false;
          camera.position.copy(home); controls.target.copy(centre); controls.update();
          if (st) { const ps = poseFor(st); startFly(ps.pos, ps.target, 2.8); }
        } else if (c.type === 'fly-out') {                // back to the map: rise over the whole estate, then switch
          setNav('orbit'); nv.mode = 'orbit';
          startFly(home, centre, 2.2, () => setView('map'));
        } else if (c.type === 'home') { if (tour) endTour(); setNav('orbit'); nv.mode = 'orbit'; camera.position.copy(home); controls.target.copy(centre); controls.update(); }
      }
      if (nv.init) { nv.init = false; const was = nv.last; nv.last = nv.mode; if (!tour) syncMode(was); }
      controls.enabled = nv.mode === 'orbit' && !tour && !fly;
      if (fly) {
        fly.t += dt;
        const e = smooth(Math.min(1, fly.t / fly.dur));
        camera.position.lerpVectors(fly.fromPos, fly.toPos, e); camera.position.y += Math.sin(Math.PI * e) * fly.arc;
        controls.target.lerpVectors(fly.fromTarget, fly.toTarget, e); camera.lookAt(controls.target);
        if (fly.t >= fly.dur) { const d = fly.done; fly = null; controls.update(); if (d) d(); }
      } else if (tour) stepTour(dt);
      else if (nv.mode === 'orbit') controls.update();
      else stepFree(dt);
      if (helper) helper.update();
      labels.forEach(l => {                              // keep name tags readable at any distance
        const d = camera.position.distanceTo(l.position), k = Math.min(Math.max(d * 0.045, 1.2), 6);
        l.scale.set(k * 3.2, k * 0.8, 1); l.visible = d > 14;
      });
      if ((frame++ & 7) === 0) spriteMeshes.forEach(m => { m.userData.sprite.getWorldPosition(tmp); m.userData.sprite.visible = camera.position.distanceTo(tmp) < 42; });
      renderer.render(sc, camera);
    };
    tick();

    sceneRef.current = { sc, meshes: allMeshes, setHelper: (mesh) => {
      if (helper) { sc.remove(helper); helper.geometry.dispose(); helper = null; }
      if (mesh) { helper = new THREE.BoxHelper(mesh, 0xffffff); sc.add(helper); }
    } };

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      camMem.current = { pos: camera.position.toArray(), target: controls.target.toArray(), quat: camera.quaternion.toArray() };
      controls.dispose();
      Object.entries(hs).forEach(([n, f]) => renderer.domElement.removeEventListener(n, f));
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', onBlur);
      sc.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      });
      renderer.dispose(); renderer.forceContextLoss();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      sceneRef.current = {};
    };
  }, [scene, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dimming by payment state + selection outline (no scene rebuild)
  useEffect(() => {
    const { meshes, setHelper } = sceneRef.current;
    if (!meshes) return;
    meshes.forEach(m => {
      const dim = filterState && m.userData.unit.state !== filterState;
      m.material.opacity = dim ? 0.1 : m.userData.baseOpacity;
      (m.userData.detail || []).forEach(x => { x.opacity = dim ? 0.08 : x.userData.base; });
      m.userData.sprite.material.opacity = dim ? 0.15 : 1;
    });
    const sel = selected ? meshes.find(m => m.userData.unit.id === selected.unitId && m.userData.plotId === selected.plotId) : null;
    setHelper(sel || null);
  }, [filterState, selected, scene, view]);

  // ── editing ──
  function startEdit() {
    cmd({ type: 'tour-stop' }); setNav('orbit'); setSelected(null); cmd({ type: 'home' });
    setDraft(draftFromEstate(data.plots, fps, data.pieces)); setSaveError(''); setEditing(true);
  }
  function cancelEdit() { setEditing(false); setDraft(null); setSaveError(''); }
  async function saveMap() {
    setSaving(true); setSaveError('');
    try {
      await API.put('/estate/layout', {
        plots: Object.entries(draft.plots).map(([id, p]) => ({ id: Number(id), x: p.x, z: p.z, rot: p.rot || 0 })),
        pieces: draft.pieces,
      });
      await load(); setEditing(false); setDraft(null);
    } catch (e) { setSaveError(e.response?.data?.error || 'Could not save the map.'); }
    finally { setSaving(false); }
  }

  // ── UI ──
  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)' };
  const btn = { padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' };
  const seg = (on) => ({ ...btn, borderRadius: 0, border: 'none', background: on ? 'var(--text)' : 'var(--surface)', color: on ? 'var(--surface)' : 'var(--text)' });
  const present = Object.keys(STATES).filter(k => totals.states[k]);
  const pad = (k, t) => (
    <button key={k} onPointerDown={() => navRef.current.keys.add(k)} onPointerUp={() => navRef.current.keys.delete(k)} onPointerLeave={() => navRef.current.keys.delete(k)} onPointerCancel={() => navRef.current.keys.delete(k)}
      style={{ width: 44, height: 44, borderRadius: 10, border: '1px solid rgba(255,255,255,.5)', background: 'rgba(15,23,42,.55)', color: '#fff', fontSize: 18, touchAction: 'none', userSelect: 'none' }}>{t}</button>
  );

  return (
    <div style={{ padding: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', color: 'var(--text)' }}>Estate Map <span style={{ fontSize: 12, fontWeight: 700, background: 'var(--surface2)', color: 'var(--muted)', padding: '2px 9px', borderRadius: 99, verticalAlign: 'middle' }}>Admin</span></h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
            {data ? `${totals.plots} properties · ${totals.units} units · rent status for ${data.month}` : 'All your properties on one map.'}
          </p>
        </div>
        {data && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'inline-flex', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <button style={seg(view === 'map')} onClick={() => { if (view === '3d') goMap(); }} disabled={editing}>🗺 Map</button>
              <button style={seg(view === '3d')} onClick={() => { if (view !== '3d') { setView('3d'); setNav('orbit'); } }}>🧊 3D</button>
            </div>
            {view === '3d' && <>
            <button style={btn} onClick={() => cmd({ type: 'fly-out' })} disabled={editing}>⬆ Back to map</button>
            <div style={{ display: 'inline-flex', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {[['orbit', '🛰 Orbit'], ['walk', '🚶 Walk'], ['fly', '🕊 Fly']].map(([k, t]) => (
                <button key={k} style={seg(nav === k)} onClick={() => { if (tourOn) stopTour(); setNav(k); }} disabled={editing}>{t}</button>
              ))}
            </div>
            {!tourOn
              ? <button style={{ ...btn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' }} onClick={startTour} disabled={editing || !data.plots.length}>🎥 Start tour</button>
              : <div style={{ display: 'inline-flex', gap: 6 }}>
                  <button style={btn} onClick={() => cmd({ type: 'tour-prev' })}>⏮</button>
                  <button style={btn} onClick={() => cmd({ type: 'tour-pause' })}>{tourPaused ? '▶ Resume' : '⏸ Pause'}</button>
                  <button style={btn} onClick={() => cmd({ type: 'tour-next' })}>⏭</button>
                  <button style={{ ...btn, color: '#dc2626' }} onClick={stopTour}>■ Stop</button>
                </div>}
            <button style={btn} onClick={() => cmd({ type: 'home' })}>⌂ Whole estate</button>
            <button style={btn} onClick={() => setDetails(d => !d)}>{details ? '🪟 Hide windows & doors' : '🪟 Show windows & doors'}</button>
            {!editing && <button style={{ ...btn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' }} onClick={startEdit}>✏️ Edit map</button>}
            </>}
          </div>
        )}
      </div>

      {error && <div style={{ ...card, padding: 16, color: 'var(--red, #dc2626)' }}>{error}</div>}
      {loading && <div style={{ color: 'var(--muted)', padding: 20 }}>Loading the estate…</div>}
      {!loading && !error && webglOk === false && <div style={{ ...card, padding: 16, color: 'var(--muted)' }}>This device cannot show 3D. Open the estate map in a browser with WebGL enabled.</div>}

      {data && (
        <>
          {view === 'map' && <EstateRealMap plots={data.plots} admin onFly={flyIn} onOpen={(id) => navigate(`/building?plot=${id}`)} onSavePin={savePin} />}
          {view === '3d' && <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            {present.map(k => (
              <button key={k} onClick={() => setFilterState(f => (f === k ? null : k))}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 99, border: `1px solid ${filterState === k ? STATES[k].color : 'var(--border)'}`, background: filterState === k ? STATES[k].color : 'var(--surface)', color: filterState === k ? '#fff' : 'var(--text)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: STATES[k].color }} />{STATES[k].label} · {totals.states[k]}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <div style={{ ...card, flex: '1 1 560px', position: 'relative', minHeight: 520, overflow: 'hidden' }}>
              <div ref={mountRef} style={{ position: 'absolute', inset: 0, cursor: 'grab', touchAction: 'none' }} />
              {data.plots.length === 0 && <div style={{ position: 'relative', padding: 40, color: 'var(--muted)' }}>No properties yet.</div>}
              {hover && !tourOn && (
                <div style={{ position: 'absolute', left: hover.x + 14, top: hover.y + 14, pointerEvents: 'none', background: '#0f172a', color: '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.5, zIndex: 3 }}>
                  <div style={{ fontWeight: 700 }}>{data.plots.find(p => p.plot.id === hover.plotId)?.plot.name} · Unit {hover.unit.unit_number}</div>
                  <div>{STATES[hover.unit.state]?.label}{hover.unit.tenant ? ` · ${hover.unit.tenant.name}` : ''}</div>
                  {hover.unit.balance > 0 && <div style={{ color: '#fca5a5' }}>Owes {kes(hover.unit.balance)}</div>}
                </div>
              )}
              {tourOn && tourStop && (
                <div style={{ position: 'absolute', left: 14, top: 14, background: 'rgba(15,23,42,.8)', color: '#fff', padding: '10px 16px', borderRadius: 12, zIndex: 3, pointerEvents: 'none' }}>
                  <div style={{ fontSize: 11, opacity: .7, letterSpacing: '.06em', textTransform: 'uppercase' }}>Drone tour</div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{tourStop.name}</div>
                  {(() => { const p = data.plots.find(x => x.plot.id === tourStop.id); if (!p) return null;
                    const occ = p.units.filter(u => u.state !== 'vacant').length, late = p.units.filter(u => ['unpaid', 'overdue', 'partial'].includes(u.state)).length;
                    return <div style={{ fontSize: 12.5, opacity: .85 }}>{p.units.length} units · {occ} occupied · {late} behind on rent</div>; })()}
                </div>
              )}
              {!tourOn && nav !== 'orbit' && (
                <>
                  <div style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 11.5, color: '#0f172a', background: 'rgba(255,255,255,.7)', padding: '4px 9px', borderRadius: 8, pointerEvents: 'none' }}>
                    W A S D / arrows to move · drag to look · Shift to run{nav === 'fly' ? ' · Q / E down / up' : ''} · Esc to exit
                  </div>
                  <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 44px)', gap: 4, zIndex: 3 }}>
                    <span />{pad('w', '▲')}<span />{pad('a', '◀')}{pad('s', '▼')}{pad('d', '▶')}
                    {nav === 'fly' ? <>{pad('q', '⤓')}<span />{pad('e', '⤒')}</> : null}
                  </div>
                </>
              )}
              {!tourOn && nav === 'orbit' && <div style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 11.5, color: '#0f172a', background: 'rgba(255,255,255,.7)', padding: '4px 9px', borderRadius: 8, pointerEvents: 'none' }}>Drag to rotate · scroll to zoom · click a unit for details</div>}
            </div>

            <div style={{ ...card, flex: '0 1 300px', minWidth: 260, padding: 18, maxHeight: 560, overflow: 'auto' }}>
              {!selUnit && (
                <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Properties</div>
                  {data.plots.map(p => {
                    const late = p.units.filter(u => ['unpaid', 'overdue', 'partial'].includes(u.state)).length;
                    return (
                      <button key={p.plot.id} onClick={() => cmd({ type: 'focus', id: p.plot.id })}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 6, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
                        <div style={{ fontWeight: 700 }}>{p.plot.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.units.length} units{late ? ` · ${late} behind on rent` : ' · all up to date'}</div>
                      </button>
                    );
                  })}
                  <div style={{ fontSize: 12, marginTop: 8 }}>Click a property to fly to it, or click any unit on the map.</div>
                </div>
              )}
              {selUnit && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontFamily: 'Space Grotesk', fontWeight: 800, fontSize: 22, color: 'var(--text)' }}>Unit {selUnit.unit_number}</div>
                    <button onClick={() => setSelected(null)} style={{ border: 'none', background: 'var(--surface2)', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{selPlot.plot.name}</div>
                  <span style={{ display: 'inline-block', margin: '8px 0 14px', padding: '3px 12px', borderRadius: 99, background: STATES[selUnit.state]?.color, color: '#fff', fontSize: 12, fontWeight: 700 }}>{STATES[selUnit.state]?.label}</span>
                  {[['Type', selUnit.house_type || '—'], ['Monthly rent', kes(selUnit.rent_amount)],
                    ...(selUnit.tenant ? [['Tenant', selUnit.tenant.name], ['Phone', selUnit.tenant.phone || '—'], ['Paid this month', kes(selUnit.paid_this_month)], ['Balance owed', selUnit.balance > 0 ? kes(selUnit.balance) : 'None'], ['Months owed', selUnit.months_owed || 0]] : []),
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 600, color: 'var(--text)', textAlign: 'right' }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                    <button style={btn} onClick={() => navigate(`/building?plot=${selPlot.plot.id}`)}>Open property</button>
                    {selUnit.tenant && <button style={{ ...btn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' }} onClick={() => navigate('/payments', { state: { tenantId: selUnit.tenant.id } })}>Payments</button>}
                  </div>
                </div>
              )}
            </div>
          </div>

          </>}

          {view === '3d' && editing && draft && (
            <EstateMapEditor plots={data.plots} fps={fps} draft={draft} setDraft={setDraft} onSave={saveMap} onCancel={cancelEdit} saving={saving} error={saveError} />
          )}
        </>
      )}
    </div>
  );
}
