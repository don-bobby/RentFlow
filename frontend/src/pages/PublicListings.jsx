// frontend/src/pages/PublicListings.jsx
// Public vacant-units portal. No login needed.
// Needs only: react + your existing services/api.js (axios instance).
import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';

/* ---------- helpers ---------- */
const ORIGIN = (process.env.REACT_APP_API_URL || '').replace(/\/api\/?$/, '');
const img = (u) => (!u ? null : /^(https?:|data:)/.test(u) ? u : ORIGIN + (u.startsWith('/') ? u : '/' + u));
const kes = (n) => (n || n === 0 ? 'KSh ' + Number(n).toLocaleString('en-KE') : '');
const toWa = (p) => {                       // 0712… / 712… / +254712… -> 254712…
  const d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('254')) return d;
  if (d.startsWith('0')) return '254' + d.slice(1);
  return d.length === 9 ? '254' + d : d;
};
const PAGE = 12;
const isFuture = (d) => !!d && new Date(d + 'T00:00:00') > new Date();
const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
// who the visitor is talking to, as shown on the contact buttons
const ROLE = { agent: 'agent', caretaker: 'caretaker', landlord: 'owner', admin: 'RentFlow' };
const unitUrl = (u) => `${window.location.origin}${window.location.pathname}#unit-${u.id}`;
function closeNav(setOpen) {          // Back button / Esc / X all end up here
  if (window.history.state && window.history.state.pl) window.history.back();   // popstate then closes it
  else { setOpen(null); window.history.replaceState(null, '', window.location.pathname + window.location.search); }
}
const clearHash = () => window.history.replaceState(null, '', window.location.pathname + window.location.search);
function shareUnit(u) {
  const text = `${u.title}${u.area ? ' in ' + u.area : ''}, ${kes(u.rent)} per month.`;
  const url = unitUrl(u);
  if (navigator.share) navigator.share({ title: u.title, text, url }).catch(() => {});
  else window.open('https://wa.me/?text=' + encodeURIComponent(text + ' See it here: ' + url), '_blank', 'noopener');
}
const daysAgo = (d) => (d ? (Date.now() - new Date(d).getTime()) / 864e5 : Infinity);

// Finds the list of units whatever shape the API returns:
// [..]  |  {listings:[..]}  |  {plots:[{houses:[..]}]}  | etc.
function extractRows(d) {
  let rows = [];
  if (Array.isArray(d)) rows = d;
  else if (d && typeof d === 'object') {
    const k = ['listings', 'units', 'houses', 'vacant', 'data', 'results', 'plots']
      .find((x) => Array.isArray(d[x]));
    rows = k ? d[k] : Object.values(d).find(Array.isArray) || [];
  }
  return rows.flatMap((r) => {                 // plots that hold their own houses
    const kids = r.houses || r.units;
    return Array.isArray(kids)
      ? kids.map((h) => ({ ...r, ...h, plot_name: h.plot_name || r.plot_name || r.name, area: h.area || r.area || r.location || r.address, description: h.description || r.description }))
      : [r];
  });
}
const isVacant = (r) => {
  const st = String(r.status ?? r.unit_status ?? '').toLowerCase();
  if (st) return ['vacant', 'available'].includes(st);
  return !(r.is_occupied === true || r.occupied === true);
};

// Adjust the field names here if your /api/listings response differs.
function normalize(r, idx) {
  const rawTags = r.tags ?? r.amenities ?? r.features;
  const ownTags = Array.isArray(rawTags) ? rawTags.map((t) => (typeof t === 'string' ? t : t.name || t.label)).filter(Boolean)
    : typeof rawTags === 'string' ? rawTags.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const rawMedia = r.photos || r.media || r.images
    || [r.cover_photo, r.photo, r.photo_url, r.image_url, r.image].filter(Boolean);
  const media = rawMedia.map((m) => ({
    type: typeof m !== 'string' && m.media_type === 'video' ? 'video' : 'photo',
    url: img(typeof m === 'string' ? m : m.url || m.file_path || m.path),
  })).filter((m) => m.url);
  const photos = media.filter((m) => m.type === 'photo').map((m) => m.url);   // cards show photos only
  // only tags that staff entered themselves (furnishing/water/electricity are not set by any screen yet)
  const tags = [...new Set(ownTags.filter(Boolean))];
  return {
    id: r.id ?? r.house_id ?? idx,
    title: r.title || [r.plot_name || r.plot, r.unit_number || r.house_number || r.unit].filter(Boolean).join(' · ') || 'Vacant unit',
    plot: r.plot_name || r.plot || '',
    area: r.area || r.location || r.address || '',
    type: r.type || r.unit_type || r.house_type || r.category || '',
    rent: Number(r.rent ?? r.rent_amount ?? r.monthly_rent ?? r.price) || 0,
    oldRent: Number(r.previous_rent) || 0,
    deposit: Number(r.deposit ?? r.deposit_amount) || 0,
    desc: r.description || '',
    tags, photos, media,
    availableFrom: r.available_from || null,
    changedAt: r.status_changed_at || r.created_at,
    lat: Number(r.lat) || null, lng: Number(r.lng) || null,
    // Only the contact chosen by the backend is used (agent > caretaker > landlord > admin).
    // The landlord's own number is never used here on purpose.
    phone: r.contact_phone || '',
    role: r.contact_role || '',
  };
}

