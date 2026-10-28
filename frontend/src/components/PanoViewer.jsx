// 360° photo viewer (Street-View style): drag to look around, wheel / pinch to
// zoom. Staff mode lists every photo of a property and lets people with edit
// rights add, rename, publish or delete them. Public mode shows only photos the
// owner published, with no login.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import API from '../services/api';

const MAX_W = 4096;

// Shrink a camera photo so it uploads quickly and fits a phone GPU.
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_W / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  return { blob, w, h, ratio: bmp.width / bmp.height };
}

function Sphere({ src, onReady, onError }) {
  const box = useRef(null);
  const auto = useRef(true);
  useEffect(() => {
    const el = box.current; if (!el || !src) return undefined;
    let dead = false, raf = 0, tex = null;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
    const geo = new THREE.SphereGeometry(500, 64, 40); geo.scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    scene.add(new THREE.Mesh(geo, mat));
    const st = { lon: 0, lat: 0, fov: 75, vx: 0, vy: 0 };
    const size = () => { const w = el.clientWidth || 300, h = el.clientHeight || 300; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    size(); const ro = new ResizeObserver(size); ro.observe(el);
    new THREE.TextureLoader().load(src, (t) => {
      if (dead) { t.dispose(); return; }
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; tex = t;
      mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true; onReady && onReady();
    }, undefined, () => onError && onError());
    const pts = new Map(); let pinch = 0;
    const dom = renderer.domElement;
    const down = (e) => { dom.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); auto.current = false; st.vx = st.vy = 0; dom.style.cursor = 'grabbing'; };
    const move = (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 2) {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) st.fov = Math.min(100, Math.max(25, st.fov * (pinch / d)));
        pinch = d; return;
      }
      const k = st.fov / 600;
      st.vx = -(e.clientX - p.x) * k; st.vy = (e.clientY - p.y) * k;
      st.lon += st.vx; st.lat = Math.max(-85, Math.min(85, st.lat + st.vy));
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const up = (e) => { pts.delete(e.pointerId); pinch = 0; dom.style.cursor = 'grab'; };
    const wheel = (e) => { e.preventDefault(); st.fov = Math.min(100, Math.max(25, st.fov + e.deltaY * 0.05)); };
    dom.addEventListener('pointerdown', down); dom.addEventListener('pointermove', move);
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', wheel, { passive: false });
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!pts.size) { st.lon += st.vx; st.lat = Math.max(-85, Math.min(85, st.lat + st.vy)); st.vx *= 0.92; st.vy *= 0.92; if (auto.current) st.lon += 0.06; }
      cam.fov = st.fov; cam.updateProjectionMatrix();
      const phi = THREE.MathUtils.degToRad(90 - st.lat), th = THREE.MathUtils.degToRad(st.lon);
      cam.lookAt(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
      renderer.render(scene, cam);
    };
    loop();
    return () => {
      dead = true; cancelAnimationFrame(raf); ro.disconnect();
      dom.removeEventListener('wheel', wheel);
      if (tex) tex.dispose(); mat.dispose(); geo.dispose();
      renderer.dispose(); renderer.forceContextLoss();
      if (dom.parentNode) dom.parentNode.removeChild(dom);
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={box} style={{ position: 'absolute', inset: 0 }} />;
}

export default function PanoViewer({ plotId, plotName, publicMode = false, onClose }) {
  const [items, setItems] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [cur, setCur] = useState(null);
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [max, setMax] = useState(30);
  const fileRef = useRef(null);
  const blobUrl = useRef('');
  const base = API.defaults.baseURL;

  const load = useCallback(async (keep) => {
    try {
      const r = await API.get(publicMode ? `/panoramas/public/plot/${plotId}` : `/panoramas/plot/${plotId}`);
      setItems(r.data.items); setCanEdit(!!r.data.can_edit); if (r.data.max) setMax(r.data.max);
      setCur(c => (keep && r.data.items.find(i => i.id === keep)) ? keep : (r.data.items.find(i => i.id === c)?.id ?? r.data.items[0]?.id ?? null));
      setErr('');
    } catch (e) { setErr(e.response?.data?.error || 'Could not load 360° photos.'); }
    setLoading(false);
  }, [plotId, publicMode]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let dead = false;
    if (blobUrl.current) { URL.revokeObjectURL(blobUrl.current); blobUrl.current = ''; }
    setSrc('');
    if (!cur) return undefined;
    if (publicMode) { setSrc(`${base}/panoramas/public/${cur}/image`); return undefined; }
    API.get(`/panoramas/${cur}/image`, { responseType: 'blob' }).then(r => {
      if (dead) return; blobUrl.current = URL.createObjectURL(r.data); setSrc(blobUrl.current);
    }).catch(() => !dead && setErr('Could not load that photo.'));
    return () => { dead = true; };
  }, [cur, publicMode, base]);
  useEffect(() => () => { if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); }, []);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const current = items.find(i => i.id === cur);

  const add = async (file) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const { blob, w, h, ratio } = await shrink(file);
      if (ratio < 1.8 || ratio > 2.2) setErr('Heads up: a true 360° photo is twice as wide as it is tall. This one will look stretched.');
      const fd = new FormData();
      fd.append('title', file.name.replace(/\.[^.]+$/, '').slice(0, 60)); fd.append('width', w); fd.append('height', h);
      fd.append('file', blob, 'pano.jpg');
      const r = await API.post(`/panoramas/plot/${plotId}`, fd);
      await load(r.data.item.id);
    } catch (e) { setErr(e.response?.data?.error || 'Upload failed.'); }
    setBusy(false); if (fileRef.current) fileRef.current.value = '';
  };
  const patch = async (body) => { try { await API.patch(`/panoramas/${cur}`, body); await load(cur); } catch (e) { setErr(e.response?.data?.error || 'Could not save.'); } };
  const remove = async () => {
    if (!window.confirm(`Delete "${current?.title}"?`)) return;
    try { await API.delete(`/panoramas/${cur}`); setCur(null); await load(); } catch (e) { setErr(e.response?.data?.error || 'Could not delete.'); }
  };

  const chip = { padding: '6px 11px', borderRadius: 99, border: '1px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.1)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: '#0b0f1a', display: 'flex', flexDirection: 'column', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', flexWrap: 'wrap', background: 'rgba(0,0,0,.4)' }}>
        <b style={{ fontSize: 15 }}>📷 {plotName || 'Property'} · 360°</b>
        <div style={{ flex: 1 }} />
        {canEdit && !publicMode && <>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => add(e.target.files[0])} />
          <button style={chip} disabled={busy || items.length >= max} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : '＋ Add 360° photo'}</button>
        </>}
        <button style={chip} onClick={onClose} aria-label="Close">✕ Close</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {src && <Sphere key={src} src={src} onError={() => setErr('That image could not be displayed.')} />}
        {loading && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>Loading…</div>}
        {!loading && !items.length && !err && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24, color: '#cbd5e1' }}>
            <div>No 360° photos yet.{canEdit && !publicMode && <div style={{ fontSize: 13, marginTop: 6 }}>Take one with your phone camera's panorama / 360 mode (or a 360 camera) and tap “Add 360° photo”.</div>}</div>
          </div>
        )}
        {err && <div style={{ position: 'absolute', left: 12, right: 12, top: 10, background: 'rgba(120,20,20,.9)', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>{err}</div>}
        {current && <div style={{ position: 'absolute', left: 12, bottom: 70, fontSize: 12, opacity: .8, pointerEvents: 'none' }}>Drag to look around · scroll or pinch to zoom</div>}
      </div>
      <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,.5)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {items.map(i => (
          <button key={i.id} onClick={() => setCur(i.id)} style={{ ...chip, background: i.id === cur ? '#7c3aed' : chip.background }}>
            {i.title}{!publicMode && i.is_public ? ' 🌐' : ''}
          </button>
        ))}
        {canEdit && !publicMode && current && <>
          <div style={{ flex: 1 }} />
          <button style={chip} onClick={() => { const t = window.prompt('Name this view', current.title); if (t !== null && t.trim()) patch({ title: t.trim() }); }}>Rename</button>
          <button style={chip} onClick={() => patch({ is_public: !current.is_public })} title="Public photos appear on the public listings page">{current.is_public ? '🌐 Public — make private' : 'Make public'}</button>
          <button style={{ ...chip, borderColor: '#f87171', color: '#fecaca' }} onClick={remove}>Delete</button>
        </>}
      </div>
    </div>
  );
}
