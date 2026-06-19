import { useState } from 'react';
import KeywordInput from '../components/KeywordInput';
import ProgressSteps from '../components/ProgressSteps';
import SerpUrls from '../components/SerpUrls';
import ResultsTable from '../components/ResultsTable';
import ExportButtons from '../components/ExportButtons';
import KBContextSelector from '../components/KBContextSelector';

const CONFIDENCE_STYLES = {
  HIGH:   { bg: '#D1FAE5', text: '#065F46', label: 'KB: HIGH' },
  MEDIUM: { bg: '#FEF9C3', text: '#92400E', label: 'KB: MEDIUM' },
  LOW:    { bg: '#FEE2E2', text: '#DC2626', label: 'KB: LOW' },
};

export default function ContentResearchPage() {
  const [keyword, setKeyword] = useState('');
  const [client, setClient] = useState('');
  const [feedbackKbIds, setFeedbackKbIds] = useState([]);
  const [step, setStep] = useState('idle');
  const [serpResults, setSerpResults] = useState(null);
  const [scrapeResults, setScrapeResults] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [kbConfidence, setKbConfidence] = useState(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [searchCount, setSearchCount] = useState(0);

  const isLoading = ['searching', 'scraping', 'analyzing'].includes(step);

  async function handleResearch() {
    if (!keyword.trim() || isLoading) return;

    setStep('searching');
    setSerpResults(null);
    setScrapeResults(null);
    setAnalysis(null);
    setError('');
    setWarnings([]);

    try {
      const searchRes = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim() })
      });
      if (!searchRes.ok) throw new Error((await searchRes.json()).error || 'Google search failed.');
      const searchData = await searchRes.json();
      setSerpResults(searchData.results);
      setSearchCount(searchData.searchCount || 0);

      setStep('scraping');
      const scrapeRes = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: searchData.results.map(r => r.url) })
      });
      if (!scrapeRes.ok) throw new Error((await scrapeRes.json()).error || 'Scraping failed.');
      const scrapeData = await scrapeRes.json();
      setScrapeResults(scrapeData.results);

      const allWarnings = [...(scrapeData.warnings || [])];
      const failed = scrapeData.results.filter(r => !r.success);
      if (failed.length > 0 && !allWarnings.some(w => w.includes('scraped'))) {
        allWarnings.push(`${failed.length} page(s) could not be scraped and were skipped.`);
      }

      setStep('analyzing');
      const analyzeRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), scrapedPages: scrapeData.results, client: client || undefined, feedbackKbIds: feedbackKbIds.length ? feedbackKbIds : undefined })
      });
      if (!analyzeRes.ok) throw new Error((await analyzeRes.json()).error || 'Analysis failed.');
      const analyzeData = await analyzeRes.json();
      setAnalysis(analyzeData.analysis);
      setKbConfidence(analyzeData.kbConfidence || null);
      setWarnings(allWarnings);
      setStep('done');
    } catch (err) {
      setError(err.message);
      setStep('error');
    }
  }

  return (
      <main className="max-w-7xl mx-auto px-8 py-7">
        <KBContextSelector
          module="content-research"
          onChange={({ client: c, feedbackKbIds: fb }) => { setClient(c); setFeedbackKbIds(fb || []); }}
          disabled={isLoading}
        />
        <div className="mt-4">
        <KeywordInput keyword={keyword} setKeyword={setKeyword} onSearch={handleResearch} disabled={isLoading} /></div>

        {step !== 'idle' && <div className="mt-6"><ProgressSteps step={step} /></div>}

        {warnings.length > 0 && (
          <div className="mt-4 p-4 bg-[#FEF9C3] border border-[#FDE68A] rounded-xl">
            <div className="flex items-start gap-2">
              <span className="mt-0.5" style={{ color: '#D97706' }}>⚠</span>
              <div className="space-y-1">{warnings.map((w, i) => <p key={i} className="text-sm" style={{ color: '#92400E' }}>{w}</p>)}</div>
            </div>
          </div>
        )}

        {step === 'error' && error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5 text-xs">✕</span>
              <p className="text-red-700 text-sm font-medium">{error}</p>
            </div>
          </div>
        )}

        {serpResults && (
          <div className="mt-6">
            <SerpUrls results={serpResults} scrapeResults={scrapeResults} isLoading={step === 'scraping'} />
          </div>
        )}

        {analysis && (
          <div className="mt-8">
            <div className="flex items-center gap-3 mb-3">
              <ExportButtons keyword={keyword} analysis={analysis} />
              {kbConfidence && CONFIDENCE_STYLES[kbConfidence] && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded"
                  style={{ backgroundColor: CONFIDENCE_STYLES[kbConfidence].bg, color: CONFIDENCE_STYLES[kbConfidence].text }}>
                  {CONFIDENCE_STYLES[kbConfidence].label}
                </span>
              )}
            </div>
            <ResultsTable keyword={keyword} analysis={analysis} />
          </div>
        )}
      </main>
  );
}
