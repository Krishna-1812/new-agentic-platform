import { useState } from 'react';

// All of the SEO & GEO audit run plumbing: inputs and the SSE reader. Shared
// by SeoGeoAuditPage (full report) and SeoGeoSnapshotPage (score dashboard
// only) so both pages provably send the same request body and behave the
// same way.
//
//   const ctl = useSeoGeoAudit();
//
// `restoring` is always false and `persistKey`/`onRestored` are accepted but
// unused — this hook does not persist a run across a page refresh. A prior
// version depended on a `usePersistedRun`/`/api/runs` layer that is a
// separate, not-yet-shipped piece of work; re-add persistence here once that
// lands, rather than carrying an unreviewed dependency in the meantime.
export function useSeoGeoAudit(persistKey, { onRestored, onResult } = {}) {
  const [inputType, setInputType] = useState('url');
  const [urlInput, setUrlInput] = useState('');
  const [htmlInput, setHtmlInput] = useState('');
  const [keyword1, setKeyword1] = useState('');
  const [keyword2, setKeyword2] = useState('');
  const [pageIntent, setPageIntent] = useState('auto');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState({});
  const [findings, setFindings] = useState(null);
  const [ai, setAi] = useState(null);
  const [error, setError] = useState('');
  const restoring = false;

  function reset() {
    setRunning(false); setSteps({}); setFindings(null); setAi(null); setError('');
    // keywords and page intent intentionally not reset so users can re-run
  }

  // Deliberately NOT wrapped in useCallback: `onResult` is captured by this
  // closure, so memoizing without also ref-ing the callback would go stale.
  async function runAudit() {
    reset();
    setRunning(true);
    setError('');

    const keywords = [keyword1.trim(), keyword2.trim()].filter(Boolean);
    const body = inputType === 'url'
      ? { url: urlInput.trim(), keywords, pageIntent }
      : { html: htmlInput.trim(), keywords, pageIntent };

    try {
      const resp = await fetch('/api/seo-geo-audit/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        setError(err.error || 'Audit request failed');
        setRunning(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = null; // persists across read() chunks

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
              if (currentEvent === 'step') {
                setSteps(prev => ({ ...prev, [data.id]: data }));
              } else if (currentEvent === 'result') {
                setFindings(data.findings);
                setAi(data.ai);
                setRunning(false);
                onResult?.();
              } else if (currentEvent === 'error') {
                setError(data.message);
                setRunning(false);
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
      setRunning(false);
    } catch (err) {
      setError(err.message || 'Connection failed');
      setRunning(false);
    }
  }

  return {
    inputType, setInputType,
    urlInput, setUrlInput,
    htmlInput, setHtmlInput,
    keyword1, setKeyword1,
    keyword2, setKeyword2,
    pageIntent, setPageIntent,
    running, steps, findings, ai, error, restoring,
    runAudit, reset,
  };
}
