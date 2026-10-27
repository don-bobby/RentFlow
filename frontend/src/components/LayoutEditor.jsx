import React, { useMemo, useRef, useState } from 'react';
import { GRID_W, GRID_D, EXTRA_KINDS, overlaps, fits, natural } from '../utils/buildingLayout';

const CELL = 28;
const STATE_COLORS = { paid: '#22c55e', partial: '#f59e0b', pending: '#60a5fa', unpaid: '#f97316', overdue: '#dc2626', vacant: '#9ca3af', occupied: '#6366f1', other: '#a78bfa' };

// Top-down editor for one floor at a time. The parent owns `draft` and shows
// the live 3D preview from it.
//   draft = { units: { [id]: { placed, floor, x, z, w, d } }, extras: [{ id, kind, floor, x, z, w, d }] }
export default function LayoutEditor({ units, draft, setDraft, onSave, onCancel, onAuto, saving, error }) {
  const [floor, setFloor] = useState(0);
  const [sel, setSel] = useState(null);       // { type: 'unit'|'extra', id }
  const [arm, setArm] = useState(null);       // piece waiting to be dropped: { type, id } | { type:'new', kind }
  const [drag, setDrag] = useState(null);     // { type, id, dx, dz, x, z }
  const gridRef = useRef(null);
  const [msg, setMsg] = useState('');

  const unitById = useMemo(() => Object.fromEntries(units.map(u => [u.id, u])), [units]);
  const maxFloor = Math.max(0, ...Object.values(draft.units).filter(d => d.placed).map(d => d.floor), ...draft.extras.map(e => e.floor));
  const floors = Array.from({ length: Math.max(maxFloor, floor) + 1 }, (_, i) => i);

  const pieces = useMemo(() => ([
    ...units.filter(u => draft.units[u.id]?.placed).map(u => ({ type: 'unit', id: u.id, ...draft.units[u.id] })),
    ...draft.extras.map(e => ({ type: 'extra', ...e })),
  ]), [units, draft]);
  const unplaced = units.filter(u => !draft.units[u.id]?.placed).sort((a, b) => natural(a.unit_number, b.unit_number));
  const here = pieces.filter(p => p.floor === floor);
  const below = pieces.filter(p => p.floor === floor - 1);
  const key = (t, id) => `${t}:${id}`;
  const selected = sel ? pieces.find(p => key(p.type, p.id) === key(sel.type, sel.id)) : null;

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };
  const setPiece = (p, patch) => {
    setDraft(d => p.type === 'unit'
      ? { ...d, units: { ...d.units, [p.id]: { ...d.units[p.id], ...patch } } }
      : { ...d, extras: d.extras.map(e => (e.id === p.id ? { ...e, ...patch } : e)) });
  };
  const canPlace = (p, r) => {
    const rect = { floor: r.floor, x: r.x, z: r.z, w: r.w, d: r.d };
    if (!fits(rect)) return false;
    return !pieces.some(o => !(o.type === p.type && o.id === p.id) && overlaps(rect, o));
  };

  const cellFromEvent = (e) => {
    const r = gridRef.current.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / CELL), z: Math.floor((e.clientY - r.top) / CELL) };
  };

  // Click on empty grid: drop the armed piece
  const onGridClick = (e) => {
    if (!arm) { setSel(null); return; }
    const c = cellFromEvent(e);
    if (arm.type === 'new') {
      const k = EXTRA_KINDS[arm.kind];
      const piece = { type: 'extra', id: `n${Date.now().toString(36)}`, kind: arm.kind, floor, x: c.x, z: c.z, w: k.w, d: k.d };
      // shrink to fit the right/bottom edge
      piece.x = Math.min(piece.x, GRID_W - piece.w); piece.z = Math.min(piece.z, GRID_D - piece.d);
      if (!canPlace(piece, piece)) { flash('Not enough free space there.'); return; }
      setDraft(d => ({ ...d, extras: [...d.extras, { id: piece.id, kind: piece.kind, floor, x: piece.x, z: piece.z, w: piece.w, d: piece.d }] }));
      setSel({ type: 'extra', id: piece.id }); setArm(null);
    } else {
      const cur = draft.units[arm.id];
      const r = { floor, x: c.x, z: c.z, w: cur.w || 1, d: cur.d || 1 };
      if (!canPlace({ type: 'unit', id: arm.id }, r)) { flash('That spot is taken or off the grid.'); return; }
      setPiece({ type: 'unit', id: arm.id }, { placed: true, floor, x: r.x, z: r.z });
      setSel({ type: 'unit', id: arm.id }); setArm(null);
    }
  };

  // Drag an existing piece
  const startDrag = (e, p) => {
    e.stopPropagation(); e.preventDefault();
    setSel({ type: p.type, id: p.id }); setArm(null);
    const c = cellFromEvent(e);
    setDrag({ type: p.type, id: p.id, dx: c.x - p.x, dz: c.z - p.z, x: p.x, z: p.z, moved: false });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const moveDrag = (e) => {
    if (!drag) return;
    const c = cellFromEvent(e);
    setDrag(d => ({ ...d, x: c.x - d.dx, z: c.z - d.dz, moved: true }));
  };
  const endDrag = () => {
    if (!drag) return;
    const p = pieces.find(o => o.type === drag.type && o.id === drag.id);
    if (p && drag.moved) {
      const r = { floor: p.floor, x: drag.x, z: drag.z, w: p.w, d: p.d };
      if (canPlace(p, r)) setPiece(p, { x: r.x, z: r.z }); else flash('Cannot drop there — spot taken or off the grid.');
    }
    setDrag(null);
  };

  const resize = (p, dw, dd) => {
    const r = { floor: p.floor, x: p.x, z: p.z, w: Math.max(1, Math.min(8, p.w + dw)), d: Math.max(1, Math.min(8, p.d + dd)) };
    if (!canPlace(p, r)) { flash('No room to resize that way.'); return; }
    setPiece(p, { w: r.w, d: r.d });
  };
  const changeFloor = (p, f) => {
    const r = { floor: f, x: p.x, z: p.z, w: p.w, d: p.d };
    if (!canPlace(p, r)) { flash(`Floor ${f} has something at that spot — move it first.`); return; }
    setPiece(p, { floor: f }); setFloor(f);
  };
  const remove = (p) => {
    if (p.type === 'unit') setPiece(p, { placed: false });
    else setDraft(d => ({ ...d, extras: d.extras.filter(e => e.id !== p.id) }));
    setSel(null);
  };

  const label = { fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '12px 0 6px' };
  const sbtn = { padding: '6px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' };
  const step = { ...sbtn, padding: '2px 9px', fontSize: 15 };

  const ghost = (p, i) => (
    <div key={`g${i}`} style={{ position: 'absolute', left: p.x * CELL, top: p.z * CELL, width: p.w * CELL, height: p.d * CELL, background: 'rgba(100,116,139,.12)', border: '1px dashed rgba(100,116,139,.35)', pointerEvents: 'none' }} />
  );

  const render = (p) => {
    const dragging = drag && drag.type === p.type && drag.id === p.id;
    const x = dragging ? drag.x : p.x, z = dragging ? drag.z : p.z;
    const isSel = sel && sel.type === p.type && sel.id === p.id;
    const u = p.type === 'unit' ? unitById[p.id] : null;
    const color = u ? (STATE_COLORS[u.state] || '#9ca3af') : EXTRA_KINDS[p.kind]?.color;
    const bad = dragging && drag.moved && !canPlace(p, { floor: p.floor, x, z, w: p.w, d: p.d });
    return (
      <div key={key(p.type, p.id)}
        onPointerDown={(e) => startDrag(e, p)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
        style={{
          position: 'absolute', left: x * CELL + 1, top: z * CELL + 1, width: p.w * CELL - 2, height: p.d * CELL - 2,
          background: color, opacity: dragging ? 0.8 : (u?.state === 'vacant' ? 0.7 : 1), borderRadius: p.type === 'unit' ? 5 : 3, cursor: 'grab',
          border: bad ? '2px solid #dc2626' : isSel ? '2px solid var(--text)' : '1px solid rgba(0,0,0,.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: p.type === 'unit' ? '#fff' : '#0f172a',
          fontSize: 11, fontWeight: 700, overflow: 'hidden', touchAction: 'none', userSelect: 'none', zIndex: dragging ? 5 : 2,
        }}>
        {u ? u.unit_number : EXTRA_KINDS[p.kind]?.label}
      </div>
    );
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)', padding: 16, marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>Edit layout</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Drag units on the grid, or pick one below and click a square. The 3D model above updates as you go.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={sbtn} onClick={onAuto} disabled={saving}>Auto-arrange</button>
          <button style={sbtn} onClick={onCancel} disabled={saving}>Cancel</button>
          <button style={{ ...sbtn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' }} onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save layout'}</button>
        </div>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13, margin: '6px 0' }}>{error}</div>}
      {msg && <div style={{ color: '#b45309', fontSize: 13, margin: '6px 0' }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 520px', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {floors.map(f => (
              <button key={f} onClick={() => setFloor(f)} style={{ ...sbtn, background: floor === f ? 'var(--text)' : 'var(--surface)', color: floor === f ? 'var(--surface)' : 'var(--text)' }}>{f === 0 ? 'Ground' : `Floor ${f}`}</button>
            ))}
            {floors.length < 60 && <button style={sbtn} onClick={() => setFloor(floors.length)}>＋ Floor</button>}
          </div>
          <div style={{ overflow: 'auto', maxHeight: 460, border: '1px solid var(--border)', borderRadius: 10 }}>
            <div ref={gridRef} onClick={onGridClick}
              style={{ position: 'relative', width: GRID_W * CELL, height: GRID_D * CELL, cursor: arm ? 'crosshair' : 'default',
                backgroundColor: 'var(--surface2)',
                backgroundImage: 'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
                backgroundSize: `${CELL}px ${CELL}px` }}>
              {below.map(ghost)}
              {here.map(render)}
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
            {arm ? 'Click a square to drop it there.' : 'Faint outlines show the floor below, so upper floors line up with it.'}
          </div>
        </div>

        <div style={{ flex: '1 1 240px', minWidth: 220 }}>
          <div style={{ ...label, marginTop: 0 }}>Not placed ({unplaced.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 130, overflow: 'auto' }}>
            {unplaced.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Every unit is on the grid.</span>}
            {unplaced.map(u => {
              const on = arm && arm.type === 'unit' && arm.id === u.id;
              return <button key={u.id} onClick={() => { setArm(on ? null : { type: 'unit', id: u.id }); setSel(null); }}
                style={{ ...sbtn, background: on ? 'var(--text)' : 'var(--surface)', color: on ? 'var(--surface)' : 'var(--text)' }}>{u.unit_number}</button>;
            })}
          </div>

          <div style={label}>Add</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(EXTRA_KINDS).map(([k, v]) => {
              const on = arm && arm.type === 'new' && arm.kind === k;
              return <button key={k} onClick={() => { setArm(on ? null : { type: 'new', kind: k }); setSel(null); }}
                style={{ ...sbtn, background: on ? 'var(--text)' : 'var(--surface)', color: on ? 'var(--surface)' : 'var(--text)' }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: v.color, marginRight: 6 }} />{v.label}
              </button>;
            })}
          </div>

          <div style={label}>Selected</div>
          {!selected && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Click a piece on the grid to resize, move it to another floor, or remove it.</div>}
          {selected && (
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{selected.type === 'unit' ? `Unit ${unitById[selected.id]?.unit_number}` : EXTRA_KINDS[selected.kind]?.label}</div>
              {[['Width', 'w', 1, 0], ['Depth', 'd', 0, 1]].map(([name, k, dw, dd]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--muted)' }}>{name}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <button style={step} onClick={() => resize(selected, -dw, -dd)}>−</button>
                    <b style={{ minWidth: 18, textAlign: 'center' }}>{selected[k]}</b>
                    <button style={step} onClick={() => resize(selected, dw, dd)}>+</button>
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ color: 'var(--muted)' }}>Floor</span>
                <select value={selected.floor} onChange={e => changeFloor(selected, parseInt(e.target.value))} style={{ ...sbtn, padding: '4px 8px' }}>
                  {Array.from({ length: Math.max(maxFloor, selected.floor) + 2 }, (_, i) => i).map(f => <option key={f} value={f}>{f === 0 ? 'Ground' : f}</option>)}
                </select>
              </div>
              <button style={{ ...sbtn, color: '#dc2626' }} onClick={() => remove(selected)}>{selected.type === 'unit' ? 'Take off grid' : 'Delete piece'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
