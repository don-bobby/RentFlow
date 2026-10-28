// One public "special": an Airbnb-style stay or a property for sale.
import { useState } from 'react';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

function waNumber(phone) {
  const d = String(phone || '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.startsWith('254')) return d;
  if (d.startsWith('0')) return `254${d.slice(1)}`;
  return d.length <= 9 ? `254${d}` : d;
}

export function priceText(s) {
  if (s.price == null) return s.kind === 'sale' ? 'Price on request' : 'Ask for rates';
  const n = `KES ${Number(s.price).toLocaleString()}`;
  return s.kind === 'sale' ? n : `${n} / ${s.price_unit === 'month' ? 'month' : 'night'}`;
}

export default function SpecialCard({ s }) {
  const [i, setI] = useState(0);
  const photos = s.photos || [];
  const hasPin = s.lat != null && s.lng != null;
  const dest = hasPin ? `${s.lat},${s.lng}` : encodeURIComponent([s.title, s.location].filter(Boolean).join(', '));
  const wa = waNumber(s.contact_phone);
  const msg = `Hi, I'm interested in "${s.title}"${s.location ? ` (${s.location})` : ''}. Is it still available?`;
  const pill = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 99, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#1a1a2e', fontSize: 12, fontWeight: 700, textDecoration: 'none' };
  const arrow = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.45)', color: '#fff', cursor: 'pointer', fontSize: 16 };
  return (
    <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ position: 'relative', background: '#111', aspectRatio: '4/3' }}>
        {photos.length
          ? <img src={`${API}/specials/photo/${photos[i]}`} alt={s.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#6b7280', fontSize: 40 }}>{s.kind === 'sale' ? '🏡' : '🏖️'}</div>}
        <span style={{ position: 'absolute', top: 10, left: 10, background: s.kind === 'sale' ? '#dbeafe' : '#fef3c7', color: s.kind === 'sale' ? '#1d4ed8' : '#b45309', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99 }}>
          {s.kind === 'sale' ? 'For Sale' : 'Stay'}
        </span>
        {photos.length > 1 && <>
          <button aria-label="Previous photo" style={{ ...arrow, left: 8 }} onClick={() => setI((i + photos.length - 1) % photos.length)}>‹</button>
          <button aria-label="Next photo" style={{ ...arrow, right: 8 }} onClick={() => setI((i + 1) % photos.length)}>›</button>
          <span style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 11, color: '#fff', background: 'rgba(0,0,0,.5)', padding: '2px 8px', borderRadius: 99 }}>{i + 1}/{photos.length}</span>
        </>}
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 17, color: '#1a1a2e' }}>{s.title}</div>
        {s.location && <div style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 8px' }}>📍 {s.location}</div>}
        <div style={{ fontWeight: 800, fontSize: 19, color: '#1a1a2e', marginBottom: 6 }}>{priceText(s)}</div>
        {(s.bedrooms != null || s.bathrooms != null) && (
          <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 6 }}>
            {s.bedrooms != null && <span>🛏 {s.bedrooms} bed </span>}{s.bathrooms != null && <span>🛁 {s.bathrooms} bath</span>}
          </div>
        )}
        {s.description && <p style={{ fontSize: 13.5, color: '#4b5563', lineHeight: 1.5, margin: '6px 0 12px', whiteSpace: 'pre-line' }}>{s.description}</p>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(s.location || hasPin) && <a href={`https://www.google.com/maps/dir/?api=1&destination=${dest}`} target="_blank" rel="noopener noreferrer" style={pill}>🧭 Get directions</a>}
          {hasPin && <a href={`https://waze.com/ul?ll=${s.lat},${s.lng}&navigate=yes`} target="_blank" rel="noopener noreferrer" style={pill}>Waze</a>}
          {wa && <a href={`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" style={{ ...pill, background: '#dcfce7', borderColor: '#bbf7d0', color: '#15803d' }}>💬 WhatsApp</a>}
          {s.contact_phone && <a href={`tel:${s.contact_phone.replace(/\s/g, '')}`} style={pill}>📞 Call</a>}
        </div>
      </div>
    </div>
  );
}
