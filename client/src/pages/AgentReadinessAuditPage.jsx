import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

const SC = {
  pass: { label: 'Pass', bg: '#EAF3DE', color: '#3B6D11', icon: '✓' },
  fail: { label: 'Fail', bg: '#FCEBEB', color: '#A32D2D', icon: '✗' },
  info: { label: 'Info', bg: '#FAEEDA', color: '#854F0B', icon: 'i' },
};

const EC = {
  done:   { label: 'Completed',   color: '#3B6D11' },
  quick:  { label: 'Quick win',   color: '#185FA5' },
  medium: { label: 'Medium lift', color: '#854F0B' },
  high:   { label: 'Strategic',   color: '#534AB7' },
  low:    { label: 'Low lift',    color: '#185FA5' },
};

// Flag status (visual differentiation from Fail)
const FC = { label: 'Flag', bg: '#FEF3C7', color: '#92400E', icon: '⚑' };

// Effort time ranges
const EFFORT_TIME = {
  done: null,
  quick: '~15 min – 2 hrs',
  medium: '~4 hrs – 2 weeks',
  high: '~2 – 8 weeks',
  low: '~1 – 2 hrs',
};

// Role ownership map
const ROLE_MAP = {
  robots: 'SEO / Content', sitemap: 'SEO / Content', aibots: 'SEO / Content',
  contentsignals: 'SEO / Content', linkheaders: 'SEO / Content',
  markdown: 'Engineering', apicatalog: 'Engineering', oauth: 'Engineering',
  oauthresource: 'Engineering', mcp: 'Engineering', agentskills: 'Engineering',
  webmcp: 'Engineering', webbotauth: 'Engineering', captcha: 'Engineering',
  form_labels: 'Front-End Dev', input_type: 'Front-End Dev', autocomplete: 'Front-End Dev',
  vague_buttons: 'Front-End Dev', interactive_divs: 'Front-End Dev',
  schema_search: 'Front-End Dev', schema_action: 'Front-End Dev',
  js_rendering: 'Front-End Dev', cookie_banner: 'Front-End Dev',
};

// Code snippets for quick-win failing checks
const CODE_SNIPPETS = {
  contentsignals: `# Add to robots.txt
Content-Signal: training=disallow, crawling=allow, summarization=allow`,
  aibots: `# Add to robots.txt
User-agent: GPTBot
Disallow:

User-agent: ClaudeBot
Disallow:

User-agent: anthropic-ai
Disallow:

User-agent: PerplexityBot
Disallow:

User-agent: Google-Extended
Disallow:`,
  linkheaders: `# nginx — add to server block
add_header Link '</sitemap.xml>; rel="sitemap"';

# Apache — add to .htaccess or VirtualHost
Header always set Link "</sitemap.xml>; rel=sitemap"`,
  vague_buttons: `<!-- Before -->
<button type="submit">Submit</button>

<!-- After — use action-specific copy -->
<button type="submit">Request My Appointment</button>
<button type="submit">Confirm and Send Message</button>`,
};

// Level thresholds for tooltip
const LEVELS = [
  { score: '90–100', label: 'Agent Native', level: 4 },
  { score: '75–89', label: 'Agent Ready', level: 3 },
  { score: '50–74', label: 'AI Aware', level: 2 },
  { score: '25–49', label: 'Basic Web Presence', level: 1 },
  { score: '0–24', label: 'Not Indexed', level: 0 },
];

// Scoring weight table for explanation panel
const SCORE_WEIGHTS_TABLE = [
  { cat: 'Discoverability', checks: 3, weight: '20' },
  { cat: 'Content', checks: 1, weight: '10' },
  { cat: 'Bot Access', checks: 3, weight: '20' },
  { cat: 'API / Auth / MCP', checks: 6, weight: '50' },
  { cat: 'On-Page Signals', checks: 5, weight: '34 (when run)' },
  { cat: 'Forms', checks: 5, weight: '29 (when run)' },
];

// Agentic protocol check IDs
const AGENTIC_PROTOCOL_IDS = ['apicatalog', 'oauth', 'oauthresource', 'mcp', 'agentskills', 'webmcp'];

const ROADMAP = [
  {
    tier: 'This week',
    sub: '15 min – 2 hrs each',
    color: '#3B6D11', bg: '#EAF3DE',
    checkIds: ['contentsignals', 'linkheaders', 'form_labels', 'input_type', 'autocomplete', 'cookie_banner', 'vague_buttons'],
    efforts: { contentsignals: '15 min', linkheaders: '~2 hrs', form_labels: '~1 hr', input_type: '30 min', autocomplete: '30 min', cookie_banner: '30 min', vague_buttons: '1 hr' },
  },
  {
    tier: 'This quarter',
    sub: '1 day – 2 weeks each',
    color: '#185FA5', bg: '#E6F1FB',
    checkIds: ['markdown', 'apicatalog', 'oauth', 'schema_search', 'schema_action', 'js_rendering', 'interactive_divs'],
    efforts: { markdown: '1–3 days', apicatalog: '3–5 days', oauth: '1–2 wks', schema_search: '~1 day', schema_action: '~1 day', js_rendering: '1–2 wks', interactive_divs: '~1 day' },
  },
  {
    tier: 'Strategic horizon',
    sub: '2–8 weeks each',
    color: '#534AB7', bg: '#EEEDFE',
    checkIds: ['mcp', 'agentskills', 'webmcp', 'captcha'],
    efforts: { mcp: '2–4 wks', agentskills: '4–6 wks', webmcp: '4–8 wks', captcha: '2–4 wks' },
  },
];

