// Notifies the parent window that a tool actually started running (the user
// filled in the required fields and clicked the CTA), not merely opened the
// page. Used by the three tools embedded as /app agents on
// intelligence.position2.com so that page can log a run only on real use.
// No-op when not embedded (window.parent === window) or when postMessage is
// unavailable for any reason.
export function notifyAgentRunStarted(tool) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: 'p2-seo-tool', type: 'agent-run-started', tool }, '*');
    }
  } catch (e) {
    // ignore — embedding context may block cross-window messaging
  }
}

// Notifies the parent window that a run finished with a real result, carrying
// the full output payload so the parent can persist it for the user's History
// page — the child has no durable storage of its own. Called once per run,
// right when the tool's own SSE stream reports completion. No-op when not
// embedded, same as notifyAgentRunStarted.
export function notifyAgentRunFinished(tool, output) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: 'p2-seo-tool', type: 'agent-run-finished', tool, output }, '*');
    }
  } catch (e) {
    // ignore — embedding context may block cross-window messaging
  }
}

// Notifies the parent window (the Intelligence Platform shell) which tool the
// user just navigated to inside our sidebar, so the shell can keep its address
// bar + breadcrumb in sync (e.g. /p2/seo/content-research). The iframe is
// cross-origin, so the shell can't read our URL — this message is the only way
// it learns the route. `tool` is the canonical slug (toolsMeta id), `name` the
// display label. No-op when not embedded, same guards as the run signals.
export function notifyRouteChange(tool, name, path) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: 'p2-seo-tool', type: 'route-change', tool, name, path }, '*');
    }
  } catch (e) {
    // ignore — embedding context may block cross-window messaging
  }
}
