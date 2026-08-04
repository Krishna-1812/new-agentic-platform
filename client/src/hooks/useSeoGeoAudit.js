import { useState } from 'react';
import { usePersistedRun } from './usePersistedRun';

// All of the SEO & GEO audit run plumbing: inputs, the SSE reader, and run
// persistence. Shared by SeoGeoAuditPage (full report) and SeoGeoSnapshotPage
// (score dashboard only) so both pages provably send the same request body and
// rehydrate the same way.
//
//   const ctl = useSeoGeoAudit('seo-geo-audit', {
//     onRestored: () => setActivePanel('dashboard'),
//     onResult:   () => setActivePanel('dashboard'),
//   });
//
// `persistKey` MUST be distinct per page: `runs.tool` is a plain string with no
// notion of which page wrote the row, so a shared key means the two tools fight
// over one rehydration slot.
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

  // Persist run output so a completed audit survives a page refresh.
  const { save, restoring } = usePersistedRun(persistKey, {
    onRestore: (o) => {
      setFindings(o.findings ?? null);
      setAi(o.ai ?? null);
      if (o.inputType !== undefined) setInputType(o.inputType);
      if (o.url !== undefined) setUrlInput(o.url ?? '');
      if (o.html !== undefined) setHtmlInput(o.html ?? '');
      if (o.keyword1 !== undefined) setKeyword1(o.keyword1 ?? '');
      if (o.keyword2 !== undefined) setKeyword2(o.keyword2 ?? '');
      if (o.pageIntent !== undefined) setPageIntent(o.pageIntent ?? 'auto');
      if (o.findings) onRestored?.();
    },
  });

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

    // Snapshot the inputs at run time so persistence isn't affected by later edits.
    const inputsSnapshot = {
      inputType,
      url: urlInput.trim(),
      html: htmlInput.trim(),
      keyword1: keyword1.trim(),
      keyword2: keyword2.trim(),
      pageIntent,
    };

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
                save({
                  label: data.findings?.meta?.url || inputsSnapshot.url || 'HTML audit',
                  inputs: inputsSnapshot,
                  output: {
                    findings: data.findings ?? null,
                    ai: data.ai ?? null,
                    inputType: inputsSnapshot.inputType,
                    url: inputsSnapshot.url,
                    html: inputsSnapshot.html,
                    keyword1: inputsSnapshot.keyword1,
                    keyword2: inputsSnapshot.keyword2,
                    pageIntent: inputsSnapshot.pageIntent,
                  },
                });
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
