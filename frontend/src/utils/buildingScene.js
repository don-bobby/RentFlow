// Builds the three.js model of one property from a computePlacement() layout.
// Shared by the single-property 3D view and the admin estate map, so both
// always look the same. The returned group is centred on the property's
// footprint (its local origin is the middle of the building).
import * as THREE from 'three';
import { EXTRA_KINDS, isLine } from './buildingLayout';

export const STATES = {
  paid:     { label: 'Paid up',          color: '#22c55e' },
  partial:  { label: 'Partly paid',      color: '#f59e0b' },
  pending:  { label: 'Not yet due',      color: '#60a5fa' },
  unpaid:   { label: 'Unpaid (late)',    color: '#f97316' },
  overdue:  { label: 'Overdue 2+ months', color: '#dc2626' },
  vacant:   { label: 'Vacant',           color: '#9ca3af' },
  occupied: { label: 'Occupied',         color: '#6366f1' },
  other:    { label: 'Other',            color: '#a78bfa' },
};

export const CELL = 1.8, H = 1.0, FLOOR_H = 1.3;

export function buildBuilding(layout, { details = true, ground: withGround = true } = {}) {
    const GAP = 0.16;
    const all = [...layout.items, ...layout.extras];
    const minX = Math.min(...all.map(i => i.x)), maxX = Math.max(...all.map(i => i.x + i.w));
    const minZ = Math.min(...all.map(i => i.z)), maxZ = Math.max(...all.map(i => i.z + i.d));
    const cx = ((minX + maxX) / 2) * CELL, cz = ((minZ + maxZ) / 2) * CELL;
    const wx = (x, w) => (x + w / 2) * CELL - cx;       // world centre of a piece
    const wz = (z, d) => (z + d / 2) * CELL - cz;
    const maxFloor = Math.max(0, ...all.map(i => i.floor));
    const totalW = (maxX - minX) * CELL, totalD = (maxZ - minZ) * CELL;
    const group = new THREE.Group();
    const slate = (op) => new THREE.MeshStandardMaterial({ color: 0x64748b, transparent: true, opacity: op });

    if (withGround) {
      // Ground
      const ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(totalW, totalD) * 0.75 + 3, 56),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.18 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.09; group.add(ground);
    }

    // Extras: corridors, stairs, gardens, roads
    layout.extras.forEach(e => {
      if (isLine(e.kind)) return;                       // fences and gates are drawn below
      const y = e.floor * FLOOR_H, w = e.w * CELL, d = e.d * CELL, px = wx(e.x, e.w), pz = wz(e.z, e.d);
      const kind = EXTRA_KINDS[e.kind] || EXTRA_KINDS.corridor;
      const add = (geo, color, x, yy, z, op = 1) => {
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: op < 1, opacity: op, roughness: 0.8 }));
        m.position.set(x, yy, z); group.add(m); return m;
      };
      if (e.kind === 'stairs') {
        const along = e.d >= e.w ? 'z' : 'x', len = along === 'z' ? d : w, steps = 6;
        for (let i = 0; i < steps; i++) {
          const h = ((i + 1) / steps) * FLOOR_H, sl = len / steps;
          const geo = along === 'z' ? new THREE.BoxGeometry(w - 0.2, h, sl) : new THREE.BoxGeometry(sl, h, d - 0.2);
          const off = -len / 2 + sl * (i + 0.5);
          add(geo, kind.color, along === 'x' ? px + off : px, y + h / 2, along === 'z' ? pz + off : pz);
        }
      } else if (e.kind === 'garden') {
        add(new THREE.BoxGeometry(w - 0.1, 0.1, d - 0.1), kind.color, px, y + 0.02, pz, 0.85);
        const trees = Math.min(6, Math.max(1, Math.round(e.w * e.d / 3)));
        for (let i = 0; i < trees; i++) {
          const tx = px + (((i * 37 + e.x * 13) % 10) / 10 - 0.5) * (w - 0.9);
          const tz = pz + (((i * 53 + e.z * 17) % 10) / 10 - 0.5) * (d - 0.9);
          add(new THREE.CylinderGeometry(0.07, 0.09, 0.45, 8), 0x92400e, tx, y + 0.3, tz);
          add(new THREE.ConeGeometry(0.4, 0.9, 10), 0x15803d, tx, y + 0.95, tz);
        }
      } else if (e.kind === 'road') {
        add(new THREE.BoxGeometry(w, 0.06, d), kind.color, px, y - 0.02, pz);
        const horiz = e.w >= e.d, n = Math.max(2, Math.round((horiz ? e.w : e.d) / 1.2));
        for (let i = 0; i < n; i++) {
          const t = ((i + 0.5) / n - 0.5) * (horiz ? w : d);
          add(new THREE.BoxGeometry(horiz ? 0.45 : 0.08, 0.02, horiz ? 0.08 : 0.45), 0xf8fafc, horiz ? px + t : px, y + 0.03, horiz ? pz : pz + t);
        }
      } else { // corridor
        add(new THREE.BoxGeometry(w, 0.1, d), kind.color, px, y - 0.03, pz, 0.9);
      }
    });

    // Fences and gates: single squares joined into continuous lines
    const lineCells = layout.extras.filter(e => isLine(e.kind));
    if (lineCells.length) {
      const cellMap = new Map(lineCells.map(e => [`${e.x},${e.z}`, e]));
      const nb = (e, dx, dz) => cellMap.get(`${e.x + dx},${e.z + dz}`);
      const box = (w, h, d, color, x, y, z) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
        m.position.set(x, y, z); group.add(m);
      };
      const FENCE = 0x92400e, RAIL = 0xb45309;
      lineCells.forEach(e => {
        const px = wx(e.x, 1), pz = wz(e.z, 1);
        if (e.kind === 'fence') {
          box(0.1, 0.75, 0.1, FENCE, px, 0.38, pz);
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz]) => {
            const o = nb(e, dx, dz); if (!o) return;
            const horiz = dx !== 0;
            if (o.kind === 'fence') {
              if (dx < 0 || dz < 0) return;               // draw each fence-to-fence rail once
              [0.28, 0.58].forEach(hy => box(horiz ? CELL : 0.05, 0.07, horiz ? 0.05 : CELL, RAIL, px + dx * CELL / 2, hy, pz + dz * CELL / 2));
            } else {                                      // stops at the gate post
              const len = CELL / 2 + 0.1;
              [0.28, 0.58].forEach(hy => box(horiz ? len : 0.05, 0.07, horiz ? 0.05 : len, RAIL, px + dx * len / 2, hy, pz + dz * len / 2));
            }
          });
        } else {
          const hasX = nb(e, 1, 0) || nb(e, -1, 0), hasZ = nb(e, 0, 1) || nb(e, 0, -1);
          const horiz = hasX || !hasZ, len = CELL;
          [-1, 1].forEach(sg => box(horiz ? 0.22 : 0.3, 1.05, horiz ? 0.3 : 0.22, 0x475569, horiz ? px + sg * (len / 2 - 0.11) : px, 0.52, horiz ? pz : pz + sg * (len / 2 - 0.11)));
          const bars = Math.max(4, Math.round(len / 0.22));
          for (let i = 0; i < bars; i++) {
            const t = (i / (bars - 1) - 0.5) * (len - 0.5);
            box(0.04, 0.8, 0.04, EXTRA_KINDS.gate.color ? parseInt(EXTRA_KINDS.gate.color.slice(1), 16) : 0x0f766e, horiz ? px + t : px, 0.45, horiz ? pz : pz + t);
          }
          [0.12, 0.78].forEach(hy => box(horiz ? len - 0.45 : 0.05, 0.06, horiz ? 0.05 : len - 0.45, parseInt(EXTRA_KINDS.gate.color.slice(1), 16), px, hy, pz));
        }
      });
    }

    // Units
    const meshes = [];
    layout.items.forEach(it => {
      const u = it.unit, y = it.floor * FLOOR_H;
      const w = it.w * CELL - GAP, d = it.d * CELL - GAP;
      const x = wx(it.x, it.w), z = wz(it.z, it.d);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(it.w * CELL, 0.08, it.d * CELL), slate(0.55));
      plate.position.set(x, y - 0.04, z); group.add(plate);
      const base = u.state === 'vacant' ? 0.45 : 0.95;
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(STATES[u.state]?.color || '#999'), transparent: true, opacity: base, roughness: 0.55, metalness: 0.05 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), mat);
      mesh.position.set(x, y + H / 2, z);
      mesh.userData = { unit: u, baseOpacity: base, dims: [w, H, d] };
      group.add(mesh); meshes.push(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.35 }));
      edges.position.copy(mesh.position); group.add(edges);
      mesh.userData.detail = [];
      if (details) {
        const mk = (color, op, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: op, roughness: 0.3, ...extra }); m.userData.base = op; mesh.userData.detail.push(m); return m; };
        const glass = mk(0x1e3a5f, base < 0.9 ? 0.5 : 0.9, { metalness: 0.4 }), doorM = mk(0x78350f, base < 0.9 ? 0.5 : 1, { roughness: 0.7 }), handle = mk(0xfbbf24, base < 0.9 ? 0.5 : 1, { metalness: 0.7 });
        const roofM = mk(0x94a3b8, base < 0.9 ? 0.5 : 1, { roughness: 0.8 });
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.07, d + 0.1), roofM);
        roof.position.set(0, H / 2 + 0.035, 0); mesh.add(roof);
        // face: 0=+z, 1=-z, 2=+x, 3=-x; the door is on the side the unit faces
        const doorFace = [1, 2, 0, 3][it.facing ?? 2];
        [0, 1, 2, 3].forEach(face => {
          const fw = face < 2 ? w : d;
          const g = new THREE.Group();
          g.position.set(face === 2 ? w / 2 + 0.006 : face === 3 ? -w / 2 - 0.006 : 0, 0, face === 0 ? d / 2 + 0.006 : face === 1 ? -d / 2 - 0.006 : 0);
          g.rotation.y = face === 1 ? Math.PI : face === 2 ? Math.PI / 2 : face === 3 ? -Math.PI / 2 : 0;
          const n = Math.max(1, Math.round(fw / 0.85));
          for (let i = 0; i < n; i++) {
            const cx = (i + 0.5) / n * fw - fw / 2;
            if (face === doorFace && Math.abs(cx) < 0.3 && n > 1) continue;       // leave room for the door
            if (face === doorFace && n === 1) continue;
            const win = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(0.42, fw / n - 0.2), 0.4), glass);
            win.position.set(cx, 0.1, 0); g.add(win);
          }
          if (face === doorFace) {
            const door = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.66), doorM); door.position.set(0, -H / 2 + 0.33, 0.002); g.add(door);
            const knob = new THREE.Mesh(new THREE.CircleGeometry(0.03, 10), handle); knob.position.set(0.12, -H / 2 + 0.32, 0.004); g.add(knob);
          }
          mesh.add(g);
        });
      }
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
      const c2 = cv.getContext('2d');
      c2.fillStyle = 'rgba(15,23,42,0.78)'; c2.fillRect(0, 0, 128, 64);
      c2.fillStyle = '#fff'; c2.font = 'bold 34px sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillText(String(u.unit_number).slice(0, 7), 64, 34);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: true }));
      sprite.scale.set(0.9, 0.45, 1); sprite.position.set(x, y + H + 0.28, z); sprite.renderOrder = 5;
      group.add(sprite); mesh.userData.sprite = sprite;
    });


    return { group, meshes, totalW, totalD, maxFloor, height: (maxFloor + 1) * FLOOR_H };
}
