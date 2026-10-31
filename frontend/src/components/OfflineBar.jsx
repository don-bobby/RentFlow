// Shows when the phone has no signal and what is waiting to upload. Hidden when everything is fine.
import { useState, useSyncExternalStore } from 'react';
import { getState, subscribe, syncNow, discard, retry } from '../services/offline';

const when = (iso) => new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function OfflineBar() {
  const s = useSyncExternalStore(subscribe, getState);
  const [open, setOpen] = useState(false);
  if (!s.offline && !s.pending.length && !s.failed.length) return null;

  const bar = { position: 'sticky', top: 0, zIndex: 20, margin: '0 0 12px', borderRadius: 12, padding: '10px 14px', fontSize: 14, border: '1px solid', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' };
  const btn = { padding: '5px 11px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const tone = s.failed.length ? { background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' }
    : s.offline ? { background: '#fffbeb', color: '#92400e', borderColor: '#fde68a' }
    : { background: '#eff6ff', color: '#1e40af', borderColor: '#bfdbfe' };

  return (
    <div style={{ ...bar, ...tone, flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ flex: 1, minWidth: 200 }}>
          {s.offline && <>📴 <b>No signal.</b> You can keep recording payments, maintenance and meter readings. They are saved on this phone and upload when you are back online. Lists show the last saved copy.{' '}</>}
          {!s.offline && s.pending.length > 0 && <>⏳ <b>{s.syncing ? 'Uploading' : 'Waiting to upload'}:</b> </>}
          {s.pending.length > 0 && <b>{s.pending.length} saved change{s.pending.length === 1 ? '' : 's'}</b>}
          {s.failed.length > 0 && <>{s.pending.length > 0 ? ' · ' : ''}⚠️ <b>{s.failed.length} could not be saved</b></>}
        </span>
        {s.pending.length > 0 && !s.offline && <button style={btn} disabled={s.syncing} onClick={syncNow}>Upload now</button>}
        {(s.pending.length > 0 || s.failed.length > 0) && <button style={btn} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Details'}</button>}
      </div>
      {open && (
        <div style={{ borderTop: '1px solid currentColor', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {s.failed.map(o => (
            <div key={o.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 180 }}><b>{o.label}</b> from {when(o.queued_at)}: {o.error}</span>
              <button style={btn} onClick={() => retry(o.id)}>Try again</button>
              <button style={btn} onClick={() => { if (window.confirm('Discard this change? It will not be saved.')) discard(o.id); }}>Discard</button>
            </div>))}
          {s.pending.map(o => <div key={o.id}><b>{o.label}</b> from {when(o.queued_at)}{o.attempts ? ` (tried ${o.attempts}x)` : ''}</div>)}
        </div>)}
    </div>
  );
}
