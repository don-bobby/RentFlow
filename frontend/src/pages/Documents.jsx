// Notices and tenancy agreements. Pick a tenant and a template, adjust the details,
// edit the wording if needed, then download a PDF. Nothing is sent to the tenant from here.
import { useEffect, useMemo, useState } from 'react';
import API from '../services/api';
import { IconInline } from '../components/Icon';

export default function Documents() {
  const [tenants, setTenants] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [q, setQ] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [key, setKey] = useState('');
  const [params, setParams] = useState({});
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    API.get('/documents/templates').then(r => setTemplates(r.data.data)).catch(() => setErr('Could not load templates.'));
    API.get('/tenants').then(r => setTenants((r.data.data || r.data || []).filter(t => t.is_active !== false))).catch(() => setErr('Could not load tenants.'));
  }, []);

  const tpl = templates.find(t => t.key === key);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tenants.filter(t => !s || `${t.full_name} ${t.unit_number || ''} ${t.plot_name || ''}`.toLowerCase().includes(s)).slice(0, 30);
  }, [tenants, q]);

  const preview = async (p = {}) => {
    if (!tenantId || !key) return;
    setBusy(true); setErr('');
    try {
      const r = await API.get('/documents/preview', { params: { tenant_id: tenantId, template: key, ...p } });
      setDoc({ title: r.data.title, body: r.data.body }); setParams(r.data.params);
    } catch (e) { setDoc(null); setErr(e.response?.data?.error || 'Could not build the document.'); }
    setBusy(false);
  };
  useEffect(() => { setDoc(null); setParams({}); if (tenantId && key) preview(); /* eslint-disable-next-line */ }, [tenantId, key]);

  const download = async () => {
    try {
      const r = await API.post('/documents/pdf', { tenant_id: Number(tenantId), template: key, title: doc.title, body: doc.body }, { responseType: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.data);
      a.download = `${key}-${(tenants.find(t => String(t.id) === String(tenantId))?.full_name || 'tenant').replace(/\s+/g, '_')}.pdf`; a.click();
    } catch (e) { setErr('Could not create the PDF.'); }
  };

  const card = { background: 'var(--card, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 14, padding: 16, marginBottom: 14 };
  const inp = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--bg, #fff)', color: 'inherit', fontSize: 14, boxSizing: 'border-box', width: '100%' };
  const btn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)', background: 'var(--card, #fff)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const primary = { ...btn, background: 'var(--primary, #1b6b45)', color: '#fff', border: 'none' };
  const muted = { color: 'var(--muted, #6b7280)', fontSize: 13 };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 4 }}>
      <h1 style={{ fontFamily: 'Bricolage Grotesque', fontSize: 32, fontWeight: 700, letterSpacing: '-0.4px', margin: '0 0 4px', color: 'var(--text)' }}><IconInline name="📄" size={14} />Notices and leases</h1>
      <p style={{ ...muted, marginTop: 0 }}>Make a notice or tenancy agreement as a PDF. These are general templates, not legal advice. Have a lawyer check important documents.</p>
      {err && <div style={{ ...card, color: '#b91c1c' }}>{err}</div>}

      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>1. Choose a tenant</div>
        <input style={inp} placeholder="Search by name, unit or property" value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, maxHeight: 150, overflowY: 'auto' }}>
          {matches.map(t => (
            <button key={t.id} onClick={() => setTenantId(String(t.id))} style={{ ...btn, background: String(t.id) === tenantId ? 'var(--primary, #1b6b45)' : undefined, color: String(t.id) === tenantId ? '#fff' : undefined }}>
              {t.full_name} <span style={{ opacity: .7, fontWeight: 400 }}>{t.unit_number || ''}</span>
            </button>))}
          {matches.length === 0 && <span style={muted}>No tenants found.</span>}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>2. Choose a document</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          {templates.map(t => (
            <button key={t.key} onClick={() => setKey(t.key)} style={{ ...btn, textAlign: 'left', padding: 12, borderColor: key === t.key ? '#1b6b45' : undefined, background: key === t.key ? 'rgba(27,107,69,.08)' : undefined }}>
              <div>{t.label}</div><div style={{ ...muted, fontWeight: 400, marginTop: 3 }}>{t.description}</div>
            </button>))}
        </div>
      </div>

      {tpl && tenantId && (
        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>3. Details</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {tpl.fields.map(f => (
              <label key={f.key} style={{ ...muted, display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 170px' }}>{f.label}
                <input style={inp} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={params[f.key] ?? ''} onChange={e => setParams({ ...params, [f.key]: e.target.value })} />
              </label>))}
            <button style={btn} disabled={busy} onClick={() => preview(params)}>Update text</button>
          </div>
        </div>)}

      {doc && (
        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>4. Check and edit the wording</div>
          <p style={{ ...muted, marginTop: 0 }}>Edit anything below. A line starting with "# " becomes a heading. If you press "Update text" again, your edits are replaced.</p>
          <input style={{ ...inp, fontWeight: 700, marginBottom: 8 }} value={doc.title} onChange={e => setDoc({ ...doc, title: e.target.value })} />
          <textarea style={{ ...inp, minHeight: 420, fontFamily: 'inherit', lineHeight: 1.5 }} value={doc.body} onChange={e => setDoc({ ...doc, body: e.target.value })} />
          <div style={{ marginTop: 12 }}><button style={primary} onClick={download}>Download PDF</button></div>
        </div>)}
    </div>
  );
}
