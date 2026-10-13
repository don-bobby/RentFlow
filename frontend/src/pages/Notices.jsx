import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';

// ── Responsive hook (matches the one used in Layout.jsx) ──────────────────────
function useBreakpoint() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return { isMobile: w < 768 };
}

const PRIORITY = {
  info:    { label: 'Info',    bg: 'var(--blue-light)',   color: 'var(--blue)',    icon: 'ℹ️' },
  warning: { label: 'Warning', bg: 'var(--amber-light)',  color: 'var(--amber)',   icon: '⚠️' },
  urgent:  { label: 'Urgent',  bg: 'var(--red-light)',    color: 'var(--red)',     icon: '🚨' },
};

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

export default function Notices({ defaultTab = 'notices' }) {
  const location = useLocation();
  const { isMobile } = useBreakpoint();
  const [tab,           setTab]           = useState(defaultTab); // notices | messages
  const [notices,       setNotices]       = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConv,    setActiveConv]    = useState(null);
  const [messages,      setMessages]      = useState([]);
  const [msgInput,      setMsgInput]      = useState('');
  const [plots,         setPlots]         = useState([]);
  const [houses,        setHouses]        = useState([]);
  const [tenants,       setTenants]       = useState([]);
  const [users,         setUsers]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [modal,         setModal]         = useState(false);
  const [newConvModal,  setNewConvModal]  = useState(false);
  const [newConvTarget, setNewConvTarget] = useState({ id: '', type: 'tenant' });
  const [form,          setForm]          = useState({ title: '', body: '', priority: 'info', target_type: 'property', target_id: '', expires_at: '' });
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');
  const messagesEndRef = useRef(null);
  const pollRef        = useRef(null);
  const { user: me, can } = useAuth();
  const canPost = can('notices.create');

  async function load() {
    setLoading(true);
    try {
      const [nr, cr, pr, hr, tr, ur] = await Promise.all([
        API.get('/notices'),
        API.get('/notices/conversations'),
        API.get('/plots'),
        API.get('/houses'),
        API.get('/tenants'),
        API.get('/notices/contacts'),
      ]);
      setNotices(nr.data.data || []);
      setConversations(cr.data.data || []);
      setPlots(Array.isArray(pr.data) ? pr.data : pr.data.data || []);
      setHouses(Array.isArray(hr.data) ? hr.data : hr.data.data || []);
      setTenants(Array.isArray(tr.data) ? tr.data : tr.data.data || []);
      setUsers(Array.isArray(ur.data) ? ur.data : ur.data.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // If we arrived here from the Chats panel with a specific conversation to open, select it
  useEffect(() => {
    const wantedId = location.state?.conversationId;
    if (!wantedId || conversations.length === 0) return;
    const conv = conversations.find(c => c.id === wantedId);
    if (conv) {
      setTab('messages');
      openConversation(conv);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, location.state]);

  // Poll for new messages when a conversation is open
  useEffect(() => {
    if (!activeConv) { clearInterval(pollRef.current); return; }
    pollRef.current = setInterval(async () => {
      const res = await API.get(`/notices/conversations/${activeConv.id}/messages`);
      setMessages(res.data.data || []);
    }, 8000);
    return () => clearInterval(pollRef.current);
  }, [activeConv]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function openConversation(conv) {
    setActiveConv(conv);
    const [msgRes, crRes] = await Promise.all([
      API.get(`/notices/conversations/${conv.id}/messages`),
      API.get('/notices/conversations'),
    ]);
    setMessages(msgRes.data.data || []);
    const updated = crRes.data.data || [];
    setConversations(updated);
    // Update activeConv with full data from refreshed list
    const full = updated.find(c => c.id === conv.id);
    if (full) setActiveConv(full);
  }

  async function sendMessage() {
    if (!msgInput.trim() || !activeConv) return;
    try {
      const res = await API.post(`/notices/conversations/${activeConv.id}/messages`, { body: msgInput.trim() });
      setMessages(m => [...m, res.data.data]);
      setMsgInput('');
      // Update conversation list
      setConversations(cs => cs.map(c => c.id === activeConv.id ? { ...c, last_message: msgInput.trim(), last_message_at: new Date().toISOString() } : c));
    } catch (e) { console.error(e); }
  }

  async function postNotice() {
    setSaving(true); setError('');
    try {
      // form.expires_at comes from a plain <input type="date">, e.g. "2026-10-02",
      // with no time component. Sent as-is, that becomes midnight at the START
      // of that day — meaning a notice "expiring" today is already expired the
      // moment it's posted, any time after 00:00. Treat the picked date as
      // valid through the END of that day instead.
      const payload = {
        ...form,
        target_id: form.target_id || null,
        expires_at: form.expires_at ? `${form.expires_at}T23:59:59` : null,
      };
      const res = await API.post('/notices', payload);
      setNotices(n => [res.data.data, ...n]);
      setModal(false);
      setForm({ title: '', body: '', priority: 'info', target_type: 'property', target_id: '', expires_at: '' });
    } catch (e) { setError(e.response?.data?.error || 'Failed to post notice.'); }
    finally { setSaving(false); }
  }

  async function deleteNotice(id) {
    if (!window.confirm('Delete this notice?')) return;
    await API.delete(`/notices/${id}`);
    setNotices(n => n.filter(x => x.id !== id));
  }

  async function startNewConversation() {
    if (!newConvTarget.id) return;
    try {
      const res = await API.post('/notices/conversations/new', { recipient_id: newConvTarget.id, recipient_type: newConvTarget.type });
      setNewConvModal(false);
      setTab('messages');
      // Reload conversations then open the new one
      const cr = await API.get('/notices/conversations');
      const updatedConvs = cr.data.data || [];
      setConversations(updatedConvs);
      const newConv = updatedConvs.find(c => c.id === res.data.conversation_id);
      if (newConv) {
        openConversation(newConv);
      } else {
        // fallback — open by id directly
        setActiveConv({ id: res.data.conversation_id, other_name: newConvTarget.type === 'tenant'
          ? tenants.find(t => String(t.id) === String(newConvTarget.id))?.full_name || 'Tenant'
          : users.find(u => String(u.id) === String(newConvTarget.id))?.name || 'Staff' });
        const mr = await API.get(`/notices/conversations/${res.data.conversation_id}/messages`);
        setMessages(mr.data.data || []);
      }
    } catch (e) { console.error(e); }
  }

  const targetOptions = () => {
    if (form.target_type === 'property') return plots.map(p => ({ id: p.id, label: p.name }));
    if (form.target_type === 'unit')     return houses.map(h => ({ id: h.id, label: `Unit ${h.unit_number}` }));
    if (form.target_type === 'tenant')   return tenants.filter(t => t.is_active).map(t => ({ id: t.id, label: t.full_name }));
    return [];
  };

  const totalUnread = conversations.reduce((s, c) => s + parseInt(c.unread_count || 0), 0);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: isMobile ? 16 : 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: isMobile ? 20 : 26, fontWeight: 700, marginBottom: 4 }}>
            {tab === 'notices' ? '📢 Notice Board' : '💬 Messages'}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            {tab === 'notices' ? `${notices.length} notices posted` : `${conversations.length} conversations`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {tab === 'notices' && canPost && (
            <button onClick={() => { setModal(true); setError(''); }}
              style={{ padding: isMobile ? '9px 14px' : '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: isMobile ? 13 : 14, cursor: 'pointer' }}>
              + Post Notice
            </button>
          )}
          {tab === 'messages' && (
            <button onClick={() => setNewConvModal(true)}
              style={{ padding: isMobile ? '9px 14px' : '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: isMobile ? 13 : 14, cursor: 'pointer' }}>
              + New Message
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: isMobile ? 16 : 24, background: 'var(--surface2)', borderRadius: 12, padding: 4, width: 'fit-content' }}>
        {[
          { key: 'notices',  label: '📢 Notices' },
          { key: 'messages', label: `💬 Messages${totalUnread > 0 ? ` (${totalUnread})` : ''}` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: isMobile ? '7px 14px' : '8px 20px', borderRadius: 10, border: 'none', fontWeight: 600, fontSize: isMobile ? 13 : 14, cursor: 'pointer',
            background: tab === t.key ? 'var(--surface)' : 'transparent',
            color: tab === t.key ? 'var(--text)' : 'var(--muted)',
            boxShadow: tab === t.key ? 'var(--shadow)' : 'none',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── NOTICES TAB ── */}
      {tab === 'notices' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>
          ) : notices.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📢</div>
              <p>No notices yet. Post one to notify your tenants.</p>
            </div>
          ) : notices.map(n => {
            const p = PRIORITY[n.priority] || PRIORITY.info;
            // Staff still see expired notices (kept as history, same as
            // before) but they used to render identically to a live one —
            // same colors, no indication the expiry date had passed. Dim
            // the card and badge it explicitly instead.
            const expired = !!n.is_expired;
            return (
              <div key={n.id} style={{ background: 'var(--surface)', border: `1px solid var(--border)`, borderLeft: `4px solid ${p.color}`, borderRadius: 12, padding: isMobile ? '13px 14px' : '16px 20px', boxShadow: 'var(--shadow)', opacity: expired ? 0.6 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ background: p.bg, color: p.color, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>{p.icon} {p.label}</span>
                    <span style={{ background: 'var(--surface2)', color: 'var(--muted)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>
                      {n.target_type === 'all' ? '🌍 Everyone' : n.target_type === 'staff' ? '🔒 Staff Only' : n.target_type === 'property' ? '🏢 Property' : n.target_type === 'unit' ? '🏠 Unit' : '👤 Individual'}
                    </span>
                    {expired && (
                      <span style={{ background: 'var(--surface2)', color: 'var(--muted)', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700, border: '1px solid var(--border)' }}>⏳ Expired</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{parseInt(n.read_count || 0)} read</span>
                    {(canPost && n.author_id === me?.id) || me?.role === 'admin' || me?.role === 'super_admin' ? (
                      <button onClick={() => deleteNotice(n.id)} style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: 'var(--red-light)', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                    ) : null}
                  </div>
                </div>
                <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{n.title}</div>
                <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 8 }}>{n.body}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Posted by {n.author_name} · {new Date(n.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {n.expires_at && ` · ${expired ? 'Expired' : 'Expires'} ${new Date(n.expires_at).toLocaleDateString('en-KE')}`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── MESSAGES TAB ── */}
      {tab === 'messages' && (
        <div style={
          isMobile
            ? { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 220px)', minHeight: 360, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }
            : { display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, height: 'calc(100vh - 280px)', minHeight: 400 }
        }>

          {/* Conversation list — hidden on mobile once a conversation is open */}
          {(!isMobile || !activeConv) && (
            <div style={{
              background: 'var(--surface)', border: isMobile ? 'none' : '1px solid var(--border)', borderRadius: isMobile ? 0 : 14,
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
              flex: isMobile ? 1 : 'initial', minHeight: 0,
            }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>Conversations</div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {conversations.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No conversations yet.</div>
                ) : conversations.map(c => {
                  const unread = parseInt(c.unread_count || 0);
                  const isActive = activeConv?.id === c.id;
                  return (
                    <div key={c.id} onClick={() => openConversation(c)}
                      style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isActive && !isMobile ? 'var(--primary-light)' : 'transparent', transition: 'background 0.1s' }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface2)'; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontWeight: unread > 0 ? 700 : 500, fontSize: 14, color: 'var(--text)' }}>{c.other_name || 'Unknown'}</span>
                        {unread > 0 && <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: 99, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{unread}</span>}
                      </div>
                      {c.notice_title && <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600, marginBottom: 2 }}>Re: {c.notice_title}</div>}
                      <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last_message || 'No messages yet'}</div>
                      {c.last_message_at && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{new Date(c.last_message_at).toLocaleDateString('en-KE')}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Message thread — on mobile, only shown once a conversation is selected */}
          {(!isMobile || activeConv) && (
            <div style={{ background: 'var(--surface)', border: isMobile ? 'none' : '1px solid var(--border)', borderRadius: isMobile ? 0 : 14, display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: isMobile ? 1 : 'initial', minHeight: 0 }}>
              {!activeConv ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', flexDirection: 'column', gap: 12 }}>
                  <span style={{ fontSize: 40 }}>💬</span>
                  <p>Select a conversation to read messages</p>
                </div>
              ) : (
                <>
                  {/* Thread header */}
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isMobile && (
                      <button onClick={() => setActiveConv(null)} style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer', color: 'var(--text)', padding: 0, lineHeight: 1 }}>←</button>
                    )}
                    <div>
                      {activeConv.other_name || conversations.find(c => c.id === activeConv.id)?.other_name || 'Conversation'}
                      {activeConv.notice_title && <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, marginTop: 2 }}>Re: {activeConv.notice_title}</div>}
                    </div>
                  </div>

                  {/* Messages */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 14px' : '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {messages.map(m => {
                      const isMe = m.sender_id === me?.id && m.sender_type === 'user';
                      return (
                        <div key={m.id} style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end' }}>
                          <div style={{
                            maxWidth: isMobile ? '85%' : '70%', padding: '10px 14px', borderRadius: isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                            background: isMe ? 'var(--primary)' : 'var(--surface2)',
                            color: isMe ? '#fff' : 'var(--text)', fontSize: 14, lineHeight: 1.5,
                          }}>
                            {!isMe && <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: 'var(--primary)' }}>{m.sender_name}</div>}
                            {m.body}
                            <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7, textAlign: isMe ? 'right' : 'left' }}>
                              {new Date(m.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input */}
                  <div style={{ padding: isMobile ? '10px 12px' : '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
                    <input value={msgInput} onChange={e => setMsgInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                      placeholder="Type a message..."
                      style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 14, color: 'var(--text)', outline: 'none' }} />
                    <button onClick={sendMessage} disabled={!msgInput.trim()}
                      style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                      Send
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Post Notice Modal ── */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: isMobile ? 18 : 28, width: '100%', maxWidth: 520, boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 20 }}>📢 Post Notice</h2>
            {error && <div style={{ background: 'var(--red-light)', color: 'var(--red)', padding: '9px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Title</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Water Interruption Notice" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Message</label>
                <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  placeholder="Write your notice here..." rows={4}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
              </div>
              <div>
                <label style={labelStyle}>Priority</label>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} style={inputStyle}>
                  <option value="info">ℹ️ Info</option>
                  <option value="warning">⚠️ Warning</option>
                  <option value="urgent">🚨 Urgent</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Send To</label>
                <select value={form.target_type} onChange={e => setForm(f => ({ ...f, target_type: e.target.value, target_id: '' }))} style={inputStyle}>
                  {me?.role !== 'caretaker' && <option value="all">🌍 Everyone (all staff and tenants)</option>}
                  {me?.role !== 'caretaker' && <option value="staff">🔒 Staff Only (admin, agents, landlords — never caretakers or tenants)</option>}
                  <option value="property">🏢 Specific Property{me?.role === 'caretaker' ? ' (your assigned plot)' : ''}</option>
                  <option value="unit">🏠 Specific Unit{me?.role === 'caretaker' ? ' (on your assigned plot)' : ''}</option>
                  {me?.role !== 'caretaker' && <option value="tenant">👤 Individual Tenant</option>}
                </select>
              </div>
              {form.target_type !== 'all' && form.target_type !== 'staff' && (
                <div>
                  <label style={labelStyle}>{form.target_type === 'property' ? 'Select Property' : form.target_type === 'unit' ? 'Select Unit' : 'Select Tenant'}</label>
                  <select value={form.target_id} onChange={e => setForm(f => ({ ...f, target_id: e.target.value }))} style={inputStyle}>
                    <option value="">— Select —</option>
                    {targetOptions().map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={labelStyle}>Expiry Date (optional)</label>
                <input type="date" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(false)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={postNotice} disabled={saving} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                {saving ? 'Posting...' : '📢 Post Notice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Conversation Modal ── */}
      {newConvModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: isMobile ? 18 : 28, width: '100%', maxWidth: 420, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 18, marginBottom: 20 }}>💬 New Message</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Message To</label>
                <select value={newConvTarget.type} onChange={e => setNewConvTarget(t => ({ ...t, type: e.target.value, id: '' }))} style={inputStyle}>
                  <option value="tenant">Tenant</option>
                  <option value="user">Staff (Admin / Agent / Landlord / Caretaker)</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Select {newConvTarget.type === 'tenant' ? 'Tenant' : 'Staff Member'}</label>
                <select value={newConvTarget.id} onChange={e => setNewConvTarget(t => ({ ...t, id: e.target.value }))} style={inputStyle}>
                  <option value="">— Select —</option>
                  {newConvTarget.type === 'tenant'
                    ? tenants.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.full_name} — {t.phone}</option>)
                    : users.filter(u => u.id !== me?.id).map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => setNewConvModal(false)} style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={startNewConversation} disabled={!newConvTarget.id} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                Start Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
