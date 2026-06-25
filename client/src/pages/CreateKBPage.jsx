import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MDEditor from '@uiw/react-md-editor';

const BRANDS = ['gentle-dental','great-lakes','riccobene','clear-behavioral-health','neuro-wellness-spa','new-life-house'];
const INDUSTRY_KBS = ['global','dental-service-organizations','mental-health-organizations','b2b-tech'];
const CATEGORIES = ['industry','brand','client-feedback','best-practices'];
const ALL_MODULES = ['content-research','keyword-research','article-recommendation'];

// Steps per category
const STEPS_BY_CATEGORY = {
  brand:             ['Category', 'Brand Slug', 'Industry KB', 'Tags & Priority', 'Linked Modules', 'Content'],
  industry:          ['Category', 'Tags & Priority', 'Linked Modules', 'Content'],
  'client-feedback': ['Category', 'Brand', 'Label & Content'],
  'best-practices':  ['Category', 'Tags & Priority', 'Linked Modules', 'Content'],
};

export default function CreateKBPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    id: '', category: 'brand', client: 'gentle-dental', industry: 'dental-service-organizations',
    tags: '', priority: 3, linked_modules: [], body: '', label: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
  const toggleModule = mod => set('linked_modules',
    form.linked_modules.includes(mod) ? form.linked_modules.filter(m => m !== mod) : [...form.linked_modules, mod]
  );

  const STEPS = STEPS_BY_CATEGORY[form.category] || STEPS_BY_CATEGORY.brand;
  const currentStepName = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  async function handleCreate() {
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      };
      if (!payload.label) delete payload.label;
      const res = await fetch('/api/kb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      navigate(`/kb/${data.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const canAdvance = () => {
    if (currentStepName === 'Category') return !!form.category;
    if (currentStepName === 'Brand Slug') return !!form.client;
    if (currentStepName === 'Brand') return !!form.client;
    if (currentStepName === 'Label & Content') return !!form.id.trim();
    if (currentStepName === 'Content') return !!form.id.trim();
    return true;
  };

  function handleCategoryChange(cat) {
    set('category', cat);
    setStep(0); // reset to first step when category changes
  }

  return (
      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Step progress */}
        <div className="flex items-center gap-0 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style={i < step ? { backgroundColor: '#3DAA8E', color: '#fff' }
                    : i === step ? { backgroundColor: '#111827', color: '#fff' }
                    : { backgroundColor: '#E5E7EB', color: '#9CA3AF' }}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span className="text-xs mt-1 text-center whitespace-nowrap"
                  style={{ color: i === step ? '#111827' : '#9CA3AF', fontWeight: i === step ? 600 : 400 }}>
                  {s}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-0.5 mb-5 mx-1" style={{ backgroundColor: i < step ? '#3DAA8E' : '#E5E7EB' }} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-8" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          {/* Step: Category */}
          {currentStepName === 'Category' && (
            <div>
              <h2 className="text-base font-semibold text-[#111827] mb-1">Choose a category</h2>
              <p className="text-sm text-[#6B7280] mb-5">What type of knowledge base is this?</p>
              <div className="grid grid-cols-2 gap-3">
                {CATEGORIES.map(cat => (
                  <button key={cat} onClick={() => handleCategoryChange(cat)}
                    className="p-4 rounded-xl border-2 text-left transition-all"
                    style={form.category === cat ? { borderColor: '#3DAA8E', backgroundColor: '#F0FAF7' } : { borderColor: '#E5E7EB', backgroundColor: '#fff' }}>
                    <div className="font-semibold text-sm text-[#111827]">{cat}</div>
                    <div className="text-xs text-[#6B7280] mt-0.5">
                      {cat === 'industry' && 'Sector context, compliance rules'}
                      {cat === 'brand' && 'Client voice, services, personas'}
                      {cat === 'client-feedback' && 'Notes from client interactions'}
                      {cat === 'best-practices' && 'Reusable guidelines for AI modules'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step: Brand Slug (for brand category) */}
          {currentStepName === 'Brand Slug' && (
            <div>
              <h2 className="text-base font-semibold text-[#111827] mb-1">Select brand</h2>
              <p className="text-sm text-[#6B7280] mb-5">Which brand does this KB represent? The brand slug becomes the KB ID.</p>
              <div className="grid grid-cols-2 gap-2">
                {BRANDS.map(b => (
                  <button key={b} onClick={() => { set('client', b); set('id', b); }}
                    className="p-3 rounded-lg border-2 text-left text-sm font-medium transition-all"
                    style={form.client === b ? { borderColor: '#3DAA8E', backgroundColor: '#F0FAF7', color: '#111827' } : { borderColor: '#E5E7EB', color: '#6B7280' }}>
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step: Brand (for client-feedback category) */}
          {currentStepName === 'Brand' && (
            <div>
              <h2 className="text-base font-semibold text-[#111827] mb-1">Select brand</h2>
              <p className="text-sm text-[#6B7280] mb-5">Which brand does this feedback belong to?</p>
              <div className="grid grid-cols-2 gap-2">
                {BRANDS.map(b => (
                  <button key={b} onClick={() => set('client', b)}
                    className="p-3 rounded-lg border-2 text-left text-sm font-medium transition-all"
                    style={form.client === b ? { borderColor: '#3DAA8E', backgroundColor: '#F0FAF7', color: '#111827' } : { borderColor: '#E5E7EB', color: '#6B7280' }}>
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step: Industry KB (for brand category) */}
          {currentStepName === 'Industry KB' && (
            <div>
              <h2 className="text-base font-semibold text-[#111827] mb-1">Associated Industry KB</h2>
              <p className="text-sm text-[#6B7280] mb-5">Which industry KB should be auto-injected alongside this brand?</p>
              <div className="space-y-2">
                {INDUSTRY_KBS.map(ind => (
                  <button key={ind} onClick={() => set('industry', ind)}
                    className="w-full p-3 rounded-lg border-2 text-left text-sm font-medium transition-all"
                    style={form.industry === ind ? { borderColor: '#3DAA8E', backgroundColor: '#F0FAF7', color: '#111827' } : { borderColor: '#E5E7EB', color: '#6B7280' }}>
                    {ind === 'global' ? 'global (no industry KB)' : ind}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step: Tags & Priority */}
          {currentStepName === 'Tags & Priority' && (
            <div className="space-y-5">
              <h2 className="text-base font-semibold text-[#111827]">Tags & Priority</h2>
              <div>
                <label className="block text-sm font-semibold text-[#111827] mb-1.5">Tags <span className="font-normal text-[#6B7280]">(comma-separated)</span></label>
                <input type="text" value={form.tags} onChange={e => set('tags', e.target.value)}
                  placeholder="dental, dso, brand"
                  className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#111827] mb-1.5">Priority <span className="font-normal text-[#6B7280]">(1 = highest, 5 = lowest)</span></label>
                <div className="flex gap-2">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => set('priority', n)}
                      className="w-10 h-10 rounded-lg border-2 text-sm font-semibold transition-all"
                      style={form.priority === n ? { borderColor: '#3DAA8E', backgroundColor: '#F0FAF7', color: '#3DAA8E' } : { borderColor: '#E5E7EB', color: '#6B7280' }}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step: Linked Modules */}
          {currentStepName === 'Linked Modules' && (
            <div>
              <h2 className="text-base font-semibold text-[#111827] mb-1">Linked Modules</h2>
              <p className="text-sm text-[#6B7280] mb-5">Which modules should load this KB?</p>
              <div className="space-y-3">
                {ALL_MODULES.map(mod => (
                  <label key={mod} className="flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all"
                    style={form.linked_modules.includes(mod) ? { borderColor: '#3DAA8E', backgroundColor: '#F0FAF7' } : { borderColor: '#E5E7EB' }}>
                    <input type="checkbox" checked={form.linked_modules.includes(mod)} onChange={() => toggleModule(mod)} className="w-4 h-4" />
                    <div className="text-sm font-semibold text-[#111827]">{mod}</div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Step: Content (brand / industry) */}
          {currentStepName === 'Content' && (
            <div className="space-y-5">
              <h2 className="text-base font-semibold text-[#111827]">ID & Content</h2>
              <div>
                <label className="block text-sm font-semibold text-[#111827] mb-1.5">KB ID <span className="font-normal text-[#6B7280]">(unique slug, kebab-case)</span></label>
                <input type="text" value={form.id} onChange={e => set('id', e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  placeholder="e.g. dental-service-organizations"
                  className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm font-mono text-[#111827] focus:outline-none" />
              </div>
              <div data-color-mode="light">
                <label className="block text-sm font-semibold text-[#111827] mb-1.5">Content <span className="font-normal text-[#6B7280]">(Markdown)</span></label>
                <MDEditor value={form.body} onChange={val => set('body', val || '')} height={300} preview="edit" />
              </div>
            </div>
          )}

          {/* Step: Label & Content (client-feedback) */}
          {currentStepName === 'Label & Content' && (
            <div className="space-y-5">
              <h2 className="text-base font-semibold text-[#111827]">ID, Label & Content</h2>
              <div>
                <label className="block text-sm font-semibold text-[#111827] mb-1.5">KB ID <span className="font-normal text-[#6B7280]">(unique slug, kebab-case)</span></label>
                <input type="text" value={form.id} onChange={e => set('id', e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  placeholder={`e.g. ${form.client}-feedback-q1-2026`}
                  className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm font-mono text-[#111827] focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#111827] mb-1.5">Display Label <span className="font-normal text-[#6B7280]">(shown in the feedback selector)</span></label>
                <input type="text" value={form.label} onChange={e => set('label', e.target.value)}
                  placeholder="e.g. Q1 2026 Review, Post-Launch Feedback"
                  className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] focus:outline-none" />
              </div>
              <div data-color-mode="light">
                <label className="block text-sm font-semibold text-[#111827] mb-1.5">Content <span className="font-normal text-[#6B7280]">(Markdown)</span></label>
                <MDEditor value={form.body} onChange={val => set('body', val || '')} height={300} preview="edit" />
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-5">
          <button onClick={() => step > 0 ? setStep(s => s - 1) : navigate('/kb')}
            className="px-5 py-2.5 text-sm font-semibold border border-[#E5E7EB] rounded-lg text-[#6B7280] hover:text-[#111827] bg-white transition-colors">
            {step === 0 ? 'Cancel' : '← Back'}
          </button>

          {!isLastStep ? (
            <button onClick={() => setStep(s => s + 1)} disabled={!canAdvance()}
              className="px-5 py-2.5 text-sm font-semibold rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#111827' }}>
              Next →
            </button>
          ) : (
            <button onClick={handleCreate} disabled={saving || !form.id.trim()}
              className="px-5 py-2.5 text-sm font-semibold rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#3DAA8E' }}>
              {saving ? 'Creating…' : 'Create KB'}
            </button>
          )}
        </div>
      </main>
  );
}
