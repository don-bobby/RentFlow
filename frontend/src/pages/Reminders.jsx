// WhatsApp rent reminders. Shows who owes (or is about to), with the message
// ready in English or Kiswahili. Each tap opens WhatsApp with the message typed
// out; the reminder is then logged so nobody gets nagged twice in a day.
import { useCallback, useEffect, useMemo, useState } from 'react';
import API from '../services/api';
import { IconInline } from '../components/Icon';

const LEVELS = { overdue: ['Overdue', '#dc2626'], due: ['Due now', '#d97706'], upcoming: ['Due soon', '#2563eb'] };
const TEMPLATES = {
  en: {
    upcoming: 'Hello {name}, a friendly reminder that rent of KES {amount} for {property}, unit {unit} is due on the {due} of this month. {payline} Thank you.',
    due: 'Hello {name}, your rent of KES {amount} ({months}) for {property}, unit {unit} is now due. {payline} Thank you.',
    overdue: 'Hello {name}, you have rent arrears of KES {amount} ({months}) for {property}, unit {unit}. Please pay as soon as you can or contact us to agree on a plan. {payline} Thank you.',
    payline: 'Pay via M-Pesa Paybill {paybill}, account {account}.',
  },
  sw: {
    upcoming: 'Habari {name}, tunakukumbusha kuwa kodi ya KES {amount} ya {property}, nyumba {unit} inatakiwa tarehe {due} ya mwezi huu. {payline} Asante.',
    due: 'Habari {name}, kodi yako ya KES {amount} ({months}) ya {property}, nyumba {unit} sasa inatakiwa. {payline} Asante.',
    overdue: 'Habari {name}, una malimbikizo ya kodi ya KES {amount} ({months}) — {property}, nyumba {unit}. Tafadhali lipa mapema iwezekanavyo au wasiliana nasi. {payline} Asante.',
    payline: 'Lipa kupitia M-Pesa Paybill {paybill}, akaunti {account}.',
  },
};
function waNumber(phone) {
  const d = String(phone || '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.startsWith('254')) return d;
  if (d.startsWith('0')) return `254${d.slice(1)}`;
  return d.length <= 9 ? `254${d}` : d;
}
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')).replace(/\s{2,}/g, ' ').replace(/ \./g, '.').trim();
const sameDay = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } } };

