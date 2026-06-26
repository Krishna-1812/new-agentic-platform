import { useState, useEffect } from 'react';

export default function InputForm({ onSubmit, loading, mode, onModeChange }) {
  const [form, setForm] = useState({
    brandName: '',
    targetUrl: '',
    analysisLevel: 'domain',
    subUrl: '',
    country: 'United States',
    dateFrom: '',
    dateTo: '',
    maxCompetitors: 5,
  });
  const [countries, setCountries] = useState(['United States', 'United Kingdom', 'Australia', 'Canada', 'India']);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    const now = new Date();
    const from = new Date(now);
    from.setMonth(from.getMonth() - 1);
    setForm(f => ({
      ...f,
      dateFrom: from.toISOString().split('T')[0],
      dateTo: now.toISOString().split('T')[0],
    }));

    fetch('/api/competitor-analysis/countries')
      .then(r => r.json())
      .then(d => { if (d.countries?.length) setCountries(d.countries); })
      .catch(() => {});
  }, []);

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => ({ ...e, [field]: undefined }));
  }

  function validate() {
    const errs = {};
    if (!form.brandName.trim()) errs.brandName = 'Required';
    if (!form.targetUrl.trim()) errs.targetUrl = 'Required';
    else if (!/^[a-z0-9.-]+\.[a-z]{2,}/i.test(form.targetUrl.replace(/^https?:\/\//, ''))) {
      errs.targetUrl = 'Enter a valid domain (e.g. example.com)';
    }
    if (form.analysisLevel === 'suburl' && !form.subUrl.trim()) {
      errs.subUrl = 'Sub-URL path is required (e.g. /services/)';
    }
    if (!form.country) errs.country = 'Required';
    if (!form.dateFrom || !form.dateTo) errs.dateRange = 'Both dates are required';
    return errs;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    const cleanDomain = form.targetUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    onSubmit({
      brandName: form.brandName.trim(),
      targetUrl: cleanDomain,
      analysisLevel: form.analysisLevel,
      subUrl: form.analysisLevel === 'suburl' ? form.subUrl : null,
      country: form.country,
      dateRange: { from: form.dateFrom, to: form.dateTo },
      maxCompetitors: form.maxCompetitors,
      mode,
    });
  }

  const inputStyle = (hasError) => ({
    width: '100%',
    border: `1px solid ${hasError ? 'var(--danger)' : 'var(--border)'}`,
    borderRadius: 'var(--r-lg)',
    padding: '10px 12px',
    fontSize: 14,
    color: 'var(--text)',
    background: 'var(--card)',
    outline: 'none',
    boxSizing: 'border-box',
  });

  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 };
  const errStyle = { fontSize: 12, color: 'var(--danger)', marginTop: 4 };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Data Source mode toggle */}
      <div>
        <label style={labelStyle}>Data Source</label>
        <div style={{ display: 'flex', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          {[
            { id: 'api', label: 'Semrush API', desc: 'Auto-pull data' },
            { id: 'manual', label: 'Manual Upload', desc: 'Upload CSV exports' },
          ].map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onModeChange(opt.id)}
              style={{
                flex: 1, padding: '10px 12px', textAlign: 'left', border: 'none', cursor: 'pointer',
                background: mode === opt.id ? 'var(--primary)' : 'var(--card)',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: mode === opt.id ? '#fff' : 'var(--text)' }}>{opt.label}</div>
              <div style={{ fontSize: 12, marginTop: 2, color: mode === opt.id ? 'rgba(255,255,255,0.75)' : 'var(--text-3)' }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Brand Name */}
        <div>
          <label style={labelStyle}>Brand Name *</label>
          <input
            type="text"
            placeholder="e.g. Acalvio"
            maxLength={80}
            value={form.brandName}
            onChange={e => set('brandName', e.target.value)}
            style={inputStyle(errors.brandName)}
          />
          {errors.brandName && <p style={errStyle}>{errors.brandName}</p>}
        </div>

        {/* Target URL */}
        <div>
          <label style={labelStyle}>Target URL *</label>
          <input
            type="text"
            placeholder="e.g. acalvio.com"
            value={form.targetUrl}
            onChange={e => set('targetUrl', e.target.value)}
            style={inputStyle(errors.targetUrl)}
          />
          {errors.targetUrl && <p style={errStyle}>{errors.targetUrl}</p>}
        </div>
      </div>

      {/* Analysis Level */}
      <div>
        <label style={labelStyle}>Analysis Level *</label>
        <div style={{ display: 'flex', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          {['domain', 'suburl'].map(lvl => (
            <button
              key={lvl}
              type="button"
              onClick={() => set('analysisLevel', lvl)}
              style={{
                flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer',
                background: form.analysisLevel === lvl ? 'var(--primary)' : 'var(--card)',
                color: form.analysisLevel === lvl ? '#fff' : 'var(--text-2)',
                transition: 'background 0.15s',
              }}
            >
              {lvl === 'domain' ? 'Full Domain' : 'Sub-URL'}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-URL */}
      {form.analysisLevel === 'suburl' && (
        <div>
          <label style={labelStyle}>Sub-URL Path *</label>
          <input
            type="text"
            placeholder="e.g. /services/seo/"
            value={form.subUrl}
            onChange={e => set('subUrl', e.target.value)}
            style={inputStyle(errors.subUrl)}
          />
          {errors.subUrl && <p style={errStyle}>{errors.subUrl}</p>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Country */}
        <div>
          <label style={labelStyle}>Country *</label>
          <select
            value={form.country}
            onChange={e => set('country', e.target.value)}
            style={inputStyle(errors.country)}
          >
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {errors.country && <p style={errStyle}>{errors.country}</p>}
        </div>

        {/* Max Competitors (API mode only) */}
        {mode === 'api' && (
          <div>
            <label style={labelStyle}>Max Competitors</label>
            <select
              value={form.maxCompetitors}
              onChange={e => set('maxCompetitors', parseInt(e.target.value))}
              style={inputStyle(false)}
            >
              {[4, 5, 6, 7].map(n => <option key={n} value={n}>{n} competitors</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Date Range */}
      <div>
        <label style={labelStyle}>Date Range</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <input
            type="date"
            value={form.dateFrom}
            onChange={e => set('dateFrom', e.target.value)}
            style={inputStyle(errors.dateRange)}
          />
          <input
            type="date"
            value={form.dateTo}
            onChange={e => set('dateTo', e.target.value)}
            style={inputStyle(errors.dateRange)}
          />
        </div>
        {errors.dateRange && <p style={errStyle}>{errors.dateRange}</p>}
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%', padding: '12px 0', borderRadius: 'var(--r-lg)',
          fontSize: 14, fontWeight: 600, color: '#fff', border: 'none', cursor: 'pointer',
          background: 'var(--primary)', opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s',
        }}
      >
        {loading
          ? (mode === 'manual' ? 'Preparing…' : 'Discovering Competitors…')
          : (mode === 'manual' ? 'Continue to Upload' : 'Discover Competitors')}
      </button>
    </form>
  );
}
