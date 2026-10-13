/* People & Signals page (templates/account_mapper.html).
 *
 * The render* functions are pure: data in, HTML out, every value escaped
 * (names, titles, photos and briefs come from Saleshandy, the web and a
 * model), every link and image through safeUrl. They are exported as
 * window.AM so tests can run them under Node. The wiring at the bottom only
 * runs on the page.
 *
 * Flow: Map (free) -> tick who to reveal -> Reveal (credits, after a yes)
 * -> results, CSV.
 */
(function (root) {
  'use strict';

  var API = '/strategic-agents/people-signals/api';
  // Inside a client account (app.py account_agent) every call carries the account (account-context.js);
  // a download link names it as ?acct=. A client of the account maps for free: no credits, no reveal,
  // no Claude steps and no costs (app.py refuses and strips them too).
  var DOC = typeof document !== 'undefined' ? document : null;
  var CLIENT = !!(DOC && DOC.body && DOC.body.hasAttribute('data-am-client'));
  var ACCT = typeof window !== 'undefined' && window.__acctContext;
  var AQ = ACCT ? 'acct=' + encodeURIComponent(ACCT) : '';
  var EMAIL = {
    verified: ['ok', 'Verified', 'Saleshandy verified this address when it revealed it'],
    saleshandy: ['ok', 'From Saleshandy', 'Revealed by Saleshandy, which verifies on reveal; no status was returned'],
    risky: ['warn', 'Risky', 'Saleshandy could not fully verify it (for example, the domain accepts every address)'],
    invalid: ['bad', 'Invalid', 'Saleshandy found this address undeliverable'],
    not_found: ['', 'Not found', 'Saleshandy has no email for this person; no credit was charged'],
    pending: ['warn', 'Pending', 'The reveal was still running; reveal again later at no new charge'],
    pattern_confirmed: ['ok', 'Pattern', 'Built from the pattern 2 or more verified emails at this company follow'],
    pattern_likely: ['warn', 'Pattern, likely', 'Built from the pattern 1 verified email at this company follows']
  };
  var ROLE_STATUS = { found: ['ok', 'Found'], close: ['warn', 'Close matches only'], web: ['acc', 'Found on the web'], not_found: ['bad', 'Nobody found'] };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) {
    return /^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : null;
  }
  function link(url, text) {
    var h = safeUrl(url);
    return h ? '<a href="' + esc(h) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + '</a>' : esc(text);
  }
  function chip(cls, text, title) {
    return '<span class="mr-chip ' + esc(cls || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>';
  }
  function money(v) { return v == null ? '–' : '$' + Number(v).toFixed(Number(v) < 1 ? 3 : 2); }
  function num(v) { return v == null || v === '' ? '–' : Number(v).toLocaleString('en-US'); }
  function when(iso) {
    var d = new Date(iso || '');
    return isNaN(d) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function initials(name) {
    var w = String(name || '?').trim().split(/\s+/);
    return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase();
  }
  function keyOf(p) {
    if (p.id != null) return String(p.id);
    var m = /linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/i.exec(p.linkedin || '');
    return m ? 'li:' + m[1].toLowerCase() : null;
  }
  function plural(n, one, many) { return esc(n) + ' ' + (Number(n) === 1 ? one : (many || one + 's')); }
  // A steady colour for a name: the same person or account is the same colour every time.
  function hue(name) {
    var h = 0, s = String(name || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'h' + (h % 6);
  }

  // One small set of line icons (24-unit grid, drawn with currentColor).
  var IC = {
    spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
    shield: 'M12 3l7 3v5c0 4.4-2.9 8.3-7 10-4.1-1.7-7-5.6-7-10V6z M9 12l2 2 4-4',
    mail: 'M4 6h16v12H4z M4 7l8 6 8-6',
    copy: 'M9 9h10v10H9z M5 15V5h10',
    pin: 'M12 21s-6-5.6-6-10a6 6 0 1112 0c0 4.4-6 10-6 10z M12 11.5a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z',
    brief: 'M4 8h16v11H4z M9 8V6h6v2 M4 13h16',
    tag: 'M4 4h8l8 8-8 8-8-8z M8.5 8.5h.01',
    trend: 'M4 17l5-5 4 4 7-8 M15 8h5v5',
    coin: 'M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v10 M9.5 9.5c.6-.9 1.6-1.3 2.5-1.3 1.5 0 2.5.8 2.5 1.8 0 2.4-5 1.4-5 4 0 1 1 1.9 2.5 1.9 1 0 2-.4 2.5-1.2',
    users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M2.5 20c.4-3.6 3-5.5 6.5-5.5s6.1 1.9 6.5 5.5 M16.5 4.5a3.3 3.3 0 010 6.3 M18 14.8c2 .6 3.3 2.3 3.5 5.2',
    li: 'M5 9h3v10H5z M6.5 5a1.7 1.7 0 110 3.4 1.7 1.7 0 010-3.4z M11 9h3v1.5c.6-1 1.6-1.7 3.1-1.7 2.6 0 3.4 1.7 3.4 4V19h-3v-5c0-1.2-.3-2-1.5-2s-1.9.9-1.9 2.1V19h-3z',
    lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 017 0v3',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    refresh: 'M20 12a8 8 0 10-2.5 5.8 M20 5v5h-5',
    dl: 'M12 4v11 M7 11l5 5 5-5 M5 20h14',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14z M20 20l-4-4',
    plus: 'M12 5v14 M5 12h14',
    trash: 'M5 7h14 M10 7V5h4v2 M7 7l1 12h8l1-12 M10 11v5 M14 11v5',
    chat: 'M5 5h14a1 1 0 011 1v9a1 1 0 01-1 1H10l-4 4v-4H5a1 1 0 01-1-1V6a1 1 0 011-1z',
    send: 'M5 12h13 M12 6l6 6-6 6',
    bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
    globe: 'M12 21a9 9 0 100-18 9 9 0 000 18z M3 12h18 M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z',
    eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 14.8a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6z',
    x: 'M6 6l12 12 M18 6L6 18'
  };
  function ic(name, cls) {
    return '<svg class="am-ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + (IC[name] || '') + '"/></svg>';
  }

  // A score as a ring: green-orange when high, amber in the middle, grey when low or unknown.
  function ring(score, size, label) {
    var sc = score == null ? null : Math.max(0, Math.min(100, Number(score) || 0));
    var C = 2 * Math.PI * 18, off = sc == null ? C : C * (1 - sc / 100);
    var band = sc == null ? 'none' : sc >= 70 ? 'hi' : sc >= 40 ? 'mid' : 'lo';
    return '<span class="am-ring r-' + band + '" style="--sz:' + esc(size) + 'px;--c:' + C.toFixed(1) + '"><svg viewBox="0 0 44 44" aria-hidden="true">' +
      '<circle class="bg" cx="22" cy="22" r="18"/><circle class="fg" cx="22" cy="22" r="18" stroke-dasharray="' + C.toFixed(1) +
      '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg><b>' + (sc == null ? '–' : esc(sc)) + '</b>' + (label ? '<i>' + esc(label) + '</i>' : '') + '</span>';
  }

  // == readiness and the estimate =======================================================

  function renderReady(s) {
    if (!s) return '';
    var h = s.saleshandy || {};
    if (CLIENT || s.client) return h.configured ? chip('ok', 'Ready') : chip('bad', 'Not connected yet');
    var sh = !h.configured ? chip('bad', 'Saleshandy: no key', 'Add SALESHANDY_API_KEY in Railway → web → Variables') :
      h.ok === false ? chip('bad', 'Saleshandy: ' + (h.error || 'error')) :
      chip('ok', 'Saleshandy: ' + num((h.credits || {}).total) + ' credits', 'Used today ' + num((h.credits || {}).today) + ' · this month ' + num((h.credits || {}).month));
    return sh + ' ' + chip((s.claude || {}).configured ? 'ok' : '', 'Claude: ' + ((s.claude || {}).configured ? 'key set' : 'no key'));
  }

  // When Saleshandy is not connected yet: what to do, in the order to do it (the team) or who to ask (a client).
  function renderSetup(s) {
    if (!s || (s.saleshandy || {}).configured) return '';
    if (CLIENT || s.client) {
      return '<div class="am-setup"><div class="am-setup-ic">' + ic('lock') + '</div><div><b>Not connected yet</b><p>This agent is waiting to be connected. Your account manager will let you know when it is ready.</p></div></div>';
    }
    return '<div class="am-setup"><div class="am-setup-ic">' + ic('lock') + '</div><div><b>Connect Saleshandy to start</b>' +
      '<ol><li>In Saleshandy open <em>Settings → API Key → Create API Key</em> and copy it.</li>' +
      '<li>In Railway open <em>web → Variables → New Variable</em>, name it <code>SALESHANDY_API_KEY</code>, paste the key and Deploy.</li>' +
      '<li>Reload this page: the chip at the top right shows your credits.</li></ol></div></div>';
  }

  function renderEstimate(e) {
    if (!e) return '';
    if (e.error) return '<div class="mr-callout bad">' + esc(e.error) + '</div>';
    if (CLIENT) return '<div class="am-est-grid am-est-one"><div class="e-free"><b>Free</b><span>' + plural(e.companies, 'company', 'companies') + ' &times; ' + plural(e.roles, 'title') + '</span></div></div>';
    return '<div class="am-est-grid">' +
      '<div class="e-free"><b>Free</b><span>Mapping: ' + plural(e.companies, 'company', 'companies') + ' &times; ' + plural(e.roles, 'title') + ', about ' + esc(num(e.free_searches)) + ' searches</span></div>' +
      '<div class="e-cred"><b>' + esc(num(e.credits_default)) + ' credits at most</b><span>Only if you reveal the best person per title, and only for emails found. You choose after mapping.</span></div>' +
      '<div class="e-ai"><b>' + (e.claude ? 'About ' + esc(money(e.usd_typical)) : '$0') + '</b><span>' + (e.claude ? 'Claude, capped at ' + esc(money(e.usd_cap)) : 'No Claude steps ticked') + '</span></div></div>';
  }

  // == the runs list ====================================================================

  function seatShare(r) {
    var t = r.totals || {};
    return t.titles ? Math.round(100 * (t.titles_found || 0) / t.titles) : null;
  }

  function renderRuns(runs, selected) {
    if (!runs || !runs.length) return '<div class="mr-empty"><b>Nothing yet</b>Ask a question, or map a list of accounts.</div>';
    return '<ul class="cl-runl">' + runs.map(function (r) {
      var st = r.status === 'running' ? (r.stale ? chip('bad', 'Stalled') : chip('acc', r.stage === 'revealing' || /^reveal/.test(r.stage || '') ? 'Revealing' : 'Mapping')) :
        r.status === 'failed' ? chip('bad', 'Failed') : chip('ok', 'Ready');
      var n = ((r.settings || {}).companies || []).length, t = r.totals || {}, share = seatShare(r);
      var q = ((r.settings || {}).chat || {}).message;
      if (q) {
        return '<li><button type="button" class="cl-run am-runb am-runq s-' + esc(r.status || 'ready') + (r.id === selected ? ' on' : '') + '" data-act="open" data-id="' + esc(r.id) + '">' +
          '<span class="am-run-n">' + ic('chat') + '</span><span class="am-run-t"><b title="' + esc(q) + '">' + esc(q) + '</b>' + st + '</span>' +
          '<small>' + esc(when(r.created_at)) + ' &middot; ' + (t.people_picked != null ? plural(t.people_picked, 'person', 'people') + ' found' : 'asked in chat') +
          (CLIENT ? '' : ' &middot; ' + esc(num(r.credits_used || 0)) + ' credits') + '</small></button></li>';
      }
      return '<li><button type="button" class="cl-run am-runb s-' + esc(r.status || 'ready') + (r.id === selected ? ' on' : '') + '" data-act="open" data-id="' + esc(r.id) + '">' +
        '<span class="am-run-n">' + esc(r.id) + '</span><span class="am-run-t"><b>Run ' + esc(r.id) + '</b>' + st + '</span>' +
        '<small>' + esc(when(r.created_at)) + ' &middot; ' + plural(n, 'account') +
        (t.titles ? ' &middot; ' + esc(t.titles_found || 0) + '/' + esc(t.titles) + ' titles' : '') +
        (CLIENT ? '' : ' &middot; ' + esc(num(r.credits_used || 0)) + ' credits' + (r.spent_usd ? ' &middot; ' + esc(money(r.spent_usd)) : '')) + '</small>' +
        (share == null ? '' : '<i class="am-run-bar" title="' + esc(share) + '% of seats filled"><em style="width:' + esc(share) + '%"></em></i>') + '</button></li>';
    }).join('') + '</ul>';
  }

  // The first screen, before any run: how it works, and a small picture of what comes back.
  function renderWelcome() {
    var cells = '';
    var pattern = ['f', 'f', 'c', 'f', 'n', 'f', 'f', 'f', 'w', 'c', 'n', 'f'];
    for (var i = 0; i < 12; i++) cells += '<span class="am-cell s-' + ({ f: 'found', c: 'close', n: 'none', w: 'web' }[pattern[i]]) + '"></span>';
    return '<div class="card am-welcome"><div class="am-welcome-l"><div class="cl-eye">How it works</div>' +
      '<h3>From a list of companies to the people who decide</h3>' +
      '<ol class="am-how"><li><b>Map</b><span>Give it companies and the titles you sell to. ' + (CLIENT ? '' : 'It costs nothing. ') + 'It finds the right people at each one.</span></li>' +
      '<li><b>Read the signals</b><span>Who is new in role, which teams are growing, whether they are hiring or funded, and a priority score per account.</span></li>' +
      (CLIENT ? '<li><b>Download</b><span>Take the people and signals as a CSV.</span></li>' :
        '<li><b>Reveal</b><span>Tick the people you want and reveal their verified emails. Credits are spent only after you confirm.</span></li>') + '</ol></div>' +
      '<div class="am-welcome-r" aria-hidden="true"><div class="am-seatgrid">' + cells + '</div><small>A seat map: green is a person found, amber a close match, grey nobody.</small></div></div>';
  }

  // == one run: the dashboard ===========================================================

  function kpi(n, label, cls, icon) {
    return '<div class="am-kpi ' + (cls || '') + '">' + (icon ? ic(icon) : '') + '<b>' + n + '</b><span>' + esc(label) + '</span></div>';
  }

  function emailCounts(companies) {
    var out = { verified: 0, risky: 0, pattern: 0, revealed: 0 };
    companies.forEach(function (c) {
      (c.roles || []).forEach(function (r) {
        (r.picked || []).concat(r.also || [], r.web || []).forEach(function (p) {
          var l = (p.email || {}).label;
          if (l === 'verified' || l === 'saleshandy') out.verified++;
          else if (l === 'risky') out.risky++;
          else if (/^pattern_/.test(l || '')) out.pattern++;
          if (p.revealed) out.revealed++;
        });
      });
    });
    return out;
  }

  // One seat of one account: found, close, from the web, or nobody.
  function seatOf(c, role) {
    var r = (c.roles || []).filter(function (x) { return x.role === role; })[0];
    if (!r) return { s: 'none', t: 'Not searched for this title' };
    var main = (r.picked || [])[0], web = (r.web || [])[0];
    if (main) return { s: 'found', who: main.name, t: main.name + (main.title ? ', ' + main.title : '') };
    if (web) return { s: 'web', who: web.name, t: web.name + ' (found on the web)' };
    if ((r.also || []).length) return { s: 'close', who: r.also[0].name, t: 'Close match only: ' + r.also[0].name + (r.also[0].title ? ', ' + r.also[0].title : '') };
    return { s: 'none', t: 'Nobody found for this title' };
  }

  function roleNames(run, cs) {
    var named = ((run.settings || {}).roles || []).filter(Boolean);
    if (named.length) return named;
    var seen = [];
    cs.forEach(function (c) { (c.roles || []).forEach(function (r) { if (seen.indexOf(r.role) < 0) seen.push(r.role); }); });
    return seen;
  }

  // The seat map: every account against every title, found or not, at a glance.
  function renderSeatMap(run, list) {
    var cs = list || [], roles = roleNames(run, cs);
    if (!cs.length || !roles.length) return '';
    var head = '<div class="am-sm-row am-sm-head"><span></span>' + roles.map(function (r) { return '<span class="am-sm-col" title="' + esc(r) + '">' + esc(r) + '</span>'; }).join('') + '</div>';
    var rows = cs.map(function (c, i) {
      var cells = roles.map(function (r) {
        var st = seatOf(c, r);
        return '<button type="button" class="am-cell s-' + st.s + (st.who ? ' ' + hue(st.who) : '') + '" data-act="jump" data-i="' + i + '" title="' + esc(st.t) + '" aria-label="' + esc((c.display_name || c.name) + ', ' + r + ': ' + st.t) + '">' +
          (st.s === 'found' || st.s === 'web' ? '<span class="am-cell-n">' + esc(st.who) + '</span>' : st.s === 'close' ? '<span class="am-cell-n close">~ ' + esc(st.who) + '</span>' : '') + (st.s === 'web' ? '<i></i>' : '') + '</button>';
      }).join('');
      var p = c.priority || {};
      return '<div class="am-sm-row"><button type="button" class="am-sm-co" data-act="jump" data-i="' + i + '">' + ring(p.score, 30) + '<span>' + esc(c.display_name || c.name) + '</span></button>' + cells + '</div>';
    }).join('');
    return '<div class="am-seatmap"><div class="am-seatmap-h"><span class="mr-k">Seat map</span><span class="am-legend"><i class="l-found"></i>Found<i class="l-close"></i>Close match<i class="l-web"></i>On the web<i class="l-none"></i>Nobody</span></div>' +
      '<div class="am-sm-scroll"><div class="am-sm" style="--n:' + roles.length + '">' + head + rows + '</div></div></div>';
  }

  function renderOverview(run, list) {
    var s = run.summary || {}, t = s.totals || {}, cs = s.companies || [], e = emailCounts(cs), cost = s.cost || {};
    var ordered = list || cs;
    var hiring = 0, funded = 0, leaders = 0;
    cs.forEach(function (c) {
      var sg = (c.insights || {}).signals || {};
      if (sg.hiring || sg.hiring_your_titles) hiring++;
      if (sg.funded_last_year) funded++;
      leaders += ((c.insights || {}).new_leaders || {}).total || 0;
    });
    var share = t.titles ? Math.round(100 * (t.titles_found || 0) / t.titles) : null;
    var top = (s.ranking || []).slice(0, 3).map(function (name, i) {
      var c = cs.filter(function (x) { return x.name === name; })[0] || {};
      var p = c.priority || {};
      return '<li><button type="button" class="am-top" data-act="jump" data-i="' + esc(ordered.indexOf(c)) + '">' + ring(p.score, 46) + '<div><b>' + esc(c.display_name || c.name) + '</b><small>' +
        esc((p.reasons || []).slice(0, 2).join(' · ') || 'no signals yet') + '</small></div></button></li>';
    }).join('');
    return '<div class="am-ink"><div class="am-ink-h"><div class="am-ink-l"><div class="cl-eye">Dashboard</div>' +
      '<h3>' + esc(t.titles_found || 0) + ' of ' + esc(t.titles || 0) + ' seats filled across ' + plural(t.companies || 0, 'account') + '</h3>' +
      (CLIENT ? '<p>The right people at each account, and what each account is doing.</p>' :
      '<p>Mapping is free. Emails are revealed only for the people you tick, and only after you confirm the credits.</p>') +
      '<div class="am-pulse">' + (hiring ? '<span class="p-hot">' + ic('trend') + plural(hiring, 'account') + ' hiring</span>' : '') + (funded ? '<span class="p-hot">' + ic('coin') + plural(funded, 'account') + ' funded this year</span>' : '') +
      (leaders ? '<span>' + ic('spark') + plural(leaders, 'new leader') + '</span>' : '') + '</div></div>' +
      '<div class="am-ink-r">' + (share == null ? '' : '<div class="am-donut">' + ring(share, 112, 'filled') + '</div>') +
      (CLIENT ? '' : '<div class="cl-total"><b>' + esc(num(run.credits_used || 0)) + '</b><span>credits used' + (cost.spent_usd ? ' · ' + esc(money(cost.spent_usd)) + ' Claude' : '') + '</span></div>') + '</div></div>' +
      '<div class="am-kpis">' + kpi(esc(num(t.people_picked || 0)), 'best matches', 'k-big', 'users') + kpi(esc(num(t.people_also || 0)), 'also found', '', 'search') +
      kpi(esc(num(t.new_in_role || 0)), 'new in their role', '', 'spark') + kpi(esc(num(e.verified)), 'verified emails', '', 'shield') +
      kpi(esc(num(e.pattern)), 'emails from a pattern', '', 'mail') + kpi(esc(num(t.companies_resolved || 0)) + '/' + esc(num(t.companies || 0)), 'accounts matched', '', 'check') + '</div>' +
      renderSeatMap(run, ordered) +
      (top ? '<div class="am-rank"><span class="mr-k">Work these first</span><ol>' + top + '</ol></div>' : '') + '</div>';
  }

  // == one person ========================================================================

  function avatar(p, size) {
    var src = safeUrl(p.photo);
    return '<span class="am-ava ' + hue(p.name) + (size ? ' ' + size : '') + '" aria-hidden="true">' + esc(initials(p.name)) +
      (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '</span>';
  }

  function emailLine(p) {
    var em = p.email;
    if (!em) return '<div class="am-mail none">' + ic('lock') + '<span>' + (p.source === 'web' ? 'Reveal to look up by LinkedIn' : 'Not revealed yet') + '</span></div>';
    var lab = EMAIL[em.label] || ['', em.label || 'unknown', ''];
    return '<div class="am-mail">' + (em.address ? '<code>' + esc(em.address) + '</code>' : '') + chip(lab[0], lab[1], em.note || lab[2]) +
      (em.address ? '<button type="button" class="am-copy" data-act="copy" data-text="' + esc(em.address) + '" title="Copy the address" aria-label="Copy ' + esc(em.address) + '">' + ic('copy') + '</button>' : '') + '</div>';
  }

  function fact(icon, text) { return '<li>' + ic(icon) + '<span>' + esc(text) + '</span></li>'; }

  function personCard(p, opts) {
    opts = opts || {};
    var key = keyOf(p);
    var can = key && !p.revealed && !CLIENT;
    var facts = [p.location ? fact('pin', p.location) : '', p.experience_years ? fact('brief', p.experience_years + ' yrs experience') : '',
      p.department ? fact('tag', p.department) : ''].join('');
    return '<article class="am-person' + (opts.picked ? ' picked' : '') + (opts.selected ? ' sel' : '') + (p.new_in_role ? ' fresh' : '') + '">' +
      (can ? '<label class="am-tick" title="Reveal this person\'s email"><input type="checkbox" data-act="pick" data-key="' + esc(key) + '"' + (opts.selected ? ' checked' : '') + '><span class="am-tick-box">' + ic('check') + '</span><span>Reveal</span></label>' : '') +
      '<div class="am-person-h">' + avatar(p) + '<div><b>' + esc(p.name) + '</b><div class="am-title">' + esc(p.title || '') + '</div></div></div>' +
      '<div class="am-badges">' + (p.new_in_role ? chip('acc', 'New in role', 'Started this role in the last year (Saleshandy)') : '') +
      (p.decision_maker ? chip('ok', 'Decision-maker') : '') + (p.source === 'web' ? chip('', 'Found on the web') : '') + '</div>' +
      (facts ? '<ul class="am-facts">' + facts + '</ul>' : '') +
      emailLine(p) +
      (p.linkedin && safeUrl(p.linkedin) ? '<div class="am-li"><a href="' + esc(safeUrl(p.linkedin)) + '" target="_blank" rel="noopener noreferrer">' + ic('li') + 'LinkedIn profile</a></div>' : '') +
      (opts.opener ? '<blockquote class="am-opener">' + esc(opts.opener) + '</blockquote>' : '') + '</article>';
  }

  // == one account =======================================================================

  function teamBars(ins) {
    var teams = (ins.teams || []).slice();
    if (!teams.length) return '';
    var max = Math.max.apply(null, teams.map(function (t) { return t.people || 0; }).concat([1]));
    return '<div class="am-bars">' + teams.map(function (t, i) {
      var w = Math.max(4, Math.round(100 * (t.people || 0) / max));
      return '<div class="am-bar"><span>' + esc(t.department) + '</span><i><em class="b' + (i % 6) + '" style="width:' + w + '%"></em></i><b>' + esc(num(t.people)) + '</b></div>';
    }).join('') + '</div>';
  }

  function signals(ins) {
    var sig = ins.signals || {}, nl = ins.new_leaders || {};
    var out = [];
    if (sig.hiring_your_titles) out.push('<span class="am-sg hot">' + ic('trend') + 'Hiring for your titles</span>');
    else if (sig.hiring) out.push('<span class="am-sg ok">' + ic('trend') + 'Hiring</span>');
    if (sig.funded_last_year) out.push('<span class="am-sg hot">' + ic('coin') + 'Raised money this year</span>');
    if (nl.total) out.push('<span class="am-sg warn">' + ic('spark') + esc(plural(nl.total, 'new leader')) + ' this year</span>');
    if (ins.signals && !out.length) out.push('<span class="am-sg">No hiring or funding shown</span>');
    return out.join('');
  }

  function renderBrief(b) {
    if (!b) return '';
    var fc = b.first_contact || {};
    return '<div class="am-brief"><div class="cl-eye">The brief</div>' +
      (b.one_liner ? '<p class="am-one">' + esc(b.one_liner) + '</p>' : '') +
      (b.shape ? '<p class="am-shape">' + esc(b.shape) + '</p>' : '') +
      ((b.changes || []).length ? '<h5>What changed</h5><ul class="am-changes">' + b.changes.map(function (c) {
        return '<li>' + esc(c.text) + ' <span class="am-src">' + (safeUrl(c.source) ? link(c.source, 'source') : esc(c.source)) + '</span></li>';
      }).join('') + '</ul>' : '') +
      (fc.name ? '<div class="am-first"><span class="mr-k">Contact first</span><b>' + esc(fc.name) + '</b><p>' + esc(fc.why) + '</p></div>' :
        fc.why ? '<div class="am-first"><span class="mr-k">Contact first</span><p>' + esc(fc.why) + '</p></div>' : '') +
      ((b.watch_outs || []).length ? '<h5>Watch out</h5><ul class="am-watch">' + b.watch_outs.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
      '</div>';
  }

  var FILTERS = [['all', 'Everyone'], ['new', 'New in role'], ['dm', 'Decision-makers'], ['email', 'With an email']];
  function passes(p, f) {
    return f === 'new' ? !!p.new_in_role : f === 'dm' ? !!p.decision_maker : f === 'email' ? !!(p.email && p.email.address) : true;
  }
  function peopleOf(c) {
    var all = [];
    (c.roles || []).forEach(function (r) { all = all.concat(r.picked || [], r.also || [], r.web || []); });
    return all;
  }

  function renderFilters(c, f) {
    var all = peopleOf(c);
    if (!all.length) return '';
    return '<div class="am-filters" role="group" aria-label="Show">' + FILTERS.map(function (x) {
      var n = all.filter(function (p) { return passes(p, x[0]); }).length;
      return '<button type="button" class="am-f' + (x[0] === f ? ' on' : '') + '" data-act="filter" data-f="' + x[0] + '" aria-pressed="' + (x[0] === f) + '">' + esc(x[1]) + '<b>' + esc(n) + '</b></button>';
    }).join('') + '</div>';
  }

  // The buying group of one account: one tile per title, the person in it.
  function renderGroup(c) {
    var roles = (c.roles || []);
    if (!roles.length) return '';
    return '<div class="am-group"><span class="mr-k">Buying group</span><div class="am-group-row">' + roles.map(function (r) {
      var st = seatOf(c, r.role);
      return '<div class="am-seat s-' + st.s + '">' + (st.who ? '<span class="am-ava sm ' + hue(st.who) + '">' + esc(initials(st.who)) + '</span>' : '<span class="am-ava sm empty">?</span>') +
        '<div><small>' + esc(r.role) + '</small><b>' + esc(st.who || (st.s === 'none' ? 'Nobody found' : '')) + '</b></div></div>';
    }).join('') + '</div></div>';
  }

  function renderRole(r, opener, selected, f) {
    var st = ROLE_STATUS[r.status] || ['', r.status];
    var show = function (p) { return passes(p, f); };
    var people = (r.picked || []).filter(show).map(function (p) { return personCard(p, { picked: true, opener: opener[p.name], selected: selected[keyOf(p)] }); })
      .concat((r.web || []).filter(show).map(function (p) { return personCard(p, { picked: true, opener: opener[p.name], selected: selected[keyOf(p)] }); }));
    var also = (r.also || []).filter(show).map(function (p) { return personCard(p, { opener: opener[p.name], selected: selected[keyOf(p)] }); });
    var tried = (r.attempts || []).map(function (a) { return '<li>' + esc(a.how) + ': ' + esc(num(a.total)) + ' found' + (a.kept != null && a.kept !== a.total ? ', ' + esc(a.kept) + ' kept' : '') + '</li>'; }).join('');
    var filtered = f && f !== 'all';
    return '<section class="am-role"><div class="am-role-h"><h4>' + esc(r.role) + '</h4>' + chip(st[0], st[1]) + '</div>' +
      (people.length ? '<div class="am-people">' + people.join('') + '</div>' :
        '<div class="am-none">' + (filtered ? '<b>No one here matches this filter</b>' : '<b>Nobody in this seat</b>' + (also.length ? 'The closest titles are below.' : 'Saleshandy has nobody with this title here' + (r.web_search ? ', and the web search found nobody either.' : '.'))) + '</div>') +
      (also.length ? '<details class="mr-more"' + (people.length ? '' : ' open') + '><summary>Also found (' + esc(also.length) + ')</summary><div class="am-people">' + also.join('') + '</div></details>' : '') +
      (tried ? '<details class="mr-more"><summary>How it searched</summary><ul class="mr-list">' + tried + '</ul></details>' : '') + '</section>';
  }

  function renderAccount(c, ui) {
    ui = ui && ui.selected !== undefined ? ui : { selected: ui || {} };
    var selected = ui.selected || {}, f = ui.filter || 'all';
    var r = c.resolved || {}, co = r.company || {}, ins = c.insights || {}, p = c.priority || {};
    var opener = {};
    ((c.brief || {}).openers || []).forEach(function (o) { opener[o.name] = o.line; });
    var meta = [co.industry, co.employees ? num(co.employees) + ' employees' : null, co.hq, co.founded ? 'founded ' + co.founded : null, co.type]
      .filter(Boolean).map(function (x) { return chip('', x); }).join(' ');
    var pat = c.email_pattern;
    var head = '<div class="am-acc-h"><div class="am-mono ' + hue(c.display_name || c.name) + '" aria-hidden="true">' + esc(initials(c.display_name || c.name)) + '</div><div class="am-acc-t">' +
      '<h3>' + esc(c.display_name || c.name) + '</h3><div class="cl-co-sub">' +
      (c.domain ? link('https://' + c.domain + '/', c.domain) : '<i>no company matched</i>') +
      (co.linkedin ? ' ' + link(co.linkedin, 'LinkedIn page') : '') +
      (r.how ? ' ' + chip(r.how === 'not found' ? 'bad' : r.how === 'closest name' ? 'warn' : '', 'matched by ' + r.how) : '') +
      (pat && pat.pattern ? ' ' + chip(pat.level === 'confirmed' ? 'ok' : 'warn', 'emails: ' + pat.pattern + '@' + pat.domain) : '') + '</div>' +
      (meta ? '<div class="am-meta">' + meta + '</div>' : '') + '</div>' +
      '<div class="am-prio" title="' + esc((p.reasons || []).join('\n')) + '">' + ring(p.score, 78, 'priority') + '</div></div>';
    var alts = (r.alternatives || []).length ? '<div class="mr-callout warn">Other companies with this name: ' + r.alternatives.map(function (a) {
      return esc(a.name) + (a.domain ? ' (' + esc(a.domain) + ')' : '');
    }).join(', ') + '. Add &ldquo;| domain.com&rdquo; to the line to pick one.</div>' : '';
    var errs = (c.errors || []).map(function (e) { return '<div class="mr-callout bad">' + esc(e) + '</div>'; }).join('');
    var side = (ins.people_in_saleshandy != null ? '<div class="am-side"><div class="am-side-ns"><div class="am-side-n"><b>' + esc(num(ins.people_in_saleshandy)) + '</b><span>people listed</span></div>' +
      '<div class="am-side-n"><b>' + esc(num(ins.decision_makers)) + '</b><span>decision-makers</span></div></div>' + teamBars(ins) +
      '<div class="am-sig">' + signals(ins) + '</div>' +
      (((ins.new_leaders || {}).people || []).length ? '<h5>New leaders this year</h5><ul class="am-nl">' + ins.new_leaders.people.map(function (x) {
        return '<li>' + avatar({ name: x.name }, 'xs') + '<span><b>' + esc(x.name) + '</b> ' + esc(x.title || '') + '</span></li>';
      }).join('') + '</ul>' : '') + '</div>' : '');
    var reasons = (p.reasons || []).length ? '<div class="am-why">' + p.reasons.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '';
    return '<div class="card mr-card am-acc">' + head + '<div class="mr-card-b">' + alts + errs + reasons +
      '<div class="am-acc-grid"><div class="am-acc-main">' + renderBrief(c.brief) + (c.brief_error ? '<div class="mr-callout warn">The brief could not be written: ' + esc(c.brief_error) + '</div>' : '') +
      renderGroup(c) + renderFilters(c, f) +
      (c.roles || []).map(function (r) { return renderRole(r, opener, selected, f); }).join('') + '</div>' + side + '</div></div></div>';
  }

  // == the reveal bar =======================================================================

  function renderRevealBar(run, sel, ui) {
    var n = Object.keys(sel || {}).filter(function (k) { return sel[k]; }).length;
    var per = ui && ui.phone ? 7 : 1;
    var cap = Number((ui && ui.cap) || 50) || 50;
    var last = ((run.summary || {}).reveals || []).slice(-1)[0];
    var worst = n * per, pct = Math.min(100, Math.round(100 * worst / cap));
    return '<div class="am-revealbar"><div class="am-rb-l"><b>' + plural(n, 'person', 'people') + ' ticked</b><span>Up to ' + esc(worst) + ' credits' +
      (per > 1 ? ' (email + phone, 7 each)' : ' (1 per email found; none when not found)') + '</span>' +
      '<i class="am-meter' + (worst > cap ? ' over' : '') + '" title="' + esc(worst) + ' of the ' + esc(cap) + '-credit cap"><em style="width:' + pct + '%"></em></i>' +
      (last ? '<span class="am-last">Last reveal: ' + esc(last.found) + ' of ' + esc(last.asked) + ' found, ' + esc(num(last.credits)) + ' credits</span>' : '') + '</div>' +
      '<label class="am-cap">Credit cap <input type="number" min="1" max="1000" id="amCap" value="' + esc(cap) + '"></label>' +
      '<label class="am-cap"><input type="checkbox" id="amPhone"' + (ui && ui.phone ? ' checked' : '') + '> Phones too</label>' +
      '<button type="button" class="mr-btn ghost" data-act="best">Best per title</button>' +
      '<button type="button" class="mr-btn primary hot" data-act="reveal"' + (n && run.status === 'ready' ? '' : ' disabled') + '>' + ic('mail') + 'Reveal emails</button></div>';
  }

  // A run in progress: how many accounts are done, and what it is doing now.
  function renderProgress(run, total, done) {
    var pct = total ? Math.round(100 * done / total) : 0;
    var revealing = run.stage === 'revealing' || /^reveal/.test(run.stage || '');
    return '<div class="am-progress"><div class="am-progress-h"><span class="am-spin" aria-hidden="true"></span><div><b>' + (revealing ? 'Revealing emails' : 'Mapping accounts') + '</b>' +
      '<span>' + esc(run.stage || 'starting') + '&hellip;</span></div><strong>' + esc(done) + ' of ' + esc(total) + '</strong></div>' +
      '<i class="am-pbar"><em style="width:' + Math.max(pct, 6) + '%"></em></i></div>';
  }

  function renderRun(run, ui) {
    ui = ui || {};
    if (!run) return '';
    var s = run.summary || {}, cs = s.companies || [];
    var running = run.status === 'running' && !run.stale;
    var roles = ((run.settings || {}).roles || []);
    var head = '<div class="cl-run-h"><div><div class="eyebrow">Run ' + esc(run.id) + ' &middot; ' + esc(when(run.created_at)) + '</div>' +
      '<h2>' + esc(roles.join(', ')) + '</h2>' +
      '<p>' + esc(((run.settings || {}).companies || []).map(function (c) { return c.name; }).join(' · ')) + '</p></div>' +
      '<div class="mr-actions"><button type="button" class="mr-btn ghost" data-act="again" title="Put this run’s accounts and titles back in the form">' + ic('refresh') + 'Run again</button>' +
      '<a class="mr-btn" href="' + API + '/runs/' + encodeURIComponent(run.id) + '/export.csv' + (AQ ? '?' + AQ : '') + '">' + ic('dl') + 'Download CSV</a>' +
      '<a class="mr-btn ghost" href="' + API + '/runs/' + encodeURIComponent(run.id) + '?download=1' + (AQ ? '&amp;' + AQ : '') + '">JSON</a>' +
      (CLIENT || running ? '' : '<button type="button" class="mr-btn ghost am-del" data-act="delete" title="Remove this run and its results from the list">' + ic('trash') + 'Delete</button>') + '</div></div>';
    var total = ((run.settings || {}).companies || []).length;
    var stateLine = running ? renderProgress(run, total, cs.length) :
      run.stale ? '<div class="mr-callout bad">' + esc(run.stale) + '</div>' :
      run.status === 'failed' ? '<div class="am-failed"><b>The run did not finish</b><p>' + esc(run.error || 'No reason was given.') + '</p><button type="button" class="mr-btn primary" data-act="again">' + ic('refresh') + 'Try again</button></div>' :
      run.error ? '<div class="mr-callout warn">' + esc(run.error) + '</div>' : '';
    var notes = [s.plan_note, s.web_stopped, s.brief_stopped, s.reveal_error].filter(Boolean).map(function (n) { return '<div class="mr-callout warn">' + esc(n) + '</div>'; }).join('');
    if (!cs.length) return head + stateLine + notes + (running || run.status === 'failed' ? '' : '<div class="card"><div class="mr-empty"><b>No results</b>This run found nothing to show.</div></div>');
    var order = (s.ranking || []).length ? s.ranking : cs.map(function (c) { return c.name; });
    var byName = {};
    cs.forEach(function (c) { byName[c.name] = c; });
    var list = order.map(function (n) { return byName[n]; }).filter(Boolean);
    cs.forEach(function (c) { if (list.indexOf(c) < 0) list.push(c); });
    var pick = Math.min(ui.company || 0, list.length - 1);
    var tabs = '<nav class="am-tabs" aria-label="Accounts">' + list.map(function (c, i) {
      var found = (c.roles || []).filter(function (r) { return (r.picked || []).length || (r.web || []).length; }).length;
      return '<button type="button" class="' + (i === pick ? 'on' : '') + '" data-act="company" data-i="' + i + '"' + (i === pick ? ' aria-current="true"' : '') + '>' +
        ring((c.priority || {}).score, 36) + '<span class="am-tab-n">' + esc(c.display_name || c.name) +
        '<small>' + esc(found) + '/' + esc((c.roles || []).length) + ' seats</small></span></button>';
    }).join('') + '</nav>';
    // While it runs only the accounts finished so far are shown, as they come in; the dashboard and the reveal bar wait for the end.
    return head + stateLine + notes + (running ? '' : renderOverview(run, list)) + (!CLIENT && run.status === 'ready' ? renderRevealBar(run, ui.selected, ui) : '') +
      '<div class="am-body" id="amBody">' + tabs + renderAccount(list[pick], ui) + '</div>';
  }

  function bestSelection(run) {
    var sel = {};
    ((run.summary || {}).companies || []).forEach(function (c) {
      (c.roles || []).forEach(function (r) {
        var first = (r.picked || []).length ? r.picked : (r.web || []).slice(0, 1);
        first.forEach(function (p) { var k = keyOf(p); if (k && !p.revealed) sel[k] = true; });
      });
    });
    return sel;
  }

  // The form's lines for a run's accounts and titles (so a run can be repeated).
  function formLines(run) {
    var st = run.settings || {};
    return { companies: (st.companies || []).map(function (c) { return c.name + (c.domain ? ' | ' + c.domain : ''); }).join('\n'),
      roles: (st.roles || []).join('\n') };
  }

  var AM = { esc: esc, safeUrl: safeUrl, keyOf: keyOf, renderReady: renderReady, renderEstimate: renderEstimate, renderRuns: renderRuns,
    renderRun: renderRun, renderOverview: renderOverview, renderAccount: renderAccount, personCard: personCard,
    renderRevealBar: renderRevealBar, bestSelection: bestSelection, renderSetup: renderSetup, renderWelcome: renderWelcome,
    renderSeatMap: renderSeatMap, renderProgress: renderProgress, ring: ring, formLines: formLines, seatOf: seatOf,
    // what the chat (people_chat.js) shares
    ic: ic, chip: chip, hue: hue, initials: initials, avatar: avatar, num: num, when: when, plural: plural, link: link,
    money: money, EMAIL: EMAIL, client: CLIENT };
  root.AM = AM;

  // == the page =========================================================================

  if (typeof document === 'undefined' || !document.getElementById('am')) return;

  var $ = function (id) { return document.getElementById(id); };
  var state = { status: null, runs: [], selected: null, run: null, poll: null, estTimer: null,
    ui: { company: 0, selected: {}, cap: 50, phone: false, filter: 'all' } };
  var LIMITS = { companies: 25, roles: 6 };
  var PRESETS = ['VP Marketing', 'Head of Demand Generation', 'CMO', 'VP Sales', 'Head of Growth', 'CTO', 'VP Engineering', 'Founder'];
  var EXAMPLE = { companies: 'HubSpot | hubspot.com\nGong | gong.io\nCore Care Clinic | corecareclinic.com', roles: 'VP Marketing\nHead of Demand Generation\nCMO' };

  function api(path, body) {
    var opts = body === undefined ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Request failed (' + r.status + ')'); e.data = j; e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function toast(text) {
    var t = document.createElement('div');
    t.className = 'mr-toast'; t.setAttribute('role', 'status'); t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }
  function ask(title, text, yes) {
    return new Promise(function (resolve) {
      $('amModalTitle').textContent = title; $('amModalText').textContent = text; $('amModalYes').textContent = yes || 'Go ahead';
      var bg = $('amModal'); bg.classList.add('open'); $('amModalYes').focus();
      function done(ok) { bg.classList.remove('open'); $('amModalYes').onclick = $('amModalNo').onclick = null; resolve(ok); }
      $('amModalYes').onclick = function () { done(true); };
      $('amModalNo').onclick = function () { done(false); };
    });
  }
  function form() {
    return { companies: $('amCompanies').value, roles: $('amRoles').value, per_role: Number($('amPerRole').value) || 2,
      insights: $('amInsights').checked, use_claude: $('amPhrasings').checked, web_fill: $('amWeb').checked,
      briefs: $('amBriefs').checked, model: $('amModel').value };
  }
  function lines(id) { return $(id).value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function counts() {
    var c = lines('amCompanies').length, r = lines('amRoles').length;
    $('amCompaniesN').textContent = c + ' of ' + LIMITS.companies;
    $('amCompaniesN').className = 'am-count' + (c > LIMITS.companies ? ' over' : '');
    $('amRolesN').textContent = r + ' of ' + LIMITS.roles;
    $('amRolesN').className = 'am-count' + (r > LIMITS.roles ? ' over' : '');
    var have = lines('amRoles').map(function (x) { return x.toLowerCase(); });
    $('amPresets').innerHTML = PRESETS.map(function (t) {
      var on = have.indexOf(t.toLowerCase()) >= 0;
      return '<button type="button" class="am-pre' + (on ? ' on' : '') + '" data-act="preset" data-t="' + esc(t) + '" aria-pressed="' + on + '">' + (on ? '' : '+ ') + esc(t) + '</button>';
    }).join('');
  }
  function fill(companies, roles) {
    $('amCompanies').value = companies; $('amRoles').value = roles; counts(); estimate();
    $('amForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function welcome() {
    if (!state.runs.length && !state.run) $('amDetail').innerHTML = renderWelcome();
  }
  function estimate() {
    clearTimeout(state.estTimer);
    state.estTimer = setTimeout(function () {
      var f = form();
      if (!f.companies.trim() || !f.roles.trim()) { $('amEstimate').innerHTML = ''; return; }
      api('/estimate', f).then(function (e) { state.est = e; $('amEstimate').innerHTML = renderEstimate(e); })
        .catch(function (e) { $('amEstimate').innerHTML = renderEstimate({ error: e.message }); });
    }, 350);
  }
  function paintRun() {
    var y = window.scrollY;
    $('amDetail').innerHTML = renderRun(state.run, state.ui);
    window.scrollTo(0, y);
  }
  function loadRuns() {
    return api('/runs').then(function (j) { state.runs = j.runs || []; $('amRuns').innerHTML = renderRuns(state.runs, state.selected); })
      .catch(function (e) { $('amRuns').innerHTML = '<div class="mr-empty">' + esc(e.message) + '</div>'; });
  }
  function isChat(id) {
    var r = state.runs.filter(function (x) { return x.id === id; })[0];
    return !!(r && (r.settings || {}).chat);
  }
  // Two ways in: ask in plain words (the chat) or map many accounts at once (the form and its dashboard).
  function setMode(mode) {
    state.mode = mode === 'map' ? 'map' : 'ask';
    var ask = state.mode === 'ask';
    $('amAsk').hidden = !ask; $('amForm').hidden = ask; $('amDetail').hidden = ask;
    ['ask', 'map'].forEach(function (m) {
      var b = document.querySelector('[data-mode="' + m + '"]');
      if (b) { b.classList.toggle('on', m === state.mode); b.setAttribute('aria-selected', String(m === state.mode)); }
    });
    try { sessionStorage.setItem('am-mode', state.mode); } catch (e) { /* ignore */ }
  }
  function open(id) {
    if (isChat(id)) {
      setMode('ask'); state.selected = id; $('amRuns').innerHTML = renderRuns(state.runs, id);
      if (AM.chat) AM.chat.show(id);
      return Promise.resolve();
    }
    setMode('map');
    clearTimeout(state.poll);
    var fresh = state.selected !== id;
    state.selected = id;
    try { history.replaceState(null, '', '#run-' + id); } catch (e) { /* ignore */ }
    $('amRuns').innerHTML = renderRuns(state.runs, id);
    return api('/runs/' + id).then(function (run) {
      if (state.selected !== id) return;
      var wasRunning = state.run && state.run.id === id && state.run.status === 'running';
      state.run = run;
      if (fresh || (wasRunning && run.status === 'ready')) { state.ui.company = fresh ? 0 : state.ui.company; state.ui.selected = bestSelection(run); if (fresh) state.ui.filter = 'all'; }
      paintRun();
      if (run.status === 'running' && !run.stale) state.poll = setTimeout(function () { open(id); }, 4000);
      else loadRuns();
    }).catch(function (e) { $('amDetail').innerHTML = '<div class="mr-callout bad">' + esc(e.message) + '</div>'; });
  }
  function removeRun() {
    var run = state.run;
    if (!run) return;
    ask('Delete run ' + run.id + '?', 'Its people, signals and briefs are removed from your list. Credits already spent stay spent. This cannot be undone.', 'Delete').then(function (ok) {
      if (!ok) return;
      api('/runs/' + run.id + '/delete', {}).then(function () {
        toast('Run ' + run.id + ' deleted.');
        state.run = null; state.selected = null; clearTimeout(state.poll);
        try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
        return loadRuns().then(function () { if (state.runs.length) open(state.runs[0].id); else { $('amDetail').innerHTML = ''; welcome(); } });
      }).catch(function (e) { toast(e.message); });
    });
  }
  function copyText(text) {
    function done() { toast('Copied ' + text); }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { toast('Copy it by hand: ' + text); }); return; }
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Copy it by hand: ' + text); }
    ta.remove();
  }
  function chosen() { return Object.keys(state.ui.selected).filter(function (k) { return state.ui.selected[k]; }).map(function (k) { return /^\d+$/.test(k) ? Number(k) : k; }); }

  function reveal() {
    var run = state.run, keys = chosen();
    if (!run || !keys.length) return;
    var body = { keys: keys, cap_credits: Number(state.ui.cap) || 50, phone: !!state.ui.phone };
    api('/runs/' + run.id + '/reveal', Object.assign({ dry_run: true }, body)).then(function (check) {
      if (!check.ok) { toast(check.why || 'This reveal cannot go ahead.'); return; }
      return ask('Reveal ' + check.people + ' email' + (check.people === 1 ? '' : 's') + '?',
        'This uses up to ' + check.worst_credits + ' Saleshandy credits (' + check.per_person + ' per person, only when an email is found). ' +
        (check.balance != null ? 'The account has ' + num(check.balance) + ' credits. ' : '') + 'The cap for this reveal is ' + check.cap + '.', 'Reveal').then(function (ok) {
        if (!ok) return;
        return api('/runs/' + run.id + '/reveal', Object.assign({ confirm: true }, body)).then(function () {
          toast('Revealing ' + check.people + '…'); state.ui.selected = {}; return open(run.id);
        });
      });
    }).catch(function (e) { toast(e.message); });
  }

  ['amCompanies', 'amRoles', 'amPerRole', 'amInsights', 'amPhrasings', 'amWeb', 'amBriefs', 'amModel'].forEach(function (id) {
    $(id).addEventListener('input', function () { counts(); estimate(); }); $(id).addEventListener('change', estimate);
  });
  counts();
  $('amForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = form();
    var paid = f.use_claude || f.web_fill || f.briefs;
    var go = paid ? ask('Use Claude on this run?', 'Mapping is free; the Claude steps you ticked cost about ' + money((state.est || {}).usd_typical) +
      ' and stop at ' + money((state.est || {}).usd_cap) + '. No Saleshandy credits are used until you reveal.', 'Map accounts') : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      f.confirm_spend = paid;
      $('amRunBtn').disabled = true;
      api('/runs', f).then(function (j) { toast('Mapping run ' + j.run_id + '.'); return loadRuns().then(function () { open(j.run_id); }); })
        .catch(function (err) {
          if (err.status === 409 && err.data && err.data.run_id) { toast(err.message); open(err.data.run_id); return; }
          toast(err.message);
        }).then(function () { $('amRunBtn').disabled = false; });
    });
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || !$('am').contains(el)) return;
    var act = el.getAttribute('data-act');
    if (act === 'open') open(Number(el.getAttribute('data-id')));
    else if (act === 'company') { state.ui.company = Number(el.getAttribute('data-i')); paintRun(); }
    else if (act === 'jump') {
      state.ui.company = Number(el.getAttribute('data-i')); paintRun();
      var body = $('amBody'); if (body) body.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    else if (act === 'filter') { state.ui.filter = el.getAttribute('data-f'); paintRun(); }
    else if (act === 'copy') copyText(el.getAttribute('data-text'));
    else if (act === 'again' && state.run) { var f = formLines(state.run); fill(f.companies, f.roles); toast('The form has this run\u2019s accounts and titles.'); }
    else if (act === 'example') { fill(EXAMPLE.companies, EXAMPLE.roles); }
    else if (act === 'delete') removeRun();
    else if (act === 'preset') {
      var t = el.getAttribute('data-t'), have = lines('amRoles');
      var at = have.map(function (x) { return x.toLowerCase(); }).indexOf(t.toLowerCase());
      if (at >= 0) have.splice(at, 1); else have.push(t);
      $('amRoles').value = have.join('\n'); counts(); estimate();
    }
    else if (act === 'best') { state.ui.selected = bestSelection(state.run); paintRun(); }
    else if (act === 'reveal') reveal();
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!$('am').contains(el)) return;
    if (el.getAttribute('data-act') === 'pick') { state.ui.selected[el.getAttribute('data-key')] = el.checked; paintRun(); }
    else if (el.id === 'amCap') { state.ui.cap = Number(el.value) || 50; }
    else if (el.id === 'amPhone') { state.ui.phone = el.checked; paintRun(); }
  });

  api('/status').then(function (s) {
    state.status = s;
    if (AM.chat) AM.chat.setStatus(s);
    $('amReady').innerHTML = renderReady(s);
    $('amSetup').innerHTML = renderSetup(s);
    if (s.limits) { LIMITS.companies = s.limits.companies || LIMITS.companies; LIMITS.roles = s.limits.roles || LIMITS.roles; counts(); }
    if (!(s.saleshandy || {}).configured) { $('amRunBtn').disabled = true; $('amRunBtn').title = CLIENT ? 'Not connected yet' : 'Add SALESHANDY_API_KEY first'; }
    $('amModel').innerHTML = (s.models || []).map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join('');
    if (CLIENT || !(s.claude || {}).configured) ['amPhrasings', 'amWeb', 'amBriefs'].forEach(function (id) { $(id).checked = false; $(id).disabled = true; });
    estimate();
  }).catch(function (e) { $('amReady').innerHTML = chip('bad', e.message); });
  AM.page = { api: api, toast: toast, ask: ask, copyText: copyText, loadRuns: loadRuns, state: state, setMode: setMode,
    refreshRuns: function () { $('amRuns').innerHTML = renderRuns(state.runs, state.selected); } };
  document.querySelectorAll('[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      setMode(b.getAttribute('data-mode'));
      if (state.mode === 'map' && !state.run) {
        var last = state.runs.filter(function (r) { return !(r.settings || {}).chat; })[0];
        if (last) open(last.id); else welcome();
      }
    });
  });
  loadRuns().then(function () {
    var m = /#run-(\d+)/.exec(location.hash);
    var hashId = m ? Number(m[1]) : null;
    var saved = null;
    try { saved = sessionStorage.getItem('am-mode'); } catch (e) { /* ignore */ }
    if (AM.chat) AM.chat.init(state.runs, state.status);
    if (hashId && !isChat(hashId)) { open(hashId); return; }
    setMode(hashId || saved !== 'map' ? 'ask' : 'map');
    if (hashId) { open(hashId); return; }
    if (state.mode === 'map') {
      var last = state.runs.filter(function (r) { return !(r.settings || {}).chat; })[0];
      if (last) open(last.id); else welcome();
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
