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

  function renderEstimate(e) {
    if (!e) return '';
    if (e.error) return '<div class="mr-callout bad">' + esc(e.error) + '</div>';
    if (CLIENT) return '<div class="am-est-grid"><div><b>Free</b><span>' + plural(e.companies, 'company', 'companies') + ' &times; ' + plural(e.roles, 'title') + '</span></div></div>';
    return '<div class="am-est-grid">' +
      '<div><b>Free</b><span>Mapping: ' + plural(e.companies, 'company', 'companies') + ' &times; ' + plural(e.roles, 'title') + ', about ' + esc(num(e.free_searches)) + ' searches</span></div>' +
      '<div><b>' + esc(num(e.credits_default)) + ' credits at most</b><span>Only if you reveal the best person per title, and only for emails found. You choose after mapping.</span></div>' +
      '<div><b>' + (e.claude ? 'About ' + esc(money(e.usd_typical)) : '$0') + '</b><span>' + (e.claude ? 'Claude, capped at ' + esc(money(e.usd_cap)) : 'No Claude steps ticked') + '</span></div></div>';
  }

  // == the runs list ====================================================================

  function renderRuns(runs, selected) {
    if (!runs || !runs.length) return '<div class="mr-empty"><b>No runs yet</b>Map your first accounts on the left.</div>';
    return '<ul class="cl-runl">' + runs.map(function (r) {
      var st = r.status === 'running' ? (r.stale ? chip('bad', 'Stalled') : chip('acc', r.stage === 'revealing' || /^reveal/.test(r.stage || '') ? 'Revealing' : 'Mapping')) :
        r.status === 'failed' ? chip('bad', 'Failed') : chip('ok', 'Ready');
      var n = ((r.settings || {}).companies || []).length, t = r.totals || {};
      return '<li><button type="button" class="cl-run' + (r.id === selected ? ' on' : '') + '" data-act="open" data-id="' + esc(r.id) + '">' +
        '<b>Run ' + esc(r.id) + '</b>' + st + '<small>' + esc(when(r.created_at)) + ' &middot; ' + plural(n, 'account') +
        (t.titles ? ' &middot; ' + esc(t.titles_found || 0) + '/' + esc(t.titles) + ' titles' : '') +
        (CLIENT ? '' : ' &middot; ' + esc(num(r.credits_used || 0)) + ' credits' + (r.spent_usd ? ' &middot; ' + esc(money(r.spent_usd)) : '')) + '</small></button></li>';
    }).join('') + '</ul>';
  }

  // == one run: the overview ============================================================

  function kpi(n, label, cls) {
    return '<div class="am-kpi ' + (cls || '') + '"><b>' + n + '</b><span>' + esc(label) + '</span></div>';
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

  function renderOverview(run) {
    var s = run.summary || {}, t = s.totals || {}, cs = s.companies || [], e = emailCounts(cs), cost = s.cost || {};
    var top = (s.ranking || []).slice(0, 3).map(function (name) {
      var c = cs.filter(function (x) { return x.name === name; })[0] || {};
      var p = c.priority || {};
      return '<li><span class="am-rank-s">' + esc(p.score == null ? '–' : p.score) + '</span><div><b>' + esc(c.display_name || c.name) + '</b><small>' +
        esc((p.reasons || []).slice(0, 2).join(' · ') || 'no signals yet') + '</small></div></li>';
    }).join('');
    return '<div class="am-ink"><div class="am-ink-h"><div><div class="cl-eye">Overview</div>' +
      '<h3>' + esc(t.titles_found || 0) + ' of ' + esc(t.titles || 0) + ' seats filled across ' + plural(t.companies || 0, 'account') + '</h3>' +
      (CLIENT ? '<p>The right people at each account, and what each account is doing.</p></div></div>' :
      '<p>Mapping is free. Emails are revealed only for the people you tick, and only after you confirm the credits.</p></div>' +
      '<div class="cl-total"><b>' + esc(num(run.credits_used || 0)) + '</b><span>credits used' + (cost.spent_usd ? ' · ' + esc(money(cost.spent_usd)) + ' Claude' : '') + '</span></div></div>') +
      '<div class="am-kpis">' + kpi(esc(num(t.people_picked || 0)), 'best matches', 'k-big') + kpi(esc(num(t.people_also || 0)), 'also found') +
      kpi(esc(num(t.new_in_role || 0)), 'new in their role') + kpi(esc(num(e.verified)), 'verified emails') +
      kpi(esc(num(e.pattern)), 'emails from a pattern') + kpi(esc(num(t.companies_resolved || 0)) + '/' + esc(num(t.companies || 0)), 'accounts matched') + '</div>' +
      (top ? '<div class="am-rank"><span class="mr-k">Work these first</span><ol>' + top + '</ol></div>' : '') + '</div>';
  }

  // == one person ========================================================================

  function avatar(p) {
    var src = safeUrl(p.photo);
    return '<span class="am-ava" aria-hidden="true">' + esc(initials(p.name)) +
      (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '</span>';
  }

  function emailLine(p) {
    var em = p.email;
    if (!em) return '<div class="am-mail none">' + (p.source === 'web' ? 'Reveal to look up by LinkedIn' : 'Not revealed yet') + '</div>';
    var lab = EMAIL[em.label] || ['', em.label || 'unknown', ''];
    return '<div class="am-mail">' + (em.address ? '<code>' + esc(em.address) + '</code>' : '') + chip(lab[0], lab[1], em.note || lab[2]) + '</div>';
  }

  function personCard(p, opts) {
    opts = opts || {};
    var key = keyOf(p);
    var can = key && !p.revealed && !CLIENT;
    var facts = [p.location, p.experience_years ? p.experience_years + ' yrs experience' : null, p.department].filter(Boolean);
    return '<article class="am-person' + (opts.picked ? ' picked' : '') + (opts.selected ? ' sel' : '') + '">' +
      (can ? '<label class="am-tick" title="Reveal this person\'s email"><input type="checkbox" data-act="pick" data-key="' + esc(key) + '"' + (opts.selected ? ' checked' : '') + '><span>Reveal</span></label>' : '') +
      '<div class="am-person-h">' + avatar(p) + '<div><b>' + esc(p.name) + '</b><div class="am-title">' + esc(p.title || '') + '</div></div></div>' +
      '<div class="am-badges">' + (p.new_in_role ? chip('acc', 'New in role', 'Started this role in the last year (Saleshandy)') : '') +
      (p.decision_maker ? chip('ok', 'Decision-maker') : '') + (p.source === 'web' ? chip('', 'Found on the web') : '') + '</div>' +
      (facts.length ? '<div class="am-facts">' + esc(facts.join(' · ')) + '</div>' : '') +
      emailLine(p) +
      (p.linkedin ? '<div class="am-li">' + link(p.linkedin, 'LinkedIn profile') + '</div>' : '') +
      (opts.opener ? '<blockquote class="am-opener">' + esc(opts.opener) + '</blockquote>' : '') + '</article>';
  }

  // == one account =======================================================================

  function teamBars(ins) {
    var teams = (ins.teams || []).slice();
    if (!teams.length) return '';
    var max = Math.max.apply(null, teams.map(function (t) { return t.people || 0; }).concat([1]));
    return '<div class="am-bars">' + teams.map(function (t) {
      var w = Math.max(4, Math.round(100 * (t.people || 0) / max));
      return '<div class="am-bar"><span>' + esc(t.department) + '</span><i><em style="width:' + w + '%"></em></i><b>' + esc(num(t.people)) + '</b></div>';
    }).join('') + '</div>';
  }

  function signals(ins) {
    var sig = ins.signals || {}, nl = ins.new_leaders || {};
    var out = [];
    if (sig.hiring_your_titles) out.push(chip('acc', 'Hiring for your titles'));
    else if (sig.hiring) out.push(chip('ok', 'Hiring'));
    if (sig.funded_last_year) out.push(chip('acc', 'Raised money this year'));
    if (nl.total) out.push(chip('warn', plural(nl.total, 'new leader') + ' this year'));
    if (ins.signals && !out.length) out.push(chip('', 'No hiring or funding shown'));
    return out.join(' ');
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

  function renderRole(r, opener, selected) {
    var st = ROLE_STATUS[r.status] || ['', r.status];
    var people = (r.picked || []).map(function (p) { return personCard(p, { picked: true, opener: opener[p.name], selected: selected[keyOf(p)] }); })
      .concat((r.web || []).map(function (p) { return personCard(p, { picked: true, opener: opener[p.name], selected: selected[keyOf(p)] }); }));
    var also = (r.also || []).map(function (p) { return personCard(p, { opener: opener[p.name], selected: selected[keyOf(p)] }); });
    var tried = (r.attempts || []).map(function (a) { return '<li>' + esc(a.how) + ': ' + esc(num(a.total)) + ' found' + (a.kept != null && a.kept !== a.total ? ', ' + esc(a.kept) + ' kept' : '') + '</li>'; }).join('');
    return '<section class="am-role"><div class="am-role-h"><h4>' + esc(r.role) + '</h4>' + chip(st[0], st[1]) + '</div>' +
      (people.length ? '<div class="am-people">' + people.join('') + '</div>' :
        '<div class="mr-empty"><b>Nobody in this seat</b>' + (also.length ? 'The closest titles are below.' : 'Saleshandy has nobody with this title here' + (r.web_search ? ', and the web search found nobody either.' : '.')) + '</div>') +
      (also.length ? '<details class="mr-more"' + (people.length ? '' : ' open') + '><summary>Also found (' + esc(also.length) + ')</summary><div class="am-people">' + also.join('') + '</div></details>' : '') +
      (tried ? '<details class="mr-more"><summary>How it searched</summary><ul class="mr-list">' + tried + '</ul></details>' : '') + '</section>';
  }

  function renderAccount(c, selected) {
    selected = selected || {};
    var r = c.resolved || {}, co = r.company || {}, ins = c.insights || {}, p = c.priority || {};
    var opener = {};
    ((c.brief || {}).openers || []).forEach(function (o) { opener[o.name] = o.line; });
    var meta = [co.industry, co.employees ? num(co.employees) + ' employees' : null, co.hq, co.founded ? 'founded ' + co.founded : null, co.type]
      .filter(Boolean).map(function (x) { return chip('', x); }).join(' ');
    var pat = c.email_pattern;
    var head = '<div class="am-acc-h"><div class="am-mono" aria-hidden="true">' + esc(initials(c.display_name || c.name)) + '</div><div class="am-acc-t">' +
      '<h3>' + esc(c.display_name || c.name) + '</h3><div class="cl-co-sub">' +
      (c.domain ? link('https://' + c.domain + '/', c.domain) : '<i>no company matched</i>') +
      (co.linkedin ? ' ' + link(co.linkedin, 'LinkedIn page') : '') +
      (r.how ? ' ' + chip(r.how === 'not found' ? 'bad' : r.how === 'closest name' ? 'warn' : '', 'matched by ' + r.how) : '') +
      (pat && pat.pattern ? ' ' + chip(pat.level === 'confirmed' ? 'ok' : 'warn', 'emails: ' + pat.pattern + '@' + pat.domain) : '') + '</div>' +
      (meta ? '<div class="am-meta">' + meta + '</div>' : '') + '</div>' +
      '<div class="am-prio" title="' + esc((p.reasons || []).join('\n')) + '"><b>' + esc(p.score == null ? '–' : p.score) + '</b><span>priority</span></div></div>';
    var alts = (r.alternatives || []).length ? '<div class="mr-callout warn">Other companies with this name: ' + r.alternatives.map(function (a) {
      return esc(a.name) + (a.domain ? ' (' + esc(a.domain) + ')' : '');
    }).join(', ') + '. Add &ldquo;| domain.com&rdquo; to the line to pick one.</div>' : '';
    var errs = (c.errors || []).map(function (e) { return '<div class="mr-callout bad">' + esc(e) + '</div>'; }).join('');
    var side = (ins.people_in_saleshandy != null ? '<div class="am-side"><div class="am-side-n"><b>' + esc(num(ins.people_in_saleshandy)) + '</b><span>people listed</span></div>' +
      '<div class="am-side-n"><b>' + esc(num(ins.decision_makers)) + '</b><span>decision-makers</span></div>' + teamBars(ins) +
      '<div class="am-sig">' + signals(ins) + '</div>' +
      (((ins.new_leaders || {}).people || []).length ? '<h5>New leaders this year</h5><ul class="am-nl">' + ins.new_leaders.people.map(function (x) {
        return '<li><b>' + esc(x.name) + '</b> ' + esc(x.title || '') + '</li>';
      }).join('') + '</ul>' : '') + '</div>' : '');
    var reasons = (p.reasons || []).length ? '<div class="am-why">' + p.reasons.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '';
    return '<div class="card mr-card am-acc">' + head + '<div class="mr-card-b">' + alts + errs + reasons +
      '<div class="am-acc-grid"><div class="am-acc-main">' + renderBrief(c.brief) + (c.brief_error ? '<div class="mr-callout warn">The brief could not be written: ' + esc(c.brief_error) + '</div>' : '') +
      (c.roles || []).map(function (r) { return renderRole(r, opener, selected); }).join('') + '</div>' + side + '</div></div></div>';
  }

  // == the reveal bar =======================================================================

  function renderRevealBar(run, sel, ui) {
    var n = Object.keys(sel || {}).filter(function (k) { return sel[k]; }).length;
    var per = ui && ui.phone ? 7 : 1;
    var last = ((run.summary || {}).reveals || []).slice(-1)[0];
    return '<div class="am-revealbar"><div><b>' + plural(n, 'person', 'people') + ' ticked</b><span>Up to ' + esc(n * per) + ' credits' +
      (per > 1 ? ' (email + phone, 7 each)' : ' (1 per email found; none when not found)') + '</span>' +
      (last ? '<span class="am-last">Last reveal: ' + esc(last.found) + ' of ' + esc(last.asked) + ' found, ' + esc(num(last.credits)) + ' credits</span>' : '') + '</div>' +
      '<label class="am-cap">Credit cap <input type="number" min="1" max="1000" id="amCap" value="' + esc((ui && ui.cap) || 50) + '"></label>' +
      '<label class="am-cap"><input type="checkbox" id="amPhone"' + (ui && ui.phone ? ' checked' : '') + '> Phones too</label>' +
      '<button type="button" class="mr-btn ghost" data-act="best">Best per title</button>' +
      '<button type="button" class="mr-btn primary hot" data-act="reveal"' + (n && run.status === 'ready' ? '' : ' disabled') + '>Reveal emails</button></div>';
  }

  function renderRun(run, ui) {
    ui = ui || {};
    if (!run) return '';
    var s = run.summary || {}, cs = s.companies || [];
    var running = run.status === 'running' && !run.stale;
    var head = '<div class="cl-run-h"><div><div class="eyebrow">Run ' + esc(run.id) + ' &middot; ' + esc(when(run.created_at)) + '</div>' +
      '<h2>' + esc(((run.settings || {}).roles || []).join(', ')) + '</h2>' +
      '<p>' + esc(((run.settings || {}).companies || []).map(function (c) { return c.name; }).join(' · ')) + '</p></div>' +
      '<div class="mr-actions"><a class="mr-btn" href="' + API + '/runs/' + encodeURIComponent(run.id) + '/export.csv' + (AQ ? '?' + AQ : '') + '">Download CSV</a>' +
      '<a class="mr-btn ghost" href="' + API + '/runs/' + encodeURIComponent(run.id) + '?download=1' + (AQ ? '&amp;' + AQ : '') + '">JSON</a></div></div>';
    var stateLine = running ? '<div class="mr-callout info">' + esc(run.stage === 'revealing' || /^revealing/.test(run.stage || '') ? 'Revealing' : 'Mapping') + ': ' +
      esc(run.stage || 'starting') + '&hellip; ' + esc(cs.length) + ' of ' + esc(((run.settings || {}).companies || []).length) + ' accounts done.</div>' :
      run.stale ? '<div class="mr-callout bad">' + esc(run.stale) + '</div>' :
      run.status === 'failed' ? '<div class="mr-callout bad">The run failed: ' + esc(run.error || 'no reason given') + '</div>' :
      run.error ? '<div class="mr-callout warn">' + esc(run.error) + '</div>' : '';
    var notes = [s.plan_note, s.web_stopped, s.brief_stopped, s.reveal_error].filter(Boolean).map(function (n) { return '<div class="mr-callout warn">' + esc(n) + '</div>'; }).join('');
    if (!cs.length) return head + stateLine + notes + (running ? '' : '<div class="card"><div class="mr-empty"><b>No results</b>This run found nothing to show.</div></div>');
    var order = (s.ranking || []).length ? s.ranking : cs.map(function (c) { return c.name; });
    var byName = {};
    cs.forEach(function (c) { byName[c.name] = c; });
    var list = order.map(function (n) { return byName[n]; }).filter(Boolean);
    cs.forEach(function (c) { if (list.indexOf(c) < 0) list.push(c); });
    var pick = Math.min(ui.company || 0, list.length - 1);
    var tabs = '<nav class="am-tabs" aria-label="Accounts">' + list.map(function (c, i) {
      var found = (c.roles || []).filter(function (r) { return (r.picked || []).length || (r.web || []).length; }).length;
      return '<button type="button" class="' + (i === pick ? 'on' : '') + '" data-act="company" data-i="' + i + '"' + (i === pick ? ' aria-current="true"' : '') + '>' +
        '<span class="am-tab-s">' + esc(((c.priority || {}).score == null) ? '·' : c.priority.score) + '</span><span class="am-tab-n">' + esc(c.display_name || c.name) +
        '<small>' + esc(found) + '/' + esc((c.roles || []).length) + ' seats</small></span></button>';
    }).join('') + '</nav>';
    return head + stateLine + notes + renderOverview(run) + (!CLIENT && (run.status === 'ready' || running) ? renderRevealBar(run, ui.selected, ui) : '') +
      '<div class="am-body">' + tabs + renderAccount(list[pick], ui.selected) + '</div>';
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

  var AM = { esc: esc, safeUrl: safeUrl, keyOf: keyOf, renderReady: renderReady, renderEstimate: renderEstimate, renderRuns: renderRuns,
    renderRun: renderRun, renderOverview: renderOverview, renderAccount: renderAccount, personCard: personCard,
    renderRevealBar: renderRevealBar, bestSelection: bestSelection };
  root.AM = AM;

  // == the page =========================================================================

  if (typeof document === 'undefined' || !document.getElementById('am')) return;

  var $ = function (id) { return document.getElementById(id); };
  var state = { status: null, runs: [], selected: null, run: null, poll: null, estTimer: null,
    ui: { company: 0, selected: {}, cap: 50, phone: false } };

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
  function open(id) {
    clearTimeout(state.poll);
    var fresh = state.selected !== id;
    state.selected = id;
    try { history.replaceState(null, '', '#run-' + id); } catch (e) { /* ignore */ }
    $('amRuns').innerHTML = renderRuns(state.runs, id);
    return api('/runs/' + id).then(function (run) {
      if (state.selected !== id) return;
      var wasRunning = state.run && state.run.id === id && state.run.status === 'running';
      state.run = run;
      if (fresh || (wasRunning && run.status === 'ready')) { state.ui.company = fresh ? 0 : state.ui.company; state.ui.selected = bestSelection(run); }
      paintRun();
      if (run.status === 'running' && !run.stale) state.poll = setTimeout(function () { open(id); }, 4000);
      else loadRuns();
    }).catch(function (e) { $('amDetail').innerHTML = '<div class="mr-callout bad">' + esc(e.message) + '</div>'; });
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
    $(id).addEventListener('input', estimate); $(id).addEventListener('change', estimate);
  });
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
    $('amReady').innerHTML = renderReady(s);
    $('amModel').innerHTML = (s.models || []).map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join('');
    if (CLIENT || !(s.claude || {}).configured) ['amPhrasings', 'amWeb', 'amBriefs'].forEach(function (id) { $(id).checked = false; $(id).disabled = true; });
    estimate();
  }).catch(function (e) { $('amReady').innerHTML = chip('bad', e.message); });
  loadRuns().then(function () {
    var m = /#run-(\d+)/.exec(location.hash);
    var id = m ? Number(m[1]) : (state.runs[0] && state.runs[0].id);
    if (id) open(id);
  });
})(typeof window !== 'undefined' ? window : globalThis);
