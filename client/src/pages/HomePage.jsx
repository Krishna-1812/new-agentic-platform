import { useNavigate } from 'react-router-dom';

const TOOLS = [
  {
    id: 'knowledge-base',
    path: '/kb',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
    label: 'Knowledge Base',
    tagline: 'Client & industry context management',
    description: 'Create and maintain knowledge base entries for clients, industries, and best practices. KB context is automatically injected into AI tools when a client is selected.',
    features: ['Brand & voice guidelines per client', 'Industry compliance rules', 'Client feedback versioning', 'Module dependency audit', 'Auto-injected into AI tools'],
    badge: 'Knowledge',
  },
  {
    id: 'article-recommendation',
    path: '/article-recommendation',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6V7.5z" />
      </svg>
    ),
    label: 'Article Recommendation',
    tagline: 'Structured content briefs from SERP data',
    description: 'Analyze the top 10 ranking pages for any keyword and generate a complete article brief — with H1/H2/H3 structure, writing instructions, keywords per section, FAQ recommendations, and visual opportunity callouts.',
    features: ['Top 10 SERP scraping', 'H2/H3 structure analysis', 'Section writing instructions', 'Visual opportunity callouts', 'FAQ pattern extraction', 'Export to .docx'],
    badge: 'Briefs',
  },
  {
    id: 'content-enhancement',
    path: '/content-enhancement',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75h6m-6 3h6m2.25 4.5H6.75A2.25 2.25 0 014.5 18V6A2.25 2.25 0 016.75 3.75h5.379c.597 0 1.17.237 1.591.659l1.871 1.871c.422.422.659.994.659 1.591V18a2.25 2.25 0 01-2.25 2.25z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 8.25h3m-3 0a1.5 1.5 0 100 3m3-3a1.5 1.5 0 110 3m4.5-3h.008v.008h-.008z" />
      </svg>
    ),
    label: 'Content Enhancement',
    tagline: 'Structure & authority recommendations',
    description: 'Analyze a live URL or pasted HTML, research the top 10 ranking blogs for the topic, and generate copy-ready upgrades for structure, authority, citations, FAQs, schema, and AI-search readiness.',
    features: ['URL or pasted HTML input', 'Google top 10 content research', 'Copy-ready FAQ and answer blocks', 'Useful HTML table recommendations', 'Citation/statistic/expert quote gaps', 'Author byline guidance'],
    badge: 'AEO',
  },
  {
    id: 'content-research',
    path: '/content-research',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    label: 'Content Research',
    tagline: 'Competitor-based content briefs',
    description: 'Scrape the top 10 ranking pages for any keyword, extract their structure, and generate a ready-to-use content brief with H2 recommendations and competitor insights.',
    features: ['Top 10 SERP analysis', 'Competitor H2 mapping', 'Content recommendations', 'Word count benchmarks', 'Export to Word (.docx)'],
    badge: 'Content',
  },
  {
    id: 'image-alt-audit',
    path: '/image-alt-audit',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
    label: 'Image Alt Tag Audit',
    tagline: 'Bulk alt tag generation for location pages',
    description: 'Scrape 100+ location pages, classify every image by type (doctor, service, hero, plan), generate SEO-optimised alt tags and clean filenames, and export a colour-coded Excel workbook.',
    features: ['Batch scrape 100+ pages', 'Rule-based image classification', 'GPT-4o vision for hero banners', 'Suggested filenames per image', 'RENAME_CRITICAL flagging', 'Export to 4-sheet .xlsx'],
    badge: 'Images',
  },
  {
    id: 'team-insights',
    path: '/team-insights',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    label: 'Team Insights',
    tagline: 'Live SEO PM dashboard from Google Sheets',
    description: 'Connect to your team\'s task management sheet and surface daily intelligence — blocked tasks, overdue work, WIP limits, capacity vs load, client health, and team-level signals.',
    features: ['Morning triage dashboard', 'Monday planning & capacity', 'Weekly review & slippage', 'Client health & cadence', 'Team health & pitch pipeline'],
    badge: 'PM',
  },
  {
    id: 'seo-geo-audit',
    path: '/seo-geo-audit',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    label: 'SEO & GEO Audit',
    tagline: '200+ checks · scored · AI recommendations',
    description: 'Run a full SEO and Generative Engine Optimization audit on any URL or pasted HTML. 200+ checks across title, meta, headings, content, schema, E-E-A-T, technical, and GEO signals — scored and analysed by GPT-4o mini.',
    features: ['200+ checks across 21 categories', 'CSQAF & GEO readiness score', 'Platform readiness: 6 AI engines', 'Schema audit with sameAs gaps', 'E-E-A-T & content recommendations', 'Instant AI expert analysis'],
    badge: 'SEO+GEO',
  },
  {
    id: 'agent-readiness-audit',
    path: '/agent-readiness-audit',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    label: 'Agent Readiness Audit',
    tagline: 'Score any site\'s AI agent readiness in 15s',
    description: 'Run 13 automated checks across discoverability, content negotiation, bot access rules, and protocol support (MCP, OAuth, Agent Skills). Get a 0–100 score, category breakdown, and a GPT-generated CMO brief with prioritized roadmap.',
    features: ['robots.txt, sitemap & Link headers', 'AI bot rules & Content-Signal', 'MCP server card detection', 'OAuth / OIDC discovery', 'Agent Skills index check', 'GPT-4o CMO executive brief'],
    badge: 'AI Audit',
  },
  {
    id: 'location-page-builder',
    path: '/location-page-builder',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
      </svg>
    ),
    label: 'Location + Service Page Builder',
    tagline: 'Composed, approved, dev-ready location pages',
    description: 'For a Client × Service × Location, produce an approved page package — keywords, competitor analysis, layer-composed content, FAQs, internal links and schema — routed through SEO/Clinical/Content/Client gates and exported as JSON, Markdown & DOCX.',
    features: ['Three-layer composition engine', 'Keyword pipeline (SERP + SEMrush + AI)', 'Category-aware section logic', 'Uniqueness & NAP guardrails', 'Approval workflow & audit trail', 'Export to JSON / Markdown / DOCX'],
    badge: 'Local SEO',
  },
  {
    id: 'keyword-research',
    path: '/keyword-research',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
    label: 'Keyword Research',
    tagline: 'AI-powered keyword shortlisting',
    description: 'Enter a seed keyword, find the top ranking competitors, pull their real keyword rankings via SEMrush, and let AI shortlist 2 primary and 10 secondary keywords for your campaign.',
    features: ['Top competitor analysis', 'SEMrush keyword data', 'AI filtering & ranking', '2 primary keywords', '10 secondary keywords'],
    badge: 'Keywords',
  },
];

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F4F5F7' }}>
      {/* Top nav */}
      <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
        <div className="max-w-6xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: '#3DAA8E' }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-[#111827] text-sm tracking-tight">SEO Automation</span>
              <span className="text-[#9CA3AF] text-sm">· Arena</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-8">
        <div className="mb-7">
          <h1 className="text-[22px] font-bold text-[#111827]">SEO Tools</h1>
          <p className="text-sm text-[#6B7280] mt-1">Select a tool to get started. Each tool is independently powered.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {TOOLS.map(tool => (
            <button
              key={tool.id}
              onClick={() => navigate(tool.path)}
              className="text-left bg-white rounded-xl border border-[#E5E7EB] p-6 hover:shadow-[0_4px_12px_rgba(0,0,0,0.10)] transition-all group focus:outline-none border-l-4"
              style={{
                boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)',
                borderLeftColor: '#3DAA8E',
              }}
            >
              {/* Top row */}
              <div className="flex items-start justify-between mb-4">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white flex-shrink-0"
                  style={{ backgroundColor: '#3DAA8E1A' }}
                >
                  <span style={{ color: '#3DAA8E' }}>{tool.icon}</span>
                </div>
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded"
                  style={{ backgroundColor: '#F4F5F7', color: '#6B7280' }}
                >
                  {tool.badge}
                </span>
              </div>

              {/* Title */}
              <div className="mb-1">
                <h3 className="text-base font-semibold text-[#111827] group-hover:text-[#3DAA8E] transition-colors">
                  {tool.label}
                </h3>
                <p className="text-xs font-medium mt-0.5 text-[#3DAA8E]">
                  {tool.tagline}
                </p>
              </div>

              {/* Description */}
              <p className="text-sm text-[#6B7280] leading-relaxed mt-2.5 mb-4">
                {tool.description}
              </p>

              {/* Features */}
              <ul className="space-y-1.5 mb-5">
                {tool.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-[#6B7280]">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#3DAA8E' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: '#3DAA8E' }}>
                Open tool
                <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-[#9CA3AF] mt-10">
          SEO Automation · Built by Arena · Powered by Google Search, SEMrush &amp; GPT-4o
        </p>
      </main>
    </div>
  );
}