export default function Reminders() {
  const [rows, setRows] = useState([]);
  const [paybill, setPaybill] = useState(null);
  const [plots, setPlots] = useState([]);
  const [plotId, setPlotId] = useState('');
  const [level, setLevel] = useState('');
  const [lang, setLang] = useState(() => store.get('rf_rem_lang', 'en'));
  const [custom, setCustom] = useState(() => store.get('rf_rem_tpl', {}));
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [queue, setQueue] = useState(null);   // { list, i }

  const load = useCallback(async () => {
    try {
      const r = await API.get('/reminders', { params: { plot_id: plotId || undefined } });
      setRows(r.data.data); setPaybill(r.data.paybill); setErr('');
    } catch (e) { setErr(e.response?.data?.error || 'Could not load reminders. Has migration 026 been run?'); }
    setLoading(false);
  }, [plotId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    API.get('/plots').then(r => setPlots(Array.isArray(r.data) ? r.data : (r.data.data || []))).catch(() => {});
  }, []);
  useEffect(() => store.set('rf_rem_lang', lang), [lang]);

  const tpl = (lv) => custom[`${lang}.${lv}`] ?? TEMPLATES[lang][lv];
  const message = (t) => {
    const hasPay = paybill && t.account_no;
    const months = t.months.length > 3 ? `${t.months.slice(0, 2).join(', ')} ${lang === 'sw' ? 'na mingine' : 'and'} ${t.months.length - 2}${lang === 'sw' ? '' : ' more'}` : t.months.join(', ');
    return fill(tpl(t.level), {
      name: t.full_name.split(' ')[0], amount: Number(t.owed).toLocaleString(), months, property: t.plot_name, unit: t.unit_number,
      due: ordinal(t.due_day), payline: hasPay ? fill(TEMPLATES[lang].payline, { paybill, account: t.account_no }) : '',
    });
  };
  const link = (t) => { const n = waNumber(t.phone); return n ? `https://wa.me/${n}?text=${encodeURIComponent(message(t))}` : null; };
  const markSent = async (t) => {
    try { await API.post(`/reminders/${t.tenant_id}/sent`, { level: t.level, owed: t.owed }); setRows(rs => rs.map(x => x.tenant_id === t.tenant_id ? { ...x, last_reminded_at: new Date().toISOString() } : x)); }
    catch (e) { setErr(e.response?.data?.error || 'Sent, but could not log it.'); }
  };
  const send = (t) => { const l = link(t); if (!l) return; window.open(l, '_blank', 'noopener'); markSent(t); };

  const shown = useMemo(() => rows.filter(r => !level || r.level === level), [rows, level]);
  const counts = useMemo(() => rows.reduce((a, r) => ({ ...a, [r.level]: (a[r.level] || 0) + 1 }), {}), [rows]);
  const todo = shown.filter(r => !sameDay(r.last_reminded_at) && waNumber(r.phone));

  const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: 14 };
  const inp = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--bg, #fff)', color: 'inherit', fontSize: 14 };
  const btn = { padding: '7px 13px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const primary = { ...btn, background: '#1b6b45', color: '#fff', border: 'none' };
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--muted, #6b7280)', borderBottom: '1px solid var(--border, #e5e7eb)' };
  const td = { padding: '8px 10px', borderBottom: '1px solid var(--border, #f1f5f9)', fontSize: 14, verticalAlign: 'top' };

  const cur = queue ? queue.list[queue.i] : null;
  return (
    <div style={{ padding: 4 }}>
      <h1 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 32, fontWeight: 700, letterSpacing: '-0.4px', margin: 0, color: 'var(--text)' }}><IconInline name="🔔" size={14} />Rent Reminders</h1>
      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select style={inp} value={plotId} onChange={e => setPlotId(e.target.value)}><option value="">All properties</option>{plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        {[['', `All (${rows.length})`], ['overdue', `Overdue (${counts.overdue || 0})`], ['due', `Due now (${counts.due || 0})`], ['upcoming', `Due soon (${counts.upcoming || 0})`]].map(([v, l]) =>
          <button key={v} style={level === v ? { ...btn, background: 'var(--primary, #1b6b45)', color: '#fff', border: 'none' } : btn} onClick={() => setLevel(v)}>{l}</button>)}
        <div style={{ flex: 1 }} />
        <select style={inp} value={lang} onChange={e => setLang(e.target.value)}><option value="en">English</option><option value="sw">Kiswahili</option></select>
        <button style={btn} onClick={() => setEditing(!editing)}><IconInline name="✏️" size={14} />Edit wording</button>
        <button style={primary} disabled={!todo.length} onClick={() => setQueue({ list: todo, i: 0 })}>▶ Send one by one ({todo.length})</button>
      </div>
      {err && <div style={{ ...card, color: '#b91c1c', marginBottom: 10 }}>{err}</div>}
      {editing && (
        <div style={{ ...card, marginBottom: 12, display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted, #6b7280)' }}>Placeholders: {'{name} {amount} {months} {property} {unit} {due} {payline}'}. The payline (Paybill and account number) is added only when both are known. Saved on this device.</div>
          {['upcoming', 'due', 'overdue'].map(lv => (
            <label key={lv} style={{ fontSize: 13 }}><b>{LEVELS[lv][0]}</b>
              <textarea style={{ ...inp, width: '100%', minHeight: 56, boxSizing: 'border-box', marginTop: 3 }} value={tpl(lv)} onChange={e => { const c = { ...custom, [`${lang}.${lv}`]: e.target.value }; setCustom(c); store.set('rf_rem_tpl', c); }} />
            </label>
          ))}
          <div><button style={btn} onClick={() => { setCustom({}); store.set('rf_rem_tpl', {}); }}>Reset to standard wording</button></div>
        </div>
      )}
      {!paybill && <div style={{ fontSize: 12.5, color: 'var(--muted, #6b7280)', marginBottom: 8 }}>Tip: once your Paybill is set up, reminders will include how to pay with the tenant's own account number.</div>}
      {loading ? <div>Loading…</div> : (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Tenant</th><th style={th}>Unit</th><th style={th}>Owes</th><th style={th}>Status</th><th style={th}>Last reminded</th><th style={th} /></tr></thead>
            <tbody>
              {shown.map(t => (
                <tr key={t.tenant_id}>
                  <td style={td}><b>{t.full_name}</b><div style={{ fontSize: 12, color: 'var(--muted, #6b7280)' }}>{t.phone}</div></td>
                  <td style={td}>{t.plot_name} · {t.unit_number}</td>
                  <td style={td}>KES {Number(t.owed).toLocaleString()}<div style={{ fontSize: 12, color: 'var(--muted, #6b7280)' }}>{t.months_behind} month{t.months_behind > 1 ? 's' : ''}</div></td>
                  <td style={{ ...td, color: LEVELS[t.level][1], fontWeight: 700 }}>{LEVELS[t.level][0]}</td>
                  <td style={td}>{t.last_reminded_at ? (sameDay(t.last_reminded_at) ? 'Today ✓' : new Date(t.last_reminded_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })) : '—'}</td>
                  <td style={td}>{link(t) ? <button style={primary} onClick={() => send(t)}><IconInline name="💬" size={14} />WhatsApp</button> : <span style={{ fontSize: 12, color: '#b91c1c' }}>No valid phone</span>}</td>
                </tr>
              ))}
              {!shown.length && <tr><td style={td} colSpan={6}> Nobody needs a reminder right now.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {cur && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 12 }}>
          <div style={{ ...card, width: 'min(480px, 100%)' }}>
            <div style={{ fontSize: 12, color: 'var(--muted, #6b7280)' }}>{queue.i + 1} of {queue.list.length}</div>
            <h3 style={{ margin: '4px 0' }}>{cur.full_name} <span style={{ fontSize: 13, color: LEVELS[cur.level][1] }}>· {LEVELS[cur.level][0]}</span></h3>
            <div style={{ fontSize: 13, color: 'var(--muted, #6b7280)', marginBottom: 8 }}>{cur.plot_name} · {cur.unit_number} · {cur.phone}</div>
            <div style={{ background: 'var(--bg, #f1f5f9)', borderRadius: 10, padding: 12, fontSize: 14, whiteSpace: 'pre-wrap' }}>{message(cur)}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 14 }}>
              <button style={btn} onClick={() => setQueue(null)}>Stop</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btn} onClick={() => setQueue(q => q.i + 1 < q.list.length ? { ...q, i: q.i + 1 } : null)}>Skip</button>
                <button style={primary} onClick={() => { send(cur); setQueue(q => q.i + 1 < q.list.length ? { ...q, i: q.i + 1 } : null); }}><IconInline name="💬" size={14} />Open WhatsApp & next</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
