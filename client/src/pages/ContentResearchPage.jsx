import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import KeywordInput from '../components/KeywordInput';
import ProgressSteps from '../components/ProgressSteps';
import SerpUrls from '../components/SerpUrls';
import ResultsTable from '../components/ResultsTable';
import ExportButtons from '../components/ExportButtons';

export default function ContentResearchPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [step, setStep] = useState('idle');
  const [serpResults, setSerpResults] = useState(null);
  const [scrapeResults, setScrapeResults] = useState(null);
  const [analysis, setAnalysis] = useState(null);
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
        body: JSON.stringify({ keyword: keyword.trim(), scrapedPages: scrapeData.results })
      });
      if (!analyzeRes.ok) throw new Error((await analyzeRes.json()).error || 'Analysis failed.');
      const analyzeData = await analyzeRes.json();
      setAnalysis(analyzeData.analysis);
      setWarnings(allWarnings);
      setStep('done');
    } catch (err) {
      setError(err.message);
      setStep('error');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ backgroundColor: '#1e3a5f' }} className="text-white py-5 px-4 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              All tools
            </button>
            <div className="w-px h-5 bg-white/20" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Content Research</h1>
              <p className="text-blue-200 text-xs mt-0.5">Analyse top-ranking pages &amp; generate structured content recommendations</p>
            </div>
          </div>
          {searchCount > 0 && (
            <div className="text-right">
              <div className="text-white/60 text-xs uppercase tracking-wider">Daily searches used</div>
              <div className="text-white font-semibold text-lg">{searchCount} <span className="text-white/50 text-sm font-normal">/ 100</span></div>
              <div className="mt-1 h-1.5 w-32 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{
                  width: `${Math.min(100, searchCount)}%`,
                  backgroundColor: searchCount >= 90 ? '#ef4444' : searchCount >= 70 ? '#f59e0b' : '#22c55e'
                }} />
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <KeywordInput keyword={keyword} setKeyword={setKeyword} onSearch={handleResearch} disabled={isLoading} />

        {step !== 'idle' && <div className="mt-6"><ProgressSteps step={step} /></div>}

        {warnings.length > 0 && (
          <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5">⚠</span>
              <div className="space-y-1">{warnings.map((w, i) => <p key={i} className="text-amber-800 text-sm">{w}</p>)}</div>
            </div>
          </div>
        )}

        {step === 'error' && error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">✕</span>
              <p className="text-red-800 text-sm font-medium">{error}</p>
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
            <ExportButtons keyword={keyword} analysis={analysis} />
            <div className="mt-4"><ResultsTable keyword={keyword} analysis={analysis} /></div>
          </div>
        )}
      </main>
    </div>
  );
}