// Weight map for priority sorting
const WEIGHT_MAP = {
  robots: 7, sitemap: 7, linkheaders: 6, markdown: 10, aibots: 11, contentsignals: 9,
  webbotauth: 0, apicatalog: 8, oauth: 8, oauthresource: 8, mcp: 10, agentskills: 10, webmcp: 6,
  form_labels: 10, input_type: 6, autocomplete: 6, schema_search: 5, schema_action: 5,
  captcha: 8, cookie_banner: 6, js_rendering: 8, vague_buttons: 4, interactive_divs: 5,
};

// ─── CodeSnippet component ────────────────────────────────────────────────────
function CodeSnippet({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div style={{ position: 'relative', marginTop: 10, background: '#1E1E2E', borderRadius: 8, padding: '12px 14px' }}>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code snippet"
        style={{ position: 'absolute', top: 8, right: 8, background: copied ? '#3B6D11' : '#374151', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}
      >
        {copied ? '✓ Copied' : '⎘ Copy'}
      </button>
      <pre style={{ margin: 0, fontSize: 12, color: '#E5E7EB', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', paddingRight: 60 }}>
        {code}
      </pre>
    </div>
  );
}

// ─── ScoreRing component (animated) ──────────────────────────────────────────
function ScoreRing({ score, checkCount }) {
  const [displayScore, setDisplayScore] = useState(0);
  const animationRef = useRef(null);
  const r = 52, cx = 64, cy = 64;
  const circ = 2 * Math.PI * r;

  useEffect(() => {
    // Check prefers-reduced-motion
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setDisplayScore(score); return; }

    const start = performance.now();
    const duration = 800;

    const animate = (now) => {
      const t = Math.min((now - start) / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(eased * score));
      if (t < 1) animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [score]);

  const offset = circ * (1 - displayScore / 100);
  const color = score >= 70 ? '#639922' : score >= 40 ? '#EF9F27' : '#E24B4A';

  return (
    <svg width="128" height="128" viewBox="0 0 128 128"
      aria-label={`Agent readiness score: ${score} out of 100`} role="img">
      <title>Agent readiness score: {score} out of 100</title>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E2E8F0" strokeWidth="8" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 64 64)"
        style={{ transition: 'none' }} />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="28" fontWeight="500" fill={color}>{displayScore}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize="12" fill="#888780">/ 100</text>
    </svg>
  );
}

// ─── CatBar component ─────────────────────────────────────────────────────────
function CatBar({ cat }) {
  const color = cat.score >= 70 ? '#639922' : cat.score >= 40 ? '#EF9F27' : '#E24B4A';
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: '#6B7280' }}>{cat.id}</span>
        <span style={{ fontSize: 13, fontWeight: 500, color }}>{cat.score}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#F3F4F6', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${cat.score}%`, background: color, borderRadius: 3 }} />
      </div>
      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{cat.passed} of {cat.total} checks passed</div>
    </div>
  );
}

// ─── CheckRow component ───────────────────────────────────────────────────────
function CheckRow({ check, open, onToggle, isLast }) {
  const isFlag = check.flagOnly;
  const badge = isFlag ? FC : (SC[check.status] || SC.info);
  const badgeLabel = isFlag ? 'Flag' : badge.label;
  const e = EC[check.effort] || EC.medium;

  return (
    <div style={{ borderBottom: isLast ? 'none' : '0.5px solid #F3F4F6' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%', background: 'none', border: 'none', padding: '13px 0',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
        }}
      >
        <span
          style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: badge.bg, color: badge.color }}
          title={isFlag ? 'Advisory — this check is informational and does not affect your score.' : undefined}
        >
          {badge.icon} {badgeLabel}
        </span>
        <span style={{ flex: 1, fontSize: 14, color: '#111827' }}>{check.label}</span>
        <span style={{ flexShrink: 0, fontSize: 11, color: '#9CA3AF', marginRight: 2 }}>{check.cat}</span>
        <span style={{ flexShrink: 0, fontSize: 11, color: e.color, border: `0.5px solid ${e.color}`, padding: '2px 7px', borderRadius: 4 }}>
          {e.label}
        </span>
        <span style={{ color: '#9CA3AF', fontSize: 12, marginLeft: 2 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ paddingBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5, fontWeight: 500 }}>
                Technical finding
              </div>
              <p style={{ fontSize: 12, color: '#6B7280', margin: 0, fontFamily: 'monospace', lineHeight: 1.6 }}>
                {check.tech}
              </p>
            </div>
            <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5, fontWeight: 500 }}>
                Business impact
              </div>
              <p style={{ fontSize: 12, color: '#111827', margin: 0, lineHeight: 1.6 }}>
                {check.business}
              </p>
            </div>
          </div>

          {check.status !== 'pass' && check.detail && check.detail !== check.tech && (
            <div style={{ background: '#FFFBEB', borderRadius: 8, padding: '10px 12px', marginBottom: 10, borderLeft: '3px solid #F59E0B' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Specific issues found
              </div>
              <p style={{ fontSize: 12, color: '#78350F', margin: 0, lineHeight: 1.6, fontFamily: 'monospace' }}>{check.detail}</p>
            </div>
          )}

          {check.action && (
            <div style={{ background: '#E6F1FB', borderRadius: 8, padding: '10px 12px', borderLeft: '3px solid #378ADD' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#185FA5', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Recommended action
              </div>
              <p style={{ fontSize: 12, color: '#0C447C', margin: 0, lineHeight: 1.6 }}>{check.action}</p>
            </div>
          )}

          {check.effort === 'quick' && check.status !== 'pass' && CODE_SNIPPETS[check.id] && (
            <CodeSnippet code={CODE_SNIPPETS[check.id]} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── SkeletonLine component ───────────────────────────────────────────────────
function SkeletonLine({ w = '100%' }) {
  return <div style={{ height: 13, background: '#F3F4F6', borderRadius: 4, marginBottom: 7, width: w }} />;
}

// ─── Main page component ──────────────────────────────────────────────────────
export default function AgentReadinessAuditPage() {
  const navigate = useNavigate();
  const [urlHomepage, setUrlHomepage] = useState('');
  const [urlAction, setUrlAction]     = useState('');
  const [urlForm, setUrlForm]         = useState('');
  const [loading, setLoading]         = useState(false);
  const [pdfLoading, setPdfLoading]   = useState(false);
  const [error, setError]             = useState('');
  const [result, setResult]           = useState(null);
  const [tab, setTab]                 = useState('findings');
  const [expanded, setExpanded]       = useState(null);
  const [filterCat, setFilterCat]     = useState('all');

  // New state
  const [sortMode, setSortMode]               = useState('priority');
  const [scorePanelOpen, setScorePanelOpen]   = useState(false);
  const [levelTooltipOpen, setLevelTooltipOpen] = useState(false);
  const [delta, setDelta]                     = useState(null);
  const [actionSuggestions, setActionSuggestions] = useState([]);
  const [formSuggestions, setFormSuggestions] = useState([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [copiedRoadmap, setCopiedRoadmap]     = useState(false);
  const [sharedBrief, setSharedBrief]         = useState(false);
  const debounceRef = useRef(null);

  // ── URL auto-discovery ────────────────────────────────────────────────────
  async function discoverLinks(url) {
    if (!url || !url.trim()) return;
    setDiscoverLoading(true);
    try {
      const res = await fetch(`/api/agent-readiness-audit/discover-links?url=${encodeURIComponent(url.trim())}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setActionSuggestions(data.actionCandidates || []);
        setFormSuggestions(data.formCandidates || []);
      }
    } catch {}
    setDiscoverLoading(false);
  }

  // ── finishAudit (shared between stream and fallback) ──────────────────────
  function finishAudit(data) {
    setResult(data);
    setLoading(false);
    // Store delta
    try {
      const domain = new URL(data.site.full).hostname;
      const storageKey = `ara_last_${domain}`;
      const prev = localStorage.getItem(storageKey);
      if (prev) {
        const prevData = JSON.parse(prev);
        const diff = data.site.score - prevData.score;
        setDelta({ diff, prevScore: prevData.score, prevDate: prevData.date });
      }
      localStorage.setItem(storageKey, JSON.stringify({
        score: data.site.score,
        level: data.site.level,
        date: data.site.date,
      }));
    } catch {}
  }

  // ── handleAudit (with SSE streaming + fallback) ───────────────────────────
  async function handleAudit(e) {
    e.preventDefault();
    if (!urlHomepage.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    setTab('findings');
    setExpanded(null);
    setFilterCat('all');
    setDelta(null);

    try {
      const resp = await fetch('/api/agent-readiness-audit/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          url_homepage: urlHomepage.trim(),
          url_action: urlAction.trim() || undefined,
          url_form: urlForm.trim() || undefined,
        }),
      });

      if (!resp.ok || !resp.body) throw new Error('stream_unavailable');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = null;
      let streamResult = null;

      const processEvents = (text) => {
        buffer += text;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'complete') {
                streamResult = data;
              }
            } catch {}
            currentEvent = null;
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        processEvents(decoder.decode(value, { stream: true }));
      }

      if (streamResult) {
        finishAudit(streamResult);
      } else {
        throw new Error('stream_incomplete');
      }
    } catch (streamErr) {
      // Fallback to non-streaming endpoint
      try {
        const res = await fetch('/api/agent-readiness-audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            url_homepage: urlHomepage.trim(),
            url_action: urlAction.trim() || undefined,
            url_form: urlForm.trim() || undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Audit failed');
        }
        const data = await res.json();
        finishAudit(data);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    }
  }

  // ── handleDownloadPdf ─────────────────────────────────────────────────────
  async function handleDownloadPdf() {
    if (!result) return;
    setPdfLoading(true);
    try {
      const res = await fetch('/api/agent-readiness-audit/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(result),
      });
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agent-readiness-${result.site.url}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setPdfLoading(false);
    }
  }

  // ── shareSummary ──────────────────────────────────────────────────────────
  function shareSummary() {
    if (!result?.cmoBrief) return;
    const payload = {
      brief: result.cmoBrief,
      url: result.site.url,
      full: result.site.full,
      score: result.site.score,
      level: result.site.level,
      date: result.site.date,
    };
    const encoded = btoa(JSON.stringify(payload));
    const shareUrl = `${window.location.origin}/agent-readiness-audit/summary?d=${encoded}`;
    navigator.clipboard.writeText(shareUrl);
    setSharedBrief(true);
    setTimeout(() => setSharedBrief(false), 2000);
  }

  // ── copyRoadmap ───────────────────────────────────────────────────────────
  function copyRoadmap() {
    const lines = [`## Agent Readiness Roadmap — ${result.site.url}`, `Scanned ${result.site.date} · Score: ${result.site.score}/100`, ''];
    for (const tier of ROADMAP) {
      const tierChecks = tier.checkIds.map(id => allChecks.find(c => c.id === id)).filter(Boolean);
      const failing = tierChecks.filter(c => c.status !== 'pass');
      if (failing.length === 0) continue;
      lines.push(`### ${tier.tier}`);
      for (const c of failing) {
        const role = ROLE_MAP[c.id] || 'Team';
        const time = EFFORT_TIME[c.effort] || tier.efforts[c.id] || '–';
        lines.push(`- [ ] ${c.label} (${role} · ${time})`);
      }
      lines.push('');
    }
    const passing = allChecks.filter(c => c.status === 'pass');
    if (passing.length > 0) {
      lines.push('### Already Done ✓');
      passing.forEach(c => lines.push(`- [x] ${c.label}`));
    }
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedRoadmap(true);
    setTimeout(() => setCopiedRoadmap(false), 2000);
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const httpChecks    = result?.checks || [];
  const onPageChecks  = result?.onPageChecks || [];
  const allChecks     = [...httpChecks, ...onPageChecks];
  const passCount     = allChecks.filter(c => c.status === 'pass').length;
  const failCount     = allChecks.filter(c => c.status === 'fail').length;
  const infoCount     = allChecks.filter(c => c.status === 'info').length;
  const catFilters    = ['all', ...(result?.cats || []).map(c => c.id)];
  const hasOnPage     = onPageChecks.length > 0;
  const checkCount    = allChecks.length;

  // Sorted + filtered checks
  const filtered = useMemo(() => {
    const base = filterCat === 'all' ? allChecks : allChecks.filter(c => c.cat === filterCat);
    if (sortMode === 'priority') {
      return [...base].sort((a, b) => {
        const aFail = a.status !== 'pass' ? 0 : 1;
        const bFail = b.status !== 'pass' ? 0 : 1;
        if (aFail !== bFail) return aFail - bFail;
        return (WEIGHT_MAP[b.id] || 0) - (WEIGHT_MAP[a.id] || 0);
      });
    }
    return base;
  }, [allChecks, filterCat, sortMode]);

  // Detect if all agentic protocol checks are failing
  const agenticAllFailing = useMemo(() => {
    if (allChecks.length === 0) return false;
    return AGENTIC_PROTOCOL_IDS.every(id => {
      const c = allChecks.find(ch => ch.id === id);
      return c && c.status !== 'pass';
    });
  }, [allChecks]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F4F5F7' }}>
      {/* Nav */}
      <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
        <div className="max-w-5xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-[#6B7280] hover:text-[#111827] transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
            <div className="w-px h-4 bg-[#E5E7EB]" />
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: '#534AB71A' }}>
                <span style={{ fontSize: 13 }}>🤖</span>
              </div>
              <span className="font-semibold text-[#111827] text-sm">Agent Readiness Audit</span>
            </div>
          </div>
          <span className="text-xs text-[#9CA3AF]">{checkCount || '13–23'} checks · Scores 0–100</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">

        {/* Agent importance one-liner */}
        <div style={{ background: '#534AB7', borderRadius: 10, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>⚡</span>
          <p style={{ fontSize: 13, color: '#EEEDFe', margin: 0, lineHeight: 1.5 }}>
            <strong style={{ color: '#fff' }}>AI agents are replacing browsers as the primary interface to the web.</strong>{' '}
            Sites optimized for agents get found, cited, and transacted with — those that aren't get bypassed entirely. By 2027, agents will initiate the majority of commercial queries.
          </p>
        </div>

        {/* URL Inputs */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <h2 className="text-base font-semibold text-[#111827] mb-1">Audit a website's AI agent readiness</h2>
          <p className="text-sm text-[#6B7280] mb-5">
            Provide up to three URLs for a full audit: 13 HTTP checks run on all sites; 10 additional on-page checks require the action and form URLs.
          </p>
          <form onSubmit={handleAudit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Homepage <span style={{ color: '#A32D2D' }}>*</span>
                </label>
                <input
                  type="text"
                  value={urlHomepage}
                  onChange={e => {
                    setUrlHomepage(e.target.value);
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    debounceRef.current = setTimeout(() => discoverLinks(e.target.value), 800);
                  }}
                  onBlur={e => {
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    discoverLinks(e.target.value);
                  }}
                  placeholder="https://example.com"
                  disabled={loading}
                  className="w-full border border-[#E5E7EB] rounded-lg px-4 py-2.5 text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
                />
                {discoverLoading && (
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, border: '1.5px solid #534AB7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    Discovering links…
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }} className="ara-form-grid">
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Key action page <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>optional — product / service page</span>
                  </label>
                  <input
                    type="text"
                    value={urlAction}
                    onChange={e => setUrlAction(e.target.value)}
                    placeholder="https://example.com/product"
                    disabled={loading}
                    className="w-full border border-[#E5E7EB] rounded-lg px-4 py-2.5 text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
                  />
                  {actionSuggestions.length > 0 && !urlAction && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                      {actionSuggestions.map(s => (
                        <button key={s.full} type="button"
                          onClick={() => setUrlAction(s.full)}
                          style={{ fontSize: 11, color: '#534AB7', background: '#EEEDFE', border: '0.5px solid #C4BFEF', borderRadius: 20, padding: '3px 10px', cursor: 'pointer' }}>
                          → {s.path} <span style={{ opacity: 0.6, marginLeft: 3 }}>suggested</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Form / checkout page <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>optional — contact / checkout</span>
                  </label>
                  <input
                    type="text"
                    value={urlForm}
                    onChange={e => setUrlForm(e.target.value)}
                    placeholder="https://example.com/contact"
                    disabled={loading}
                    className="w-full border border-[#E5E7EB] rounded-lg px-4 py-2.5 text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
                  />
                  {formSuggestions.length > 0 && !urlForm && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                      {formSuggestions.map(s => (
                        <button key={s.full} type="button"
                          onClick={() => setUrlForm(s.full)}
                          style={{ fontSize: 11, color: '#534AB7', background: '#EEEDFE', border: '0.5px solid #C4BFEF', borderRadius: 20, padding: '3px 10px', cursor: 'pointer' }}>
                          → {s.path} <span style={{ opacity: 0.6, marginLeft: 3 }}>suggested</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !urlHomepage.trim()}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#534AB7' }}
            >
              {loading ? 'Running audit…' : 'Run Audit'}
            </button>
          </form>

          {loading && (
            <div className="mt-3 flex items-center gap-2 text-sm text-[#6B7280]">
              <div className="w-4 h-4 border-2 border-[#534AB7] border-t-transparent rounded-full animate-spin" />
              Running {urlAction || urlForm ? '23' : '13'} checks
              {(urlAction || urlForm) && ' including browser-rendered on-page checks'}… (~{urlAction || urlForm ? '35' : '15'}s)
            </div>
          )}
          {error && (
            <div className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</div>
          )}
        </div>

        {!result && !loading && (
          <div className="text-center py-16 text-[#9CA3AF]">
            <div className="text-4xl mb-3">🤖</div>
            <p className="text-sm">Enter a URL above to audit its agent readiness.</p>
            <p className="text-xs mt-1">Add the action and form URLs for on-page checks.</p>
          </div>
        )}

        {result && (
          <div style={{ paddingBottom: '1.5rem' }}>
            {/* Site header */}
            <div className="flex items-start justify-between mb-5 ara-header-row">
              <div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
                  Agent Readiness Audit
                </div>
                <h1 style={{ fontSize: 22, fontWeight: 500, margin: '0 0 4px', color: '#111827' }}>
                  {result.site.url}
                </h1>
                <div style={{ fontSize: 13, color: '#6B7280', position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    onMouseEnter={() => setLevelTooltipOpen(true)}
                    onMouseLeave={() => setLevelTooltipOpen(false)}
                    style={{ cursor: 'help', borderBottom: '1px dashed #9CA3AF' }}
                  >
                    {result.site.level}
                  </span>
                  &nbsp;·&nbsp; Scanned {result.site.date}
                  {hasOnPage && <span style={{ marginLeft: 6, fontSize: 11, background: '#EEEDFE', color: '#534AB7', padding: '1px 7px', borderRadius: 10 }}>+10 on-page checks</span>}
                  {levelTooltipOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '8px 12px', zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: 220 }}>
                      {LEVELS.map(l => (
                        <div key={l.level} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', color: result.site.level.includes(l.label) ? '#534AB7' : '#6B7280', fontWeight: result.site.level.includes(l.label) ? 600 : 400 }}>
                          <span>Level {l.level} — {l.label}</span>
                          <span style={{ color: '#9CA3AF' }}>{l.score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={handleDownloadPdf}
                  disabled={pdfLoading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 12, color: '#534AB7', background: '#EEEDFE',
                    border: '0.5px solid #C4BFEF', borderRadius: 7,
                    padding: '6px 12px', cursor: 'pointer',
                    opacity: pdfLoading ? 0.6 : 1,
                  }}
                >
                  {pdfLoading
                    ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #534AB7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Generating…</>
                    : <>⬇ Download PDF</>}
                </button>
                <a href={result.site.full} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: '#534AB7', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {result.site.full} ↗
                </a>
              </div>
            </div>

            {/* Sub-scores banner (only when on-page ran) */}
            {hasOnPage && result.site.onPageScore !== null && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }} className="ara-sub-scores">
                <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>HTTP readiness</div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: result.site.httpScore >= 70 ? '#3B6D11' : result.site.httpScore >= 40 ? '#EF9F27' : '#E24B4A' }}>
                      {result.site.httpScore}<span style={{ fontSize: 12, fontWeight: 400, color: '#9CA3AF' }}>/100</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.5 }}>robots, sitemap, headers,<br />bot access, MCP/OAuth</div>
                </div>
                <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>On-page readiness</div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: result.site.onPageScore >= 70 ? '#3B6D11' : result.site.onPageScore >= 40 ? '#EF9F27' : '#E24B4A' }}>
                      {result.site.onPageScore}<span style={{ fontSize: 12, fontWeight: 400, color: '#9CA3AF' }}>/100</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.5 }}>forms, schema, CAPTCHA,<br />rendering gap, interactivity</div>
                </div>
              </div>
            )}

            {/* Score + Category bars */}
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16, marginBottom: '1.25rem' }} className="ara-score-grid">
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 text-center" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <ScoreRing score={result.site.score} checkCount={checkCount} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 10, color: '#9CA3AF', marginTop: 2, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <span>overall score</span>
                  <button type="button" aria-label="How is this score calculated?"
                    onClick={() => setScorePanelOpen(o => !o)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 13, padding: 0, lineHeight: 1 }}>ⓘ</button>
                </div>
                <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 6 }}>
                  Based on {hasOnPage ? '23 checks (HTTP + on-page)' : '13 HTTP checks'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 11, background: '#EAF3DE', color: '#3B6D11', padding: '3px 8px', borderRadius: 4 }}>✓ {passCount} passed</span>
                  <span style={{ fontSize: 11, background: '#FCEBEB', color: '#A32D2D', padding: '3px 8px', borderRadius: 4 }}>✗ {failCount} failed</span>
                  {infoCount > 0 && (
                    <span style={{ fontSize: 11, background: '#FAEEDA', color: '#854F0B', padding: '3px 8px', borderRadius: 4 }}>i {infoCount} info</span>
                  )}
                </div>
                {delta && (
                  <div style={{ marginTop: 8, fontSize: 11, padding: '3px 8px', borderRadius: 6,
                    background: delta.diff > 0 ? '#EAF3DE' : delta.diff < 0 ? '#FEF3C7' : '#F3F4F6',
                    color: delta.diff > 0 ? '#3B6D11' : delta.diff < 0 ? '#92400E' : '#6B7280',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span>{delta.diff > 0 ? `↑ ${delta.diff} pts` : delta.diff < 0 ? `↓ ${Math.abs(delta.diff)} pts` : 'No change'} since {delta.prevDate}</span>
                    <button type="button" onClick={() => { setDelta(null); localStorage.removeItem(`ara_last_${new URL(result.site.full).hostname}`); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                  </div>
                )}
              </div>

              <div className="bg-white border border-[#E5E7EB] rounded-xl p-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Score by category
                </div>
                {result.cats.map(cat => <CatBar key={cat.id} cat={cat} />)}
                <div style={{ marginTop: 8, padding: '7px 10px', background: '#EEEDFE', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: '#534AB7' }}>
                    📈 Quick wins this week could raise your score to <strong>{Math.min(100, result.site.score + 16)}/100</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Score explanation panel — outside grid */}
            {scorePanelOpen && (
              <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: 10, padding: 14, marginTop: -8, marginBottom: 16 }}>
                <p style={{ fontSize: 12, color: '#374151', margin: '0 0 10px', lineHeight: 1.7 }}>
                  <strong>How this score is calculated</strong><br />
                  The overall score combines up to 23 checks across 6 categories. Each check carries a weight based on its business impact. HTTP checks (13 total) run on every audit and form the foundation score. On-page checks (10 additional) only run when an action page or form URL is provided.
                </p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 10 }}>
                  <thead>
                    <tr>{['Category', 'Checks', 'Total Weight'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #E5E7EB', color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {SCORE_WEIGHTS_TABLE.map(row => (
                      <tr key={row.cat}>
                        <td style={{ padding: '4px 8px', color: '#374151' }}>{row.cat}</td>
                        <td style={{ padding: '4px 8px', color: '#6B7280' }}>{row.checks}</td>
                        <td style={{ padding: '4px 8px', color: '#374151', fontWeight: 500 }}>{row.weight}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0 }}>On-page checks add up to 63 points of possible additional signal. Add your action and form URLs to unlock the full audit.</p>
              </div>
            )}

            {/* Executive Summary */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 mb-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#534AB7', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  ✦ Executive Summary
                </span>
                {result.cmoBrief && (
                  <button type="button" onClick={shareSummary}
                    style={{ fontSize: 11, color: '#534AB7', background: '#EEEDFE', border: '0.5px solid #C4BFEF', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                    {sharedBrief ? '✓ Link copied!' : '⬡ Share summary'}
                  </button>
                )}
              </div>
              {result.cmoBrief ? (
                <>
                  <p style={{ fontSize: 17, fontWeight: 500, color: '#111827', margin: '0 0 10px', lineHeight: 1.4 }}>
                    {result.cmoBrief.headline}
                  </p>
                  <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 16px', lineHeight: 1.7 }}>
                    {result.cmoBrief.summary}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }} className="ara-brief-grid">
                    <div style={{ background: '#FCEBEB', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#A32D2D', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Top risk</div>
                      <p style={{ fontSize: 12, color: '#791F1F', margin: 0, lineHeight: 1.55 }}>{result.cmoBrief.risk}</p>
                    </div>
                    <div style={{ background: '#EAF3DE', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#3B6D11', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>60-day opportunity</div>
                      <p style={{ fontSize: 12, color: '#27500A', margin: 0, lineHeight: 1.55 }}>{result.cmoBrief.opportunity}</p>
                    </div>
                    <div style={{ background: '#EEEDFE', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#534AB7', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Competitive context</div>
                      <p style={{ fontSize: 12, color: '#3C3489', margin: 0, lineHeight: 1.55 }}>{result.cmoBrief.competitive}</p>
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <SkeletonLine w="55%" />
                  <div style={{ height: 8 }} />
                  <SkeletonLine w="100%" /><SkeletonLine w="90%" /><SkeletonLine w="70%" />
                  <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 8 }}>Executive Summary unavailable (check OPENAI_API_KEY)</div>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div role="tablist" style={{ display: 'flex', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1rem' }}>
              {[['findings', `Findings (${allChecks.length})`], ['roadmap', 'Priority roadmap']].map(([t, label]) => (
                <button key={t} type="button"
                  role="tab"
                  aria-selected={tab === t}
                  id={`tab-${t}`}
                  onClick={() => setTab(t)}
                  style={{
                    background: 'none', border: 'none',
                    borderBottom: tab === t ? '2px solid #111827' : '2px solid transparent',
                    padding: '8px 16px', cursor: 'pointer',
                    fontSize: 14, fontWeight: tab === t ? 500 : 400,
                    color: tab === t ? '#111827' : '#6B7280',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Findings tab */}
            {tab === 'findings' && (
              <div role="tabpanel" aria-labelledby="tab-findings">
                {/* Sort controls + filter chips row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {catFilters.map(c => (
                      <button key={c} type="button"
                        aria-pressed={filterCat === c}
                        onClick={() => setFilterCat(c)}
                        style={{
                          fontSize: 12, padding: '4px 11px', borderRadius: 20, cursor: 'pointer',
                          border: '0.5px solid #E5E7EB',
                          background: filterCat === c ? '#111827' : '#F9FAFB',
                          color: filterCat === c ? '#fff' : '#6B7280',
                          fontWeight: filterCat === c ? 500 : 400,
                        }}>
                        {c === 'all' ? `All (${allChecks.length})` : c}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[['priority', 'By priority'], ['category', 'By category']].map(([mode, label]) => (
                      <button key={mode} type="button" onClick={() => setSortMode(mode)}
                        style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, border: '0.5px solid #E5E7EB', cursor: 'pointer',
                          background: sortMode === mode ? '#111827' : '#F9FAFB', color: sortMode === mode ? '#fff' : '#6B7280' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Findings legend */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                  {[
                    { bg: '#EAF3DE', color: '#3B6D11', label: 'Pass' },
                    { bg: '#FCEBEB', color: '#A32D2D', label: 'Fail' },
                    { bg: '#FEF3C7', color: '#92400E', label: 'Flag (advisory)' },
                    { bg: '#FAEEDA', color: '#854F0B', label: 'Info' },
                  ].map(b => (
                    <span key={b.label} style={{ fontSize: 10, background: b.bg, color: b.color, padding: '2px 7px', borderRadius: 4, fontWeight: 500 }}>
                      {b.label}
                    </span>
                  ))}
                </div>

                {/* Agentic Protocol callout (when all failing) */}
                {agenticAllFailing && (filterCat === 'all' || filterCat === 'API / Auth / MCP') && (
                  <div style={{ background: '#FFFBEB', border: '0.5px solid #F59E0B', borderRadius: 8, padding: '10px 14px', marginBottom: 10, borderLeft: '3px solid #F59E0B' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>Agentic Protocol Setup — None configured</div>
                    <p style={{ fontSize: 12, color: '#78350F', margin: 0, lineHeight: 1.6 }}>
                      <strong>None of these protocols are configured.</strong> These are emerging standards for AI agent integration. They're not required today, but sites that adopt them early will have a significant advantage as agent traffic grows. Start with API catalog — it's a medium lift and unlocks the most downstream value.
                    </p>
                  </div>
                )}

                <div className="bg-white border border-[#E5E7EB] rounded-xl px-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                  {filtered.map((check, i) => (
                    <CheckRow
                      key={check.id}
                      check={check}
                      open={expanded === check.id}
                      isLast={i === filtered.length - 1}
                      onToggle={() => setExpanded(expanded === check.id ? null : check.id)}
                    />
                  ))}
                </div>
                {!hasOnPage && (
                  <div style={{ marginTop: 10, padding: '8px 14px', background: '#FFFBEB', borderRadius: 8, fontSize: 12, color: '#92400E' }}>
                    💡 Add an action page and form page URL above to unlock 10 additional on-page checks covering forms, schema markup, CAPTCHA, and rendering gaps.
                  </div>
                )}
              </div>
            )}

            {/* Roadmap tab */}
            {tab === 'roadmap' && (
              <div role="tabpanel" aria-labelledby="tab-roadmap">
                {/* Copy as checklist button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <button type="button" onClick={copyRoadmap}
                    style={{ fontSize: 12, color: '#534AB7', background: '#EEEDFE', border: '0.5px solid #C4BFEF', borderRadius: 7, padding: '6px 12px', cursor: 'pointer' }}>
                    {copiedRoadmap ? '✓ Copied!' : '⎘ Copy as checklist'}
                  </button>
                </div>

                <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 1rem', lineHeight: 1.6 }}>
                  Prioritized by impact-to-effort ratio. Quick wins deliver immediate governance and discoverability signal; the strategic horizon positions you for the AI agent economy.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }} className="ara-roadmap-grid">
                  {ROADMAP.map(tier => {
                    const tierChecks = tier.checkIds
                      .map(id => allChecks.find(c => c.id === id))
                      .filter(Boolean);
                    if (tierChecks.length === 0) return null;
                    return (
                      <div key={tier.tier} className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                        <div style={{ background: tier.bg, padding: '14px 16px' }}>
                          <span style={{ fontSize: 14, fontWeight: 500, color: tier.color }}>{tier.tier}</span>
                          <div style={{ fontSize: 12, color: tier.color, marginTop: 2, opacity: 0.8 }}>{tier.sub}</div>
                        </div>
                        <div style={{ padding: '12px 16px' }}>
                          {tierChecks.map((check, i) => (
                            <div key={check.id} style={{
                              paddingBottom: i < tierChecks.length - 1 ? 12 : 0,
                              marginBottom: i < tierChecks.length - 1 ? 12 : 0,
                              borderBottom: i < tierChecks.length - 1 ? '0.5px solid #F3F4F6' : 'none',
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: SC[check.status]?.bg, color: SC[check.status]?.color }}>
                                  {check.status === 'pass' ? '✓ Done' : check.flagOnly ? '⚑ Flag' : '✗ Missing'}
                                </span>
                                <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{check.label}</span>
                              </div>
                              <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.4, marginBottom: 5 }}>
                                {check.action ? check.action.split('.')[0] + '.' : 'Already implemented.'}
                              </div>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
                                {check.status === 'pass' ? (
                                  <span style={{ fontSize: 11, color: '#3B6D11', background: '#EAF3DE', padding: '2px 7px', borderRadius: 3 }}>✓ Done</span>
                                ) : (
                                  <>
                                    <span style={{ fontSize: 11, color: tier.color, background: tier.bg, padding: '2px 7px', borderRadius: 3 }}>
                                      {EC[check.effort]?.label || 'Medium lift'} · {EFFORT_TIME[check.effort] || tier.efforts[check.id] || '–'}
                                    </span>
                                    <span style={{ fontSize: 10, color: '#6B7280', background: '#F3F4F6', padding: '2px 7px', borderRadius: 10 }}>
                                      {ROLE_MAP[check.id] || 'Team'}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: '1rem', padding: '10px 14px', background: '#F9FAFB', borderRadius: 8 }}>
                  <span style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>
                    ℹ Effort estimates assume a developer familiar with your stack. WebMCP is not checkable via HTTP — marked fail by default. On-page checks require the action/form URLs to be provided. Score gain estimates are approximate.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 640px) {
          .ara-score-grid { grid-template-columns: 1fr !important; }
          .ara-sub-scores { grid-template-columns: 1fr !important; }
          .ara-roadmap-grid { grid-template-columns: 1fr !important; }
          .ara-header-row { flex-direction: column !important; align-items: flex-start !important; gap: 10px !important; }
          .ara-brief-grid { grid-template-columns: 1fr !important; }
          .ara-form-grid { grid-template-columns: 1fr !important; }
          .ara-copy-btn, .ara-share-btn { width: 100%; justify-content: center; }
        }
      `}</style>
    </div>
  );
}
