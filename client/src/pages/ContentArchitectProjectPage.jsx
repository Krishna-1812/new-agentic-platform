import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SectionHeader } from '../ui/SectionHeader';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { DataTable } from '../ui/DataTable';
import { ProgressSteps } from '../ui/ProgressSteps';
import { useToast } from '../ui/Toast';
import { ca } from '../lib/contentArchitectApi';

const DISCOVER_STEPS = [
  { id: 'sitemap', label: 'Find sitemap' },
  { id: 'crawl-fallback', label: 'Crawl fallback' },
  { id: 'patterns', label: 'Group patterns' },
];

const CLASSIFICATION_META = {
  article: { label: 'Article', variant: 'success' },
  service: { label: 'Service', variant: 'info' },
  location: { label: 'Location', variant: 'info' },
  exclude: { label: 'Exclude', variant: 'danger' },
  static: { label: 'Static', variant: 'neutral' },
  unknown: { label: 'Unknown', variant: 'warning' },
};

const VERTICAL_OPTIONS = ['dental', 'healthcare', 'legal', 'saas', 'ecommerce', 'home-services', 'other'];

export default function ContentArchitectProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [project, setProject] = useState(null);
  const [screen, setScreen] = useState('loading'); // loading | discovering | patterns
  const [steps, setSteps] = useState({});
  const [error, setError] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [vertical, setVertical] = useState(null);
  const [discoverMeta, setDiscoverMeta] = useState(null);
  const [saving, setSaving] = useState(false);
  const esRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => () => esRef.current?.close(), []);

  useEffect(() => {
    (async () => {
      try {
        const proj = await ca.getProject(id);
        setProject(proj);
        if (proj.workflowState === 'created') {
          if (!startedRef.current) { startedRef.current = true; startDiscovery(); }
        } else {
          setVertical(proj.vertical);
          const existing = await ca.getPatterns(id).catch(() => null);
          setPatterns(existing || []);
          setScreen('patterns');
        }
      } catch (e) {
        setError(e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function startDiscovery() {
    setScreen('discovering');
    setError(null);
    setSteps({});
    try {
      const { token } = await ca.discoverInit(id);
      const es = new EventSource(ca.discoverStreamUrl(id, token));
      esRef.current = es;
      es.addEventListener('step', (e) => {
        const d = JSON.parse(e.data);
        setSteps((prev) => ({ ...prev, [d.id]: { status: d.status, message: d.message } }));
      });
      es.addEventListener('ready', (e) => {
        const d = JSON.parse(e.data);
        setPatterns(d.patterns);
        setVertical(d.vertical);
        setDiscoverMeta(d);
        setScreen('patterns');
      });
      es.addEventListener('fail', (e) => {
        const d = JSON.parse(e.data);
        setError(d.message);
      });
      es.addEventListener('done', () => es.close());
      es.onerror = () => es.close();
    } catch (e) {
      setError(e.message);
    }
  }

  function toggleIncluded(pattern) {
    setPatterns((prev) => prev.map((p) => (p.pattern === pattern ? { ...p, included: !p.included } : p)));
  }

  async function confirmPatterns() {
    setSaving(true);
    try {
      await ca.savePatterns(id, patterns.map((p) => ({ pattern: p.pattern, included: p.included })), vertical);
      toast.add({ title: 'Patterns saved', description: 'Clustering (Checkpoint 2) isn’t built yet — this just locks in your URL selection for now.', variant: 'success' });
    } catch (e) {
      toast.add({ title: 'Save failed', description: e.message, variant: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  const totalUrls = patterns.reduce((sum, p) => sum + p.count, 0);
  const selectedUrls = patterns.filter((p) => p.included).reduce((sum, p) => sum + p.count, 0);

  const progressSteps = DISCOVER_STEPS
    .filter((s) => steps[s.id])
    .map((s) => ({ label: s.label, status: steps[s.id]?.status === 'done' ? 'done' : 'active' }));

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <SectionHeader
        eyebrow="Build · Content Architect"
        title={project?.name || 'Loading…'}
        subtitle={project?.domain}
        actions={<Button variant="secondary" onClick={() => navigate('/content-architect')}>All Projects</Button>}
      />

      {error && (
        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: 'var(--danger)', flex: 1, fontSize: 13 }}>{error}</span>
            <Button variant="secondary" size="sm" onClick={startDiscovery}>Retry</Button>
          </div>
        </Card>
      )}

      {screen === 'loading' && !error && <EmptyState title="Loading project…" />}

      {screen === 'discovering' && (
        <Card>
          <div style={{ marginBottom: 16 }}>
            <ProgressSteps steps={progressSteps.length ? progressSteps : [{ label: 'Starting…', status: 'active' }]} layout="vertical" />
          </div>
          {Object.entries(steps).map(([k, v]) => (
            <div key={k} style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{v.message}</div>
          ))}
        </Card>
      )}

      {screen === 'patterns' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {discoverMeta?.capped && (
            <Card style={{ background: 'var(--warning-soft)' }}>
              <div style={{ fontSize: 13 }}>
                Hit the <strong>{discoverMeta.capReason}</strong> limit while reading the sitemap — results may be a partial sample.
              </div>
            </Card>
          )}
          {discoverMeta?.skippedSitemaps?.length > 0 && (
            <Card>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                Skipped {discoverMeta.skippedSitemaps.length} sitemap file(s) that couldn't be read (media sitemaps, broken links, etc.) — this is normal.
              </div>
            </Card>
          )}

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Detected vertical:</span>
                <select
                  value={vertical || 'other'}
                  onChange={(e) => setVertical(e.target.value)}
                  style={{ fontSize: 12, padding: '4px 8px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-strong)', background: 'var(--card)', color: 'var(--text)' }}
                >
                  {VERTICAL_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                Analyzing {selectedUrls.toLocaleString()} of {totalUrls.toLocaleString()} URLs
              </div>
            </div>
          </Card>

          <DataTable
            columns={[
              {
                key: 'included', label: '', sortable: false, width: 40,
                render: (v, row) => (
                  <input type="checkbox" checked={!!v} onChange={() => toggleIncluded(row.pattern)} style={{ cursor: 'pointer' }} />
                ),
              },
              { key: 'pattern', label: 'Pattern', mono: true },
              { key: 'count', label: 'Count', align: 'right' },
              {
                key: 'classification', label: 'Classification',
                render: (v) => {
                  const meta = CLASSIFICATION_META[v] || { label: v, variant: 'neutral' };
                  return <Badge variant={meta.variant}>{meta.label}</Badge>;
                },
              },
              {
                key: 'examples', label: 'Examples', sortable: false, maxWidth: 380, wrap: true,
                render: (v) => (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {(v || []).map((u) => <span key={u} style={{ fontSize: 11, color: 'var(--text-3)' }}>{u}</span>)}
                  </div>
                ),
              },
            ]}
            rows={patterns.map((p) => ({ id: p.pattern, ...p }))}
            striped
            emptyText="No patterns found."
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={confirmPatterns} loading={saving} disabled={saving}>
              {saving ? 'Saving…' : 'Confirm Patterns'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
