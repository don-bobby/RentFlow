import { useState, useEffect, useMemo } from 'react';
import API, { getTenants, getUsers } from '../services/api';
import { useAuth } from '../context/AuthContext';

// Admin/agent-only free-form SMS messaging — pick a tenant or landlord and
// send a one-off message. Separate from the automatic arrears-reminder
// blast (still triggered from wherever that already lives) and separate
// from the tenant portal's own SMS use (OTP delivery, PIN reset), which
// never routes through this page or through POST /sms/send at all.
const MAX_SMS_LEN = 320; // ~2 GSM-7 segments; soft guidance only, backend doesn't enforce a cap

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
        <h1 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 22, color: 'var(--text)', marginBottom: 4 }}>
          Send SMS
        </h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
          Send a one-off message to a tenant or a landlord. Rent-arrears reminders are sent separately as a bulk action.
        </p>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Recipient type */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[['tenant', 'Tenant'], ['landlord', 'Landlord']].map(([key, label]) => (
            <button key={key}
              onClick={() => { setRecipientType(key); setSelected(null); setSearch(''); }}
              style={{
                padding: '8px 18px', borderRadius: 10, border: '1px solid var(--border)',
                background: recipientType === key ? 'var(--primary)' : 'var(--surface2)',
                color: recipientType === key ? '#fff' : 'var(--text)',
                fontWeight: 600, fontSize: 13, cursor: 'pointer',
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* Recipient picker */}
        <div>
          <label style={labelStyle}>Recipient</label>
          {selected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'var(--primary-light)', border: '1px solid var(--primary)' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, #4f46e5, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13 }}>
                {selected.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {selected.phone}{selected.sub ? ` · ${selected.sub}` : ''}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: 15, cursor: 'pointer' }}>×</button>
            </div>
          ) : (
            <>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={recipientType === 'tenant' ? 'Search tenants by name, phone, or unit…' : 'Search landlords by name or phone…'}
                style={inputStyle}
              />
              <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                {loadingPeople ? (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
                ) : filtered.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    No {recipientType === 'tenant' ? 'tenants' : 'landlords'} found{search ? ' for that search' : ' with a phone number on file'}.
                  </div>
                ) : filtered.map(p => (
                  <div key={p.id} onClick={() => selectPerson(p)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, #4f46e5, #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12 }}>
                      {(p.full_name || p.name)?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text)' }}>{p.full_name || p.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
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
          <label style={labelStyle}>Message</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Type your message…"
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ fontSize: 11, color: message.length > MAX_SMS_LEN ? 'var(--red)' : 'var(--muted)', marginTop: 4, textAlign: 'right' }}>
            {message.length} characters {message.length > MAX_SMS_LEN ? '(may be split into multiple SMS segments)' : ''}
          </div>
        </div>

        {msg   && <div style={{ background: 'var(--green-light)', color: 'var(--green)', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{msg}</div>}
        {error && <div style={{ background: 'var(--red-light)',   color: 'var(--red)',   padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleSend} disabled={sending || !selected || !message.trim()} style={{
            padding: '10px 24px', borderRadius: 10, border: 'none',
            background: (sending || !selected || !message.trim()) ? 'var(--border)' : 'var(--primary)',
            color: '#fff', fontWeight: 700, fontSize: 14,
            cursor: (sending || !selected || !message.trim()) ? 'not-allowed' : 'pointer',
          }}>
            {sending ? 'Sending…' : 'Send SMS'}
          </button>
        </div>
      </div>

      {/* Recent sends — admin only, same restriction as the backend (sms_logs
          has no sender/plot column yet, so it can't be scoped to "messages
          an agent sent" vs. everyone else's) */}
      {isAdmin && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Recent SMS activity</h2>
          {logsLoading ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : logsError ? (
            <div style={{ color: 'var(--red)', fontSize: 13 }}>{logsError}</div>
          ) : logs.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No messages sent yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {logs.slice(0, 20).map((l, i) => (
                <div key={l.id || i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{l.to_phone}</span>
                    <span style={{
                      marginLeft: 8, padding: '1px 8px', borderRadius: 99, fontSize: 10.5, fontWeight: 700,
                      background: l.status === 'sent' ? 'var(--green-light)' : 'var(--red-light)',
                      color: l.status === 'sent' ? 'var(--green)' : 'var(--red)',
                    }}>{l.status}</span>
                    <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.message}</div>
                  </div>
                  <div style={{ color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
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
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };
