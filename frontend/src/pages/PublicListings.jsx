import { useState, useEffect } from 'react';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const BASE = process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:5000';

const TYPES = {
  'Bedsitter':      { label: 'Bedsitter',    icon: '🛏️' },
  'Single Room':    { label: 'Single Room',  icon: '🛏️' },
  '1 Bedroom':      { label: '1 Bedroom',    icon: '🛋️' },
  '2 Bedroom':      { label: '2 Bedroom',    icon: '🛋️🛋️' },
  '3 Bedroom':      { label: '3 Bedroom',    icon: '🏠' },
  'Studio':         { label: 'Studio',       icon: '🏙️' },
  'Shop':           { label: 'Shop/Commercial', icon: '🏪' },
};

export default function PublicListings() {
  const [listings, setListings] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [filter,   setFilter]   = useState('all');

  useEffect(() => {
    fetch(`${API}/listings`)
      .then(r => r.json())
      .then(d => { setListings(d.data || []); setLoading(false); })
      .catch(() => { setError('Failed to load listings.'); setLoading(false); });
  }, []);

  // Collect all unit types across listings for filter
  const allTypes = [...new Set(listings.flatMap(l => l.units.map(u => u.house_type)))].sort();

  // Flatten plots → one entry per vacant unit, each carrying its parent plot's info
  const allUnits = listings.flatMap(plot =>
    plot.units.map(unit => ({ unit, plot }))
  );

  const filtered = filter === 'all'
    ? allUnits
    : allUnits.filter(({ unit }) => unit.house_type === filter);

  return (
    <div style={{ minHeight: '100vh', background: '#f5f0e8', fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>

      {/* ── Header ── */}
      <header style={{ background: '#1a1a2e', padding: '0 24px', position: 'sticky', top: 0, zIndex: 50, boxShadow: '0 2px 12px rgba(0,0,0,0.25)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>🏠</span>
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 20, color: '#fff', letterSpacing: '-0.5px' }}>RentFlow</span>
            <span style={{ background: '#e8a838', color: '#1a1a2e', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, marginLeft: 4, letterSpacing: '0.5px' }}>LISTINGS</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ color: '#9ca3af', fontSize: 13 }}>
              {allUnits.length} vacant unit{allUnits.length !== 1 ? 's' : ''} available
            </div>
            <a href="/login" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: '#e8a838', color: '#1a1a2e', textDecoration: 'none',
              fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 8,
            }}>
              🔑 Staff Login
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <div style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)', padding: '56px 24px 48px', textAlign: 'center' }}>
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#e8a838', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: 16 }}>Available Now</p>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 'clamp(28px, 5vw, 46px)', fontWeight: 800, color: '#fff', lineHeight: 1.15, marginBottom: 16, letterSpacing: '-1px' }}>
            Find Your Next Home
          </h1>
          <p style={{ color: '#9ca3af', fontSize: 16, lineHeight: 1.6, marginBottom: 32 }}>
            Browse verified vacant units — bedsitters, apartments, and commercial spaces across our managed properties.
          </p>

          {/* Type filter pills */}
          {allTypes.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              <FilterPill label="All Units" active={filter === 'all'} onClick={() => setFilter('all')} />
              {allTypes.map(t => (
                <FilterPill key={t} label={t} active={filter === t} onClick={() => setFilter(t)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Main Content ── */}
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px 80px' }}>

        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#6b7280' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            Loading available properties...
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#ef4444' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#6b7280' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏚️</div>
            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 22, color: '#374151', marginBottom: 8 }}>No vacancies right now</h2>
            <p style={{ fontSize: 15 }}>Check back soon — new units become available regularly.</p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 24 }}>
            {filtered.map(({ unit, plot }) => (
              <ListingCard key={unit.id} unit={unit} plot={plot} BASE={BASE} />
            ))}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer style={{ background: '#1a1a2e', padding: '32px 24px', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
        <p style={{ marginBottom: 4 }}>© {new Date().getFullYear()} RentFlow — Managed Properties</p>
        <p>All listings are verified and managed by our property team.</p>
      </footer>
    </div>
  );
}

// ── WhatsApp helpers ─────────────────────────────────────────────────────────
function toWhatsAppNumber(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0'))   return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  return digits;
}

