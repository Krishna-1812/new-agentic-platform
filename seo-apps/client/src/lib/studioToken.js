// Carries the studio pass (see server/routes/auth.js) on every API call.
//
// The Northaxis platform opens the studio with ?st=<signed pass>. We keep it in
// sessionStorage (per tab, survives reloads and in-app navigation), take it out
// of the address bar, and attach it to every same-origin /api request: as the
// X-Studio-Token header on fetch, and as ?st= where a header can't be set
// (EventSource streams and plain navigations such as file downloads).

const KEY = 'studioToken';

function readStored() {
  try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
}

let token = readStored();

export function captureStudioToken() {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('st');
  if (fromUrl) {
    token = fromUrl;
    try { sessionStorage.setItem(KEY, fromUrl); } catch { /* storage blocked: keep it in memory */ }
    url.searchParams.delete('st');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
  return token;
}

export function getStudioToken() {
  return token;
}

function isApi(input) {
  try {
    const u = new URL(input, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

// For URLs the browser requests itself (downloads, EventSource).
export function withStudioToken(url) {
  if (!token || !isApi(url)) return url;
  const u = new URL(url, window.location.origin);
  u.searchParams.set('st', token);
  return u.pathname + u.search;
}

export function installStudioTokenTransport() {
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (!token || !isApi(url)) return origFetch(input, init);
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-Studio-Token', token);
    return origFetch(input, { ...init, headers });
  };

  const OrigEventSource = window.EventSource;
  if (OrigEventSource) {
    class StudioEventSource extends OrigEventSource {
      constructor(url, config) {
        super(withStudioToken(String(url)), config);
      }
    }
    window.EventSource = StudioEventSource;
  }
}
