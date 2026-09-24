// Status tags shown next to a tool's name (sidebar) and on its card (home).
// Same visual language as the original "Beta" pill, one distinct color each.
// A tool with no `tag` shows nothing. Single source of truth for both surfaces.
// `label` is the full text (cards, which have room); `short` is the compact
// form used in the width-constrained sidebar so tool names aren't over-truncated.
export const TAGS = {
  beta:     { label: 'Beta',             short: 'Beta',     bg: '#E2F1FF', fg: '#1D65A6' },
  internal: { label: 'Internal Only',    short: 'Internal', bg: '#FFE4D8', fg: '#B83C0C' },
  testing:  { label: 'Internal Testing', short: 'Testing',  bg: '#EFE3F9', fg: '#6B3FA0' },
  soon:     { label: 'Coming Soon',      short: 'Soon',     bg: '#EBE9E5', fg: '#6F6B66' },
};

export const TOOL_GROUPS = [
  {
    label: 'Research',
    tools: [
      { id: 'keyword-research',       path: '/keyword-research',       label: 'Keyword Research',       icon: '🔍' },
      { id: 'content-research',       path: '/content-research',       label: 'Content Research',       icon: '📄', tag: 'internal' },
      { id: 'article-recommendation', path: '/article-recommendation', label: 'Article Recommendation', icon: '📰' },
      { id: 'market-potential',       path: '/market-potential',       label: 'Market Potential',       icon: '🗺️', tag: 'beta' },
      { id: 'competitor-analysis',    path: '/competitor-analysis',    label: 'Competitor Analysis',    icon: '🆚', tag: 'beta' },
    ],
  },
  {
    label: 'Optimize',
    tools: [
      { id: 'article-enhancement',    path: '/article-enhancement',    label: 'Enhance Existing Article', icon: '✍️', tag: 'internal' },
      { id: 'article-enhancement-lite', path: '/article-enhancement-lite', label: 'Article Enhancer', icon: '📝' },
      { id: 'on-page-audit',          path: '/on-page-audit',          label: 'On-Page SEO Audit',      icon: '🔎', tag: 'soon' },
      { id: 'seo-geo-audit',          path: '/seo-geo-audit',          label: 'SEO & GEO Audit',        icon: '🌐', tag: 'beta' },
      { id: 'seo-geo-snapshot',       path: '/seo-geo-snapshot',       label: 'SEO & GEO Snapshot',     icon: '📊', tag: 'beta' },
      { id: 'agent-readiness-audit',  path: '/agent-readiness-audit',  label: 'Agent Readiness Audit',  icon: '🤖' },
      { id: 'image-alt-audit',        path: '/image-alt-audit',        label: 'Image Alt Tag Audit',    icon: '🖼️', tag: 'beta' },
    ],
  },
  {
    label: 'Build',
    tools: [
      { id: 'location-page-builder',  path: '/location-page-builder',  label: 'Location + Service Pages', icon: '📍', tag: 'testing' },
      { id: 'content-architect',      path: '/content-architect',      label: 'Content Architect',      icon: '🗺️', tag: 'testing' },
      { id: 'gbp-qc',                 path: '/gbp-qc',                 label: 'GBP Quality Check',      icon: '🏪', tag: 'beta' },
      { id: 'knowledge-base',         path: '/kb',                     label: 'Knowledge Base',         icon: '📚', tag: 'internal' },
    ],
  },
];

export const ALL_TOOLS = TOOL_GROUPS.flatMap(g => g.tools);

export function getToolByPath(pathname) {
  return ALL_TOOLS.find(t => pathname === t.path || pathname.startsWith(t.path + '/'));
}
