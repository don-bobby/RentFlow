import { useState, useEffect, useMemo } from 'react';
import API, { getTenants, getUsers } from '../services/api';
import { useAuth } from '../context/AuthContext';

// Admin/agent-only free-form SMS messaging — pick a tenant or landlord and
// send a one-off message. Separate from the automatic arrears-reminder
// blast (still triggered from wherever that already lives) and separate
// from the tenant portal's own SMS use (OTP delivery, PIN reset), which
// never routes through this page or through POST /sms/send at all.
//
// Visual polish only in this pass — no change to data flow, endpoints, or
// the admin-only scoping of /sms/logs.

// GSM 03.38 basic character set. A message using only these characters is
// billed/split as GSM-7 (160 chars/segment, 153 when concatenated); any
// other character (emoji, most accented letters outside this set, etc.)
// forces UCS-2 (70 chars/segment, 67 when concatenated). This is purely
// informational for the sender — the backend doesn't enforce either cap.
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

// Deterministic avatar color from a name, so the same person always gets
// the same tint instead of every avatar being identical indigo.
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

export default function SmsMessages() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [recipientType, setRecipientType] = useState('tenant'); // 'tenant' | 'landlord'
  const [search, setSearch]       = useState('');
  const [tenants, setTenants]     = useState([]);
  const [landlords, setLandlords] = useState([]);
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [selected, setSelected]   = useState(null); // { id, name, phone }
  const [message, setMessage]     = useState('');
  const [sending, setSending]     = useState(false);
  const [msg, setMsg]             = useState('');
  const [error, setError]         = useState('');

  const [logs, setLogs]             = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError]     = useState('');

  useEffect(() => {
    async function fetchPeople() {
      setLoadingPeople(true);
      try {
        const [tRes, uRes] = await Promise.all([getTenants(), getUsers()]);
        setTenants((tRes.data.data || []).filter(t => t.phone));
        setLandlords((uRes.data.data || []).filter(u => u.role === 'landlord' && u.phone));
      } catch {
        setError('Could not load tenants/landlords.');
      } finally {
        setLoadingPeople(false);
      }
    }
    fetchPeople();
  }, []);

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
        // Refresh the recent-history list so the new send shows up right away
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
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 22, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          Send SMS
        </h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
          Send a one-off message to a tenant or a landlord. Rent-arrears reminders are sent separately as a bulk action.
        </p>
      </div>

      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        padding: 22, display: 'flex', flexDirection: 'column', gap: 18,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}>

        {/* Recipient type — segmented control */}
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

        {/* Recipient picker */}
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

        {/* Message */}
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
            <span>{segments.unicode ? 'Contains characters outside GSM-7 (e.g. emoji) — shorter segments apply' : ' '}</span>
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

      {/* Recent sends — admin only, same restriction as the backend (sms_logs
          has no sender/plot column yet, so it can't be scoped to "messages
          an agent sent" vs. everyone else's) */}
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
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.15s ease',
};
