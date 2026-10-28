// Paybill account numbers: every unit gets its own, so a tenant who pays the
// Paybill with it is matched automatically. Admins also register the URLs with
// Safaricom here (once) and can see the latest notices that came in.
import { useCallback, useEffect, useState } from 'react';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function PaybillAccounts() {
  const { user } = useAuth();
  const admin = ['admin', 'super_admin'].includes(user?.role);
  const [plots, setPlots] = useState([]);
  const [plotId, setPlotId] = useState('');
  const [info, setInfo] = useState({});
  const [rows, setRows] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [edit, setEdit] = useState({});
  const [msg, setMsg] = useState({ ok: '', err: '' });
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    API.get('/plots').then(r => { const l = Array.isArray(r.data) ? r.data : (r.data.data || []); setPlots(l); if (l.length) setPlotId(String(l[0].id)); }).catch(() => {});
    API.get('/pay/info').then(r => setInfo(r.data)).catch(() => {});
  }, []);
  const load = useCallback(async () => {
    if (!plotId) return;
    try { const r = await API.get('/pay/accounts', { params: { plot_id: plotId } }); setRows(r.data.data); setCanEdit(r.data.can_edit); setEdit({}); }
    catch (e) { setMsg({ ok: '', err: e.response?.data?.error || 'Could not load. Has migration 026 been run?' }); }
  }, [plotId]);
  useEffect(() => { load(); }, [load]);
  const loadRecent = useCallback(() => { if (admin) API.get('/pay/c2b/recent').then(r => setRecent(r.data.data)).catch(() => {}); }, [admin]);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  const generate = async () => { setBusy(true); try { const r = await API.post('/pay/accounts/generate', { plot_id: Number(plotId) }); setMsg({ ok: `${r.data.created} account number${r.data.created === 1 ? '' : 's'} created.`, err: '' }); load(); } catch (e) { setMsg({ ok: '', err: e.response?.data?.error || 'Could not generate.' }); } setBusy(false); };
  const saveOne = async (r) => { try { await API.put(`/pay/accounts/${r.house_id}`, { account_no: edit[r.house_id] }); setMsg({ ok: 'Saved.', err: '' }); load(); } catch (e) { setMsg({ ok: '', err: e.response?.data?.error || 'Could not save.' }); } };
  const register = async () => {
    if (!window.confirm('Register your Paybill notification URLs with Safaricom now?')) return;
    setBusy(true);
    try { const r = await API.post('/pay/c2b/register'); setMsg({ ok: `Safaricom replied: ${r.data.safaricom?.ResponseDescription || 'OK'}`, err: '' }); } catch (e) { setMsg({ ok: '', err: e.response?.data?.error || 'Registration failed.' }); }
    setBusy(false);
  };
  const instr = (r) => `To pay rent: M-Pesa → Lipa na M-Pesa → Pay Bill. Business no. ${info.shortcode || '(Paybill)'}, Account no. ${r.account_no}.`;
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => setMsg({ ok: 'Copied.', err: '' })).catch(() => {});

  const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: 14 };
  const inp = { padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--bg, #fff)', color: 'inherit', fontSize: 14 };
  const btn = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const primary = { ...btn, background: 'var(--primary, #7c3aed)', color: '#fff', border: 'none' };
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--muted, #6b7280)', borderBottom: '1px solid var(--border, #e5e7eb)' };
  const td = { padding: '8px 10px', borderBottom: '1px solid var(--border, #f1f5f9)', fontSize: 14 };
  const missing = rows.filter(r => !r.account_no).length;

  return (
    <div style={{ padding: 4 }}>
      <h2 style={{ marginTop: 0 }}>🏦 Paybill Accounts</h2>
      <div style={{ ...card, marginBottom: 12, fontSize: 14 }}>
        {info.shortcode ? <>Paybill number: <b>{info.shortcode}</b>. </> : <span style={{ color: '#b45309' }}>No Paybill number is set on the server yet (MPESA_SHORTCODE). </span>}
        {info.matching_on ? <span style={{ color: '#15803d' }}>Automatic matching is switched on.</span> : <span style={{ color: '#b45309' }}>Automatic matching is not switched on yet: the server needs C2B_SECRET. Until then, account numbers can still be given to tenants.</span>}
        <div style={{ color: 'var(--muted, #6b7280)', fontSize: 12.5, marginTop: 4 }}>A tenant pays the Paybill with their unit's account number. The payment is matched to them and taken against the oldest unpaid month, then any extra as advance rent. Payments to an unknown account number show up under unmatched payments to sort out by hand.</div>
      </div>
      {msg.err && <div style={{ ...card, color: '#b91c1c', marginBottom: 10 }}>{msg.err}</div>}
      {msg.ok && <div style={{ ...card, color: '#15803d', marginBottom: 10 }}>{msg.ok}</div>}
      <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select style={inp} value={plotId} onChange={e => setPlotId(e.target.value)}>{plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <div style={{ flex: 1 }} />
        {canEdit && missing > 0 && <button style={primary} disabled={busy} onClick={generate}>Create {missing} missing account number{missing > 1 ? 's' : ''}</button>}
      </div>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Unit</th><th style={th}>Tenant</th><th style={th}>Account number</th><th style={th} /></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.house_id}>
                <td style={td}><b>{r.unit_number}</b></td>
                <td style={td}>{r.tenant_name || <span style={{ color: 'var(--muted, #9ca3af)' }}>Vacant</span>}</td>
                <td style={td}>{canEdit
                  ? <input style={{ ...inp, width: 150 }} value={edit[r.house_id] ?? r.account_no ?? ''} maxLength={30} onChange={e => setEdit({ ...edit, [r.house_id]: e.target.value })} />
                  : (r.account_no || '—')}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {canEdit && edit[r.house_id] !== undefined && edit[r.house_id] !== (r.account_no ?? '') && <button style={primary} onClick={() => saveOne(r)}>Save</button>}
                  {r.account_no && <button style={{ ...btn, marginLeft: 6 }} onClick={() => copy(instr(r))} title="Copy payment instructions to send to the tenant">Copy instructions</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={4}>No units in this property.</td></tr>}
          </tbody>
        </table>
      </div>

      {admin && (<>
        <h3 style={{ marginTop: 22 }}>Safaricom connection</h3>
        <div style={{ ...card, marginBottom: 12, fontSize: 13.5 }}>
          Once your Paybill is live with Safaricom (and the server has <code>MPESA_SHORTCODE</code>, <code>MPESA_CONSUMER_KEY/SECRET</code>, <code>C2B_SECRET</code> and <code>PUBLIC_BASE_URL</code> set), register the notification URLs here. Do this once, and again only if your backend address changes.
          <div style={{ marginTop: 8 }}><button style={btn} disabled={busy} onClick={register}>Register URLs with Safaricom</button></div>
        </div>
        <h3>Latest Paybill notices</h3>
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>When</th><th style={th}>Code</th><th style={th}>Account typed</th><th style={th}>Amount</th><th style={th}>Result</th></tr></thead>
            <tbody>
              {recent.map(x => (
                <tr key={x.trans_id}>
                  <td style={td}>{x.trans_time ? new Date(x.trans_time).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</td>
                  <td style={td}>{x.trans_id}</td><td style={td}>{x.bill_ref || '—'}</td><td style={td}>KES {Number(x.amount).toLocaleString()}</td>
                  <td style={{ ...td, color: x.status === 'matched' ? '#15803d' : '#b45309' }}>{x.status === 'matched' ? `✓ ${x.tenant_name} (${x.plot_name} ${x.unit_number})` : (x.note || x.status)}</td>
                </tr>
              ))}
              {!recent.length && <tr><td style={td} colSpan={5}>No Paybill payments received yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}
    </div>
  );
}
