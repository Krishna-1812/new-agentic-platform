/* Contact Finder Lab page (templates/contact_lab.html).
 *
 * The render* functions are pure: data in, HTML out, every value escaped
 * (names, headlines and addresses come from search results), every link
 * through safeUrl. They are exported as window.CL so tests can run them
 * under Node. The wiring at the bottom only runs on the page.
 */
(function (root) {
  'use strict';

  var API = '/admin/contact-lab/api';
  var BACKEND = { searxng: ['Our search service', 'free'], claude: ['Claude web search', 'paid'] };
  var LABEL = {
    published: ['ok', 'Published', 'Seen on a public page'],
    pattern_confirmed: ['ok', 'Pattern, confirmed', 'Built from the company\'s pattern, which 2 or more real addresses follow'],
    pattern_likely: ['warn', 'Pattern, likely', 'Built from a pattern one real address follows, or that addresses have the shape of'],
    pattern_guess: ['', 'Guess', 'The commonest pattern; nothing seen at this company confirms it'],
    none: ['', 'No address', '']
  };
  var CURRENT = { yes: ['ok', 'Works there'], no: ['bad', 'Left / elsewhere'], unclear: ['', 'Unclear'] };

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
  function money(v) { return v == null ? '–' : '$' + Number(v).toFixed(Number(v) < 1 ? 3 : 2); }
  function secs(ms) { return ms == null ? '–' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s'; }
  function when(iso) {
    var d = new Date(iso || '');
    return isNaN(d) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function chip(cls, text, title) {
    return '<span class="mr-chip ' + esc(cls || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>';
  }

  // == readiness and the estimate =======================================================

  function renderReady(s) {
    if (!s) return '';
    var sx = s.searxng || {};
    return chip(sx.ok ? 'ok' : sx.configured ? 'bad' : '', 'Search service: ' + (sx.ok ? 'up' : sx.configured ? 'down' : 'not set up'), sx.note) +
      ' ' + chip((s.claude || {}).configured ? 'ok' : '', 'Claude: ' + ((s.claude || {}).configured ? 'key set' : 'no key'));
  }

  function renderEstimate(e, backends) {
    if (!e) return '';
    if (e.error) return '<div class="mr-callout bad">' + esc(e.error) + '</div>';
    var free = backends.indexOf('claude') < 0;
    return '<b>' + esc(e.companies) + ' compan' + (e.companies === 1 ? 'y' : 'ies') + ' &times; ' + esc(e.roles) + ' title' + (e.roles === 1 ? '' : 's') + '.</b> ' +
      (free ? 'Free: only our search service is used, and people are checked by text matching, not by a model.'
        : esc(e.claude_searches) + ' Claude searches; typically about ' + esc(money(e.typical_usd)) + ', never more than ' + esc(money(e.cap_usd)) + '.');
  }

  // == the runs list ====================================================================

  function renderRuns(runs, selected) {
    if (!runs || !runs.length) return '<div class="mr-empty"><b>No runs yet</b>Start one on the left.</div>';
    return '<ul class="cl-runl">' + runs.map(function (r) {
      var st = r.status === 'running' ? (r.stale ? chip('bad', 'Stalled') : chip('acc', 'Running')) :
        r.status === 'failed' ? chip('bad', 'Failed') : chip('ok', 'Done');
      var n = ((r.settings || {}).companies || []).length;
      return '<li><button type="button" class="cl-run' + (r.id === selected ? ' on' : '') + '" data-act="open" data-id="' + esc(r.id) + '">' +
        '<b>Run ' + esc(r.id) + '</b>' + st + '<small>' + esc(when(r.created_at)) + ' &middot; ' + esc(n) + ' compan' + (n === 1 ? 'y' : 'ies') +
        ' &middot; ' + esc(((r.settings || {}).backends || []).map(function (b) { return (BACKEND[b] || [b])[0]; }).join(' + ')) +
        ' &middot; ' + esc(money(r.spent_usd)) + '</small></button></li>';
    }).join('') + '</ul>';
  }

  // == one run ==========================================================================

  function stat(n, label, cls) {
    return '<div class="cl-stat ' + (cls || '') + '"><b>' + esc(n) + '</b><span>' + esc(label) + '</span></div>';
  }

  function renderScore(summary) {
    var t = summary.totals || {}, backends = (summary.settings || {}).backends || [];
    var cols = backends.map(function (b) {
      var x = t[b] || {}, q = x.queries || 0;
      var refusals = Object.keys(x.refusals || {}), answered = Object.keys(x.answered_by || {});
      return '<div class="cl-side b-' + esc(b) + '"><div class="cl-side-h"><b>' + esc((BACKEND[b] || [b])[0]) + '</b>' + chip(b === 'claude' ? 'acc' : 'ok', (BACKEND[b] || ['', ''])[1]) + '</div>' +
        '<div class="cl-stats">' + stat(x.matched || 0, 'right people found', 'k-big') + stat(x.profiles || 0, 'LinkedIn profiles') +
        stat(x.domains_right || 0, 'websites found') + stat(x.emails || 0, 'addresses seen') +
        stat(q ? Math.round(100 * (x.blocked || 0) / q) + '%' : '–', 'searches refused', (x.blocked ? 'k-bad' : '')) +
        stat(secs(x.ms), 'time searching') + stat(money(x.cost_usd), 'search cost') + '</div>' +
        (answered.length ? '<div class="cl-eng"><span class="mr-k">Answered</span>' + answered.map(function (e) {
          return chip('ok', e + ' ' + x.answered_by[e]);
        }).join(' ') + '</div>' : '') +
        (refusals.length ? '<div class="cl-eng"><span class="mr-k">Refused</span>' + refusals.map(function (e) {
          return chip('bad', e + ' ×' + x.refusals[e]);
        }).join(' ') + '</div>' : '') + '</div>';
    }).join('');
    var p25 = summary.port25 || {};
    var labels = t.emails || {};
    var cost = summary.cost || {};
    return '<div class="cl-score"><div class="cl-score-h"><div><div class="cl-eye">Scoreboard</div><h3>Which way of searching found the people?</h3>' +
      '<p>' + esc(t.matched_by_both || 0) + ' of the right people were found both ways. &ldquo;Right&rdquo; means still working there, in a title asked for' +
      (backends.indexOf('claude') < 0 ? ', judged by text matching on this free run.' : ', judged by the model from the search results.') + '</p></div>' +
      '<div class="cl-total"><b>' + esc(money(cost.spent_usd)) + '</b><span>spent of ' + esc(money(cost.cap_usd)) + '</span></div></div>' +
      '<div class="cl-sides">' + cols + '</div>' +
      '<div class="cl-foot">' +
      '<span>' + chip(p25.status === 'open' ? 'ok' : 'warn', 'Port 25 ' + (p25.status || 'not checked'), p25.note || p25.banner) +
      ' Mailbox checks ' + (p25.status === 'open' ? 'could be built from this server.' : 'cannot be built from this server.') + '</span>' +
      '<span>Emails for the right people: ' + (Object.keys(labels).length ? Object.keys(labels).map(function (k) {
        return chip((LABEL[k] || [''])[0], (LABEL[k] || [0, k])[1] + ' ' + labels[k], (LABEL[k] || [0, 0, ''])[2]);
      }).join(' ') : 'none yet') + '</span></div></div>';
  }

  function personRow(p) {
    var cur = CURRENT[p.current] || CURRENT.unclear, lab = LABEL[(p.email || {}).label] || LABEL.none;
    var found = (p.found_by || []).map(function (b) {
      return '<span class="cl-by by-' + esc(b) + '">' + esc(b === 'searxng' ? 'Search service' : b === 'claude' ? 'Claude' : 'Website') + '</span>';
    }).join('');
    return '<tr class="' + (p.current === 'yes' && p.role ? 'hit' : 'miss') + '"><td><b>' + esc(p.name) + '</b>' +
      (p.linkedin ? '<br>' + link(p.linkedin, 'LinkedIn profile') : '') + '</td>' +
      '<td>' + esc(p.headline || p.site_title || '') + (p.why ? '<div class="mr-hint">' + esc(p.why) + '</div>' : '') + '</td>' +
      '<td>' + chip(cur[0], cur[1]) + (p.role ? '<div class="cl-role">' + esc(p.role) + '</div>' : '') + '</td>' +
      '<td>' + ((p.email || {}).address ? '<code>' + esc(p.email.address) + '</code><br>' : '') + chip(lab[0], lab[1], (p.email || {}).evidence || lab[2]) + '</td>' +
      '<td class="cl-found">' + found + '</td></tr>';
  }

  function renderCompany(c, showAll) {
    var people = c.people || [];
    var hits = people.filter(function (p) { return p.current === 'yes' && p.role; });
    var shown = showAll ? people : hits;
    var mail = c.mail || {}, pat = c.email_pattern || {};
    var head = '<div class="cl-co-h"><div><h4>' + esc(c.name) + '</h4><div class="cl-co-sub">' +
      (c.domain ? link('https://' + c.domain + '/', c.domain) : '<i>no website found</i>') +
      (c.domain_source ? ' ' + chip('', 'website: ' + c.domain_source) : '') +
      (c.email_domain && c.email_domain !== c.domain ? ' ' + chip('warn', 'mail at ' + c.email_domain) : '') +
      (mail.status ? ' ' + chip(mail.status === 'ok' ? 'ok' : mail.status === 'none' ? 'bad' : '', mail.status === 'ok' ? 'mail: ' + (mail.provider || 'yes') : mail.status === 'none' ? 'no mail server' : 'mail: unknown', (mail.mx || []).join(', ')) : '') +
      (pat.pattern ? ' ' + chip(pat.level === 'confirmed' ? 'ok' : pat.level === 'likely' ? 'warn' : '', 'pattern ' + pat.pattern + ' (' + pat.level + ')',
        (pat.examples || []).join(', ') || 'no personal addresses seen') : '') + '</div></div>' +
      '<div class="cl-co-n"><b>' + esc(hits.length) + '</b><span>right people</span></div></div>';
    var notes = (c.notes || []).map(function (n) { return '<div class="mr-callout">' + esc(n) + '</div>'; }).join('');
    var table = shown.length ? '<div class="cl-tablew"><table class="cl-table"><thead><tr><th>Person</th><th>Title, as found</th><th>Still there? Role</th><th>Work email</th><th>Found by</th></tr></thead><tbody>' +
      shown.map(personRow).join('') + '</tbody></table></div>' :
      '<div class="mr-empty"><b>' + (people.length ? 'Nobody matched' : 'Nobody found') + '</b>' +
      (people.length ? esc(people.length) + ' people came up; none is clearly at this company in a title asked for.' : 'The searches found no one at this company.') + '</div>';
    var more = people.length > hits.length ? '<button type="button" class="mr-link" data-act="all">' +
      (showAll ? 'Show only the right people' : 'Show everyone found (' + esc(people.length) + ')') + '</button>' : '';
    var pub = (c.published_emails || []).length ? '<details class="mr-more"><summary>Addresses seen at this company (' + esc(c.published_emails.length) + ')</summary><p class="cl-mono">' +
      c.published_emails.map(esc).join(', ') + '</p></details>' : '';
    var queries = '<details class="mr-more"><summary>Every search, and what answered</summary>' + Object.keys(c.backends || {}).map(function (b) {
      return '<h5 class="cl-h5">' + esc((BACKEND[b] || [b])[0]) + '</h5><ul class="mr-list">' + ((c.backends[b] || {}).queries || []).map(function (q) {
        return '<li><code>' + esc(q.query) + '</code> ' + chip(q.status === 'ok' ? 'ok' : q.status === 'empty' ? '' : 'bad', q.status + (q.results ? ' · ' + q.results : '')) +
          ' <span class="mr-hint">' + esc(secs(q.ms)) + (q.cost_usd ? ' · ' + esc(money(q.cost_usd)) : '') +
          (Object.keys(q.refused || {}).length ? ' · refused: ' + esc(Object.keys(q.refused).map(function (e) { return e + ' (' + q.refused[e] + ')'; }).join(', ')) : '') +
          (q.note ? ' · ' + esc(q.note) : '') + '</span></li>';
      }).join('') + '</ul>';
    }).join('') + '</details>';
    return '<div class="card mr-card cl-co">' + head + '<div class="mr-card-b">' + notes + table + more + pub + queries + '</div></div>';
  }

  function renderRun(run, ui) {
    ui = ui || {};
    if (!run) return '';
    var s = run.summary || {};
    var companies = s.companies || [];
    var running = run.status === 'running' && !run.stale;
    var head = '<div class="cl-run-h"><div><div class="eyebrow">Run ' + esc(run.id) + ' &middot; ' + esc(when(run.created_at)) + '</div>' +
      '<h2>' + esc(((run.settings || {}).roles || []).join(', ')) + '</h2>' +
      '<p>' + esc(((run.settings || {}).companies || []).map(function (c) { return c.name; }).join(' · ')) + '</p></div>' +
      '<div class="mr-actions"><a class="mr-btn" href="' + API + '/runs/' + encodeURIComponent(run.id) + '?download=1">Download JSON</a></div></div>';
    var state = running ? '<div class="mr-callout info">Running: ' + esc(run.stage || 'starting') + '&hellip; ' + esc(companies.length) + ' of ' +
      esc(((run.settings || {}).companies || []).length) + ' companies done. Spent so far ' + esc(money(run.spent_usd)) + '.</div>' :
      run.stale ? '<div class="mr-callout bad">' + esc(run.stale) + '</div>' :
      run.status === 'failed' ? '<div class="mr-callout bad">The run failed: ' + esc(run.error || 'no reason given') + '</div>' :
      run.error ? '<div class="mr-callout warn">' + esc(run.error) + '</div>' : '';
    if (!companies.length) return head + state + (running ? '' : '<div class="card"><div class="mr-empty"><b>No results</b>This run produced nothing to show.</div></div>');
    var pick = Math.min(ui.company || 0, companies.length - 1);
    var tabs = '<div class="mr-seg cl-tabs" role="tablist">' + companies.map(function (c, i) {
      var hits = (c.people || []).filter(function (p) { return p.current === 'yes' && p.role; }).length;
      return '<button type="button" role="tab" class="' + (i === pick ? 'on' : '') + '" data-act="company" data-i="' + i + '">' + esc(c.name) +
        ' <span class="mr-tabn">' + esc(hits) + '</span></button>';
    }).join('') + '</div>';
    return head + state + renderScore(s) + tabs + renderCompany(companies[pick], !!ui.showAll);
  }

  var CL = { esc: esc, safeUrl: safeUrl, renderReady: renderReady, renderEstimate: renderEstimate, renderRuns: renderRuns,
    renderRun: renderRun, renderScore: renderScore, renderCompany: renderCompany };
  root.CL = CL;

  // == the page =========================================================================

  if (typeof document === 'undefined' || !document.getElementById('cl')) return;

  var $ = function (id) { return document.getElementById(id); };
  var state = { status: null, runs: [], selected: null, run: null, poll: null, ui: { company: 0, showAll: false }, estTimer: null };

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
  function ask(title, text) {
    return new Promise(function (resolve) {
      $('clModalTitle').textContent = title; $('clModalText').textContent = text;
      var bg = $('clModal'); bg.classList.add('open'); $('clModalYes').focus();
      function done(ok) { bg.classList.remove('open'); $('clModalYes').onclick = $('clModalNo').onclick = null; resolve(ok); }
      $('clModalYes').onclick = function () { done(true); };
      $('clModalNo').onclick = function () { done(false); };
    });
  }
  function backends() {
    return [$('clUseSearx').checked ? 'searxng' : null, $('clUseClaude').checked ? 'claude' : null].filter(Boolean);
  }
  function form() {
    return { companies: $('clCompanies').value, roles: $('clRoles').value, backends: backends(), model: $('clModel').value };
  }
  function estimate() {
    clearTimeout(state.estTimer);
    state.estTimer = setTimeout(function () {
      var f = form();
      if (!f.companies.trim() || !f.roles.trim()) { $('clEstimate').innerHTML = ''; return; }
      api('/estimate', f).then(function (e) { $('clEstimate').innerHTML = renderEstimate(e, f.backends); })
        .catch(function (e) { $('clEstimate').innerHTML = renderEstimate({ error: e.message }, f.backends); });
    }, 350);
  }
  function paintRun() { $('clDetail').innerHTML = renderRun(state.run, state.ui); }
  function loadRuns() {
    return api('/runs').then(function (j) { state.runs = j.runs || []; $('clRuns').innerHTML = renderRuns(state.runs, state.selected); })
      .catch(function (e) { $('clRuns').innerHTML = '<div class="mr-empty">' + esc(e.message) + '</div>'; });
  }
  function open(id) {
    clearTimeout(state.poll);
    if (state.selected !== id) state.ui = { company: 0, showAll: false };
    state.selected = id;
    try { history.replaceState(null, '', '#run-' + id); } catch (e) { /* ignore */ }
    $('clRuns').innerHTML = renderRuns(state.runs, id);
    return api('/runs/' + id).then(function (run) {
      if (state.selected !== id) return;
      state.run = run; paintRun();
      if (run.status === 'running' && !run.stale) state.poll = setTimeout(function () { open(id); }, 5000);
      else loadRuns();
    }).catch(function (e) { $('clDetail').innerHTML = '<div class="mr-callout bad">' + esc(e.message) + '</div>'; });
  }

  ['clCompanies', 'clRoles', 'clUseSearx', 'clUseClaude', 'clModel'].forEach(function (id) {
    $(id).addEventListener('input', estimate); $(id).addEventListener('change', estimate);
  });
  $('clForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = form();
    if (!f.backends.length) { toast('Pick at least one way to search.'); return; }
    var paid = f.backends.indexOf('claude') >= 0;
    var go = paid ? ask('Run the lab with Claude?', 'Claude\'s searches cost money: ' + ($('clEstimate').textContent || 'see the estimate') +
      ' The run stops itself at the cap.') : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      f.confirm_spend = paid;
      $('clRunBtn').disabled = true;
      api('/runs', f).then(function (j) { toast('Started run ' + j.run_id + '.'); return loadRuns().then(function () { open(j.run_id); }); })
        .catch(function (err) {
          if (err.status === 409 && err.data && err.data.run_id) { toast(err.message); open(err.data.run_id); return; }
          toast(err.message);
        }).then(function () { $('clRunBtn').disabled = false; });
    });
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || !$('cl').contains(el)) return;
    var act = el.getAttribute('data-act');
    if (act === 'open') open(Number(el.getAttribute('data-id')));
    else if (act === 'company') { state.ui.company = Number(el.getAttribute('data-i')); state.ui.showAll = false; paintRun(); }
    else if (act === 'all') { state.ui.showAll = !state.ui.showAll; paintRun(); }
  });

  api('/status').then(function (s) {
    state.status = s;
    $('clReady').innerHTML = renderReady(s);
    $('clModel').innerHTML = (s.models || []).map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join('');
    if (!(s.searxng || {}).configured) $('clUseSearx').checked = false;
    if (!(s.claude || {}).configured) $('clUseClaude').checked = false;
    estimate();
  }).catch(function (e) { $('clReady').innerHTML = chip('bad', e.message); });
  loadRuns().then(function () {
    var m = /#run-(\d+)/.exec(location.hash);
    var id = m ? Number(m[1]) : (state.runs[0] && state.runs[0].id);
    if (id) open(id);
  });
})(typeof window !== 'undefined' ? window : globalThis);