function buildWhatsAppLink(phone, unit, plot) {
  const number = toWhatsAppNumber(phone);
  if (!number) return null;
  const message = `Hi, I'm interested in the ${unit.house_type} at ${plot.name}${plot.location ? ` (${plot.location})` : ''} listed at KES ${parseFloat(unit.rent_amount).toLocaleString()}/mo. Is it still available?`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

// ── Listing Card (one per vacant unit) ──────────────────────────────────────────
function ListingCard({ unit, plot, BASE }) {
  const [idx, setIdx] = useState(0);
  const media = unit.media || [];
  const photos = media.filter(m => m.media_type === 'photo');
  const videos = media.filter(m => m.media_type === 'video');

  const openFullSize = () => {
    const item = media[idx];
    if (item) window.open(`${BASE}${item.url}`, '_blank', 'noopener');
  };

  return (
    <div style={{
      background: '#fff', borderRadius: 16, overflow: 'hidden',
      border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      transition: 'box-shadow 0.2s, border-color 0.2s',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 28px rgba(0,0,0,0.12)'; e.currentTarget.style.borderColor = '#e8a838'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
    >
      {/* ── Media ── */}
      <div style={{ position: 'relative', background: '#111', aspectRatio: '4/3' }}>
        <MediaSlide item={media[idx]} BASE={BASE} />

        <span style={{
          position: 'absolute', top: 10, left: 10,
          background: '#dcfce7', color: '#16a34a', fontSize: 11, fontWeight: 700,
          padding: '4px 10px', borderRadius: 99,
        }}>
          Available Now
        </span>

        {media.length > 0 && (
          <button onClick={openFullSize} title="View full size" style={{
            position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)',
            color: '#fff', fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            🔍
          </button>
        )}

        {media.length > 1 && (
          <>
            <button onClick={() => setIdx(i => (i - 1 + media.length) % media.length)} style={arrowBtn('left')}>‹</button>
            <button onClick={() => setIdx(i => (i + 1) % media.length)} style={arrowBtn('right')}>›</button>
            <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4 }}>
              {media.map((_, i) => <div key={i} onClick={() => setIdx(i)} style={{ width: i === idx ? 14 : 5, height: 5, borderRadius: 99, background: i === idx ? '#e8a838' : 'rgba(255,255,255,0.5)', cursor: 'pointer' }} />)}
            </div>
          </>
        )}

        <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', gap: 6 }}>
          {photos.length > 0 && <MediaBadge icon="📷" count={photos.length} />}
          {videos.length > 0 && <MediaBadge icon="🎬" count={videos.length} />}
        </div>
      </div>

      {/* ── Info ── */}
      <div style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 15 }}>{TYPES[unit.house_type]?.icon || '🏠'}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', letterSpacing: '0.2px' }}>{unit.house_type}</span>
        </div>

        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 16, color: '#111827', lineHeight: 1.25, margin: '0 0 6px' }}>
          {unit.house_type} at {plot.name}
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
          <span>📍</span>
          <span>{plot.location || 'Location not specified'}</span>
        </div>

        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 19, color: '#1a1a2e' }}>
          KES {parseFloat(unit.rent_amount).toLocaleString()}
          <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}> /mo</span>
        </div>
        {unit.deposit > 0 && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Deposit: KES {parseFloat(unit.deposit).toLocaleString()}</div>}

        {unit.description && (
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 10, lineHeight: 1.5, borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>{unit.description}</p>
        )}

        {plot.landlord_phone && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 10, marginTop: 14 }}>
            <a
              href={`tel:${plot.landlord_phone}`}
              title="Call"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 40, height: 40, borderRadius: '50%',
                background: '#1a1a2e',
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
                <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.61 21 3 13.39 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z"/>
              </svg>
            </a>
            <a
              href={buildWhatsAppLink(plot.landlord_phone, unit, plot)}
              target="_blank"
              rel="noopener noreferrer"
              title="Enquire on WhatsApp"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 40, height: 40, borderRadius: '50%',
                background: '#25D366',
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.472-.148-.67.15-.198.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12.001 2C6.478 2 2 6.477 2 12c0 1.876.51 3.633 1.397 5.144L2 22l4.982-1.362A9.953 9.953 0 0012.001 22c5.523 0 10-4.477 10-10s-4.477-10-10-10zm0 18.2a8.176 8.176 0 01-4.166-1.14l-.299-.177-3.096.847.83-3.024-.195-.31A8.18 8.18 0 013.8 12c0-4.526 3.674-8.2 8.201-8.2 4.526 0 8.2 3.674 8.2 8.2 0 4.526-3.674 8.2-8.2 8.2z"/>
              </svg>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Media Slide ───────────────────────────────────────────────────────────────
function MediaSlide({ item, BASE }) {
  if (!item) return <div style={{ width: '100%', height: '100%', background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 13 }}>No media</div>;
  const src = `${BASE}${item.url}`;
  if (item.media_type === 'video') {
    return (
      <video key={src} src={src} controls style={{ width: '100%', height: '100%', minHeight: 260, objectFit: 'cover', display: 'block' }} />
    );
  }
  return (
    <img src={src} alt="Property" style={{ width: '100%', height: '100%', minHeight: 260, objectFit: 'cover', display: 'block' }} />
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function FilterPill({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 16px', borderRadius: 99,
      border: active ? '2px solid #e8a838' : '2px solid rgba(255,255,255,0.15)',
      background: active ? '#e8a838' : 'rgba(255,255,255,0.07)',
      color: active ? '#1a1a2e' : '#e5e7eb',
      fontWeight: active ? 700 : 500, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
    }}>
      {label}
    </button>
  );
}

function MediaBadge({ icon, count }) {
  return (
    <span style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
      {icon} {count}
    </span>
  );
}

function arrowBtn(side) {
  return {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
    [side]: 10,
    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
    color: '#fff', border: 'none', borderRadius: '50%',
    width: 34, height: 34, fontSize: 20, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1, zIndex: 2,
  };
}
