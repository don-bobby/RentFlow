import { useState, useEffect, useMemo, useRef } from 'react';
import API, { getTenants, getUsers, getPlots } from '../services/api';
import { useAuth } from '../context/AuthContext';

// Admin/agent-only SMS messaging.
//
// Two tabs:
//   - "Single Message" — free-form message to one tenant or landlord.
//     Unchanged from before this pass: same endpoint (POST /sms/send),
//     same admin-only /sms/logs history panel.
//   - "Bulk Message" — admin-only (the backend gates POST/GET /sms/bulk*
//     with requireAdmin, stricter than the admin+agent gate on the rest of
//     this file), so the tab itself is hidden for agents rather than shown
//     and then 403ing. Lets an admin pick a scope (all tenants, one
//     property, tenants in arrears, landlords & agents, or a hand-picked
//     list), write one message template with {tenant_name}/{balance}/
//     {unit_number}/{plot_name} placeholders, preview exactly who it will
//     reach and what the message renders to, then send and see a
//     delivered/failed report. Past batches are listed below with the same
//     report viewable again at any time.

const GSM7 = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;

function smsSegments(text) {
  if (!text) return { count: 0, perSegment: 160, unicode: false };
  const unicode = !GSM7.test(text);
  const single = unicode ? 70 : 160;
  const multi  = unicode ? 67 : 153;
  const len = text.length;
  const count = len <= single ? 1 : Math.ceil(len / multi);
  const perSegment = count === 1 ? single : multi;
  return { count, perSegment, unicode };
}

function initials(name) {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('') || '?';
}

const AVATAR_PALETTE = [
  ['#4f46e5', '#818cf8'], ['#0891b2', '#67e8f9'], ['#be185d', '#f472b6'],
  ['#b45309', '#fbbf24'], ['#15803d', '#86efac'], ['#6d28d9', '#c4b5fd'],
];
function avatarGradient(name) {
  const s = name || '?';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  const [a, b] = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

const SendIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" />
  </svg>
);
const SearchIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
);
const CheckIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const AlertIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M12 8v5" /><path d="M12 16h.01" />
  </svg>
);
const HistoryIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" />
  </svg>
);
const UsersIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const EyeIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const CloseIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" /><path d="M6 6l12 12" />
  </svg>
);

const BULK_SCOPES = [
  { key: 'all_tenants', label: 'All Tenants',        hint: 'Every active tenant with a phone number on file.' },
  { key: 'property',    label: 'One Property',       hint: 'All tenants in a single property.' },
  { key: 'arrears',     label: 'Tenants in Arrears',  hint: 'Only tenants with an outstanding rent balance right now.' },
  { key: 'landlords',   label: 'Landlords & Agents',  hint: 'Every approved landlord and agent with a phone number.' },
  { key: 'manual',      label: 'Pick Recipients',     hint: 'Hand-pick specific tenants and/or landlords.' },
];
const SCOPE_LABEL = Object.fromEntries(BULK_SCOPES.map(s => [s.key, s.label]));

const PLACEHOLDER_TOKENS = [
  { token: '{tenant_name}', label: 'Name' },
  { token: '{unit_number}', label: 'Unit' },
  { token: '{plot_name}',   label: 'Property' },
  { token: '{balance}',     label: 'Balance' },
];

