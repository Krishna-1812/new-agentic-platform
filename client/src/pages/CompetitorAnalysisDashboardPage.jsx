import { useState, useEffect, useRef, useCallback } from 'react';
import { SectionHeader } from '../ui/SectionHeader';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Field } from '../ui/Field';
import { Card } from '../ui/Card';
import { Tabs } from '../ui/Tabs';
import { Drawer } from '../ui/Drawer';
import { EmptyState } from '../ui/EmptyState';
import { MetricCard } from '../ui/MetricCard';
import { useToast } from '../ui/Toast';
import { ct } from '../lib/competitorTrackerApi';
import OverviewTab from '../components/competitorAnalysisDashboard/OverviewTab';
import PageSpeedTab from '../components/competitorAnalysisDashboard/PageSpeedTab';
import KeywordGapTab from '../components/competitorAnalysisDashboard/KeywordGapTab';
import BacklinkTab from '../components/competitorAnalysisDashboard/BacklinkTab';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'pagespeed', label: 'Page Speed' },
  { key: 'keywordGap', label: 'Keyword Gap' },
  { key: 'backlinks', label: 'Backlinks' },
];

const EMPTY_CLIENT_FORM = { name: '', domain: '', country: 'United States', brandName: '' };

export default function CompetitorAnalysisDashboardPage() {
  const toast = useToast();

  const [meta, setMeta] = useState(null);
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [client, setClient] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_CLIENT_FORM);
  const [savedClient, setSavedClient] = useState(null); // client being edited, once persisted
  const [savingClient, setSavingClient] = useState(false);
  const [newCompetitor, setNewCompetitor] = useState({ domain: '', label: '' });

  const pollRef = useRef(null);

  const refreshClients = useCallback(async (selectId) => {
    const { clients: list } = await ct.clients();
    setClients(list);
    if (selectId) setSelectedClientId(selectId);
    else if (!selectId && list.length && !list.find((c) => c.id === selectedClientId)) {
      setSelectedClientId(list[0].id);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDashboard = useCallback(async (clientId) => {
    if (!clientId) { setClient(null); setSnapshot(null); return; }
    setLoadingDashboard(true);
    try {
      const data = await ct.dashboard(clientId);
      setClient(data.client);
      setSnapshot(data.snapshot);
    } catch (e) {
      toast.add({ title: 'Failed to load dashboard', description: e.message, variant: 'danger' });
    } finally {
      setLoadingDashboard(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    ct.meta().then(setMeta).catch(() => {});
    refreshClients();
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadDashboard(selectedClientId);
  }, [selectedClientId, loadDashboard]);

  function startPolling(clientId) {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await ct.runStatus(clientId);
        if (status.status === 'done') {
          clearInterval(pollRef.current);
          setRunning(false);
          toast.add({ title: 'Analysis complete', variant: 'success' });
          loadDashboard(clientId);
        } else if (status.status === 'error') {
          clearInterval(pollRef.current);
          setRunning(false);
          toast.add({ title: 'Analysis failed', description: status.error, variant: 'danger' });
        }
      } catch { /* transient — keep polling */ }
    }, 1200);
  }

  async function handleRun() {
    if (!selectedClientId || running) return;
    setRunning(true);
    try {
      await ct.run(selectedClientId);
      startPolling(selectedClientId);
    } catch (e) {
      setRunning(false);
      toast.add({ title: 'Could not start run', description: e.message, variant: 'danger' });
    }
  }

  function openAddClient() {
    setForm(EMPTY_CLIENT_FORM);
    setSavedClient(null);
    setDrawerOpen(true);
  }

  function openEditClient() {
    if (!client) return;
    setForm({ name: client.name, domain: client.domain, country: client.country, brandName: client.brandName });
    setSavedClient(client);
    setDrawerOpen(true);
  }

  async function handleSaveClient() {
    if (!form.name.trim() || !form.domain.trim()) {
      toast.add({ title: 'Name and domain are required', variant: 'danger' });
      return;
    }
    setSavingClient(true);
    try {
      const result = savedClient
        ? await ct.updateClient(savedClient.id, form)
        : await ct.createClient(form);
      setSavedClient(result.client);
      const list = await refreshClients(result.client.id);
      if (result.client.id === selectedClientId) loadDashboard(selectedClientId);
      if (!list.find((c) => c.id === selectedClientId)) setSelectedClientId(result.client.id);
      toast.add({ title: 'Client saved', variant: 'success' });
    } catch (e) {
      toast.add({ title: 'Failed to save client', description: e.message, variant: 'danger' });
    } finally {
      setSavingClient(false);
    }
  }

  async function handleDeleteClient() {
    if (!savedClient) return;
    if (!window.confirm(`Delete ${savedClient.name}? This removes its saved data too.`)) return;
    try {
      await ct.deleteClient(savedClient.id);
      setDrawerOpen(false);
      setSelectedClientId('');
      await refreshClients();
      toast.add({ title: 'Client deleted', variant: 'success' });
    } catch (e) {
      toast.add({ title: 'Failed to delete client', description: e.message, variant: 'danger' });
    }
  }

  async function handleAddCompetitor() {
    if (!savedClient || !newCompetitor.domain.trim()) return;
    if (savedClient.competitors.length >= maxCompetitors) return;
    try {
      await ct.addCompetitor(savedClient.id, newCompetitor);
      const { clients: list } = await ct.clients();
      setClients(list);
      setSavedClient(list.find((c) => c.id === savedClient.id));
      setNewCompetitor({ domain: '', label: '' });
      if (savedClient.id === selectedClientId) loadDashboard(selectedClientId);
    } catch (e) {
      toast.add({ title: 'Failed to add competitor', description: e.message, variant: 'danger' });
    }
  }

  async function handleRemoveCompetitor(competitorId) {
    if (!savedClient) return;
    try {
      await ct.removeCompetitor(savedClient.id, competitorId);
      const { clients: list } = await ct.clients();
      setClients(list);
      setSavedClient(list.find((c) => c.id === savedClient.id));
      if (savedClient.id === selectedClientId) loadDashboard(selectedClientId);
    } catch (e) {
      toast.add({ title: 'Failed to remove competitor', description: e.message, variant: 'danger' });
    }
  }

  const usedUnits = snapshot?.usedUnits;
  const capUnits = snapshot?.capUnits ?? meta?.capUnits;
  const skipped = snapshot?.skipped || [];
  const maxCompetitors = meta?.maxCompetitors ?? 4;
  const atCompetitorLimit = (savedClient?.competitors?.length ?? 0) >= maxCompetitors;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <SectionHeader
        eyebrow="Optimize"
        title="Competitor Analysis"
        subtitle="Track a client against its competitors — SEMrush data and keyword gaps in one dashboard."
        actions={(
          <>
            {client && <Button variant="secondary" onClick={openEditClient}>Manage Client</Button>}
            <Button variant="secondary" onClick={openAddClient}>Add Client</Button>
            <Button variant="primary" onClick={handleRun} loading={running} disabled={!selectedClientId}>
              {running ? 'Running…' : 'Run Analysis'}
            </Button>
          </>
        )}
      />

      <Card
        style={{
          marginBottom: 20,
          background: meta?.liveDataSource ? 'var(--success-soft)' : 'var(--warning-soft)',
          border: `1px solid ${meta?.liveDataSource ? 'var(--success)' : 'var(--warning)'}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text)' }}>
          {meta?.liveDataSource ? (
            <>
              <Badge variant="success">Live data</Badge>
              <span>
                Pulling real SEMrush data. Every run is hard-capped at 10,000 SEMrush units — competitors
                beyond that cap are skipped, not fetched.
              </span>
            </>
          ) : (
            <>
              <Badge variant="warning">Simulated data</Badge>
              <span>
                SEMrush isn't connected yet — every number here is generated by a mock data provider so the
                dashboard and keyword-gap pipeline can be built and tested with zero API spend. Swapping in
                live SEMrush later is a change to one file (the data provider), not this page.
              </span>
            </>
          )}
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 260 }}>
          <Field
            as="select"
            label="Client"
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
          >
            <option value="" disabled>Select a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Field>
        </div>

        {client && (
          <div style={{ fontSize: 13, color: 'var(--text-2)', paddingBottom: 8 }}>
            {client.domain} · {client.competitors.length}/{maxCompetitors} competitors
            {meta && ` · ${meta.estimatedCostPerDomain.toLocaleString()} ${meta.liveDataSource ? 'SEMrush' : 'simulated'} units/domain (10,000-unit cap per run)`}
          </div>
        )}
      </div>

      {snapshot && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
          <MetricCard label="Last Run" value={new Date(snapshot.capturedAt).toLocaleString()} />
          <MetricCard
            label={meta?.liveDataSource ? 'SEMrush Units Used' : 'Simulated Units Used'}
            value={`${usedUnits.toLocaleString()} / ${capUnits.toLocaleString()}`}
            deltaVariant={skipped.length ? 'warning' : 'success'}
            delta={skipped.length ? `${skipped.length} skipped` : 'All fetched'}
          />
          <MetricCard label="Domains Analyzed" value={snapshot.domains.length} />
        </div>
      )}

      {skipped.length > 0 && (
        <Card style={{ marginBottom: 20, background: 'var(--danger-soft)', border: '1px solid var(--danger)' }}>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>
            <strong>Budget cap reached this run.</strong> {skipped.length} competitor{skipped.length === 1 ? '' : 's'} weren't
            fetched to stay under the 10,000-unit-per-run limit: {skipped.join(', ')}.
          </div>
        </Card>
      )}

      {!selectedClientId ? (
        <EmptyState
          title="No client selected"
          description="Add a client and its competitors to start tracking."
          action={<Button variant="primary" onClick={openAddClient}>Add Client</Button>}
        />
      ) : !snapshot && !loadingDashboard ? (
        <EmptyState
          title="No analysis yet"
          description="Run an analysis to populate this dashboard with (simulated) SEMrush data."
          action={<Button variant="primary" onClick={handleRun} loading={running}>Run Analysis</Button>}
        />
      ) : (
        <>
          <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
          <div style={{ marginTop: 20 }}>
            {activeTab === 'overview' && <OverviewTab snapshot={snapshot} />}
            {activeTab === 'pagespeed' && <PageSpeedTab snapshot={snapshot} />}
            {activeTab === 'keywordGap' && <KeywordGapTab snapshot={snapshot} />}
            {activeTab === 'backlinks' && <BacklinkTab snapshot={snapshot} />}
          </div>
        </>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={savedClient ? 'Manage Client' : 'Add Client'}
        footer={(
          <>
            {savedClient && <Button variant="danger" onClick={handleDeleteClient} style={{ marginRight: 'auto' }}>Delete Client</Button>}
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>Close</Button>
            <Button variant="primary" onClick={handleSaveClient} loading={savingClient}>Save</Button>
          </>
        )}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Client Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Dental" />
          <Field label="Domain" required value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="acmedental.com" />
          <Field label="Country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="United States" />
          <Field label="Brand Name" helper="Used for branded-keyword counting" value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} placeholder="Acme" />

          {savedClient && (
            <>
              <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                Competitors ({savedClient.competitors.length}/{maxCompetitors})
              </div>
              {savedClient.competitors.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No competitors added yet.</div>
              )}
              {savedClient.competitors.map((comp) => (
                <div key={comp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>{comp.label} <span style={{ color: 'var(--text-3)' }}>({comp.domain})</span></span>
                  <Button variant="ghost" size="sm" onClick={() => handleRemoveCompetitor(comp.id)}>Remove</Button>
                </div>
              ))}
              {atCompetitorLimit ? (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Maximum of {maxCompetitors} competitors reached. Remove one to add another.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <Field label="Competitor Domain" value={newCompetitor.domain} onChange={(e) => setNewCompetitor({ ...newCompetitor, domain: e.target.value })} placeholder="competitor.com" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Field label="Label" value={newCompetitor.label} onChange={(e) => setNewCompetitor({ ...newCompetitor, label: e.target.value })} placeholder="Main Competitor" />
                  </div>
                  <Button variant="secondary" onClick={handleAddCompetitor}>Add</Button>
                </div>
              )}
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}
