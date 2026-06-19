import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const TOOLS = [
  {
    id: 'keyword-research', path: '/keyword-research', badge: 'Keywords', group: 'Research',
    label: 'Keyword Research', tagline: 'AI-powered keyword shortlisting',
    description: 'Enter a seed keyword, find the top ranking competitors, pull their real keyword rankings via SEMrush, and let AI shortlist 2 primary and 10 secondary keywords for your campaign.',
    features: ['Top competitor analysis', 'SEMrush keyword data', 'AI filtering & ranking', '2 primary + 10 secondary keywords'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
  },
  {
    id: 'content-research', path: '/content-research', badge: 'Content', group: 'Research',
    label: 'Content Research', tagline: 'Competitor-based content briefs',
    description: 'Scrape the top 10 ranking pages for any keyword, extract their structure, and generate a ready-to-use content brief with H2 recommendations and competitor insights.',
    features: ['Top 10 SERP analysis', 'Competitor H2 mapping', 'Word count benchmarks', 'Export to Word (.docx)'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
  {
    id: 'article-recommendation', path: '/article-recommendation', badge: 'Briefs', group: 'Research',
    label: 'Article Recommendation', tagline: 'Structured content briefs from SERP data',
    description: 'Analyze the top 10 ranking pages for any keyword and generate a complete article brief with H1/H2/H3 structure, writing instructions, keywords per section, and FAQ recommendations.',
    features: ['Top 10 SERP scraping', 'H2/H3 structure analysis', 'FAQ pattern extraction', 'Export to .docx'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6V7.5z" />
      </svg>
    ),
  },
  {
    id: 'content-enhancement', path: '/content-enhancement', badge: 'AEO', group: 'Optimize',
    label: 'Content Enhancement', tagline: 'Structure & authority recommendations',
    description: 'Analyze a live URL or pasted HTML, research the top 10 ranking blogs for the topic, and generate copy-ready upgrades for structure, authority, citations, FAQs, schema, and AI-search readiness.',
    features: ['URL or pasted HTML input', 'Copy-ready FAQ and answer blocks', 'Citation & expert quote gaps', 'Author byline guidance'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75h6m-6 3h6m2.25 4.5H6.75A2.25 2.25 0 014.5 18V6A2.25 2.25 0 016.75 3.75h5.379c.597 0 1.17.237 1.591.659l1.871 1.871c.422.422.659.994.659 1.591V18a2.25 2.25 0 01-2.25 2.25z" />
      </svg>
    ),
  },
  {
    id: 'on-page-audit', path: '/on-page-audit', badge: 'On-Page', group: 'Optimize',
    label: 'On-Page SEO Audit', tagline: '23 sections · live data · PageSpeed + CWV',
    description: 'Enter a URL and primary keywords to run a comprehensive on-page audit covering URL structure, meta, headings, content, schema, Core Web Vitals, canonicals, OG tags, crawlability, and more.',
    features: ['23 audit sections, ~90 checks', 'PageSpeed Insights (mobile + desktop)', 'Core Web Vitals (LCP, CLS, INP)', 'Top 10 priority action list'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    id: 'seo-geo-audit', path: '/seo-geo-audit', badge: 'SEO+GEO', group: 'Optimize',
    label: 'SEO & GEO Audit', tagline: '200+ checks · scored · AI recommendations',
    description: 'Run a full SEO and Generative Engine Optimization audit on any URL or pasted HTML. 200+ checks across title, meta, headings, content, schema, E-E-A-T, technical, and GEO signals.',
    features: ['200+ checks across 21 categories', 'CSQAF & GEO readiness score', 'E-E-A-T & content recommendations', 'Instant AI expert analysis'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'agent-readiness-audit', path: '/agent-readiness-audit', badge: 'AI Audit', group: 'Optimize',
    label: 'Agent Readiness Audit', tagline: "Score any site's AI agent readiness in 15s",
    description: "Run 13 automated checks across discoverability, content negotiation, bot access rules, and protocol support (MCP, OAuth, Agent Skills). Get a 0–100 score with GPT-generated CMO brief.",
    features: ['robots.txt, sitemap & Link headers', 'MCP server card detection', 'OAuth / OIDC discovery', 'GPT-4o CMO executive brief'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
  {
    id: 'image-alt-audit', path: '/image-alt-audit', badge: 'Images', group: 'Optimize',
    label: 'Image Alt Tag Audit', tagline: 'Bulk alt tag generation for location pages',
    description: 'Scrape 100+ location pages, classify every image by type, generate SEO-optimised alt tags and clean filenames, and export a colour-coded Excel workbook.',
    features: ['Batch scrape 100+ pages', 'GPT-4o vision for hero banners', 'RENAME_CRITICAL flagging', 'Export to 4-sheet .xlsx'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
  },
  {
    id: 'location-page-builder', path: '/location-page-builder', badge: 'Local SEO', group: 'Build',
    label: 'Location + Service Pages', tagline: 'Composed, approved, dev-ready location pages',
    description: 'For a Client × Service × Location, produce an approved page package — keywords, competitor analysis, layer-composed content, FAQs, internal links and schema.',
    features: ['Three-layer composition engine', 'Keyword pipeline (SERP + SEMrush + AI)', 'Approval workflow & audit trail', 'Export to JSON / Markdown / DOCX'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
      </svg>
    ),
  },
  {
    id: 'hub-spoke', path: '/hub-spoke', badge: 'Internal Linking', group: 'Build',
    label: 'Hub & Spoke', tagline: 'AI internal linking strategy & recommendations',
    description: 'Upload an existing hub and spoke spreadsheet or paste a URL list to auto-categorize with AI. Review the cluster structure, approve it, then generate targeted internal linking recommendations.',
    features: ['XLSX hub/spoke import + AI categorization', 'GAP hub & dual-cluster detection', 'Hub-to-spoke, spoke-to-hub, cross-cluster recs', 'Export to XLSX or CSV'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    id: 'knowledge-base', path: '/kb', badge: 'Knowledge', group: 'Build',
    label: 'Knowledge Base', tagline: 'Client & industry context management',
    description: 'Create and maintain knowledge base entries for clients, industries, and best practices. KB context is automatically injected into AI tools when a client is selected.',
    features: ['Brand & voice guidelines per client', 'Industry compliance rules', 'Client feedback versioning', 'Auto-injected into AI tools'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    id: 'robots-monitor', path: '/robots-monitor', badge: 'Technical SEO', group: 'Monitor',
    label: 'Robots Monitor', tagline: 'Daily noindex health checks across client domains',
    description: 'Automatically crawl sitemaps, sample pages by type, and verify noindex signals on production and staging domains. Get Slack alerts the moment a production page goes dark.',
    features: ['Sitemap discovery + URL sampling', 'X-Robots-Tag & meta robots checks', 'Daily scheduled + manual runs', '90-day run history'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    ),
  },
  {
    id: 'team-insights', path: '/team-insights', badge: 'PM', group: 'Monitor',
    label: 'Team Insights', tagline: 'Live SEO PM dashboard from Google Sheets',
    description: "Connect to your team's task management sheet and surface daily intelligence — blocked tasks, overdue work, WIP limits, capacity vs load, client health, and team-level signals.",
    features: ['Morning triage dashboard', 'Monday planning & capacity', 'Weekly review & slippage', 'Client health & cadence'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
];

const GROUPS = ['Research', 'Optimize', 'Build', 'Monitor'];

function ToolCard({ tool, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textAlign: 'left', cursor: 'pointer', outline: 'none',
        background: hovered ? 'var(--card-hover)' : 'var(--card)',
        backdropFilter: 'blur(30px) saturate(180%)',
        WebkitBackdropFilter: 'blur(30px) saturate(180%)',
        border: '1px solid var(--glass-border)',
        borderRadius: 14,
        padding: '18px 18px 16px',
        transition: 'background 0.15s, box-shadow 0.15s',
        boxShadow: hovered
          ? '0 8px 24px rgba(0,0,0,.12)'
          : '0 2px 8px rgba(0,0,0,.06)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      {/* Top row: icon + badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: 'var(--accent-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)', flexShrink: 0,
        }}>
          {tool.icon}
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
          padding: '3px 8px', borderRadius: 6,
          background: 'var(--tag-bg)', color: 'var(--text-3)',
        }}>
          {tool.badge}
        </span>
      </div>

      {/* Title + tagline */}
      <div>
        <div style={{
          fontSize: 14, fontWeight: 600, color: 'var(--text)',
          marginBottom: 2,
        }}>
          {tool.label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--accent-text)', fontWeight: 500 }}>
          {tool.tagline}
        </div>
      </div>

      {/* Description */}
      <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, margin: 0 }}>
        {tool.description}
      </p>

      {/* Features */}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tool.features.map((f, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-2)' }}>
            <svg style={{ color: 'var(--accent)', flexShrink: 0 }} width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            {f}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 12, fontWeight: 600, color: 'var(--accent-text)',
        marginTop: 2,
      }}>
        Open tool
        <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
      </div>
    </button>
  );
}

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '28px 32px 40px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', margin: 0 }}>
          SEO Tools
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
          A unified workspace of independently-powered tools for research, optimization, and monitoring. Pick one to begin.
        </p>
      </div>

      {GROUPS.map(groupName => {
        const tools = TOOLS.filter(t => t.group === groupName);
        return (
          <div key={groupName} style={{ marginBottom: 32 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.09em', color: 'var(--text-3)', marginBottom: 12,
            }}>
              {groupName}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 10,
            }}>
              {tools.map(tool => (
                <ToolCard key={tool.id} tool={tool} onClick={() => navigate(tool.path)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
