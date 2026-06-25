export const TOOL_GROUPS = [
  {
    label: 'Research',
    tools: [
      { id: 'keyword-research',       path: '/keyword-research',       label: 'Keyword Research',       icon: '🔍' },
      { id: 'content-research',       path: '/content-research',       label: 'Content Research',       icon: '📄' },
      { id: 'article-recommendation', path: '/article-recommendation', label: 'Article Recommendation', icon: '📰' },
    ],
  },
  {
    label: 'Optimize',
    tools: [
      { id: 'content-enhancement',    path: '/content-enhancement',    label: 'Content Enhancement',    icon: '✨' },
      { id: 'article-enhancement',    path: '/article-enhancement',    label: 'Enhance Existing Article', icon: '✍️' },
      { id: 'on-page-audit',          path: '/on-page-audit',          label: 'On-Page SEO Audit',      icon: '🔎' },
      { id: 'seo-geo-audit',          path: '/seo-geo-audit',          label: 'SEO & GEO Audit',        icon: '🌐' },
      { id: 'agent-readiness-audit',  path: '/agent-readiness-audit',  label: 'Agent Readiness Audit',  icon: '🤖' },
      { id: 'image-alt-audit',        path: '/image-alt-audit',        label: 'Image Alt Tag Audit',    icon: '🖼️' },
    ],
  },
  {
    label: 'Build',
    tools: [
      { id: 'location-page-builder',  path: '/location-page-builder',  label: 'Location + Service Pages', icon: '📍' },
      { id: 'hub-spoke',              path: '/hub-spoke',              label: 'Hub & Spoke',            icon: '🕸️' },
      { id: 'knowledge-base',         path: '/kb',                     label: 'Knowledge Base',         icon: '📚' },
    ],
  },
  {
    label: 'Monitor',
    tools: [
      { id: 'robots-monitor',         path: '/robots-monitor',         label: 'Robots Monitor',         icon: '🛡️' },
      { id: 'team-insights',          path: '/team-insights',          label: 'Team Insights',          icon: '📊' },
    ],
  },
];

export const ALL_TOOLS = TOOL_GROUPS.flatMap(g => g.tools);

export function getToolByPath(pathname) {
  return ALL_TOOLS.find(t => pathname === t.path || pathname.startsWith(t.path + '/'));
}
