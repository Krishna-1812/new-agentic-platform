/* People & Signals chat (templates/account_mapper.html, loaded after account_mapper.js).
 *
 * Write who you want in plain words ("marketing people at Stripe"); the server reads it (POST /api/chat), searches
 * Saleshandy (free) as a run, and this file draws the answer: the people as rows, with a LinkedIn link and an email
 * slot. Emails and exact LinkedIn profiles come from the reveal: credits, only after a yes.
 *
 * The render* functions are pure (data in, HTML out, every value escaped; names, titles and photos come from
 * Saleshandy) and exported as window.AMChat so tests can run them under Node. The wiring at the bottom only runs on
 * the page. Shared pieces (icons, chips, avatars, the page's api/toast/modal) come from window.AM.
 */
(function (root) {
  'use strict';

  var AM = root.AM;
  if (!AM) return;
  var esc = AM.esc, safeUrl = AM.safeUrl, ic = AM.ic, chip = AM.chip, hue = AM.hue, avatar = AM.avatar, num = AM.num,
    when = AM.when, plural = AM.plural;

  var SUGGESTIONS = [
    ['Marketing people at HubSpot', 'A whole team, most senior first', 'users', 'sky'],
    ['Who is the CMO of Notion?', 'One job title', 'spark', 'lilac'],
    ['Sales leaders at Stripe and Ramp', 'Several companies at once', 'bolt', 'acc'],
    ['Top 5 engineers at hubspot.com', 'Use a website to be exact', 'globe', 'amber']
  ];
  var CAN = [['users', 'A team'], ['spark', 'A job title'], ['bolt', 'Several companies'], ['globe', 'A website'], ['pin', 'A place'], ['search', '\u201ctop 5\u201d']];
  var SHORT_HINTS = ['CMO of Notion', 'sales team at Ramp', 'top 5 engineers at Zoom'];
  var HINTS = ['marketing people at Stripe', 'who is the CMO of Notion?', 'top 5 engineers at hubspot.com', 'sales leaders at Ramp and Gong', 'recruiters at Meta in Austin'];
  var FOLLOW = [['Leadership', 'leadership'], ['Marketing team', 'marketing team'], ['Sales team', 'sales team'],
    ['Engineering team', 'engineering team'], ['Finance team', 'finance team'], ['HR team', 'HR team'], ['The CFO', 'the CFO']];

  // == small pieces =======================================================================

  function keyOf(p) { return AM.keyOf(p); }
  function liSearch(p, company) {
    return 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent([p.name, company || p.company].filter(Boolean).join(' '));
  }
  function allPeople(run) {
    var out = [];
    (((run || {}).summary || {}).companies || []).forEach(function (c) {
      (c.roles || []).forEach(function (r) { out = out.concat(r.picked || [], r.also || [], r.web || []); });
    });
    return out;
  }
  function pickedPeople(run) {
    var out = [];
    (((run || {}).summary || {}).companies || []).forEach(function (c) {
      (c.roles || []).forEach(function (r) { out = out.concat(r.picked || [], r.web || []); });
    });
    return out;
  }
  // The people a reveal would default to: everyone shown, not revealed yet.
  function defaultSelection(run) {
    var sel = {};
    pickedPeople(run).forEach(function (p) { var k = keyOf(p); if (k && !p.revealed) sel[k] = true; });
    return sel;
  }
  function selectedKeys(run, sel) {
    var have = {};
    allPeople(run).forEach(function (p) { var k = keyOf(p); if (k && !p.revealed) have[k] = true; });
    return Object.keys(sel || {}).filter(function (k) { return sel[k] && have[k]; });
  }
  function emails(run) {
    var out = [];
    allPeople(run).forEach(function (p) {
      var a = p.email && p.email.address;
      if (a && out.indexOf(a) < 0) out.push(a);
    });
    return out;
  }

  // == one person, one row ================================================================

  // The email, as far as it is known: the address (with copy) or nothing yet. Its status and the LinkedIn link are pills.
  function mailLine(p) {
    var em = p.email;
    if (!em || !em.address) return '';
    return '<div class="amc-mail on"><code>' + esc(em.address) + '</code>' +
      '<button type="button" class="am-copy" data-act="copy" data-text="' + esc(em.address) + '" title="Copy the address" aria-label="Copy ' + esc(em.address) + '">' + ic('copy') + '</button></div>';
  }
  function mailPill(p, ui) {
    var em = p.email;
    if (!em) return ui.client ? '' : '<span class="amc-lock" title="Revealing costs 1 credit when an email is found">' + ic('lock') + 'Email: reveal</span>';
    var lab = AM.EMAIL[em.label] || ['', em.label || 'unknown', ''];
    return chip(lab[0], lab[1], em.note || lab[2]);
  }

  function liPill(p, company) {
    var url = safeUrl(p.linkedin);
    if (url) return '<a class="amc-li on" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" title="Their LinkedIn profile">' + ic('li') + '<span>LinkedIn</span></a>';
    return '<a class="amc-li" href="' + esc(liSearch(p, company)) + '" target="_blank" rel="noopener noreferrer" title="Search LinkedIn for this person. The exact profile comes with the reveal.">' + ic('search') + '<span>Find on LinkedIn</span></a>';
  }

  function personRow(p, o) {
    o = o || {};
    var ui = o.ui || {};
    var key = keyOf(p);
    var can = key && !p.revealed && !ui.client && !ui.busy;
    var on = !!(o.selected && key && o.selected[key]);
    var badges = (p.new_in_role ? chip('acc', 'New in role', 'Started this role in the last year (Saleshandy)') : '') +
      (p.decision_maker ? chip('ok', 'Decision-maker') : '') + (p.source === 'web' ? chip('', 'Found on the web') : '');
    var tick = ui.client ? '' : (can ? '<label class="amc-tick" title="Include in the reveal"><input type="checkbox" data-act="cpick" data-run="' + esc(o.runId) + '" data-key="' + esc(key) + '"' + (on ? ' checked' : '') + '><span class="am-tick-box">' + ic('check') + '</span></label>' :
      '<span class="amc-tick off" aria-hidden="true"></span>');
    return '<li class="amc-row' + (tick ? '' : ' nt') + (on ? ' sel' : '') + (p.new_in_role ? ' fresh' : '') + (o.dim ? ' dim' : '') + '">' + tick + avatar(p) +
      '<div class="amc-id"><b>' + esc(p.name) + '</b><span class="amc-title">' + esc(p.title || '') + '</span>' + (badges ? '<span class="amc-badges">' + badges + '</span>' : '') + '</div>' +
      '<div class="amc-loc">' + (p.location ? ic('pin') + '<span>' + esc(p.location) + '</span>' : '') + '</div>' +
      '<div class="amc-contact">' + mailLine(p) + '<div class="amc-pills">' + mailPill(p, ui) + liPill(p, o.company) + '</div></div></li>';
  }

  // == the answer to one question ===========================================================

  function understoodLine(u) {
    if (!u) return '';
    var cs = (u.companies || []).map(function (c) {
      return '<span class="amc-u co ' + hue(c.name) + '"><i>' + esc((c.name || '?').charAt(0).toUpperCase()) + '</i>' + esc(c.name) + (c.domain ? '<small>' + esc(c.domain) + '</small>' : '') + '</span>';
    }).join('');
    var as = (u.asks || []).map(function (a) {
      return '<span class="amc-u ask">' + ic(a.kind === 'team' ? 'users' : 'spark') + esc(a.label) + (a.count ? '<small>up to ' + esc(a.count) + '</small>' : '') + '</span>';
    }).join('');
    var extra = (u.where ? '<span class="amc-u pin">' + ic('pin') + esc(u.where) + '</span>' : '') +
      (u.how === 'claude' ? '<span class="amc-u ai" title="Plain rules could not read this, so one small Claude call did">' + ic('bolt') + 'Read by Claude</span>' : '') +
      (u.how === 'context' ? '<span class="amc-u ai" title="Kept from your last question">' + ic('refresh') + 'From your last question</span>' : '');
    return '<div class="amc-understood"><span class="amc-u-k">Looking for</span>' + as + '<span class="amc-u-k">at</span>' + cs + extra + '</div>' +
      (u.note ? '<div class="amc-note">' + esc(u.note) + '</div>' : '');
  }

  function companyHead(c) {
    var r = c.resolved || {}, co = r.company || {};
    var meta = [co.industry, co.employees ? num(co.employees) + ' employees' : null, co.hq].filter(Boolean).map(function (x) { return chip('', x); }).join(' ');
    var alts = (r.alternatives || []).length ? '<div class="amc-alt">' + ic('globe') + '<span>Other companies share this name: ' + r.alternatives.map(function (a) {
      return esc(a.name) + (a.domain ? ' (' + esc(a.domain) + ')' : '');
    }).join(', ') + '. Write the website, like <code>' + esc((r.alternatives[0] || {}).domain || 'company.com') + '</code>, to pick one.</span></div>' : '';
    return '<header class="amc-co-h"><span class="am-mono ' + hue(c.display_name || c.name) + '" aria-hidden="true">' + esc(AM.initials(c.display_name || c.name)) + '</span>' +
      '<div class="amc-co-t"><h4>' + esc(c.display_name || c.name) + '</h4><div class="amc-co-sub">' +
      (c.domain ? AM.link('https://' + c.domain + '/', c.domain) : '<i>no company matched</i>') +
      (co.linkedin ? ' ' + AM.link(co.linkedin, 'LinkedIn page') : '') +
      (r.how && r.how !== 'exact name' && r.how !== 'domain you gave' ? ' ' + chip(r.how === 'not found' ? 'bad' : 'warn', 'matched by ' + r.how) : '') + '</div>' +
      (meta ? '<div class="amc-co-meta">' + meta + '</div>' : '') + '</div></header>' + alts;
  }

  function roleBlock(r, c, o) {
    var shown = (r.picked || []).length + (r.web || []).length;
    var people = (r.picked || []).concat(r.web || []).map(function (p) { return personRow(p, { selected: o.selected, runId: o.runId, ui: o.ui, company: c.display_name || c.name }); }).join('');
    var also = (r.also || []).map(function (p) { return personRow(p, { selected: o.selected, runId: o.runId, ui: o.ui, company: c.display_name || c.name, dim: true }); }).join('');
    var tried = (r.attempts || []).map(function (a) { return '<li>' + esc(a.how) + ': ' + esc(num(a.total)) + ' found' + (a.kept != null && a.kept !== a.total ? ', ' + esc(a.kept) + ' kept' : '') + '</li>'; }).join('');
    var head = '<div class="amc-seg-h"><h5>' + ic(r.kind === 'team' ? 'users' : 'spark') + esc(r.role) + '</h5>' +
      (shown ? chip('ok', shown + ' shown') : chip('bad', 'Nobody found')) +
      (r.total && r.total > shown ? '<span class="amc-of">of ' + esc(num(r.total)) + ' listed in Saleshandy</span>' : '') + '</div>';
    var note = r.note ? '<div class="amc-note">' + esc(r.note) + '</div>' : '';
    var none = !shown ? '<div class="amc-none"><b>Nobody matched</b>' + (also ? 'The closest people are below.' : 'Saleshandy has nobody for this at ' + esc(c.display_name || c.name) + '. Try a broader team, a different title, or write the company&rsquo;s website.') + '</div>' : '';
    return '<section class="amc-seg">' + head + note + none + (people ? '<ul class="amc-rows">' + people + '</ul>' : '') +
      (also ? '<details class="amc-more"' + (shown ? '' : ' open') + '><summary>Also found (' + esc((r.also || []).length) + ')</summary><ul class="amc-rows">' + also + '</ul></details>' : '') +
      (tried ? '<details class="amc-more"><summary>How it searched</summary><ul class="mr-list">' + tried + '</ul></details>' : '') + '</section>';
  }

  function actions(run, ui, sel) {
    var keys = selectedKeys(run, sel);
    var left = allPeople(run).filter(function (p) { return keyOf(p) && !p.revealed; }).length;
    var got = emails(run);
    var credits = (((run.summary || {}).credits) || {}).total;
    var canReveal = !ui.client && run.status === 'ready' && left;
    var buttons = '';
    if (canReveal) {
      buttons += '<button type="button" class="mr-btn primary hot amc-reveal" data-act="creveal" data-run="' + esc(run.id) + '"' + (keys.length ? '' : ' disabled') + '>' + ic('mail') +
        '<span>Get emails &amp; LinkedIn</span><small>' + (keys.length ? 'up to ' + esc(keys.length) + ' credit' + (keys.length === 1 ? '' : 's') : 'choose who') + '</small></button>';
    }
    if (got.length) buttons += '<button type="button" class="mr-btn" data-act="ccopyall" data-run="' + esc(run.id) + '">' + ic('copy') + 'Copy ' + esc(got.length) + ' email' + (got.length === 1 ? '' : 's') + '</button>';
    buttons += '<a class="mr-btn ghost" href="' + esc(ui.api) + '/runs/' + encodeURIComponent(run.id) + '/export.csv' + (ui.aq ? '?' + esc(ui.aq) : '') + '">' + ic('dl') + 'CSV</a>';
    if (!ui.client) buttons += '<button type="button" class="mr-btn ghost am-del" data-act="cremove" data-run="' + esc(run.id) + '" title="Remove this answer and its results from your list" aria-label="Remove this answer">' + ic('trash') + '</button>';
    var pick = canReveal ? '<span class="amc-sel"><b>' + esc(keys.length) + '</b> of ' + esc(left) + ' selected<span class="amc-pickall"><button type="button" data-act="call" data-run="' + esc(run.id) + '">All</button><button type="button" data-act="cnone" data-run="' + esc(run.id) + '">None</button></span></span>' : '';
    var fine = ui.client ? 'Emails and exact LinkedIn profiles are added by your account manager.' :
      left ? 'Revealing uses 1 credit for each email found and nothing when none is found' + (credits != null ? ' &middot; ' + esc(num(credits)) + ' credits in the account' : '') + '. You confirm before anything is spent.' :
      (got.length ? 'Everyone shown has been revealed.' : '');
    return '<footer class="amc-foot"><div class="amc-foot-top">' + pick + '<div class="amc-foot-r">' + buttons + '</div></div>' + (fine ? '<p class="amc-fine">' + fine + '</p>' : '') + '</footer>';
  }

  function working(run, understood) {
    var stage = (run && run.stage) || 'starting';
    var revealing = /^reveal/.test(stage);
    return '<div class="amc-working" role="status"><span class="am-spin" aria-hidden="true"></span><div><b>' + (revealing ? 'Getting emails and LinkedIn profiles' : 'Searching Saleshandy') + '</b>' +
      '<span>' + esc(stage) + '&hellip;</span></div></div>' +
      '<div class="amc-skel" aria-hidden="true"><i></i><i></i><i></i></div>';
  }

  function renderResult(run, understood, ui, sel) {
    ui = ui || {};
    var s = run.summary || {};
    var running = run.status === 'running' && !run.stale;
    var cs = s.companies || [];
    if (run.status === 'failed') {
      return '<div class="amc-fail"><b>That search did not finish</b><p>' + esc(run.error || 'No reason was given.') + '</p>' +
        '<button type="button" class="mr-btn primary" data-act="cretry" data-run="' + esc(run.id) + '">' + ic('refresh') + 'Try again</button></div>';
    }
    if (run.stale) return '<div class="mr-callout bad">' + esc(run.stale) + '</div>';
    var total = cs.reduce(function (n, c) { return n + (c.roles || []).reduce(function (m, r) { return m + (r.picked || []).length + (r.web || []).length; }, 0); }, 0);
    var head = '<div class="amc-sum">' + (running && !cs.length ? '' : '<b>' + (total ? 'Found ' + plural(total, 'person', 'people') : 'No one found') + '</b>' +
      (cs.length ? ' at ' + esc(cs.map(function (c) { return c.display_name || c.name; }).slice(0, 3).join(', ')) + (cs.length > 3 ? ' and ' + (cs.length - 3) + ' more' : '') : '')) + '</div>';
    var body = cs.map(function (c) {
      return '<article class="amc-co">' + companyHead(c) + (c.errors || []).map(function (e) { return '<div class="mr-callout bad">' + esc(e) + '</div>'; }).join('') +
        (c.roles || []).map(function (r) { return roleBlock(r, c, { selected: sel, runId: run.id, ui: dict(ui, { busy: running }) }); }).join('') + '</article>';
    }).join('');
    var warn = [run.error && run.status === 'ready' ? run.error : '', s.reveal_error].filter(Boolean).map(function (e) { return '<div class="mr-callout warn">' + esc(e) + '</div>'; }).join('');
    return understoodLine(understood) + head + (running ? working(run, understood) : '') + warn + body + (running ? '' : actions(run, ui, sel));
  }

  function dict(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  // == which company? ======================================================================

  function candidateCard(c, i, k, picked) {
    var meta = [c.industry, c.employees ? num(c.employees) + ' employees' : null, c.hq, c.founded ? 'founded ' + c.founded : null].filter(Boolean)
      .map(function (x) { return chip('', x); }).join(' ');
    var on = picked === c.domain;
    return '<div class="amc-cand' + (on ? ' on' : '') + '"><button type="button" class="amc-cand-b" data-act="cchoose" data-item="' + esc(i) + '" data-need="' + esc(k) +
      '" data-domain="' + esc(c.domain) + '"' + (picked != null ? ' disabled' : '') + '>' +
      '<span class="am-mono ' + hue(c.name) + '" aria-hidden="true">' + esc(AM.initials(c.name)) + '</span>' +
      '<span class="amc-cand-t"><b>' + esc(c.name) + '</b><small>' + esc(c.domain) + '</small>' + (meta ? '<span class="amc-cand-meta">' + meta + '</span>' : '') + '</span>' +
      '<span class="amc-cand-go">' + (on ? ic('check') + 'Chosen' : 'This one' + ic('arrow')) + '</span></button>' +
      '<span class="amc-cand-l">' + AM.link('https://' + c.domain + '/', 'Open site') + (c.linkedin ? AM.link(c.linkedin, 'LinkedIn page') : '') + '</span></div>';
  }

  // A company name that more than one company answers to: show them all and let the user choose.
  function renderChoose(it, i) {
    var done = it.state === 'done' || it.state === 'skipped';
    return (it.needs || []).map(function (n, k) {
      var cands = n.candidates || [];
      var head = cands.length ?
        '<p><b>Which &ldquo;' + esc(n.name) + '&rdquo; do you mean?</b> ' + (cands.length === 1 ? 'I found one company, and it is not an exact match.' : 'I found ' + esc(cands.length) + ' companies with a similar name.') +
        (done ? '' : ' Choose the right one and I will search there.') + '</p>' :
        '<p><b>I could not find &ldquo;' + esc(n.name) + '&rdquo; in Saleshandy.</b> Write its website, like <code>' + esc(n.name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company') + '.com</code>, and ask again.</p>';
      var list = cands.length ? '<div class="amc-cands">' + cands.map(function (c) { return candidateCard(c, i, k, n.picked === undefined ? null : n.picked); }).join('') + '</div>' : '';
      var none = cands.length && !done && n.picked == null ? '<div class="amc-choices"><button type="button" class="amc-chip" data-act="cnone-of" data-item="' + esc(i) + '">' + ic('x') + 'None of these</button>' +
        '<span class="amc-hint">Or write the website, like <code>company.com</code>.</span></div>' : '';
      return '<section class="amc-choose">' + head + list + none + '</section>';
    }).join('');
  }

  // == the thread =========================================================================

  function botBubble(inner, cls) {
    return '<div class="amc-msg bot' + (cls ? ' ' + cls : '') + '"><span class="amc-av" aria-hidden="true"></span><div class="amc-bub">' + inner + '</div></div>';
  }

  function renderItem(it, ui, sels, i) {
    if (it.t === 'user') return '<div class="amc-msg me"><div class="amc-bub">' + esc(it.text) + '</div></div>';
    if (it.t === 'day') return '<div class="amc-day"><span>' + esc(it.text) + '</span></div>';
    if (it.t === 'bot') {
      var ch = (it.choices || []).length ? '<div class="amc-choices">' + it.choices.map(function (c) {
        return '<button type="button" class="amc-chip" data-act="csay" data-say="' + esc(c) + '">' + esc(c) + '</button>';
      }).join('') + '</div>' : '';
      return botBubble('<p>' + esc(it.text) + '</p>' + ch, it.kind === 'error' ? 'err' : '');
    }
    if (it.t === 'choose') return botBubble(renderChoose(it, i), 'choose' + (it.state === 'done' || it.state === 'skipped' ? ' past' : ''));
    if (it.t === 'run') {
      var run = it.run || { id: it.id, status: 'running', stage: 'starting', summary: {} };
      return botBubble(renderResult(run, it.understood, ui, (sels || {})[it.id] || {}), 'result');
    }
    return '';
  }

  function renderThread(items, ui, sels) {
    return (items || []).map(function (it, i) { return renderItem(it, ui || {}, sels, i); }).join('');
  }

  function renderEmpty(status, ui) {
    ui = ui || {};
    var hi = '<div class="amc-hello"><span class="amc-kicker">' + ic('bolt') + 'Plain words in, real people out</span>' +
      '<h4>Who are you <em>looking for</em>?</h4><p>Write it the way you would say it: name the company and the people, a team, a job title or a level.' +
      (ui.client ? '' : ' Searching is free.') + '</p>' +
      '<div class="amc-can"><span class="amc-can-k">You can say</span>' + CAN.map(function (c) { return '<span>' + ic(c[0]) + esc(c[1]) + '</span>'; }).join('') + '</div></div>';
    var sugg = '<div class="amc-sugg">' + SUGGESTIONS.map(function (x) {
      return '<button type="button" class="amc-s" data-act="csay" data-say="' + esc(x[0]) + '"><span class="amc-s-i i-' + esc(x[3]) + '">' + ic(x[2]) + '</span>' +
        '<b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span><i class="amc-s-go" aria-hidden="true">' + ic('arrow') + '</i></button>';
    }).join('') + '</div>';
    var flow = '<ol class="amc-flow" aria-label="How it works"><li><b>1</b><span>Ask<small>name the company and who</small></span></li>' +
      '<li><b>2</b><span>Confirm the company<small>when several share the name</small></span></li>' +
      '<li><b>3</b><span>Pick people<small>' + (ui.client ? 'download the list' : 'emails &amp; LinkedIn on request') + '</small></span></li></ol>';
    return hi + sugg + flow;
  }

  function renderFollow(items, ui) {
    var last = null, i;
    for (i = (items || []).length - 1; i >= 0; i--) if (items[i].t === 'run' && items[i].understood) { last = items[i]; break; }
    if (!last || !last.run || last.run.status !== 'ready') return '';
    var used = ((last.understood || {}).asks || []).map(function (a) { return a.label.toLowerCase(); });
    var out = FOLLOW.filter(function (f) { return used.indexOf(f[0].toLowerCase()) < 0; }).slice(0, 4);
    return '<span class="amc-fk">Also</span>' + out.map(function (f) {
      return '<button type="button" class="amc-chip" data-act="csay" data-say="' + esc('and their ' + f[1] + '?') + '">' + ic('plus') + esc(f[0]) + '</button>';
    }).join('');
  }

  function contextOf(items) {
    for (var i = (items || []).length - 1; i >= 0; i--) {
      var u = items[i].t === 'run' && items[i].understood;
      if (u && u.companies && u.asks) return { companies: u.companies, asks: u.asks };
    }
    return {};
  }

  var AMChat = { renderResult: renderResult, renderThread: renderThread, renderEmpty: renderEmpty, renderFollow: renderFollow,
    personRow: personRow, renderChoose: renderChoose, understoodLine: understoodLine, defaultSelection: defaultSelection, selectedKeys: selectedKeys,
    contextOf: contextOf, liSearch: liSearch, emails: emails };
  AM.chat = AMChat;

  // == the page ===========================================================================

  var P = AM.page;
  if (typeof document === 'undefined' || !document.getElementById('amAsk') || !P) return;

  var $ = function (id) { return document.getElementById(id); };
  var items = [], sels = {}, status = null, busy = false, polls = {}, hint = 0;
  // On a phone the box is narrow: the examples it offers are shorter there.
  function hintText() {
    var narrow = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 520px)').matches;
    var list = narrow ? SHORT_HINTS : HINTS;
    return 'Try: ' + list[hint % list.length];
  }
  var API = '/strategic-agents/people-signals/api';
  var ACCT = typeof window !== 'undefined' && window.__acctContext;
  var UI = { client: AM.client, api: API, aq: ACCT ? 'acct=' + encodeURIComponent(ACCT) : '' };

  function connected() { return !status || (status.saleshandy || {}).configured; }

  // The thread scrolls inside its card; the page does not grow with it.
  function scrollThread(to, smooth) {
    var box = $('amThread');
    box.scrollTo({ top: to, behavior: smooth === false ? 'auto' : 'smooth' });
  }
  function atLatest() {
    var box = $('amThread');
    return box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  }
  function toggleJump() {
    var box = $('amThread');
    $('amJump').hidden = !items.length || atLatest() || box.scrollHeight <= box.clientHeight + 40;
  }

  function paint(stick) {
    var box = $('amThread');
    var keep = box.scrollTop;
    box.innerHTML = items.length ? renderThread(items, UI, sels) : renderEmpty(status, UI);
    box.classList.toggle('empty', !items.length);
    $('amFollow').innerHTML = busy ? '' : renderFollow(items, UI);
    $('amNew').hidden = !items.length;
    $('amSend').disabled = busy || !connected();
    // A new answer is read from its top; a new question shows at the bottom; anything else stays where it was.
    if (!items.length) box.scrollTop = 0;
    else if (stick) {
      var last = box.lastElementChild;
      scrollThread(last && last.classList.contains('result') ? Math.max(0, last.offsetTop - 14) : box.scrollHeight);
    } else box.scrollTop = keep;
    toggleJump();
  }

  function paintStatus() {
    var h = (status || {}).saleshandy || {}, el = $('amAskSt');
    if (!status) { el.innerHTML = ''; return; }
    if (!h.configured) { el.className = 'am-ask-st off'; el.innerHTML = '<i></i>Not connected'; return; }
    el.className = 'am-ask-st on';
    el.innerHTML = '<i></i>' + (UI.client ? 'Ready' : h.ok === false ? 'Saleshandy error' : 'Saleshandy connected' + (h.credits && h.credits.total != null ? '<b>' + esc(num(h.credits.total)) + ' credits</b>' : ''));
  }

  function paintSetup() {
    paintStatus();
    var ok = connected();
    $('amAskSetup').innerHTML = ok ? '' : AM.renderSetup(status);
    $('amMsg').disabled = !ok;
    $('amMsg').placeholder = ok ? hintText() : (UI.client ? 'Not connected yet' : 'Add SALESHANDY_API_KEY to start asking');
    $('amSend').disabled = busy || !ok;
    $('amFine').innerHTML = UI.client ? 'Searching is free. Press Enter to send.' :
      'Searching is free. Emails and LinkedIn profiles cost 1 credit per email found, only after you confirm. <kbd>Enter</kbd> sends, <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line.';
  }

  function grow() {
    var t = $('amMsg');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 150) + 'px';
  }

  function itemOf(id) { return items.filter(function (x) { return x.t === 'run' && x.id === id; })[0]; }

  function poll(id) {
    clearTimeout(polls[id]);
    P.api('/runs/' + id).then(function (run) {
      var it = itemOf(id);
      if (!it) return;
      it.run = run;
      if (run.status === 'ready' && !sels[id]) sels[id] = defaultSelection(run);
      busy = run.status === 'running' && !run.stale;
      paint(run.status !== 'running');
      if (busy) polls[id] = setTimeout(function () { poll(id); }, 1400);
      else P.loadRuns().then(P.refreshRuns);
    }).catch(function (e) {
      busy = false; paint();
      P.toast(e.message);
    });
  }

  function send(text) {
    text = String(text || '').trim();
    if (!text || busy || !connected()) return;
    items.forEach(function (x) { if (x.t === 'choose' && x.state === 'open') x.state = 'skipped'; });
    items.push({ t: 'user', text: text });
    busy = true; paint(true);
    $('amMsg').value = ''; grow();
    P.api('/chat', { message: text, context: contextOf(items.slice(0, -1)) }).then(function (j) {
      if (j.kind === 'search') {
        items.push({ t: 'run', id: j.run_id, understood: j.understood, run: null });
        paint(true); poll(j.run_id);
      } else if (j.kind === 'choose') {
        busy = false;
        items.push({ t: 'choose', state: 'open', message: text, understood: j.understood, needs: j.needs });
        paint(true);
      } else {
        busy = false;
        items.push({ t: 'bot', kind: j.kind, text: j.reply, choices: j.choices || [] });
        paint(true);
      }
    }).catch(function (e) {
      busy = false;
      var again = e.status === 409 && e.data && e.data.run_id;
      items.push({ t: 'bot', kind: 'error', text: e.message });
      if (again && !itemOf(e.data.run_id)) { items.push({ t: 'run', id: e.data.run_id, understood: null, run: null }); busy = true; poll(e.data.run_id); }
      paint(true);
    });
  }

  // The user chose a company (or said none of them): once every name has one, the search goes ahead.
  function choose(i, k, domain) {
    var it = items[i];
    if (!it || it.t !== 'choose' || it.state !== 'open' || busy) return;
    it.needs[k].picked = domain;
    var left = it.needs.filter(function (n) { return n.picked == null; }).length;
    if (left) { paint(); return; }
    var picks = {};
    it.needs.forEach(function (n) { if (n.picked) picks[n.name] = n.picked; });
    it.state = 'done'; busy = true; paint();
    P.api('/chat', { message: it.message, resume: { understood: it.understood, picks: picks } }).then(function (j) {
      var u = dict(it.understood, { companies: j.understood.companies });
      items.push({ t: 'run', id: j.run_id, understood: u, run: null });
      paint(true); poll(j.run_id);
    }).catch(function (e) {
      busy = false;
      items.push({ t: 'bot', kind: 'error', text: e.message });
      paint(true);
    });
  }

  function reveal(id) {
    var it = itemOf(id);
    if (!it || !it.run) return;
    var keys = selectedKeys(it.run, sels[id]).map(function (k) { return /^\d+$/.test(k) ? Number(k) : k; });
    if (!keys.length) return;
    var body = { keys: keys, cap_credits: Math.max(keys.length, 1), phone: false };
    P.api('/runs/' + id + '/reveal', dict({ dry_run: true }, body)).then(function (check) {
      if (!check.ok) { P.toast(check.why || 'This reveal cannot go ahead.'); return; }
      return P.ask('Reveal ' + check.people + ' email' + (check.people === 1 ? '' : 's') + '?',
        'This uses up to ' + check.worst_credits + ' Saleshandy credit' + (check.worst_credits === 1 ? '' : 's') + ' (1 per email found, nothing when none is found). ' +
        (check.balance != null ? 'The account has ' + num(check.balance) + ' credits. ' : '') + 'You also get each person’s LinkedIn profile when Saleshandy has it.', 'Reveal').then(function (ok) {
        if (!ok) return;
        return P.api('/runs/' + id + '/reveal', dict({ confirm: true }, body)).then(function () {
          sels[id] = {}; it.run.status = 'running'; it.run.stage = 'revealing'; busy = true; paint();
          P.toast('Revealing ' + check.people + (check.people === 1 ? ' person' : ' people') + '…');
          poll(id);
        });
      });
    }).catch(function (e) { P.toast(e.message); });
  }

  function remove(id) {
    P.ask('Remove this answer?', 'Its people and any revealed emails leave your list. Credits already spent stay spent.', 'Remove').then(function (ok) {
      if (!ok) return;
      P.api('/runs/' + id + '/delete', {}).then(function () {
        var at = -1;
        items.forEach(function (x, i) { if (x.t === 'run' && x.id === id) at = i; });
        if (at > 0 && items[at - 1].t === 'user') items.splice(at - 1, 2); else if (at >= 0) items.splice(at, 1);
        busy = false; paint(); P.toast('Removed.');
        P.loadRuns().then(P.refreshRuns);
      }).catch(function (e) { P.toast(e.message); });
    });
  }

  // A page load starts a new chat: earlier ones are in Recent (click one to read it again). The one exception is
  // a search still running, which is shown so its answer is not lost and the composer is not blocked by it.
  function resumeRunning(runs) {
    var going = (runs || []).filter(function (r) { return (r.settings || {}).chat && r.status === 'running' && !r.stale; })[0];
    if (!going) return Promise.resolve();
    return P.api('/runs/' + going.id).then(function (run) {
      var chat = (run.settings || {}).chat || {};
      items.push({ t: 'user', text: chat.message || '' });
      items.push({ t: 'run', id: run.id, run: run, understood: { companies: run.settings.companies, asks: chat.asks, where: chat.where, how: chat.how } });
      busy = true; paint(true); poll(run.id);
    }).catch(function () { /* the list still shows it */ });
  }

  AMChat.init = function (runs, st) {
    if (st) status = st;
    paintSetup(); paint();
    return resumeRunning(runs);
  };
  AMChat.setStatus = function (st) { status = st; paintSetup(); paint(); };
  AMChat.show = function (id) {
    var go = function () {
      var it = itemOf(id);
      if (!it) return;
      paint();
      var els = document.querySelectorAll('.amc-msg.result');
      var at = items.filter(function (x) { return x.t === 'run'; }).indexOf(it);
      if (els[at]) scrollThread(Math.max(0, els[at].offsetTop - 14));
    };
    if (itemOf(id)) { go(); return; }
    P.api('/runs/' + id).then(function (run) {
      var chat = (run.settings || {}).chat || {};
      items.push({ t: 'day', text: when(run.created_at) });
      items.push({ t: 'user', text: chat.message || '' });
      items.push({ t: 'run', id: run.id, run: run, understood: { companies: run.settings.companies, asks: chat.asks, where: chat.where, how: chat.how } });
      if (run.status === 'ready') sels[run.id] = defaultSelection(run);
      paint(); go();
    }).catch(function (e) { P.toast(e.message); });
  };

  $('amThread').addEventListener('scroll', toggleJump, { passive: true });
  $('amJump').addEventListener('click', function () { scrollThread($('amThread').scrollHeight); });
  $('amComposer').addEventListener('submit', function (e) { e.preventDefault(); send($('amMsg').value); });
  $('amMsg').addEventListener('input', grow);
  $('amMsg').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send($('amMsg').value); }
  });
  $('amNew').addEventListener('click', function () {
    items = []; sels = {}; busy = false; Object.keys(polls).forEach(function (k) { clearTimeout(polls[k]); });
    paint(); $('amMsg').focus();
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || !$('amAsk').contains(el)) return;
    var act = el.getAttribute('data-act'), id = Number(el.getAttribute('data-run'));
    if (act === 'csay') { var t = el.getAttribute('data-say'); if (connected()) send(t); else { $('amMsg').value = t; grow(); } }
    else if (act === 'cchoose') choose(Number(el.getAttribute('data-item')), Number(el.getAttribute('data-need')), el.getAttribute('data-domain'));
    else if (act === 'cnone-of') {
      var ci = items[Number(el.getAttribute('data-item'))];
      if (ci) { ci.state = 'skipped'; items.push({ t: 'bot', kind: 'clarify', text: 'No problem. Write the company\u2019s website, like company.com, and I will search there.', choices: [] }); paint(true); $('amMsg').focus(); }
    }
    else if (act === 'creveal') reveal(id);
    else if (act === 'cremove') remove(id);
    else if (act === 'call') { var it = itemOf(id); if (it) { sels[id] = defaultSelection(it.run); paint(); } }
    else if (act === 'cnone') { sels[id] = {}; paint(); }
    else if (act === 'ccopyall') { var r = itemOf(id); if (r) P.copyText(emails(r.run).join(', ')); }
    else if (act === 'cretry') {
      var f = itemOf(id), chat = f && f.run && (f.run.settings || {}).chat;
      if (chat && chat.message) { items = items.filter(function (x) { return x !== f && !(x.t === 'user' && x.text === chat.message && items.indexOf(x) === items.indexOf(f) - 1); }); busy = false; send(chat.message); }
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.getAttribute && el.getAttribute('data-act') === 'cpick') {
      var id = el.getAttribute('data-run');
      sels[id] = sels[id] || {};
      sels[id][el.getAttribute('data-key')] = el.checked;
      paint();
    }
  });

  // The placeholder offers a new example now and then, while the box is empty and not being used.
  setInterval(function () {
    var t = $('amMsg');
    if (t.disabled || t.value || document.activeElement === t || document.hidden) return;
    hint++; t.placeholder = hintText();
  }, 3800);

  paintSetup(); paint();
})(typeof window !== 'undefined' ? window : globalThis);
