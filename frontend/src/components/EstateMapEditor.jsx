import React, { useMemo, useRef, useState } from 'react';
import { MAP_W, MAP_D, PIECE_KINDS, rotatedSize, rectsOverlap, rectFits, resolvePositions } from '../utils/estateLayout';

const CELL = 14;

// Top-down editor for the estate map. The parent owns `draft` and shows the
// live 3D preview from it.
//   draft = { plots: { [plotId]: { x, z, rot } }, pieces: [{ kind, x, z }] }
export default function EstateMapEditor({ plots, fps, draft, setDraft, onSave, onCancel, saving, error }) {
  const [sel, setSel] = useState(null);       // plot id
  const [tool, setTool] = useState(null);     // 'road' | 'tree' | 'pond' | 'erase' | null
  const [drag, setDrag] = useState(null);     // { id, dx, dz, x, z, moved }
  const [msg, setMsg] = useState('');
  const gridRef = useRef(null);
  const lastCell = useRef(null);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };
  const rectOf = (id, pos = draft.plots[id]) => {
    const s = rotatedSize(fps[id], pos.rot || 0);
    return { x: pos.x, z: pos.z, w: s.w, d: s.d };
  };
  const rects = useMemo(() => plots.map(p => ({ id: p.plot.id, name: p.plot.name, ...rectOf(p.plot.id) })), [plots, draft, fps]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlapping = useMemo(() => {
    const bad = new Set();
    rects.forEach((a, i) => rects.slice(i + 1).forEach(b => { if (rectsOverlap(a, b)) { bad.add(a.id); bad.add(b.id); } }));
    return bad;
  }, [rects]);
  const canPlace = (id, r) => rectFits(r) && !rects.some(o => o.id !== id && rectsOverlap(r, o));
  const cellOf = (e) => {
    const b = gridRef.current.getBoundingClientRect();
    return { x: Math.floor((e.clientX - b.left) / CELL), z: Math.floor((e.clientY - b.top) / CELL) };
  };
  const insidePlot = (c) => rects.some(r => c.x >= r.x && c.x < r.x + r.w && c.z >= r.z && c.z < r.z + r.d);

  const paintCell = (c) => {
    if (c.x < 0 || c.z < 0 || c.x >= MAP_W || c.z >= MAP_D) return;
    setDraft(d => {
      const rest = d.pieces.filter(p => !(p.x === c.x && p.z === c.z));
      if (tool === 'erase') return rest.length === d.pieces.length ? d : { ...d, pieces: rest };
      if (insidePlot(c)) return d;                   // nothing is built under a property
      return { ...d, pieces: [...rest, { kind: tool, x: c.x, z: c.z }] };
    });
  };
  const paintTo = (c) => {
    const from = lastCell.current || c;
    const n = Math.max(Math.abs(c.x - from.x), Math.abs(c.z - from.z), 1);
    for (let i = 1; i <= n; i++) paintCell({ x: Math.round(from.x + ((c.x - from.x) * i) / n), z: Math.round(from.z + ((c.z - from.z) * i) / n) });
    lastCell.current = c;
  };
  const onGridDown = (e) => {
    if (!tool) return;
    e.preventDefault(); lastCell.current = null; paintTo(cellOf(e));
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onGridMove = (e) => {
    if (tool && lastCell.current) paintTo(cellOf(e));
    if (drag) { const c = cellOf(e); setDrag(d => ({ ...d, x: c.x - d.dx, z: c.z - d.dz, moved: true })); }
  };
  const endPointer = () => {
    lastCell.current = null;
    if (!drag) return;
    if (drag.moved) {
      const r = { ...rectOf(drag.id), x: drag.x, z: drag.z };
      if (canPlace(drag.id, r)) setDraft(d => ({ ...d, plots: { ...d.plots, [drag.id]: { ...d.plots[drag.id], x: r.x, z: r.z } } }));
      else flash('Cannot drop there — it overlaps another property or leaves the map.');
    }
    setDrag(null);
  };
  const startDrag = (e, r) => {
    if (tool) return;
    e.stopPropagation(); e.preventDefault();
    setSel(r.id);
    const c = cellOf(e);
    setDrag({ id: r.id, dx: c.x - r.x, dz: c.z - r.z, x: r.x, z: r.z, moved: false });
    gridRef.current.setPointerCapture?.(e.pointerId);
  };
  const rotate = (id) => {
    const pos = draft.plots[id], rot = ((pos.rot || 0) + 1) % 4;
    const s = rotatedSize(fps[id], rot);
    const r = { x: pos.x, z: pos.z, w: s.w, d: s.d };
    if (!canPlace(id, r)) { flash('No room to turn it here — move it first.'); return; }
    setDraft(d => ({ ...d, plots: { ...d.plots, [id]: { ...pos, rot } } }));
  };

  const label = { fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '12px 0 6px' };
  const sbtn = { padding: '6px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' };
  const selPlot = sel != null ? plots.find(p => p.plot.id === sel) : null;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)', padding: 16, marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>Edit estate map</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Drag properties to where they sit, turn them, and draw roads, trees and ponds. The 3D map above updates as you go.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={sbtn} onClick={() => { setDraft(d => ({ pieces: d.pieces, plots: resolvePositions(plots.map(p => ({ ...p, map: {} })), fps) })); setSel(null); }} disabled={saving}>Auto-arrange</button>
          <button style={sbtn} onClick={onCancel} disabled={saving}>Cancel</button>
          <button style={{ ...sbtn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' }} onClick={onSave} disabled={saving || overlapping.size > 0}>{saving ? 'Saving…' : 'Save map'}</button>
        </div>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13, margin: '6px 0' }}>{error}</div>}
      {msg && <div style={{ color: '#b45309', fontSize: 13, margin: '6px 0' }}>{msg}</div>}
      {overlapping.size > 0 && <div style={{ color: '#dc2626', fontSize: 13, margin: '6px 0' }}>Some properties overlap (shown in red). Move them apart to save.</div>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 520px', minWidth: 0 }}>
          <div style={{ overflow: 'auto', maxHeight: 520, border: '1px solid var(--border)', borderRadius: 10 }}>
            <div ref={gridRef} onPointerDown={onGridDown} onPointerMove={onGridMove} onPointerUp={endPointer} onPointerCancel={endPointer}
              onClick={() => { if (!tool && !drag) setSel(null); }}
              style={{ position: 'relative', width: MAP_W * CELL, height: MAP_D * CELL, cursor: tool ? 'crosshair' : 'default', touchAction: tool || drag ? 'none' : 'auto',
                backgroundColor: '#dcfce7',
                backgroundImage: 'linear-gradient(to right, rgba(22,101,52,.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(22,101,52,.12) 1px, transparent 1px)',
                backgroundSize: `${CELL}px ${CELL}px` }}>
              {draft.pieces.map(p => (
                <div key={`${p.x},${p.z}`} style={{ position: 'absolute', left: p.x * CELL, top: p.z * CELL, width: CELL, height: CELL, background: PIECE_KINDS[p.kind].color,
                  borderRadius: p.kind === 'tree' ? '50%' : 2, transform: p.kind === 'tree' ? 'scale(.8)' : 'none', pointerEvents: 'none' }} />
              ))}
              {rects.map(r => {
                const id = r.id, dragging = drag && drag.id === id;
                const x = dragging ? drag.x : r.x, z = dragging ? drag.z : r.z;
                const bad = overlapping.has(id) || (dragging && drag.moved && !canPlace(id, { x, z, w: r.w, d: r.d }));
                return (
                  <div key={id} onPointerDown={(e) => startDrag(e, r)} onClick={(e) => e.stopPropagation()}
                    style={{ position: 'absolute', left: x * CELL, top: z * CELL, width: r.w * CELL, height: r.d * CELL, boxSizing: 'border-box',
                      background: bad ? 'rgba(220,38,38,.35)' : 'rgba(99,102,241,.35)', border: `2px solid ${bad ? '#dc2626' : sel === id ? '#0f172a' : '#6366f1'}`,
                      borderRadius: 4, cursor: tool ? 'crosshair' : 'grab', pointerEvents: tool ? 'none' : 'auto', touchAction: 'none', userSelect: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#1e1b4b', overflow: 'hidden', zIndex: dragging ? 5 : 2 }}>
                    {r.name}{fps[id].empty ? ' (no units)' : ''}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>{MAP_W} × {MAP_D} squares. Each square is the same size as a unit square in a property's own layout.</div>
        </div>

        <div style={{ flex: '1 1 230px', minWidth: 210 }}>
          <div style={{ ...label, marginTop: 0 }}>Draw</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[...Object.entries(PIECE_KINDS).map(([k, v]) => [k, v.label, v.color]), ['erase', 'Erase', null]].map(([k, t, c]) => {
              const on = tool === k;
              return <button key={k} onClick={() => { setTool(on ? null : k); setSel(null); }} style={{ ...sbtn, background: on ? 'var(--text)' : 'var(--surface)', color: on ? 'var(--surface)' : 'var(--text)' }}>
                {c && <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c, marginRight: 6 }} />}{k === 'erase' ? '⌫ ' : ''}{t}
              </button>;
            })}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{tool ? 'Click or drag across squares. Click the button again to go back to moving properties.' : 'Pick a tool to draw roads, trees and ponds between properties.'}</div>

          <div style={label}>Properties</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 170, overflow: 'auto' }}>
            {plots.map(p => (
              <button key={p.plot.id} onClick={() => { setTool(null); setSel(p.plot.id); }}
                style={{ ...sbtn, textAlign: 'left', background: sel === p.plot.id ? 'var(--text)' : 'var(--surface)', color: sel === p.plot.id ? 'var(--surface)' : 'var(--text)', borderColor: overlapping.has(p.plot.id) ? '#dc2626' : 'var(--border)' }}>
                {p.plot.name} <span style={{ opacity: .6, fontWeight: 500 }}>· {p.units.length} units</span>
              </button>
            ))}
          </div>

          {selPlot && (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text)' }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{selPlot.plot.name}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button style={sbtn} onClick={() => rotate(selPlot.plot.id)}>⟳ Turn 90°</button>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                Footprint {rectOf(selPlot.plot.id).w} × {rectOf(selPlot.plot.id).d} squares. Change what is inside it from 3D View → Edit layout.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
