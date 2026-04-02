import { useState, useEffect } from 'react';

const API = 'http://localhost:5000/api';

export default function PublicListings() {
  const [listings, setListings] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');

  useEffect(() => {
    fetch(`${API}/listings`)
      .then(r => r.json())
      .then(d => setListings(d.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = listings.filter(l =>
    l.plot_name?.toLowerCase().includes(search.toLowerCase()) ||
    l.plot_location?.toLowerCase().includes(search.toLowerCase()) ||
    l.house_type?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #f0f2f7 0%, #e8eaf6 100%)' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #0f1623, #1e1b4b)', padding: '60px 20px 80px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🏠</div>
        <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 800, color: '#fff', marginBottom: 12 }}>
          Available Rentals
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16, marginBottom: 32, maxWidth: 500, margin: '0 auto 32px' }}>
          Find your next home. All units are verified and ready to move in.
        </p>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by location, type..."
          style={{ padding: '14px 20px', borderRadius: 12, border: 'none', fontSize: 15, width: '100%', maxWidth: 420, outline: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}
        />
      </div>

      {/* Listings */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>Loading listings...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>No vacancies at the moment. Check back soon!</div>
        ) : (
          <>
            <p style={{ color: 'var(--muted)', marginBottom: 20, fontSize: 14 }}>{filtered.length} unit{filtered.length !== 1 ? 's' : ''} available</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
              {filtered.map(l => (
                <div key={l.id} style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid var(--border)', overflow: 'hidden', transition: 'transform 0.15s', cursor: 'default' }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-3px)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
                  {/* Card header */}
                  <div style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)', padding: '24px 20px', position: 'relative' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>
                      {l.house_type?.includes('Shop') ? '🏪' : l.house_type?.includes('Studio') ? '🛋️' : '🏠'}
                    </div>
                    <div style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 20, color: '#fff' }}>
                      KES {parseFloat(l.rent_amount).toLocaleString()}<span style={{ fontSize: 13, fontWeight: 400, opacity: 0.7 }}>/mo</span>
                    </div>
                    <div style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', color: '#fff', padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                      {l.house_type}
                    </div>
                  </div>
                  {/* Card body */}
                  <div style={{ padding: '18px 20px' }}>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{l.plot_name} — Unit {l.unit_number}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>📍 {l.plot_location || 'Location not specified'}</div>
                    {l.plot_description && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>{l.plot_description}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Deposit: <strong style={{ color: 'var(--text)' }}>KES {parseFloat(l.deposit || 0).toLocaleString()}</strong></div>
                      <span style={{ background: 'var(--green-light)', color: 'var(--green)', padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>Available</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)', fontSize: 13 }}>
        Powered by RentFlow
      </div>
    </div>
  );
}
