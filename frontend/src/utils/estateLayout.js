// Layout helpers for the admin estate map. Positions are in the same grid
// cells as a single property's 3D layout, so one cell = one cell everywhere.
// A property's position (x, z) is the top-left cell of its footprint AFTER
// rotation; rot is quarter turns clockwise seen from above.
import { computePlacement } from './buildingLayout';

export const MAP_W = 80;
export const MAP_D = 56;
export const PIECE_KINDS = {
  road: { label: 'Road', color: '#52525b' },
  tree: { label: 'Tree', color: '#16a34a' },
  pond: { label: 'Pond', color: '#38bdf8' },
};

// Size of a property's model in cells (before rotation) and its placement.
export function footprint(plotData) {
  const layout = computePlacement(plotData.units || [], plotData.extras || [], 6);
  const all = [...layout.items, ...layout.extras];
  if (!all.length) return { w: 4, d: 4, layout, empty: true };
  const minX = Math.min(...all.map(i => i.x)), maxX = Math.max(...all.map(i => i.x + i.w));
  const minZ = Math.min(...all.map(i => i.z)), maxZ = Math.max(...all.map(i => i.z + i.d));
  return { w: maxX - minX, d: maxZ - minZ, layout, empty: false };
}

export const rotatedSize = (fp, rot) => (rot % 2 ? { w: fp.d, d: fp.w } : { w: fp.w, d: fp.d });

export const rectsOverlap = (a, b, margin = 0) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.z < b.z + b.d + margin && b.z < a.z + a.d + margin;

export const rectFits = (r) => r.x >= 0 && r.z >= 0 && r.x + r.w <= MAP_W && r.z + r.d <= MAP_D;

// Saved positions are kept; properties that were never placed are packed into
// the first free spot (left to right, top to bottom) with a gap between them.
export function resolvePositions(plots, fps) {
  const out = {};
  const rects = [];
  plots.forEach(p => {
    const id = p.plot.id, m = p.map || {};
    if (m.x != null && m.z != null) {
      out[id] = { x: m.x, z: m.z, rot: m.rot || 0 };
      const s = rotatedSize(fps[id], m.rot || 0);
      rects.push({ x: m.x, z: m.z, w: s.w, d: s.d });
    }
  });
  plots.forEach(p => {
    const id = p.plot.id;
    if (out[id]) return;
    const { w, d } = fps[id];
    let spot = null;
    for (let z = 2; z + d <= MAP_D && !spot; z++) {
      for (let x = 2; x + w <= MAP_W && !spot; x++) {
        const r = { x, z, w, d };
        if (!rects.some(o => rectsOverlap(r, o, 3))) spot = r;
      }
    }
    if (!spot) spot = { x: 0, z: 0, w, d };      // map is full: park at the corner, admin can move it
    out[id] = { x: spot.x, z: spot.z, rot: 0 };
    rects.push(spot);
  });
  return out;
}

export function draftFromEstate(plots, fps, pieces) {
  return { plots: resolvePositions(plots, fps), pieces: (pieces || []).map(p => ({ ...p })) };
}

// ── real-world geography ──
const R_EARTH = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export const hasPin = (p) => p?.plot?.lat != null && p?.plot?.lng != null;

// Great-circle distance in metres between two {lat, lng} points.
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Compass point you would face going from a to b ("N", "NE", ...).
export function compassTo(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  const deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}
export const fmtDistance = (m) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

// Positions that mirror the real map: north is the top of the grid and the
// relative distances between properties are kept (scaled down to fit the map).
// Only properties with a pin are moved; the rest stay where `current` has them.
// Returns { positions, metresPerSquare }.
export function arrangeByGps(plots, fps, current) {
  const pinned = plots.filter(hasPin);
  const out = {};
  Object.keys(current || {}).forEach(k => { out[k] = { ...current[k] }; });
  if (pinned.length < 2) return { positions: out, metresPerSquare: null };
  const lat0 = pinned.reduce((a, p) => a + p.plot.lat, 0) / pinned.length;
  const lng0 = pinned.reduce((a, p) => a + p.plot.lng, 0) / pinned.length;
  const pts = pinned.map(p => ({
    id: p.plot.id,
    x: rad(p.plot.lng - lng0) * R_EARTH * Math.cos(rad(lat0)),
    z: -rad(p.plot.lat - lat0) * R_EARTH,
    w: fps[p.plot.id].w, d: fps[p.plot.id].d,
  }));
  const spanX = Math.max(1, Math.max(...pts.map(q => q.x)) - Math.min(...pts.map(q => q.x)));
  const spanZ = Math.max(1, Math.max(...pts.map(q => q.z)) - Math.min(...pts.map(q => q.z)));
  const maxW = Math.max(...pts.map(q => q.w)), maxD = Math.max(...pts.map(q => q.d));
  // squares per metre so the whole spread fits the map with a margin
  const k = Math.min((MAP_W - 8 - maxW) / spanX, (MAP_D - 8 - maxD) / spanZ);
  const cxm = (Math.max(...pts.map(q => q.x)) + Math.min(...pts.map(q => q.x))) / 2;
  const czm = (Math.max(...pts.map(q => q.z)) + Math.min(...pts.map(q => q.z))) / 2;
  const boxes = pts.map(q => ({ id: q.id, w: q.w, d: q.d, x: MAP_W / 2 + (q.x - cxm) * k - q.w / 2, z: MAP_D / 2 + (q.z - czm) * k - q.d / 2 }));
  // Buildings are far bigger than their real spacing at this scale, so nudge apart any that collide.
  for (let it = 0; it < 300; it++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j], gap = 3;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap, oz = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z) + gap;
      if (ox > 0 && oz > 0) {
        moved = true;
        if (ox < oz) { const s = (a.x + a.w / 2 < b.x + b.w / 2 ? -1 : 1) * ox / 2; a.x += s; b.x -= s; }
        else { const s = (a.z + a.d / 2 < b.z + b.d / 2 ? -1 : 1) * oz / 2; a.z += s; b.z -= s; }
      }
    }
    boxes.forEach(b => { b.x = Math.min(Math.max(b.x, 1), MAP_W - b.w - 1); b.z = Math.min(Math.max(b.z, 1), MAP_D - b.d - 1); });
    if (!moved) break;
  }
  boxes.forEach(b => { out[b.id] = { x: Math.round(b.x), z: Math.round(b.z), rot: 0 }; });
  return { positions: out, metresPerSquare: Math.round(1 / k) };
}
