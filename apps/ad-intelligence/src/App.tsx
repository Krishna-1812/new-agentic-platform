import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import {
  LayoutDashboard, Image, Users, Palette, Brain,
  RefreshCw, ExternalLink, CheckCircle2,
  Menu, X, TrendingUp
} from 'lucide-react';
import type { Ad, TabId, NavParams } from './lib/types';
import { COMPETITORS } from './lib/types';
import { OverviewTab }    from './components/OverviewTab';
import { GalleryTab }     from './components/GalleryTab';
import { CompetitorsTab } from './components/CompetitorsTab';
import { CreativeTab }    from './components/CreativeTab';
import { InsightsTab }   from './components/InsightsTab';
import { fetchSheetData } from './lib/sheets';
import embeddedAds from './data/ads.json';

// The product's name comes from the Flask route that serves this page, which
// injects window.__BRAND__ from brand.py on every request. The app used to
// ship the previous company's logo files (its wordmark and mark) baked into
// this bundle; reading the name at runtime means a rename in brand.py reaches
// this app without a rebuild.
declare global { interface Window { __BRAND__?: { name?: string } } }
const BRAND_NAME = (typeof window !== 'undefined' && window.__BRAND__?.name) || 'Workspace'
// The product mark (.bn-mark in static/css/bento-components.css): a lime square.
const Mark = ({ size }: { size: number }) => (
  <span aria-hidden="true" style={{ width: size, height: size, borderRadius: Math.round(size / 3), background: '#FF6022', display: 'block', flexShrink: 0 }} />
)

/* ── Nav tabs ─────────────────────────────────────────── */
const NAV: { id: TabId; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'insights',    label: 'Insights',          icon: <Brain           size={18}/>, desc: 'Market intelligence'   },
  { id: 'overview',    label: 'Overview',          icon: <LayoutDashboard size={18}/>, desc: 'Charts & summary'      },
  { id: 'gallery',     label: 'Ad Gallery',        icon: <Image           size={18}/>, desc: 'Browse all creatives'  },
  { id: 'competitors', label: 'Competitors',       icon: <Users           size={18}/>, desc: 'Deep competitor intel' },
  { id: 'creative',    label: 'Creative Analysis', icon: <Palette         size={18}/>, desc: 'Keywords & messaging'  },
];

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/16U5_QSxMmrAGKvK5dHScBu1Et4BJ1p8Q1ns5LycRA0s/edit';
type DataStatus = 'embedded' | 'loading' | 'live' | 'error';

/* ── Stat tile ────────────────────────────────────────── */
// Bento: a flat opaque tile, number in the display face. The first tile is
// the one filled tile on the page ("colour is load-bearing"); no count-up,
// tilt, shine or click sparkles -- the number is simply there.
function StatTile({
  value, label, sub, icon, hint, filled = false, onClick,
}: {
  value: number; label: string; sub: string; icon: React.ReactNode;
  hint: string; filled?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} title={hint}
      className={`bn-tile text-left ${filled ? 'bn-tile--fill' : ''}`}>
      <span className="bn-tile-icon" aria-hidden="true">{icon}</span>
      <span className="bn-tile-label">{label}</span>
      <span className="bn-tile-num">{value}</span>
      <span className="bn-tile-sub">{sub}</span>
    </button>
  );
}