export default function SmsMessages() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [activeTab, setActiveTab] = useState('single'); // 'single' | 'bulk'

  // ───────────────────────────── shared people data ─────────────────────────────
  const [tenants, setTenants]     = useState([]);
  const [landlords, setLandlords] = useState([]);   // role === 'landlord' only — single-send picker, unchanged
  const [landlordsAndAgents, setLandlordsAndAgents] = useState([]); // landlord + agent — used by bulk "manual" picker
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [peopleError, setPeopleError] = useState('');

  useEffect(() => {
    async function fetchPeople() {
      setLoadingPeople(true);
      try {
        const [tRes, uRes] = await Promise.all([getTenants(), getUsers()]);
        setTenants((tRes.data.data || []).filter(t => t.phone));
        const users = uRes.data.data || [];
        setLandlords(users.filter(u => u.role === 'landlord' && u.phone));
        setLandlordsAndAgents(users.filter(u => (u.role === 'landlord' || u.role === 'agent') && u.phone));
      } catch {
        setPeopleError('Could not load tenants/landlords.');
      } finally {
        setLoadingPeople(false);
      }
    }
    fetchPeople();
  }, []);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 22, color: 'var(--text)', marginBottom: 4 }}>
          Messaging
        </h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
          Send a one-off SMS, or reach a whole group of tenants or landlords at once.
        </p>
      </div>

      {isAdmin && (
        <div style={{
          display: 'inline-flex', gap: 2, padding: 3, borderRadius: 11,
          background: 'var(--surface2)', border: '1px solid var(--border)', width: 'fit-content',
        }}>
          {[['single', 'Single Message'], ['bulk', 'Bulk Message']].map(([key, label]) => (
            <button key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: '8px 22px', borderRadius: 8, border: 'none',
                background: activeTab === key ? 'var(--primary)' : 'transparent',
                color: activeTab === key ? '#fff' : 'var(--muted)',
                fontWeight: 600, fontSize: 13.5, cursor: 'pointer',
                boxShadow: activeTab === key ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                transition: 'background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
              }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {peopleError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--red-light)', color: 'var(--red)', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500 }}>
          <AlertIcon /> {peopleError}
        </div>
      )}

      {activeTab === 'single' || !isAdmin ? (
        <SingleMessageTab
          isAdmin={isAdmin}
          tenants={tenants}
          landlords={landlords}
          loadingPeople={loadingPeople}
        />
      ) : (
        <BulkMessageTab
          tenants={tenants}
          landlordsAndAgents={landlordsAndAgents}
          loadingPeople={loadingPeople}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Single message — unchanged behavior from before this pass.
// ═══════════════════════════════════════════════════════════════════════════

function SingleMessageTab({ isAdmin, tenants, landlords, loadingPeople }) {
  const [recipientType, setRecipientType] = useState('tenant'); // 'tenant' | 'landlord'
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState(null); // { id, name, phone }
  const [message, setMessage]     = useState('');
  const [sending, setSending]     = useState(false);
  const [msg, setMsg]             = useState('');
  const [error, setError]         = useState('');

  const [logs, setLogs]             = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError]     = useState('');

  useEffect(() => {
    if (!isAdmin) return; // logs are admin-only — sms_logs has no sender/plot link to scope by for agent
    async function fetchLogs() {
      setLogsLoading(true); setLogsError('');
      try {
        const res = await API.get('/sms/logs');
        setLogs(res.data.data || []);
      } catch {
        setLogsError('Could not load recent SMS history.');
      } finally {
        setLogsLoading(false);
      }
    }
    fetchLogs();
  }, [isAdmin]);

  const people = recipientType === 'tenant' ? tenants : landlords;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter(p =>
      (p.full_name || p.name || '').toLowerCase().includes(q) ||
      (p.phone || '').includes(q) ||
      (p.unit_number || '').toLowerCase().includes(q) ||
      (p.plot_name || '').toLowerCase().includes(q)
    );
  }, [people, search]);

  const segments = useMemo(() => smsSegments(message), [message]);

  function selectPerson(p) {
    setSelected({
      id: p.id,
      name: p.full_name || p.name,
      phone: p.phone,
      sub: recipientType === 'tenant' ? [p.unit_number, p.plot_name].filter(Boolean).join(' · ') : null,
    });
    setMsg(''); setError('');
  }

  async function handleSend() {
    setError(''); setMsg('');
    if (!selected) return setError('Pick a recipient first.');
    if (!message.trim()) return setError('Message cannot be empty.');
    setSending(true);
    try {
      await API.post('/sms/send', { to_phone: selected.phone, message: message.trim() });
      setMsg(`Message sent to ${selected.name}.`);
      setMessage('');
      if (isAdmin) {
        try {
          const res = await API.get('/sms/logs');
          setLogs(res.data.data || []);
        } catch {}
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        padding: 22, display: 'flex', flexDirection: 'column', gap: 18,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}>

        <div style={{
          display: 'inline-flex', gap: 2, padding: 3, borderRadius: 11,
          background: 'var(--surface2)', border: '1px solid var(--border)', width: 'fit-content',
        }}>
          {[['tenant', 'Tenant'], ['landlord', 'Landlord']].map(([key, label]) => (
            <button key={key}
              onClick={() => { setRecipientType(key); setSelected(null); setSearch(''); setError(''); }}
              style={{
                padding: '7px 20px', borderRadius: 8, border: 'none',
                background: recipientType === key ? 'var(--primary)' : 'transparent',
                color: recipientType === key ? '#fff' : 'var(--muted)',
                fontWeight: 600, fontSize: 13, cursor: 'pointer',
                boxShadow: recipientType === key ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                transition: 'background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
              }}>
              {label}
            </button>
          ))}
        </div>

        <div>
          <label style={labelStyle}>Recipient</label>
          {selected ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12,
              background: 'var(--primary-light)', border: '1px solid var(--primary)',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: avatarGradient(selected.name), display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12.5,
              }}>
                {initials(selected.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {selected.phone}{selected.sub ? ` · ${selected.sub}` : ''}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label="Change recipient"
                style={{
                  width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'var(--surface)',
                  color: 'var(--muted)', fontSize: 15, lineHeight: 1, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                ×
              </button>
            </div>
          ) : (
            <>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', display: 'flex' }}>
                  <SearchIcon />
                </span>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={recipientType === 'tenant' ? 'Search tenants by name, phone, or unit…' : 'Search landlords by name or phone…'}
                  style={{ ...inputStyle, paddingLeft: 36 }}
                />
              </div>
              <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
                {loadingPeople ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
                ) : filtered.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    No {recipientType === 'tenant' ? 'tenants' : 'landlords'} found{search ? ' for that search' : ' with a phone number on file'}.
                  </div>
                ) : filtered.map((p, i) => (
                  <div key={p.id} onClick={() => selectPerson(p)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer',
                      borderBottom: i === filtered.length - 1 ? 'none' : '1px solid var(--border)',
                      transition: 'background 0.1s ease',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      background: avatarGradient(p.full_name || p.name), display: 'flex', alignItems: 'center',
                      justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12,
                    }}>
                      {initials(p.full_name || p.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text)' }}>{p.full_name || p.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.phone}{recipientType === 'tenant' && (p.unit_number || p.plot_name) ? ` · ${[p.unit_number, p.plot_name].filter(Boolean).join(' · ')}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <label style={{ ...labelStyle, marginBottom: 6 }}>Message</label>
          </div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Type your message…"
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
            <span>{segments.unicode ? 'Contains characters outside GSM-7 (e.g. emoji) — shorter segments apply' : ' '}</span>
            <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              {message.length} chars
              {segments.count > 1 && <> · {segments.count} SMS segments</>}
            </span>
          </div>
        </div>

        {msg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--green-light)', color: 'var(--green)', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500 }}>
            <CheckIcon /> {msg}
          </div>
        )}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--red-light)', color: 'var(--red)', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500 }}>
            <AlertIcon /> {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleSend} disabled={sending || !selected || !message.trim()} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '11px 26px', borderRadius: 11, border: 'none',
            background: (sending || !selected || !message.trim()) ? 'var(--border)' : 'var(--primary)',
            color: '#fff', fontWeight: 700, fontSize: 14,
            cursor: (sending || !selected || !message.trim()) ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s ease, transform 0.1s ease',
            boxShadow: (sending || !selected || !message.trim()) ? 'none' : '0 1px 3px rgba(0,0,0,0.15)',
          }}>
            {sending ? 'Sending…' : <>Send SMS <SendIcon /></>}
          </button>
        </div>
      </div>

      {isAdmin && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <HistoryIcon /> Recent SMS activity
          </h2>
          {logsLoading ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : logsError ? (
            <div style={{ color: 'var(--red)', fontSize: 13 }}>{logsError}</div>
          ) : logs.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No messages sent yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {logs.slice(0, 20).map((l, i) => (
                <div key={l.id || i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14,
                  padding: '10px 0', borderBottom: i === Math.min(logs.length, 20) - 1 ? 'none' : '1px solid var(--border)',
                  fontSize: 12.5,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{l.to_phone}</span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 8px 2px 6px', borderRadius: 99, fontSize: 10.5, fontWeight: 700,
                        background: l.status === 'sent' ? 'var(--green-light)' : 'var(--red-light)',
                        color: l.status === 'sent' ? 'var(--green)' : 'var(--red)',
                      }}>
                        {l.status === 'sent' ? <CheckIcon size={9} /> : <AlertIcon size={9} />}
                        {l.status}
                      </span>
                    </div>
                    <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.message}>
                      {l.message}
                    </div>
                  </div>
                  <div style={{ color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: 1 }}>
                    {l.sent_at ? new Date(l.sent_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Bulk message — admin only. Mirrors POST /sms/bulk/preview, POST
// /sms/bulk/send, GET /sms/bulk, GET /sms/bulk/:id exactly.
// ═══════════════════════════════════════════════════════════════════════════

function BulkMessageTab({ tenants, landlordsAndAgents, loadingPeople }) {
  const [scope, setScope]       = useState('all_tenants');
  const [plotId, setPlotId]     = useState('');
  const [plots, setPlots]       = useState([]);
  const [plotsLoading, setPlotsLoading] = useState(false);

  const [manualType, setManualType]     = useState('tenant'); // 'tenant' | 'landlord'
  const [manualSearch, setManualSearch] = useState('');
  const [manualSelected, setManualSelected] = useState([]); // [{key,id,type,name,phone,sub}]

  const [template, setTemplate] = useState('');
  const textareaRef = useRef(null);

  const [preview, setPreview]   = useState(null); // { count, sample_message, recipients }
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult]     = useState(null); // { batchId, total, sent, failed }
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState('');

  const [batches, setBatches]         = useState([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [reportBatchId, setReportBatchId]   = useState(null);
  const [report, setReport]                 = useState(null);
  const [reportLoading, setReportLoading]   = useState(false);

  useEffect(() => {
    fetchBatches();
    setPlotsLoading(true);
    getPlots().then(res => setPlots(res.data.data || res.data || [])).catch(() => {}).finally(() => setPlotsLoading(false));
  }, []);

  async function fetchBatches() {
    setBatchesLoading(true);
    try {
      const res = await API.get('/sms/bulk');
      setBatches(res.data.data || []);
    } catch {
      // non-fatal — the compose form above still works without history
    } finally {
      setBatchesLoading(false);
    }
  }

  async function viewReport(id) {
    setReportBatchId(id); setReport(null); setReportLoading(true);
    try {
      const res = await API.get(`/sms/bulk/${id}`);
      setReport(res.data.data);
    } catch {
      setReport({ error: true });
    } finally {
      setReportLoading(false);
    }
  }

  function resetOutcome() {
    setPreview(null); setResult(null); setError('');
  }

  function changeScope(key) {
    setScope(key);
    setPlotId('');
    setManualSelected([]);
    setManualSearch('');
    resetOutcome();
  }

  function updateTemplate(v) {
    setTemplate(v);
    resetOutcome();
  }

  function insertToken(token) {
    const el = textareaRef.current;
    if (!el) { updateTemplate(template + token); return; }
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? template.length;
    const next = template.slice(0, start) + token + template.slice(end);
    updateTemplate(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function toggleManualPerson(p, type) {
    const key = `${type}-${p.id}`;
    setManualSelected(prev => {
      const exists = prev.some(x => x.key === key);
      if (exists) return prev.filter(x => x.key !== key);
      return [...prev, {
        key, id: p.id, type,
        name: p.full_name || p.name,
        phone: p.phone,
        sub: type === 'tenant' ? [p.unit_number, p.plot_name].filter(Boolean).join(' · ') : null,
      }];
    });
    resetOutcome();
  }

  const manualPool = manualType === 'tenant' ? tenants : landlordsAndAgents;
  const manualFiltered = useMemo(() => {
    const q = manualSearch.trim().toLowerCase();
    const pool = q ? manualPool.filter(p =>
      (p.full_name || p.name || '').toLowerCase().includes(q) ||
      (p.phone || '').includes(q) ||
      (p.unit_number || '').toLowerCase().includes(q) ||
      (p.plot_name || '').toLowerCase().includes(q)
    ) : manualPool;
    return pool;
  }, [manualPool, manualSearch]);

  const segments = useMemo(() => smsSegments(template), [template]);

  function buildBody() {
    const body = { scope, message_template: template.trim() };
    if (scope === 'property') body.plot_id = Number(plotId);
    if (scope === 'manual') {
      body.tenant_ids = manualSelected.filter(x => x.type === 'tenant').map(x => x.id);
      body.user_ids   = manualSelected.filter(x => x.type === 'landlord').map(x => x.id);
    }
    return body;
  }

  function validate() {
    if (!template.trim()) return 'Write a message template first.';
    if (scope === 'property' && !plotId) return 'Pick a property.';
    if (scope === 'manual' && manualSelected.length === 0) return 'Pick at least one recipient.';
    return null;
  }

  async function handlePreview() {
    setError(''); setResult(null);
    const v = validate();
    if (v) return setError(v);
    setPreviewing(true);
    try {
      const res = await API.post('/sms/bulk/preview', buildBody());
      setPreview(res.data.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Could not preview this send.');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSend() {
    setError('');
    if (!preview) return;
    setSending(true);
    try {
      const res = await API.post('/sms/bulk/send', buildBody());
      setResult(res.data.data);
      setPreview(null);
      fetchBatches();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to send bulk message.');
    } finally {
      setSending(false);
    }
  }

  const plotName = (id) => plots.find(p => p.id === Number(id))?.name || `Plot #${id}`;

  return (
    <>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        padding: 22, display: 'flex', flexDirection: 'column', gap: 20,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}>

        {/* Scope */}
        <div>
          <label style={labelStyle}>Who should get this?</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginTop: 6 }}>
            {BULK_SCOPES.map(s => (
              <button key={s.key} onClick={() => changeScope(s.key)} title={s.hint}
                style={{
                  textAlign: 'left', padding: '10px 12px', borderRadius: 11,
                  border: scope === s.key ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                  background: scope === s.key ? 'var(--primary-light)' : 'var(--surface2)',
                  color: scope === s.key ? 'var(--primary)' : 'var(--text)',
                  fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
                  transition: 'border-color 0.15s ease, background 0.15s ease',
                }}>
                {s.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
            {BULK_SCOPES.find(s => s.key === scope)?.hint}
          </div>
        </div>

        {/* Property picker */}
        {scope === 'property' && (
          <div>
            <label style={labelStyle}>Property</label>
            <select value={plotId} onChange={e => { setPlotId(e.target.value); resetOutcome(); }} style={inputStyle}>
              <option value="">{plotsLoading ? 'Loading properties…' : 'Select a property…'}</option>
              {plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {/* Manual recipient picker */}
        {scope === 'manual' && (
          <div>
            <label style={labelStyle}>Recipients</label>

            {manualSelected.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {manualSelected.map(m => (
                  <span key={m.key} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 6px 5px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                    background: 'var(--primary-light)', color: 'var(--primary)', border: '1px solid var(--primary)',
                  }}>
                    {m.name}
                    <button onClick={() => toggleManualPerson({ id: m.id, full_name: m.name, phone: m.phone }, m.type)}
                      aria-label={`Remove ${m.name}`}
                      style={{
                        width: 17, height: 17, borderRadius: '50%', border: 'none', background: 'rgba(79,70,229,0.15)',
                        color: 'var(--primary)', fontSize: 11, lineHeight: 1, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div style={{
              display: 'inline-flex', gap: 2, padding: 3, borderRadius: 11, marginBottom: 8,
              background: 'var(--surface2)', border: '1px solid var(--border)', width: 'fit-content',
            }}>
              {[['tenant', 'Tenants'], ['landlord', 'Landlords & Agents']].map(([key, label]) => (
                <button key={key} onClick={() => { setManualType(key); setManualSearch(''); }}
                  style={{
                    padding: '6px 16px', borderRadius: 8, border: 'none',
                    background: manualType === key ? 'var(--primary)' : 'transparent',
                    color: manualType === key ? '#fff' : 'var(--muted)',
                    fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', display: 'flex' }}>
                <SearchIcon />
              </span>
              <input
                value={manualSearch}
                onChange={e => setManualSearch(e.target.value)}
                placeholder={manualType === 'tenant' ? 'Search tenants by name, phone, or unit…' : 'Search landlords/agents by name or phone…'}
                style={{ ...inputStyle, paddingLeft: 36 }}
              />
            </div>
            <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
              {loadingPeople ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
              ) : manualFiltered.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                  No {manualType === 'tenant' ? 'tenants' : 'landlords/agents'} found.
                </div>
              ) : manualFiltered.map((p, i) => {
                const key = `${manualType}-${p.id}`;
                const checked = manualSelected.some(x => x.key === key);
                return (
                  <div key={p.id} onClick={() => toggleManualPerson(p, manualType)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer',
                      borderBottom: i === manualFiltered.length - 1 ? 'none' : '1px solid var(--border)',
                      background: checked ? 'var(--primary-light)' : 'transparent',
                      transition: 'background 0.1s ease',
                    }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                      border: checked ? 'none' : '1.5px solid var(--border)',
                      background: checked ? 'var(--primary)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                    }}>
                      {checked && <CheckIcon size={11} />}
                    </div>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: avatarGradient(p.full_name || p.name), display: 'flex', alignItems: 'center',
                      justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 11,
                    }}>
                      {initials(p.full_name || p.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text)' }}>{p.full_name || p.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.phone}{manualType === 'tenant' && (p.unit_number || p.plot_name) ? ` · ${[p.unit_number, p.plot_name].filter(Boolean).join(' · ')}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Message template */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Message</label>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {PLACEHOLDER_TOKENS.map(t => (
              <button key={t.token} onClick={() => insertToken(t.token)}
                style={{
                  padding: '4px 10px', borderRadius: 7, border: '1px solid var(--border)',
                  background: 'var(--surface2)', color: 'var(--text)', fontSize: 11.5, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'monospace',
                }}>
                + {t.label}
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={template}
            onChange={e => updateTemplate(e.target.value)}
            placeholder="e.g. Dear {tenant_name}, your balance for {unit_number} at {plot_name} is {balance}. Please settle promptly."
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
            <span>{segments.unicode ? 'Contains characters outside GSM-7 — shorter segments apply' : 'Approximate — actual length varies once placeholders are filled in'}</span>
            <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              {template.length} chars
              {segments.count > 1 && <> · ~{segments.count} SMS segments</>}
            </span>
          </div>
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--red-light)', color: 'var(--red)', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500 }}>
            <AlertIcon /> {error}
          </div>
        )}

        {/* Preview results */}
        {preview && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--surface2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5, color: 'var(--text)', marginBottom: 10 }}>
              <UsersIcon /> {preview.count} recipient{preview.count === 1 ? '' : 's'} will receive this message
            </div>
            {preview.sample_message && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>
                  Sample (for {preview.recipients?.[0]?.name})
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)', background: 'var(--surface)', borderRadius: 8, padding: '8px 10px', border: '1px solid var(--border)' }}>
                  {preview.sample_message}
                </div>
              </div>
            )}
            {preview.count > 0 && (
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                {preview.recipients.map((r, i) => (
                  <div key={`${r.type}-${r.id}`} style={{
                    display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 10px', fontSize: 12.5,
                    borderBottom: i === preview.recipients.length - 1 ? 'none' : '1px solid var(--border)',
                    background: 'var(--surface)',
                  }}>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{r.name}</span>
                    <span style={{ color: 'var(--muted)' }}>{r.phone}</span>
                  </div>
                ))}
                {preview.count > preview.recipients.length && (
                  <div style={{ padding: '7px 10px', fontSize: 11.5, color: 'var(--muted)', textAlign: 'center' }}>
                    + {preview.count - preview.recipients.length} more not shown
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Send result */}
        {result && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--green-light)', color: 'var(--green)', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500 }}>
            <CheckIcon /> Sent to {result.sent} of {result.total} recipient{result.total === 1 ? '' : 's'}
            {result.failed > 0 && <> · {result.failed} failed</>}.
            <button onClick={() => viewReport(result.batchId)} style={{
              marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--green)',
              fontWeight: 700, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline', flexShrink: 0,
            }}>
              View report
            </button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={handlePreview} disabled={previewing} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '11px 22px', borderRadius: 11, border: '1px solid var(--border)',
            background: 'var(--surface2)', color: 'var(--text)', fontWeight: 600, fontSize: 14,
            cursor: previewing ? 'not-allowed' : 'pointer',
          }}>
            {previewing ? 'Checking…' : <>Preview <EyeIcon /></>}
          </button>
          <button onClick={handleSend} disabled={sending || !preview || preview.count === 0} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '11px 26px', borderRadius: 11, border: 'none',
            background: (sending || !preview || preview.count === 0) ? 'var(--border)' : 'var(--primary)',
            color: '#fff', fontWeight: 700, fontSize: 14,
            cursor: (sending || !preview || preview.count === 0) ? 'not-allowed' : 'pointer',
            boxShadow: (sending || !preview || preview.count === 0) ? 'none' : '0 1px 3px rgba(0,0,0,0.15)',
          }}>
            {sending ? 'Sending…' : <>Send{preview ? ` to ${preview.count}` : ''} <SendIcon /></>}
          </button>
        </div>
      </div>

      {/* Batch report viewer */}
      {reportBatchId && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <EyeIcon /> Batch report
            </h2>
            <button onClick={() => setReportBatchId(null)} aria-label="Close report" style={{
              border: 'none', background: 'var(--surface2)', color: 'var(--muted)', borderRadius: '50%',
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}>
              <CloseIcon size={13} />
            </button>
          </div>
          {reportLoading ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : report?.error ? (
            <div style={{ color: 'var(--red)', fontSize: 13 }}>Could not load this batch's report.</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14, fontSize: 12.5 }}>
                <span><strong style={{ color: 'var(--text)' }}>{report.batch.total_count}</strong> <span style={{ color: 'var(--muted)' }}>total</span></span>
                <span><strong style={{ color: 'var(--green)' }}>{report.batch.sent_count}</strong> <span style={{ color: 'var(--muted)' }}>sent</span></span>
                <span><strong style={{ color: 'var(--red)' }}>{report.batch.failed_count}</strong> <span style={{ color: 'var(--muted)' }}>failed</span></span>
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                {report.logs.map((l, i) => (
                  <div key={l.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 12px',
                    fontSize: 12.5, borderBottom: i === report.logs.length - 1 ? 'none' : '1px solid var(--border)',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{l.recipient_name || '—'}</div>
                      <div style={{ color: 'var(--muted)' }}>{l.to_phone}</div>
                    </div>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
                      padding: '2px 8px 2px 6px', borderRadius: 99, fontSize: 10.5, fontWeight: 700,
                      background: l.status === 'sent' ? 'var(--green-light)' : 'var(--red-light)',
                      color: l.status === 'sent' ? 'var(--green)' : 'var(--red)',
                    }}>
                      {l.status === 'sent' ? <CheckIcon size={9} /> : <AlertIcon size={9} />}
                      {l.status}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Batch history */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HistoryIcon /> Recent bulk sends
        </h2>
        {batchesLoading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : batches.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No bulk messages sent yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {batches.slice(0, 20).map((b, i) => (
              <div key={b.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14,
                padding: '10px 0', borderBottom: i === Math.min(batches.length, 20) - 1 ? 'none' : '1px solid var(--border)',
                fontSize: 12.5,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{SCOPE_LABEL[b.scope] || b.scope}</span>
                    {b.scope === 'property' && b.scope_plot_id && (
                      <span style={{ color: 'var(--muted)' }}>· {plotName(b.scope_plot_id)}</span>
                    )}
                  </div>
                  <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.message_template}>
                    {b.message_template}
                  </div>
                  <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>{b.sent_count} sent</span>
                    {b.failed_count > 0 && <span style={{ color: 'var(--red)', fontWeight: 600 }}> · {b.failed_count} failed</span>}
                    {' '}of {b.total_count} · by {b.created_by_name || '—'} ·{' '}
                    {b.created_at ? new Date(b.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                </div>
                <button onClick={() => viewReport(b.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                  border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)',
                  borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                  <EyeIcon size={12} /> Report
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.15s ease',
};
