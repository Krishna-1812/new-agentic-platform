import { useNavigate } from 'react-router-dom';

const TOOLS = [
  {
    id: 'content-research',
    path: '/content-research',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    label: 'Content Research',
    tagline: 'Competitor-based content briefs',
    description: 'Scrape the top 10 ranking pages for any keyword, extract their structure, and generate a ready-to-use content brief with H2 recommendations and competitor insights.',
    features: ['Top 10 SERP analysis', 'Competitor H2 mapping', 'Content recommendations', 'Word count benchmarks', 'Export to Word (.docx)'],
    color: '#1e3a5f',
    badge: 'Content',
  },
  {
    id: 'keyword-research',
    path: '/keyword-research',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
    label: 'Keyword Research',
    tagline: 'AI-powered keyword shortlisting',
    description: 'Enter a seed keyword, find the top 3 ranking competitors, pull their real keyword rankings via SEMrush, and let AI shortlist 2 primary and 10 secondary keywords for your campaign.',
    features: ['Top 3 competitor analysis', 'SEMrush keyword data', 'AI filtering & ranking', '2 primary keywords', '10 secondary keywords'],
    color: '#1e6b4f',
    badge: 'Keywords',
  },
];

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header style={{ backgroundColor: '#1e3a5f' }} className="text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-white/50 text-sm font-medium uppercase tracking-widest">Gentle Dental</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">SEO Automation</h1>
          <p className="text-blue-200 mt-1 text-base">
            Your intelligent toolkit for search engine optimisation
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-700">Select a tool to get started</h2>
          <p className="text-sm text-gray-400 mt-1">Each tool is independently powered — choose based on your current task.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {TOOLS.map(tool => (
            <button
              key={tool.id}
              onClick={() => navigate(tool.path)}
              className="text-left bg-white rounded-2xl shadow-sm border border-gray-200 p-7 hover:shadow-md hover:border-gray-300 transition-all group focus:outline-none focus:ring-2 focus:ring-offset-2"
              style={{ '--tw-ring-color': tool.color }}
            >
              {/* Top row */}
              <div className="flex items-start justify-between mb-5">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center text-white flex-shrink-0"
                  style={{ backgroundColor: tool.color }}
                >
                  {tool.icon}
                </div>
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: tool.color + '15', color: tool.color }}
                >
                  {tool.badge}
                </span>
              </div>

              {/* Title */}
              <div className="mb-1">
                <h3 className="text-xl font-bold text-gray-900 group-hover:text-gray-700 transition-colors">
                  {tool.label}
                </h3>
                <p className="text-sm font-medium mt-0.5" style={{ color: tool.color }}>
                  {tool.tagline}
                </p>
              </div>

              {/* Description */}
              <p className="text-sm text-gray-500 leading-relaxed mt-3 mb-5">
                {tool.description}
              </p>

              {/* Features */}
              <ul className="space-y-1.5 mb-6">
                {tool.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                    <svg className="w-4 h-4 flex-shrink-0" style={{ color: tool.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <div
                className="flex items-center gap-2 text-sm font-semibold"
                style={{ color: tool.color }}
              >
                Open tool
                <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
            </button>
          ))}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-gray-400 mt-12">
          SEO Automation · Built for Gentle Dental · Powered by Google Search, SEMrush &amp; GPT-4o
        </p>
      </main>
    </div>
  );
}
