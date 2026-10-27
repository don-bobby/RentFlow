// Shared layout maths for the 3D building view and its editor.
// A "piece" is a rectangle on a floor in grid cells: { floor, x, z, w, d }.

export const GRID_W = 30;   // editor grid size in cells (server allows up to 40)
export const GRID_D = 20;
export const EXTRA_KINDS = {
  corridor: { label: 'Corridor', color: '#cbd5e1', w: 6, d: 1 },
  stairs:   { label: 'Stairs',   color: '#a8a29e', w: 1, d: 2 },
  garden:   { label: 'Garden',   color: '#4ade80', w: 4, d: 3 },
  road:     { label: 'Road',     color: '#475569', w: 8, d: 2 },
};

export const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

export function overlaps(a, b) {
  return a.floor === b.floor && a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
}

export function fits(r) {
  return r.x >= 0 && r.z >= 0 && r.w >= 1 && r.d >= 1 && r.x + r.w <= GRID_W && r.z + r.d <= GRID_D;
}

// Automatic arrangement used until a property gets a custom layout: floors by
// the unit's floor (or chunks of `perFloor`), each floor a compact grid.
export function autoItems(units, perFloor) {
  const anyFloor = units.some(u => u.floor != null);
  const sorted = [...units].sort((a, b) => natural(a.unit_number, b.unit_number));
  const floors = {};
  if (anyFloor) sorted.forEach(u => { (floors[u.floor ?? 0] ||= []).push(u); });
  else sorted.forEach((u, i) => { (floors[Math.floor(i / perFloor)] ||= []).push(u); });
  const maxCount = Math.max(1, ...Object.values(floors).map(l => l.length));
  const rows = Math.max(1, Math.round(Math.sqrt(maxCount / 2)));
  const cols = Math.ceil(maxCount / rows);
  const items = [];
  Object.keys(floors).map(Number).forEach(f => floors[f].forEach((u, i) => {
    items.push({ kind: 'unit', unit: u, floor: f, x: i % cols, z: Math.floor(i / cols), w: 1, d: 1 });
  }));
  return { items, anyFloor };
}

// Everything the 3D scene needs: positioned units + extras.
export function computePlacement(units, extras, perFloor) {
  const custom = units.some(u => u.layout_x != null);
  if (!custom) {
    const { items, anyFloor } = autoItems(units, perFloor);
    return { items, extras: extras || [], custom: false, unplaced: 0, anyFloor };
  }
  const items = [];
  const loose = [];
  units.forEach(u => {
    if (u.layout_x != null) items.push({ kind: 'unit', unit: u, floor: u.floor ?? 0, x: u.layout_x, z: u.layout_z, w: u.layout_w || 1, d: u.layout_d || 1 });
    else loose.push(u);
  });
  // Units not yet placed wait in a row in front of the building.
  const maxZ = Math.max(0, ...items.map(i => i.z + i.d), ...(extras || []).map(e => e.z + e.d));
  loose.sort((a, b) => natural(a.unit_number, b.unit_number)).forEach((u, i) => {
    items.push({ kind: 'unit', unit: u, floor: 0, x: i % 12, z: maxZ + 1 + Math.floor(i / 12), w: 1, d: 1, staging: true });
  });
  return { items, extras: extras || [], custom: true, unplaced: loose.length, anyFloor: true };
}

// Starting draft for the editor: saved positions, or the current auto layout.
export function draftFrom(units, extras, perFloor) {
  const custom = units.some(u => u.layout_x != null);
  const draftUnits = {};
  if (custom) {
    units.forEach(u => {
      draftUnits[u.id] = u.layout_x != null
        ? { placed: true, floor: u.floor ?? 0, x: u.layout_x, z: u.layout_z, w: u.layout_w || 1, d: u.layout_d || 1 }
        : { placed: false, floor: u.floor ?? 0, x: 0, z: 0, w: 1, d: 1 };
    });
  } else {
    const { items } = autoItems(units, perFloor);
    units.forEach(u => { draftUnits[u.id] = { placed: false, floor: 0, x: 0, z: 0, w: 1, d: 1 }; });
    items.forEach(i => { draftUnits[i.unit.id] = { placed: true, floor: i.floor, x: i.x, z: i.z, w: 1, d: 1 }; });
  }
  return { units: draftUnits, extras: (extras || []).map(e => ({ ...e })) };
}

// Units with the draft applied (used for the live 3D preview while editing).
export function applyDraft(units, draft) {
  return units.map(u => {
    const d = draft.units[u.id];
    if (!d) return u;
    return { ...u, floor: d.floor, layout_x: d.placed ? d.x : null, layout_z: d.placed ? d.z : null, layout_w: d.w, layout_d: d.d };
  });
}
