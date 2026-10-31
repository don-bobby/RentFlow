// "Ask your data": type a question or tap a ready-made one. Answers only show what you are allowed to see.
import { useEffect, useState } from 'react';
import API from '../services/api';

const cell = (v) => (typeof v === 'number' ? v.toLocaleString('en-KE') : v);

export default function Ask() {
  const [status, setStatus] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);   // newest first
  const [err, setErr] = useState('');

  useEffect(() => { API.get('/ask/status').then(r => setStatus(r.data)).catch(() => setErr('Could not load.')); }, []);

  const add = (item) => setItems(x => [item, ...x]);
  const runMenu = async (m) => {
    setBusy(true); setErr('');
    try { const r = await API.post('/ask/run', { id: m.id }); add({ question: m.label, tables: [r.data.table] }); }
    catch (e) { setErr(e.response?.data?.error || 'Could not run that.'); }
    setBusy(false);
  };
  const ask = async (e) => {
    e.preventDefault(); const text = q.trim(); if (text.length < 3) return;
    setBusy(true); setErr('');
    try {
      const r = await API.post('/ask', { question: text });
      if (r.data.migration_needed) setErr('Typed questions need migration 033 (033_ask.sql) to be run first.');
      else { add({ question: text, answer: r.data.answer, tables: r.data.tables }); setQ(''); setStatus(s => ({ ...s, used: (s?.limit || 0) - r.data.remaining })); }
    } catch (e2) { setErr(e2.response?.data?.error || 'Could not get an answer.'); }
    setBusy(false);
  };

  const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 14, padding: 16, marginBottom: 14 };
  const inp = { padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border, #d1d5db)', background: 'var(--bg, #fff)', color: 'inherit', fontSize: 15, boxSizing: 'border-box', flex: 1, minWidth: 0 };
  const btn = { padding: '8px 14px', borderRadius: 999, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const primary = { ...btn, borderRadius: 10, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none', padding: '10px 18px' };
  const muted = { color: 'var(--muted, #6b7280)', fontSize: 13 };
  const th = { textAlign: 'left', padding: '7px 10px', fontSize: 12, color: 'var(--muted, #6b7280)', borderBottom: '1px solid var(--border, #e5e7eb)', whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', borderBottom: '1px solid var(--border, #f1f5f9)', fontSize: 14 };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 4 }}>
      <h2 style={{ margin: '0 0 4px' }}>💬 Ask your data</h2>
      <p style={{ ...muted, marginTop: 0 }}>Ask about rent, vacant units, maintenance or expenses. You only see what your account is allowed to see, and nothing is changed from here.</p>
      {err && <div style={{ ...card, color: '#b91c1c' }}>{err}</div>}

      <div style={card}>
        {status?.ai ? (
          <form onSubmit={ask} style={{ display: 'flex', gap: 8 }}>
            <input style={inp} placeholder="For example: who owes more than a month's rent in Wachege?" maxLength={500} value={q} onChange={e => setQ(e.target.value)} />
            <button style={{ ...primary, opacity: busy ? .6 : 1 }} disabled={busy}>Ask</button>
          </form>
        ) : status && <div style={muted}>Typed questions are not switched on for this system. Use the ready-made questions below.</div>}
        {status?.ai && <div style={{ ...muted, marginTop: 6 }}>{Math.max(0, status.limit - status.used)} of {status.limit} typed questions left today. Names and amounts are sent to an AI service to write the answer.</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {(status?.menu || []).map(m => <button key={m.id} style={btn} disabled={busy} onClick={() => runMenu(m)}>{m.label}</button>)}
        </div>
      </div>

      {busy && <div style={muted}>Working on it…</div>}
      {items.map((it, i) => (
        <div key={i} style={card}>
          <div style={{ fontWeight: 700 }}>{it.question}</div>
          {it.answer && <p style={{ margin: '8px 0', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{it.answer}</p>}
          {it.tables.map((t, k) => (
            <div key={k} style={{ marginTop: 10, overflowX: 'auto' }}>
              {it.tables.length > 1 && <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.title}</div>}
              {t.rows.length ? (
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead><tr>{t.columns.map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
                  <tbody>{t.rows.map((r, ri) => <tr key={ri}>{r.map((v, ci) => <td key={ci} style={td}>{cell(v)}</td>)}</tr>)}</tbody>
                </table>) : <div style={muted}>Nothing to show.</div>}
              {t.note && <div style={{ ...muted, marginTop: 6 }}>{t.note}</div>}
            </div>))}
        </div>))}
    </div>
  );
}