/* ── Global Platform header (the product bar every page shares) ── */
const kpDdItem: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 8, color: '#444444', textDecoration: 'none', fontSize: 13 };
function PlatformBar() {
  const [u, setU] = useState<{ name?: string; given_name?: string; email?: string; picture?: string; is_admin?: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { fetch('/api/whoami').then(r => r.json()).then(setU).catch(() => {}); }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest || !t.closest('#kp-right')) setOpen(false);
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);
  const nm = u?.given_name || u?.name || 'Account';
  const full = u?.name || nm;
  // Admin links follow the server's ADMIN_EMAILS via /api/whoami, not a list
  // of addresses baked into this bundle.
  const isAdmin = !!u?.is_admin;
  return (
    <div className="bn-bar">
      <a href="/p2/hub" className="bn-bar-brand">
        <Mark size={12} />
        <span>{BRAND_NAME}</span>
      </a>
      <nav className="bn-bar-crumbs hidden sm:flex" aria-label="Breadcrumb">
        <a href="/p2/hub">Workspace</a>
        <span aria-hidden="true">/</span>
        <a href="/p2/strategic-agents">Agents</a>
        <span aria-hidden="true">/</span>
        <span className="bn-bar-cur">Ad Intelligence</span>
      </nav>
      <div id="kp-right" style={{ marginLeft: 'auto', position: 'relative', flexShrink: 0 }}>
        <button type="button" onClick={() => setOpen(o => !o)} className="bn-bar-user">
          <span className="bn-bar-av">
            {u?.picture ? <img src={u.picture} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (nm || 'U').slice(0, 2).toUpperCase()}
          </span>
          <span className="hidden sm:inline">{nm}</span>
        </button>
        {open && (
          <div className="bn-bar-menu">
            <div style={{ padding: '10px 12px', marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#121213' }}>{full}</div>
              <div style={{ fontSize: 11, color: '#6F6B66', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u?.email || ''}</div>
            </div>
            <a href="/p2/hub" style={kpDdItem}>Workspace</a>
            {isAdmin && <a href="/p2/admin/usage" style={kpDdItem}>Usage dashboard</a>}
            <a href="/logout" style={{ ...kpDdItem, color: '#C8261B' }}>Sign out</a>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main App ─────────────────────────────── */
export default function App() {
  const [ads, setAds]             = useState<Ad[]>(embeddedAds as Ad[]);
  const [tab, setTab]             = useState<TabId>('insights');
  const [status, setStatus]       = useState<DataStatus>('embedded');
  const [lastUpdated, setLast]    = useState<Date>(new Date());
  const [now, setNow]             = useState<Date>(new Date());
  const [sidebarOpen, setSidebar] = useState(false);

  /* ── Tick every minute so "X mins ago" stays fresh */
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  /* ── Human-readable "X mins ago" */
  const timeAgo = (() => {
    const diff = Math.floor((now.getTime() - lastUpdated.getTime()) / 60_000);
    if (diff < 1)  return 'just now';
    if (diff === 1) return '1 min ago';
    if (diff < 60)  return `${diff} mins ago`;
    const h = Math.floor(diff / 60);
    return h === 1 ? '1 hr ago' : `${h} hrs ago`;
  })();

  /* ── Global filter state (controlled across all tabs) */
  const [galleryDomain,   setGalleryDomain]   = useState('all');
  const [galleryFormat,   setGalleryFormat]   = useState('all');
  const [gallerySearch,   setGallerySearch]   = useState('');
  const [competitorActive, setCompetitorActive] = useState(COMPETITORS[0].domain);

  /* ── Central navigate function ───────────────────── */
  const navigateTo = useCallback((p: NavParams) => {
    if (p.domain     !== undefined) setGalleryDomain(p.domain);
    if (p.format     !== undefined) setGalleryFormat(p.format);
    if (p.search     !== undefined) setGallerySearch(p.search);
    if (p.competitor !== undefined) setCompetitorActive(p.competitor);
    if (p.tab        !== undefined) setTab(p.tab);
  }, []);

  const loadLive = useCallback(async () => {
    setStatus('loading');
    try {
      const live = await fetchSheetData();
      if (live.length > 0) { setAds(live); setStatus('live'); setLast(new Date()); }
      else throw new Error('empty');
    } catch { setStatus('error'); }
  }, []);

  useEffect(() => { loadLive(); }, [loadLive]);

  const total       = ads.length;
  const active      = ads.filter(a => a.Status === 'active').length;
  const withImg     = ads.filter(a => a['Image URLs']).length;
  const competitors = [...new Set(ads.map(a => a.Domain).filter(Boolean))].length;
  const tabLabel    = NAV.find(n => n.id === tab)?.label ?? '';

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bn-app">
      <PlatformBar />
      <div className="flex flex-1 min-w-0 overflow-hidden">

      {/* Mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setSidebar(false)} />}

      {/* ── SIDEBAR ───────────────────────────────────── */}
      <aside className={`sidebar bn-side fixed lg:static inset-y-0 left-0 z-50 w-64 flex flex-col
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>

        <div className="flex items-center justify-between px-5 pt-6 pb-4">
          <div>
            <p className="bn-side-title">Ad Intelligence</p>
            <p className="bn-side-sub">Competitor tracker</p>
          </div>
          <button onClick={() => setSidebar(false)} className="lg:hidden bn-icon-btn" aria-label="Close menu"><X size={18}/></button>
        </div>

        <nav className="flex-1 px-3 pb-4 space-y-1 overflow-y-auto">
          {NAV.map(item => {
            const isActive = tab === item.id;
            return (
              <button key={item.id} onClick={() => { setTab(item.id); setSidebar(false); }}
                      className={`bn-nav ${isActive ? 'is-active' : ''}`}
                      aria-current={isActive ? 'page' : undefined}>
                <span className="bn-nav-icon">{item.icon}</span>
                <span className="min-w-0">
                  <span className="block bn-nav-label">{item.label}</span>
                  <span className="block bn-nav-desc">{item.desc}</span>
                </span>
              </button>
            );
          })}

          <p className="bn-side-label">Competitors</p>
          {COMPETITORS.map(c => (
            <button key={c.domain}
                    onClick={() => navigateTo({ tab: 'competitors', competitor: c.domain })}
                    className="bn-nav">
              <span className="bn-comp-dot" style={{ backgroundColor: c.color }}>{c.name[0]}</span>
              <span className="min-w-0 text-left">
                <span className="block bn-nav-label truncate">{c.name}</span>
                <span className="block bn-nav-desc truncate">{c.domain}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="px-4 py-4 flex gap-2">
          <button onClick={loadLive} disabled={status === 'loading'} className="bn-btn flex-1">
            <RefreshCw size={12} className={status === 'loading' ? 'animate-spin' : ''}/> Sync
          </button>
          <a href={SHEET_URL} target="_blank" rel="noopener noreferrer" className="bn-btn flex-1">
            <ExternalLink size={12}/> Sheet
          </a>
        </div>
      </aside>

      {/* ── MAIN ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        <header className="bn-head">
          <button onClick={() => setSidebar(true)} className="lg:hidden bn-icon-btn" aria-label="Open menu"><Menu size={20}/></button>
          <div className="min-w-0">
            <p className="bn-eyebrow hidden sm:block">Strategic agents &middot; Competitor ads</p>
            <h1 className="bn-h1 truncate">{tabLabel}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            <button onClick={loadLive} disabled={status === 'loading'} className="bn-btn bn-btn--ghost hidden sm:inline-flex">
              <RefreshCw size={12} className={status === 'loading' ? 'animate-spin' : ''}/>
              {status === 'loading' ? 'Syncing…' : `Updated ${timeAgo}`}
            </button>
            {status === 'live' && (
              <span className="bn-live hidden sm:inline-flex"><span className="live-dot" aria-hidden="true"/> Live</span>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden bn-main">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 pb-10">

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-[10px] mb-6">
              <StatTile value={total} label="Total ads tracked" sub={`${competitors} competitors`} filled
                icon={<TrendingUp size={16}/>} hint="Browse all ads"
                onClick={() => navigateTo({ tab: 'gallery', domain: 'all', format: 'all', search: '' })} />
              <StatTile value={active} label="Active ads" sub={`${total ? Math.round((active/total)*100) : 0}% of total`}
                icon={<CheckCircle2 size={16}/>} hint="View competitor breakdown"
                onClick={() => navigateTo({ tab: 'competitors' })} />
              <StatTile value={withImg} label="Image creatives" sub={`${ads.filter(a=>a.Format==='video').length} video ads`}
                icon={<Image size={16}/>} hint="Filter image ads"
                onClick={() => navigateTo({ tab: 'gallery', format: 'image', domain: 'all', search: '' })} />
              <StatTile value={competitors} label="Competitors" sub="Google Ads data"
                icon={<Users size={16}/>} hint="Explore all competitors"
                onClick={() => navigateTo({ tab: 'competitors' })} />
            </div>

            {/* Active tab: the one Bento motion, a 150ms opacity fade */}
            <div key={tab} className="tab-enter">
              {tab === 'insights' && (
                <InsightsTab ads={ads} onNav={navigateTo} />
              )}
              {tab === 'overview' && (
                <OverviewTab ads={ads} onNav={navigateTo} />
              )}
              {tab === 'gallery' && (
                <GalleryTab
                  ads={ads}
                  domain={galleryDomain}   setDomain={setGalleryDomain}
                  format={galleryFormat}   setFormat={setGalleryFormat}
                  search={gallerySearch}   setSearch={setGallerySearch}
                  onNav={navigateTo}
                />
              )}
              {tab === 'competitors' && (
                <CompetitorsTab
                  ads={ads}
                  activeCompetitor={competitorActive}
                  setActiveCompetitor={setCompetitorActive}
                  onNav={navigateTo}
                />
              )}
              {tab === 'creative' && (
                <CreativeTab ads={ads} onNav={navigateTo} />
              )}
            </div>

          </div>
        </main>
      </div>
    </div>
    </div>
  );
}
