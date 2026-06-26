import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import KBStatusBadge from '../components/KBStatusBadge';

export default function ModuleAuditPage() {
  const navigate = useNavigate();
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/audit', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setAudit(d); setLoading(false); })
      .catch(() => { setError('Failed to load audit data.'); setLoading(false); });
  }, []);

  return (
    <main style={{ maxWidth: '80rem', margin: '0 auto', padding: '1.75rem 2rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>Dependency Audit</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', marginTop: '0.25rem' }}>Full health check of module-to-KB bindings. Fix broken links before running modules.</p>
      </div>

      {loading && <p style={{ fontSize: '0.875rem', color: 'var(--text-2)' }}>Running audit…</p>}
      {error && <p style={{ fontSize: '0.875rem', color: 'var(--danger)' }}>{error}</p>}

      {audit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
            {[
              { label: 'Total KBs', value: audit.summary.total_kbs, color: 'var(--text)' },
              { label: 'Active KBs', value: audit.summary.active_kbs, color: 'var(--primary)' },
              { label: 'Errors', value: audit.summary.errors, color: 'var(--danger)' },
              { label: 'Warnings', value: audit.summary.warnings, color: 'var(--warning)' },
            ].map(s => (
              <div key={s.label} style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)',
                padding: '1.25rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
              }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-2)', marginTop: '0.25rem' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Module audit */}
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.75rem' }}>Module Health</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {audit.modules.map(mod => (
                <div key={mod.module_id} style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.875rem 1.25rem',
                    background: 'var(--surface)',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text)' }}>{mod.label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-3)' }}>{mod.module_id}</span>
                    </div>
                    <KBStatusBadge health={mod.health} />
                  </div>
                  <div style={{
                    padding: '1rem 1.25rem',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1rem',
                  }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Required KBs</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                        {mod.required.map((kb, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <KBStatusBadge health={kb.status === 'OK' ? 'OK' : kb.status === 'TEMPLATE' ? 'INFO' : 'ERROR'} size="sm" />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{kb.pattern}</span>
                            {kb.reason && <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>— {kb.reason}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Optional KBs</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                        {mod.optional.map((kb, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <KBStatusBadge health={kb.status === 'OK' ? 'OK' : kb.status === 'TEMPLATE' ? 'INFO' : 'WARNING'} size="sm" />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{kb.pattern}</span>
                            {kb.reason && <span style={{ fontSize: '0.75rem', color: 'var(--warning)' }}>— {kb.reason}</span>}
                          </div>
                        ))}
                        {mod.optional.length === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>None</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* KB health */}
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.75rem' }}>Knowledge Base Health</h2>
            <div style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
            }}>
              <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                    {['KB ID', 'Category', 'Client', 'Status', 'Flags', ''].map((h, i) => (
                      <th key={i} style={{
                        textAlign: 'left',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: 'var(--text-2)',
                        padding: '0.75rem 1rem',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {audit.knowledge_bases.map((kb, idx) => (
                    <tr key={kb.id} style={{
                      borderBottom: idx < audit.knowledge_bases.length - 1 ? '1px solid var(--surface)' : 'none',
                      transition: 'background 0.15s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{kb.id}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-2)', fontSize: '0.75rem' }}>{kb.category}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-2)', fontSize: '0.75rem' }}>{kb.client}</td>
                      <td style={{ padding: '0.75rem 1rem' }}><KBStatusBadge health={kb.health} /></td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {kb.flags.length === 0
                          ? <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>None</span>
                          : <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                              {kb.flags.map((f, i) => (
                                <div key={i} style={{
                                  fontSize: '0.75rem',
                                  color: f.level === 'ERROR' ? 'var(--danger)' : f.level === 'WARNING' ? 'var(--warning)' : 'var(--text-2)',
                                }}>
                                  {f.msg}
                                </div>
                              ))}
                            </div>
                        }
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <button
                          onClick={() => navigate(`/kb/${kb.id}`)}
                          style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          Edit →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