/* ---------- component ---------- */
export default function PublicListings() {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('loading');   // loading | ok | error
  const [info, setInfo] = useState('');
  const [hasHero, setHasHero] = useState(false);   // true when /images/hero.jpg exists
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [type, setType] = useState('');
  const [maxRent, setMaxRent] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('new');
  const [open, setOpen] = useState(null);
  const [limit, setLimit] = useState(PAGE);

  const load = () => {
    setState('loading');
    api.get('/listings')
      .then((r) => {
        const all = extractRows(r.data);
        const rows = all.filter(isVacant);
        if (process.env.NODE_ENV !== 'production') console.log('[PublicListings] raw response:', r.data);
        setInfo(`Received ${all.length} record(s), ${rows.length} look vacant.`);
        setItems(rows.map(normalize)); setState('ok');
      })
      .catch((e) => {
        setInfo(e.response ? `Server answered ${e.response.status}` : 'Could not reach the backend (is it running on port 5000?)');
        setState('error');
      });
  };
  useEffect(load, []);

  useEffect(() => {                              // is there a hero.jpg in public/images?
    const im = new Image();
    im.onload = () => setHasHero(true);
    im.src = '/images/hero.jpg';
  }, []);

  useEffect(() => {                              // Esc closes the detail panel
    const k = (e) => { if (e.key === 'Escape') closeNav(setOpen); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  // open a unit straight from a shared link like  /#unit-12
  useEffect(() => {
    const m = window.location.hash.match(/^#unit-(.+)$/);
    if (m && items.length) {
      const found = items.find((i) => String(i.id) === decodeURIComponent(m[1]));
      if (found) setOpen(found);
    }
  }, [items]);
  const openUnit = (u) => { setOpen(u); window.history.pushState({ pl: 1 }, '', '#unit-' + u.id); };
  const closeUnit = () => closeNav(setOpen);

  useEffect(() => {                              // phone Back / Forward buttons
    const pop = () => {
      const m = window.location.hash.match(/^#unit-(.+)$/);
      const found = m && items.find((i) => String(i.id) === decodeURIComponent(m[1]));
      setOpen(found || null);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [items]);

  useEffect(() => {                              // page behind stays still while a unit is open
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const areas = useMemo(() => [...new Set(items.map((i) => i.area).filter(Boolean))].sort(), [items]);
  const types = useMemo(() => [...new Set(items.map((i) => i.type).filter(Boolean))].sort(), [items]);
  const topTags = useMemo(() => {
    const c = {}; items.forEach((i) => i.tags.forEach((t) => (c[t] = (c[t] || 0) + 1)));
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  }, [items]);
  const rents = [5000, 8000, 12000, 20000, 35000, 60000];

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = items.filter((i) =>
      (!s || (i.title + i.area + i.plot + i.type + i.tags.join(' ')).toLowerCase().includes(s)) &&
      (!area || i.area === area) && (!type || i.type === type) &&
      (!maxRent || (i.rent && i.rent <= +maxRent)) && (!tag || i.tags.includes(tag)));
    if (sort === 'low') out.sort((a, b) => a.rent - b.rent);
    else if (sort === 'high') out.sort((a, b) => b.rent - a.rent);
    else out.sort((a, b) => daysAgo(a.changedAt) - daysAgo(b.changedAt));
    return out;
  }, [items, q, area, type, maxRent, tag, sort]);

  // hero.jpg wins when it exists; otherwise a real listing photo; otherwise the drawn buildings
  const heroImg = hasHero ? null : items.find((i) => i.photos[0])?.photos[0];
  useEffect(() => setLimit(PAGE), [q, area, type, maxRent, tag, sort]);
  const clear = () => { setQ(''); setArea(''); setType(''); setMaxRent(''); setTag(''); };
  const filtered = q || area || type || maxRent || tag;

  return (
    <div className="pl">
      <style>{CSS}</style>

      <header className="pl-top">
        <a className="pl-brand" href="/">RentFlow</a>
        <nav>
          <a href="/tenant-login">Tenant login</a>
          <a className="pl-btn pl-btn-dark" href="/login">Staff login</a>
        </nav>
      </header>

      <section className={'pl-hero' + (heroImg || hasHero ? ' has-img' : '')} style={{ '--hero': heroImg ? `url("${heroImg}")` : 'none' }}>
        <h1>Vacant homes from the people who manage them</h1>
        <p>Real rent, real photos, and a direct line to the property manager.</p>
        <label className="pl-search">
          <span className="pl-sr">Search listings</span>
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Try: bedsitter in Kasarani, or water 24/7" />
        </label>
        {state === 'ok' && (
          <p className="pl-count">{items.length} vacant {items.length === 1 ? 'unit' : 'units'}
            {areas.length > 0 && ` across ${areas.length} ${areas.length === 1 ? 'area' : 'areas'}`}</p>
        )}
      </section>

      <div className="pl-filters" role="search">
        <div className="pl-row">
          <select aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}
          </select>
          <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>{types.map((a) => <option key={a}>{a}</option>)}
          </select>
          <select aria-label="Maximum rent" value={maxRent} onChange={(e) => setMaxRent(e.target.value)}>
            <option value="">Any rent</option>
            {rents.map((r) => <option key={r} value={r}>Up to {kes(r)}</option>)}
          </select>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="new">Newest first</option>
            <option value="low">Rent: low to high</option>
            <option value="high">Rent: high to low</option>
          </select>
        </div>
        {topTags.length > 0 && (
          <div className="pl-chips">
            {topTags.map((t) => (
              <button key={t} className={'pl-chip' + (tag === t ? ' on' : '')} aria-pressed={tag === t}
                      onClick={() => setTag(tag === t ? '' : t)}>{t}</button>
            ))}
          </div>
        )}
      </div>

      <main className="pl-main">
        {state === 'loading' && (
          <div className="pl-grid" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="pl-card pl-skel" />)}
          </div>
        )}
        {state === 'error' && (
          <div className="pl-empty">
            <h2>Listings did not load</h2>
            <p>Check your connection, then try again.</p>
            {process.env.NODE_ENV !== 'production' && <p className="pl-dev">{info}</p>}
            <button className="pl-btn pl-btn-dark" onClick={load}>Try again</button>
          </div>
        )}
        {state === 'ok' && shown.length === 0 && (
          <div className="pl-empty">
            <h2>{filtered ? 'No units match these filters' : 'No vacant units right now'}</h2>
            <p>{filtered ? 'Widen the rent limit or pick another area.' : 'New units appear here as soon as they are free.'}</p>
            {process.env.NODE_ENV !== 'production' && <p className="pl-dev">{info} Open the browser console (F12) to see the raw response.</p>}
            {filtered && <button className="pl-btn pl-btn-dark" onClick={clear}>Clear filters</button>}
          </div>
        )}
        {state === 'ok' && shown.length > 0 && (
          <>
            <div className="pl-grid">
              {shown.slice(0, limit).map((u) => <Card key={u.id} u={u} onOpen={() => openUnit(u)} />)}
            </div>
            <div className="pl-more">
              <p>Showing {Math.min(limit, shown.length)} of {shown.length}</p>
              {limit < shown.length && (
                <button className="pl-btn pl-btn-line" onClick={() => setLimit(limit + PAGE)}>
                  Show {Math.min(PAGE, shown.length - limit)} more
                </button>
              )}
            </div>
          </>
        )}
      </main>

      <section className="pl-how">
       <div className="pl-how-in">
        <h2>How it works</h2>
        <ol>
          <li><b>Pick a unit.</b> Filter by area and rent, then open the ones you like.</li>
          <li><b>Message the property manager.</b> One tap opens WhatsApp with the unit already named.</li>
          <li><b>View it and move in.</b> Agree a viewing time, then pay rent through your tenant portal.</li>
        </ol>
       </div>
      </section>

      <footer className="pl-foot">
        <span>RentFlow · Rental management for Kenya</span>
        <a href="/register">Own property? List with us</a>
      </footer>

      {open && <Detail u={open} onClose={closeUnit} />}
    </div>
  );
}

/* ---------- pieces ---------- */
function Card({ u, onOpen }) {
  const [bad, setBad] = useState({});              // photos that failed to load
  const [cur, setCur] = useState(0);                // photo shown now
  const track = useRef(null);
  const pics = u.photos.filter((p) => !bad[p]);
  const go = (e, d) => { e.stopPropagation(); const el = track.current; if (el) el.scrollBy({ left: d * el.clientWidth, behavior: 'smooth' }); };
  const isNew = daysAgo(u.changedAt) <= 14;
  const reduced = u.oldRent > u.rent && u.rent > 0;
  return (
    <article className="pl-card">
      <div className="pl-photo" onClick={onOpen}>
        {pics.length ? (
          <div className="pl-track" ref={track}
               onScroll={(e) => setCur(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
            {pics.map((src, k) => (
              <img key={src} src={src} alt={`${u.title}, photo ${k + 1}`} loading="lazy"
                   onError={() => { setBad((b) => ({ ...b, [src]: true })); if (process.env.NODE_ENV !== 'production') console.warn('[PublicListings] photo failed to load:', src); }} />
            ))}
          </div>
        ) : <span className="pl-noimg">{u.title.slice(0, 1)}</span>}
        <span className="pl-badges">
          {isNew && <i className="pl-b new">New</i>}
          {reduced && <i className="pl-b cut">Reduced</i>}
        </span>
        {u.media.some((m) => m.type === 'video') && <span className="pl-vid">▶ Video</span>}
        {pics.length > 1 && (
          <>
            <button className="pl-arr l" aria-label="Previous photo" onClick={(e) => go(e, -1)}>‹</button>
            <button className="pl-arr r" aria-label="Next photo" onClick={(e) => go(e, 1)}>›</button>
            <span className="pl-dots" aria-hidden="true">
              {pics.slice(0, 8).map((_, k) => <i key={k} className={k === cur ? 'on' : ''} />)}
            </span>
          </>
        )}
      </div>
      <div className="pl-body">
        <p className="pl-price">{kes(u.rent) || 'Ask for price'}<small> / month</small>
          {reduced && <s>{kes(u.oldRent)}</s>}</p>
        {u.rent > 0 && u.deposit > 0 && <p className="pl-move">Move in with {kes(u.rent + u.deposit)}</p>}
        <h3>{u.title}</h3>
        <p className="pl-meta">{[u.type, u.area].filter(Boolean).join(' in ')}</p>
        {isFuture(u.availableFrom)
          ? <p className="pl-since">Available from {fmtDay(u.availableFrom)}</p>
          : daysAgo(u.changedAt) <= 60 && (
            <p className="pl-since">{daysAgo(u.changedAt) < 1 ? 'Vacant since today' : `Vacant for ${Math.floor(daysAgo(u.changedAt))} day${Math.floor(daysAgo(u.changedAt)) === 1 ? '' : 's'}`}</p>
          )}
        {u.tags.length > 0 && (
          <ul className="pl-tags">
            {u.tags.slice(0, 4).map((t) => <li key={t}>{t}</li>)}
            {u.tags.length > 4 && <li>+{u.tags.length - 4}</li>}
          </ul>
        )}
        <div className="pl-actions">
          <button className="pl-btn pl-btn-dark" onClick={onOpen}>View details</button>
          <button className="pl-btn pl-btn-line" onClick={() => shareUnit(u)} aria-label={`Share ${u.title}`}>Share</button>
        </div>
      </div>
    </article>
  );
}

function Detail({ u, onClose }) {
  const [i, setI] = useState(0);
  const sheet = useRef(null);
  const cur = u.media[i];
  const trap = (e) => {                          // keep Tab inside the open panel
    if (e.key !== 'Tab' || !sheet.current) return;
    const f = sheet.current.querySelectorAll('a[href],button:not([disabled]),video[controls]');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const wa = toWa(u.phone);
  const msg = encodeURIComponent(`Hello, I saw ${u.title}${u.area ? ' (' + u.area + ')' : ''} on RentFlow. Is it still available?`);
  return (
    <div className="pl-modal" role="dialog" aria-modal="true" aria-label={u.title} onClick={onClose}>
      <div className="pl-sheet" ref={sheet} onKeyDown={trap} onClick={(e) => e.stopPropagation()}>
        <button className="pl-x" onClick={onClose} autoFocus aria-label="Close">×</button>
        <div className="pl-gal">
          {!cur ? <span className="pl-noimg">{u.title.slice(0, 1)}</span>
            : cur.type === 'video'
              ? <video key={cur.url} src={cur.url} controls playsInline preload="metadata" />
              : <img src={cur.url} alt={`${u.title}, photo ${i + 1}`} />}
          {u.media.length > 1 && (
            <div className="pl-thumbs">
              {u.media.map((m, k) => (
                <button key={k} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={m.type === 'video' ? 'Video' : `Photo ${k + 1}`}>
                  {m.type === 'video' ? <span className="pl-play">▶</span> : <img src={m.url} alt="" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="pl-info">
          <h2>{u.title}</h2>
          <p className="pl-meta">{[u.type, u.area].filter(Boolean).join(' in ')}</p>
          <p className="pl-price big">{kes(u.rent) || 'Ask for price'}<small> / month</small></p>
          {isFuture(u.availableFrom) && <p className="pl-meta">Available from {fmtDay(u.availableFrom)}</p>}
          {u.rent > 0 && u.deposit > 0 && (
            <div className="pl-movebox">
              <b>Move in with {kes(u.rent + u.deposit)}</b>
              <span>First month {kes(u.rent)} + deposit {kes(u.deposit)}</span>
            </div>
          )}
          {u.desc && <p className="pl-desc">{u.desc}</p>}
          {u.tags.length > 0 && <ul className="pl-tags">{u.tags.map((t) => <li key={t}>{t}</li>)}</ul>}
          {u.lat && u.lng && (
            <p className="pl-meta"><a href={`https://www.google.com/maps?q=${u.lat},${u.lng}`} target="_blank" rel="noreferrer">View location on Google Maps</a></p>
          )}
          {wa && ROLE[u.role] && <p className="pl-contact">Contact {ROLE[u.role]}</p>}
          {wa ? (
            <div className="pl-cta">
              <a className="pl-btn pl-btn-green" target="_blank" rel="noreferrer"
                 href={`https://wa.me/${wa}?text=${msg}`}>Message on WhatsApp</a>
              <a className="pl-btn pl-btn-line" href={`tel:+${wa}`}>Call</a>
              <button className="pl-btn pl-btn-line" onClick={() => shareUnit(u)}>Share</button>
            </div>
          ) : (
            <div className="pl-cta">
              <p className="pl-meta">Contact details for this unit are not available yet.</p>
              <button className="pl-btn pl-btn-line" onClick={() => shareUnit(u)}>Share</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- styles (scoped under .pl) ---------- */
const ART = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 520'%3E%3Crect x='10' y='220' width='110' height='300' fill='%23155f43'/%3E%3Crect x='20' y='234' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='42' y='234' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='64' y='234' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='86' y='234' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='20' y='264' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='42' y='264' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='64' y='264' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='86' y='264' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='20' y='294' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='42' y='294' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='64' y='294' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='86' y='294' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='20' y='324' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='42' y='324' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='64' y='324' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='86' y='324' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='20' y='354' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='42' y='354' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='64' y='354' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='86' y='354' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='20' y='384' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='42' y='384' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='64' y='384' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='86' y='384' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='20' y='414' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='42' y='414' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='64' y='414' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='86' y='414' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='20' y='444' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='42' y='444' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='64' y='444' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='86' y='444' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='20' y='474' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='42' y='474' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='64' y='474' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='86' y='474' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='130' y='120' width='90' height='400' fill='%231a6b4c'/%3E%3Crect x='140' y='134' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='162' y='134' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='184' y='134' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='140' y='164' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='162' y='164' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='184' y='164' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='140' y='194' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='162' y='194' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='184' y='194' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='140' y='224' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='162' y='224' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='184' y='224' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='140' y='254' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='162' y='254' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='184' y='254' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='140' y='284' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='162' y='284' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='184' y='284' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='140' y='314' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='162' y='314' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='184' y='314' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='140' y='344' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='162' y='344' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='184' y='344' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='140' y='374' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='162' y='374' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='184' y='374' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='140' y='404' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='162' y='404' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='184' y='404' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='140' y='434' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='162' y='434' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='184' y='434' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='140' y='464' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='162' y='464' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='184' y='464' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='230' y='180' width='120' height='340' fill='%2312513a'/%3E%3Crect x='240' y='194' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='262' y='194' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='284' y='194' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='306' y='194' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='240' y='224' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='262' y='224' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='284' y='224' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='306' y='224' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='240' y='254' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='262' y='254' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='284' y='254' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='306' y='254' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='240' y='284' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='262' y='284' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='284' y='284' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='306' y='284' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='240' y='314' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='262' y='314' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='284' y='314' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='306' y='314' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='240' y='344' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='262' y='344' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='284' y='344' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='306' y='344' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='240' y='374' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='262' y='374' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='284' y='374' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='306' y='374' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='240' y='404' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='262' y='404' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='284' y='404' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='306' y='404' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='240' y='434' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='262' y='434' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='284' y='434' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='306' y='434' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='240' y='464' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='262' y='464' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='284' y='464' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='306' y='464' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='360' y='60' width='100' height='460' fill='%231a6b4c'/%3E%3Crect x='370' y='74' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='392' y='74' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='414' y='74' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='370' y='104' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='392' y='104' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='414' y='104' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='370' y='134' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='392' y='134' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='414' y='134' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='370' y='164' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='392' y='164' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='414' y='164' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='370' y='194' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='392' y='194' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='414' y='194' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='370' y='224' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='392' y='224' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='414' y='224' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='370' y='254' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='392' y='254' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='414' y='254' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='370' y='284' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='392' y='284' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='414' y='284' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='370' y='314' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='392' y='314' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='414' y='314' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='370' y='344' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='392' y='344' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='414' y='344' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='370' y='374' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='392' y='374' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='414' y='374' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='370' y='404' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='392' y='404' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='414' y='404' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='370' y='434' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='392' y='434' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='414' y='434' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='370' y='464' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='392' y='464' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='414' y='464' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='470' y='160' width='150' height='360' fill='%23155f43'/%3E%3Crect x='480' y='174' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='502' y='174' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='524' y='174' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='546' y='174' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='568' y='174' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='590' y='174' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='480' y='204' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='502' y='204' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='524' y='204' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='546' y='204' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='568' y='204' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='590' y='204' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='480' y='234' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='502' y='234' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='524' y='234' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='546' y='234' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='568' y='234' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='590' y='234' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='480' y='264' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='502' y='264' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='524' y='264' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='546' y='264' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='568' y='264' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='590' y='264' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='480' y='294' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='502' y='294' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='524' y='294' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='546' y='294' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='568' y='294' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='590' y='294' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='480' y='324' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='502' y='324' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='524' y='324' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='546' y='324' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='568' y='324' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='590' y='324' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='480' y='354' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='502' y='354' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='524' y='354' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='546' y='354' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='568' y='354' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='590' y='354' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='480' y='384' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='502' y='384' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='524' y='384' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='546' y='384' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='568' y='384' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='590' y='384' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='480' y='414' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='502' y='414' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='524' y='414' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='546' y='414' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='568' y='414' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='590' y='414' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='480' y='444' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='502' y='444' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='524' y='444' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='546' y='444' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='568' y='444' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='590' y='444' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='480' y='474' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='502' y='474' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='524' y='474' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='546' y='474' width='12' height='16' rx='2' fill='%23f4b400' opacity='0.9'/%3E%3Crect x='568' y='474' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3Crect x='590' y='474' width='12' height='16' rx='2' fill='%23ffffff' opacity='0.1'/%3E%3C/svg%3E")`;
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700&family=DM+Sans:wght@400;500;700&display=swap');
.pl{--ink:#10231b;--mute:#5b6b63;--bg:#f2f5f1;--card:#fff;--line:#dfe6e0;--green:#0e5a3c;--wa:#128c4a;--sun:#f4b400;--red:#c8372d;
  font-family:'DM Sans',system-ui,sans-serif;color:var(--ink);background:var(--bg);min-height:100vh;line-height:1.5}
.pl *{box-sizing:border-box}
.pl h1,.pl h2,.pl h3,.pl .pl-price{font-family:'Bricolage Grotesque','DM Sans',system-ui,sans-serif;letter-spacing:-.01em}
.pl a:not(.pl-btn){color:inherit}
.pl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.pl-top{position:sticky;top:0;z-index:20;height:64px;display:flex;justify-content:space-between;align-items:center;padding:0 clamp(16px,4vw,48px);background:var(--card);border-bottom:1px solid var(--line)}
.pl-brand{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:22px;text-decoration:none;color:var(--green)}
.pl-top nav{display:flex;gap:18px;align-items:center;font-size:14px}
.pl-top nav a:not(.pl-btn){text-decoration:none}
.pl-hero{--art:${ART};color:#fff;padding:clamp(36px,7vw,84px) clamp(16px,4vw,48px) clamp(44px,6vw,72px);background-color:var(--green);
  /* top to bottom: building art (only when there is no photo), green tint, a real listing photo, optional /images/hero.jpg */
  background-image:var(--art),linear-gradient(105deg,rgba(7,45,31,.93) 25%,rgba(7,45,31,.55)),var(--hero),url('/images/hero.jpg');
  background-size:auto 92%,cover,cover,cover;background-position:right 6% bottom,center,center,center;background-repeat:no-repeat}
.pl-hero.has-img{--art:none}
@media(max-width:900px){.pl-hero,.pl-hero.has-img{--art:none}}
.pl-hero h1{font-size:clamp(30px,5.4vw,56px);line-height:1.05;max-width:16ch;margin:0 0 14px;font-weight:700}
.pl-hero p{margin:0 0 22px;max-width:48ch;color:#d3e6dc;font-size:18px}
.pl-search{display:block;max-width:640px}
.pl-search input{width:100%;padding:16px 18px;border-radius:12px;border:3px solid transparent;font:inherit;font-size:17px;background:#fff;color:var(--ink)}
.pl-search input:focus{outline:none;border-color:var(--sun)}
.pl .pl-count{margin:16px 0 0;font-size:15px;color:#bcd8ca}
.pl-filters{position:sticky;top:64px;z-index:10;background:var(--card);border-bottom:1px solid var(--line);padding:12px clamp(16px,4vw,48px)}
.pl-row{display:flex;flex-wrap:wrap;gap:10px}
.pl-row select{padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;font:inherit;font-size:14px;color:var(--ink);min-width:140px}
.pl-chips{display:flex;gap:8px;overflow-x:auto;padding:10px 0 2px;scrollbar-width:none}
.pl-chip{white-space:nowrap;padding:7px 14px;border-radius:99px;border:1px solid var(--line);background:#fff;font:inherit;font-size:14px;cursor:pointer;color:var(--ink)}
.pl-chip.on{background:var(--green);border-color:var(--green);color:#fff}
.pl-main{padding:28px clamp(16px,4vw,48px) 12px;max-width:1280px;margin:0 auto}
.pl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:22px}
.pl-card{background:var(--card);border-radius:14px;overflow:hidden;border:1px solid var(--line);display:flex;flex-direction:column}
.pl-skel{min-height:380px;background:linear-gradient(90deg,#e8eee9,#f6f9f6,#e8eee9);background-size:200% 100%;animation:pl-sh 1.4s infinite}
@keyframes pl-sh{to{background-position:-200% 0}}
.pl-photo{position:relative;display:block;width:100%;aspect-ratio:4/3;overflow:hidden;cursor:pointer;background:#dfe8e1}
.pl-track{display:flex;height:100%;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}
.pl-track::-webkit-scrollbar{display:none}
.pl-track img{flex:0 0 100%;width:100%;height:100%;object-fit:cover;display:block;scroll-snap-align:center}
.pl-arr{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.92);color:var(--ink);font-size:22px;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s;box-shadow:0 1px 5px rgba(0,0,0,.3)}
.pl-arr.l{left:8px}.pl-arr.r{right:8px}
.pl-photo:hover .pl-arr,.pl-arr:focus-visible{opacity:1}
@media(hover:none){.pl-arr{opacity:1}}
.pl-dots{position:absolute;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:5px;pointer-events:none}
.pl-dots i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.55)}.pl-dots i.on{background:#fff}
.pl-noimg{display:grid;place-items:center;width:100%;height:100%;font:700 64px 'Bricolage Grotesque',sans-serif;color:#9db5a7}
.pl-badges{position:absolute;top:12px;left:12px;display:flex;gap:6px}
.pl-b{font-style:normal;font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px}
.pl-b.new{background:var(--sun);color:#2b2100}.pl-b.cut{background:var(--red);color:#fff}
.pl-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:6px;flex:1}

.pl-price{margin:0;font-size:26px;font-weight:700;color:var(--green)}
.pl-price small{font:400 14px 'DM Sans',sans-serif;color:var(--mute)}
.pl-price s{font:400 14px 'DM Sans',sans-serif;color:var(--mute);margin-left:8px}
.pl-price.big{font-size:34px}
.pl-body h3{margin:0;font-size:19px}
.pl .pl-meta{margin:0;color:var(--mute);font-size:15px}
.pl-tags{list-style:none;margin:6px 0 10px;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.pl-tags li{font-size:13px;padding:3px 10px;border-radius:8px;background:#edf3ee;color:#2d4a3c}
.pl-actions{display:flex;gap:8px;margin-top:auto}.pl-actions .pl-btn-dark{flex:1}
.pl .pl-move{margin:0;font-size:14px;font-weight:700;color:var(--ink)}
.pl-movebox{display:flex;flex-direction:column;gap:2px;padding:12px 14px;margin:6px 0;border-radius:10px;background:#edf3ee;border-left:4px solid var(--green)}
.pl-movebox span{font-size:14px;color:var(--mute)}
.pl-more{text-align:center;padding:28px 0 8px}.pl-more p{margin:0 0 12px;color:var(--mute);font-size:14px}
.pl-btn{display:inline-block;text-align:center;padding:11px 18px;border-radius:10px;font:700 15px 'DM Sans',sans-serif;border:2px solid transparent;cursor:pointer;text-decoration:none}
.pl-btn-dark{background:var(--ink);color:#fff}.pl-btn-green{background:var(--wa);color:#fff}
.pl-btn-line{background:#fff;color:var(--ink);border-color:var(--ink)}
.pl-btn:focus-visible,.pl-chip:focus-visible,.pl-x:focus-visible,.pl select:focus-visible{outline:3px solid var(--sun);outline-offset:2px}
.pl-empty{text-align:center;padding:64px 16px}.pl-empty h2{margin:0 0 8px;font-size:26px}.pl-empty p{color:var(--mute);margin:0 0 18px}
.pl-how{margin-top:40px;color:#fff;background-color:var(--green);
  background-image:linear-gradient(rgba(7,45,31,.82),rgba(7,45,31,.9)),url('/images/how.jpg');background-size:cover;background-position:center}
.pl-how-in{max-width:1280px;margin:0 auto;padding:56px clamp(16px,4vw,48px)}
.pl-how h2{font-size:30px;margin:0 0 22px}
.pl-how ol{list-style:none;counter-reset:s;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px}
.pl-how li{counter-increment:s;padding:20px;border-radius:14px;background:rgba(255,255,255,.12);backdrop-filter:blur(6px);color:#dcebe3;border:1px solid rgba(255,255,255,.18)}
.pl-how li::before{content:counter(s);display:block;font:700 30px 'Bricolage Grotesque',sans-serif;color:var(--sun)}
.pl-how b{color:#fff}
.pl .pl-dev{font-size:13px;color:var(--red);max-width:60ch;margin:0 auto 14px}
.pl-foot{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;padding:22px clamp(16px,4vw,48px);background:var(--ink);color:#c9d6cf;font-size:14px}
.pl-modal{position:fixed;inset:0;background:rgba(10,20,15,.6);display:grid;place-items:center;padding:16px;z-index:50}
.pl-sheet{position:relative;background:#fff;border-radius:16px;max-width:960px;width:100%;max-height:92vh;overflow:auto;display:grid;grid-template-columns:1.1fr 1fr}
.pl-x{position:absolute;top:10px;right:10px;z-index:2;width:38px;height:38px;border-radius:50%;border:0;background:#fff;font-size:24px;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.25)}
.pl-gal{background:#dfe8e1;display:flex;flex-direction:column;min-height:280px}
.pl-gal>img,.pl-gal>video{width:100%;flex:1;min-height:0;object-fit:cover;display:block;background:#000}
.pl-play{display:grid;place-items:center;width:100%;height:100%;background:var(--ink);color:#fff;font-size:16px}
.pl-vid{position:absolute;top:12px;right:12px;background:rgba(16,35,27,.78);color:#fff;font-size:12px;padding:3px 9px;border-radius:8px}
.pl .pl-since{margin:0;font-size:13px;color:var(--mute)}
.pl-thumbs{display:flex;gap:6px;padding:8px;overflow-x:auto;background:#fff}
.pl-thumbs button{flex:0 0 64px;height:48px;padding:0;border:2px solid transparent;border-radius:8px;overflow:hidden;cursor:pointer}
.pl-thumbs button.on{border-color:var(--green)}.pl-thumbs img{width:100%;height:100%;object-fit:cover}
.pl-info{padding:26px 24px;display:flex;flex-direction:column;gap:8px}
.pl-info h2{margin:0;font-size:26px;padding-right:30px}
.pl-desc{margin:4px 0;max-width:60ch}
.pl .pl-contact{margin:14px 0 0;font:700 14px 'DM Sans',sans-serif;color:var(--ink)}
.pl-contact+.pl-cta{margin-top:6px}
.pl-cta{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center}.pl-cta .pl-btn{padding:8px 16px;font-size:14px}
@media(max-width:720px){.pl-sheet{grid-template-columns:1fr}.pl-row select{flex:1 1 45%}}
@media(prefers-reduced-motion:reduce){.pl-skel{animation:none}}
`;
