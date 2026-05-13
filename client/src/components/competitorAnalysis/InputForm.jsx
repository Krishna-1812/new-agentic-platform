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

  const labelCls = 'block text-xs font-semibold text-[#374151] mb-1';
  const inputCls = 'w-full border border-[#D1D5DB] rounded-lg px-3 py-2.5 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#245E9E] focus:border-transparent';
  const errCls = 'text-xs text-red-500 mt-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Data Source mode toggle */}
      <div>
        <label className={labelCls}>Data Source</label>
        <div className="flex rounded-lg border border-[#D1D5DB] overflow-hidden">
          {[
            { id: 'api', label: 'Semrush API', desc: 'Auto-pull data' },
            { id: 'manual', label: 'Manual Upload', desc: 'Upload CSV exports' },
          ].map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onModeChange(opt.id)}
              className={`flex-1 py-2.5 px-3 text-left transition-colors ${
                mode === opt.id
                  ? 'bg-[#245E9E] text-white'
                  : 'bg-white text-[#6B7280] hover:bg-[#F9FAFB]'
              }`}
            >
              <div className={`text-xs font-semibold ${mode === opt.id ? 'text-white' : 'text-[#374151]'}`}>{opt.label}</div>
              <div className={`text-xs mt-0.5 ${mode === opt.id ? 'text-blue-100' : 'text-[#9CA3AF]'}`}>{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Brand Name */}
        <div>
          <label className={labelCls}>Brand Name *</label>
          <input
            type="text"
            placeholder="e.g. Acalvio"
            maxLength={80}
            value={form.brandName}
            onChange={e => set('brandName', e.target.value)}
            className={inputCls + (errors.brandName ? ' border-red-400' : '')}
          />
          {errors.brandName && <p className={errCls}>{errors.brandName}</p>}
        </div>

        {/* Target URL */}
        <div>
          <label className={labelCls}>Target URL *</label>
          <input
            type="text"
            placeholder="e.g. acalvio.com"
            value={form.targetUrl}
            onChange={e => set('targetUrl', e.target.value)}
            className={inputCls + (errors.targetUrl ? ' border-red-400' : '')}
          />
          {errors.targetUrl && <p className={errCls}>{errors.targetUrl}</p>}
        </div>
      </div>

      {/* Analysis Level */}
      <div>
        <label className={labelCls}>Analysis Level *</label>
        <div className="flex rounded-lg border border-[#D1D5DB] overflow-hidden">
          {['domain', 'suburl'].map(lvl => (
            <button
              key={lvl}
              type="button"
              onClick={() => set('analysisLevel', lvl)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                form.analysisLevel === lvl
                  ? 'bg-[#245E9E] text-white'
                  : 'bg-white text-[#6B7280] hover:bg-[#F9FAFB]'
              }`}
            >
              {lvl === 'domain' ? 'Full Domain' : 'Sub-URL'}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-URL */}
      {form.analysisLevel === 'suburl' && (
        <div>
          <label className={labelCls}>Sub-URL Path *</label>
          <input
            type="text"
            placeholder="e.g. /services/seo/"
            value={form.subUrl}
            onChange={e => set('subUrl', e.target.value)}
            className={inputCls + (errors.subUrl ? ' border-red-400' : '')}
          />
          {errors.subUrl && <p className={errCls}>{errors.subUrl}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Country */}
        <div>
          <label className={labelCls}>Country *</label>
          <select
            value={form.country}
            onChange={e => set('country', e.target.value)}
            className={inputCls + (errors.country ? ' border-red-400' : '')}
          >
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {errors.country && <p className={errCls}>{errors.country}</p>}
        </div>

        {/* Max Competitors (API mode only) */}
        {mode === 'api' && (
          <div>
            <label className={labelCls}>Max Competitors</label>
            <select
              value={form.maxCompetitors}
              onChange={e => set('maxCompetitors', parseInt(e.target.value))}
              className={inputCls}
            >
              {[4, 5, 6, 7].map(n => <option key={n} value={n}>{n} competitors</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Date Range */}
      <div>
        <label className={labelCls}>Date Range</label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <input
              type="date"
              value={form.dateFrom}
              onChange={e => set('dateFrom', e.target.value)}
              className={inputCls + (errors.dateRange ? ' border-red-400' : '')}
            />
          </div>
          <div>
            <input
              type="date"
              value={form.dateTo}
              onChange={e => set('dateTo', e.target.value)}
              className={inputCls + (errors.dateRange ? ' border-red-400' : '')}
            />
          </div>
        </div>
        {errors.dateRange && <p className={errCls}>{errors.dateRange}</p>}
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
        style={{ backgroundColor: '#245E9E' }}
      >
        {loading
          ? (mode === 'manual' ? 'Preparing…' : 'Discovering Competitors…')
          : (mode === 'manual' ? 'Continue to Upload' : 'Discover Competitors')}
      </button>
    </form>
  );
}
