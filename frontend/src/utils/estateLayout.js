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
