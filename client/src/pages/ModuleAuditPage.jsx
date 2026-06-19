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
      <main className="max-w-7xl mx-auto px-8 py-7">
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-[#111827]">Dependency Audit</h1>
          <p className="text-sm text-[#6B7280] mt-1">Full health check of module-to-KB bindings. Fix broken links before running modules.</p>
        </div>

        {loading && <p className="text-sm text-[#6B7280]">Running audit…</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}

        {audit && (
          <div className="space-y-6">
            {/* Summary strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total KBs', value: audit.summary.total_kbs, color: '#111827' },
                { label: 'Active KBs', value: audit.summary.active_kbs, color: '#3DAA8E' },
                { label: 'Errors', value: audit.summary.errors, color: '#DC2626' },
                { label: 'Warnings', value: audit.summary.warnings, color: '#D97706' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                  <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-xs text-[#6B7280] mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Module audit */}
            <div>
              <h2 className="text-base font-semibold text-[#111827] mb-3">Module Health</h2>
              <div className="space-y-4">
                {audit.modules.map(mod => (
                  <div key={mod.module_id} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                    <div className="flex items-center justify-between px-5 py-3.5 bg-[#F9FAFB] border-b border-[#E5E7EB]">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-sm text-[#111827]">{mod.label}</span>
                        <span className="font-mono text-xs text-[#9CA3AF]">{mod.module_id}</span>
                      </div>
                      <KBStatusBadge health={mod.health} />
                    </div>
                    <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2">Required KBs</div>
                        <div className="space-y-1.5">
                          {mod.required.map((kb, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <KBStatusBadge health={kb.status === 'OK' ? 'OK' : kb.status === 'TEMPLATE' ? 'INFO' : 'ERROR'} size="sm" />
                              <span className="text-xs text-[#111827] font-mono">{kb.pattern}</span>
                              {kb.reason && <span className="text-xs text-red-500">— {kb.reason}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2">Optional KBs</div>
                        <div className="space-y-1.5">
                          {mod.optional.map((kb, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <KBStatusBadge health={kb.status === 'OK' ? 'OK' : kb.status === 'TEMPLATE' ? 'INFO' : 'WARNING'} size="sm" />
                              <span className="text-xs text-[#111827] font-mono">{kb.pattern}</span>
                              {kb.reason && <span className="text-xs text-yellow-600">— {kb.reason}</span>}
                            </div>
                          ))}
                          {mod.optional.length === 0 && <span className="text-xs text-[#9CA3AF]">None</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* KB health */}
            <div>
              <h2 className="text-base font-semibold text-[#111827] mb-3">Knowledge Base Health</h2>
              <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                      <th className="text-left text-xs font-semibold text-[#6B7280] px-4 py-3">KB ID</th>
                      <th className="text-left text-xs font-semibold text-[#6B7280] px-4 py-3">Category</th>
                      <th className="text-left text-xs font-semibold text-[#6B7280] px-4 py-3">Client</th>
                      <th className="text-left text-xs font-semibold text-[#6B7280] px-4 py-3">Status</th>
                      <th className="text-left text-xs font-semibold text-[#6B7280] px-4 py-3">Flags</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {audit.knowledge_bases.map(kb => (
                      <tr key={kb.id} className="hover:bg-[#F9FAFB] transition-colors">
                        <td className="px-4 py-3 font-medium text-[#111827] font-mono text-xs">{kb.id}</td>
                        <td className="px-4 py-3 text-[#6B7280] text-xs">{kb.category}</td>
                        <td className="px-4 py-3 text-[#6B7280] text-xs">{kb.client}</td>
                        <td className="px-4 py-3"><KBStatusBadge health={kb.health} /></td>
                        <td className="px-4 py-3">
                          {kb.flags.length === 0
                            ? <span className="text-xs text-[#9CA3AF]">None</span>
                            : <div className="space-y-0.5">
                                {kb.flags.map((f, i) => (
                                  <div key={i} className="text-xs" style={{ color: f.level === 'ERROR' ? '#DC2626' : f.level === 'WARNING' ? '#D97706' : '#6B7280' }}>
                                    {f.msg}
                                  </div>
                                ))}
                              </div>
                          }
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => navigate(`/kb/${kb.id}`)}
                            className="text-xs font-medium" style={{ color: '#3DAA8E' }}>
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
