import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
  const { logout } = useAuth();

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
              <span className="text-[#9CA3AF] text-sm">· Gentle Dental</span>
            </div>
          </div>
          <button
            onClick={() => logout().then(() => navigate('/login', { replace: true }))}
            className="flex items-center gap-1.5 text-[#6B7280] hover:text-[#111827] text-xs font-medium transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            Sign out
          </button>
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
          SEO Automation · Built for Gentle Dental · Powered by Google Search, SEMrush &amp; GPT-4o
        </p>
      </main>
    </div>
  );
}
