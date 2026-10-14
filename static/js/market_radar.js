/* Market Radar edit page (templates/market_radar.html).
 *
 * The render* functions are pure: data in, HTML string out, every value
 * escaped (names, reasons and quotes come from other companies' websites and
 * from a model, so none of it is trusted markup). They are exported as
 * window.MR so tests can run them under Node without a browser. The wiring at
 * the bottom only runs on the page itself.
 */
(function (root) {
  'use strict';

  var API = '/strategic-agents/market-radar/api';
  // Inside a client account (app.py account_agent) the page's calls carry the account
  // (account-context.js) and its links stay inside it. A client of the account sees no weekly
  // email settings and no prices (app.py also refuses them and strips every cost).
  var DOC = typeof document !== 'undefined' ? document : null;
  var CLIENT = !!(DOC && DOC.body && DOC.body.hasAttribute('data-mr-client'));
  var ACCT = typeof window !== 'undefined' && window.__acctContext;
  var REPORT = ACCT ? '/' + encodeURIComponent(ACCT) + '/agents/market-radar/report/' : '/strategic-agents/market-radar/report/';

  var ARCHETYPES = [
    ['local_single', 'Local business, one site'], ['multi_location', 'Several locations or a chain'],
    ['ecommerce', 'Online shop'], ['b2b_services', 'Business services'],
    ['b2b_product', 'Business software or products'], ['manufacturer', 'Manufacturer'],
    ['marketplace', 'Marketplace or platform'], ['professional_services', 'Professional services (law, accounting, consulting)'],
    ['hospitality_travel', 'Hotels, travel and airlines'], ['education', 'Education and training'],
    ['health_system', 'Hospital or health system'], ['real_estate', 'Real estate'],
    ['financial_services', 'Banking, insurance and fintech'], ['nonprofit', 'Nonprofit or association'],
    ['personal_brand', 'Creator, consultant or personal brand'], ['other', 'Other']];
  var CUSTOMERS = [['B2C', 'Consumers'], ['B2B', 'Businesses'], ['both', 'Both']];
  var PRICES = [['budget', 'Budget'], ['mid', 'Mid-market'], ['premium', 'Premium'], ['luxury', 'Luxury'],
    ['unknown', 'Not known']];
  var KINDS = [['direct', 'Direct'], ['local', 'Nearby'], ['indirect', 'Indirect'], ['aspirational', 'Bigger player']];
  var KIND_HELP = {
    direct: 'Sells the same thing to the same customers in the same market',
    local: 'Same kind of business near this one',
    indirect: 'A substitute customers compare it with',
    aspirational: 'A much larger player in the same market'
  };
  var STATUS = { proposed: 'Suggested', confirmed: 'Confirmed', removed: 'Removed' };
  var STEPS = ['Reading the website', 'Planning searches', 'Searching', 'Checking sites', 'Ranking', 'Saving'];
  var STAGE_STEP = { queued: 0, profile: 0, rivals_plan: 1, rivals_search: 2, rivals_verify: 3,
    rivals_rank: 4, save: 5, done: 6 };

  // field, label, type, options, wide, hint
  var FIELDS = [
    ['name', 'Name', 'text'],
    ['archetype', 'Type of business', 'select', ARCHETYPES],
    ['one_liner', 'What they do', 'textarea', null, true],
    ['industry.plain_label', 'Industry', 'text'],
    ['customer_type', 'Customers', 'select', CUSTOMERS],
    ['price_positioning', 'Price level', 'select', PRICES],
    ['offerings', 'What they sell', 'list', null, true, 'Separate items with commas.'],
    ['industry.keywords', 'Industry keywords', 'list', null, true, 'Used to find news and competitors. Separate with commas.'],
    ['positioning.niche', 'Niche', 'textarea', null, true, 'The most specific category they are in. Competitors are searched for and judged against it. Example: premium Pima cotton, modal and bamboo men\'s basics.'],
    ['positioning.audience.who', 'Who they sell to', 'textarea', null, true, 'The buyer, in a sentence.'],
    ['positioning.differentiators', 'What sets them apart', 'list', null, true, 'Separate with commas.'],
    ['positioning.not_this', 'Not in these categories', 'list', null, true, 'Competitors from these are left out. Separate with commas.'],
    ['positioning.rival_search_phrases', 'What buyers search for', 'list', null, true, 'Searches that find brands like this one. Separate with commas.'],
    ['location_count', 'Number of locations', 'number', null, false, '0 for online only. Leave empty if not known.'],
    ['markets', 'Countries served', 'list', null, false, 'Two-letter codes, such as US, GB.'],
    ['service_area', 'Service area', 'text', null, true],
    ['hq.street', 'Street address', 'text', null, false, 'Where nearby competitors are searched from.'],
    ['hq.postal_code', 'Postcode', 'text'],
    ['hq.city', 'City', 'text'],
    ['hq.region', 'Region or state', 'text'],
    ['hq.country_code', 'Country', 'text', null, false, 'Two-letter code, such as US.']
  ];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) {
    return /^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : null;
  }
  function siteUrl(domain) {
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(domain || '')) ? 'https://' + domain + '/' : null;
  }
  function label(pairs, value) {
    for (var i = 0; i < pairs.length; i++) if (pairs[i][0] === value) return pairs[i][1];
    return value == null || value === '' ? '' : String(value);
  }
  function money(v) {
    if (v == null) return 'not measured';
    return '$' + Number(v).toFixed(Number(v) < 1 ? 3 : 2);
  }
  function duration(s) {
    if (s == null) return '';
    s = Math.round(Number(s));
    return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function shown(field, value) {
    var def = fieldDef(field);
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null;
    if (field === 'location_count') {
      if (value === -1) return null;
      return value === 0 ? 'Online only' : String(value);
    }
    if (Array.isArray(value)) return value.join(', ');
    if (def && def[2] === 'select') return label(def[3], value);
    return String(value);
  }
  function fieldDef(field) {
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i][0] === field) return FIELDS[i];
    return null;
  }
  function kindChip(kind) {
    return '<span class="mr-chip k-' + esc(kind) + '" title="' + esc(KIND_HELP[kind] || '') + '">' +
      esc(label(KINDS, kind)) + '</span>';
  }

  // A company's first letter on its kind's colour: a face for every rival.
  var KIND_HUE = { direct: 'acc', local: 'sky', indirect: 'cream', aspirational: 'asp' };
  function mono(name, kind, extra) {
    var ch = (String(name || '').replace(/^(the|www\.)\s*/i, '').match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase();
    return '<span class="mr-mono h-' + (KIND_HUE[kind] || 'ink') + (extra ? ' ' + extra : '') + '" aria-hidden="true">' + esc(ch) + '</span>';
  }

  // == sections and tabs ===============================================================
  //
  // The company's page is one short panel at a time, picked in the rail.
  // Every panel is rendered and the others carry `hidden`, so a switch is
  // instant and a half-typed form survives it.

  var SECTIONS = [
    ['overview', 'Overview', 'results'], ['competitors', 'Competitors', 'results'], ['moves', 'Moves', 'results'],
    ['rivals', 'Rival cards', 'results'],
    ['nearby', 'Nearby & new', 'results'], ['pulse', 'Industry pulse', 'results'],
    ['profile', 'Profile', 'setup'], ['monitor', 'Weekly update', 'setup'], ['run', 'Last search', 'setup']]
    .filter(function (s) { return !(CLIENT && s[0] === 'monitor'); });
  var ICON = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    competitors: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    moves: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    rivals: '<circle cx="9" cy="8" r="3.2"/><circle cx="17.5" cy="9.5" r="2.4"/><path d="M3 20a6 6 0 0 1 12 0M15.5 20a4.6 4.6 0 0 1 5.8-2"/>',
    nearby: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    pulse: '<path d="M4 5h12v14H6a2 2 0 0 1-2-2V5z"/><path d="M16 9h3v8a2 2 0 0 1-2 2"/><path d="M7 9h6M7 13h6M7 16h4"/>',
    profile: '<path d="M4 21V7l8-4 8 4v14"/><path d="M9 21v-5h6v5"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
    monitor: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    run: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'
  };
  function icon(key) {
    return '<svg class="mr-ico" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[key] || '') + '</svg>';
  }
  function sectionOf(state) {
    var s = state && state.section;
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i][0] === s) return s;
    return 'overview';
  }

  /** A row of tabs inside a card; `items` is [[key, label, count]]. */
  function tabs(group, items, active) {
    return '<div class="mr-seg mr-tabs" role="tablist">' + items.map(function (t) {
      return '<button type="button" role="tab" class="' + (t[0] === active ? 'on' : '') + '" aria-selected="' + (t[0] === active) +
        '" data-act="tab" data-group="' + esc(group) + '" data-tab="' + esc(t[0]) + '">' + esc(t[1]) +
        (t[2] != null ? ' <span class="mr-tabn">' + esc(t[2]) + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function pane(group, key, active, html) {
    return '<div class="mr-pane" role="tabpanel" data-group="' + esc(group) + '" data-tab="' + esc(key) + '"' +
      (key === active ? '' : ' hidden') + '>' + html + '</div>';
  }
  function pick(wanted, keys) {
    return keys.indexOf(wanted) >= 0 ? wanted : keys[0];
  }

  // == section heads ===================================================================
  //
  // Every results section opens the way the overview does: an ink block with
  // the one sentence that matters, four figures and a picture of the section.

  var KPI_HUES = ['k-acc', 'k-paper', 'k-sky', 'k-cream'];
  /** {eye, h, p, kpis: [[figure, label, sub, hue]], right, quiet} */
  function sectHead(o) {
    var kpis = (o.kpis || []).map(function (k, i) {
      return '<div class="mr-kpi static ' + (k[3] || KPI_HUES[i % 4]) + '"><b>' + esc(k[0]) + '</b><span>' + esc(k[1]) + '</span>' +
        (k[2] ? '<small>' + esc(k[2]) + '</small>' : '') + '</div>';
    }).join('');
    return '<div class="mr-cmd mr-sh' + (o.right ? '' : ' solo') + '"><div class="mr-cmd-l"><div class="mr-cmd-eye' + (o.quiet ? ' quiet' : '') + '"><i></i>' +
      esc(o.eye) + '</div><h3 class="mr-cmd-h">' + esc(o.h) + '</h3>' + (o.p ? '<p class="mr-cmd-p">' + esc(o.p) + '</p>' : '') +
      (kpis ? '<div class="mr-kpis mr-kpis--4">' + kpis + '</div>' : '') + '</div>' +
      (o.right ? '<div class="mr-cmd-r">' + o.right + '</div>' : '') + '</div>';
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** A calendar leaf for a timeline: the day large, the month and year small. */
  function dateBlock(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '<div class="mr-dt none" aria-label="No date"><b>&middot;</b><span>No date</span></div>';
    return '<div class="mr-dt" title="' + esc(m[0]) + '"><b>' + Number(m[3]) + '</b><span>' + MONTHS[Number(m[2]) - 1] +
      '</span><small>' + m[1] + '</small></div>';
  }
  function plural(n, one, many) { return esc(n) + ' ' + (Number(n) === 1 ? one : (many || one + 's')); }
  var PIN = '<svg viewBox="0 0 24 24" aria-hidden="true" class="mr-ico s"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  // Each rival's kind, for its monogram's colour wherever it is named.
  var KIND_OF = {};

  /** What each section holds, for the rail's badges and the overview. */
  function facts(state) {
    var v = state.view || {}, m = state.moves || {}, rows = v.competitors || [];
    var c = counts(rows), events = m.events || [], radar = m.radar || {};
    var high = events.filter(function (e) { return e.severity === 'HIGH'; }).length;
    var near = ((radar.local || {}).findings || []).length, brands = ((radar.entrants || {}).findings || []).length;
    var themes = 0;
    ((m.pulse || {}).markets || []).forEach(function (mk) { themes += (mk.themes || []).length; });
    var run = v.last_run || null;
    return { confirmed: c.confirmed, proposed: c.proposed, removed: c.removed, moves: events.length, high: high,
      near: near, brands: brands, themes: themes, collected: !!(m.last_collect && m.last_collect.status === 'complete'),
      monitor: state.monitor ? !!state.monitor.enabled : null, cost: run ? run.cost_usd : null,
      sites: ((v.profile || {}).sites || []).length,
      speeding: ((state.rivals || {}).counts || {}).speeding_up || 0 };
  }

  function renderNav(state) {
    if (!state || !state.view) return '';
    var f = facts(state), active = sectionOf(state);
    var badge = {
      competitors: f.proposed ? [f.proposed + ' new', 'hot'] : f.confirmed ? [f.confirmed, ''] : null,
      moves: f.high ? [f.high + ' high', 'bad'] : f.moves ? [f.moves, ''] : null,
      rivals: f.speeding ? [f.speeding + ' up', 'hot'] : null,
      nearby: f.near + f.brands ? [f.near + f.brands, 'sky'] : null,
      pulse: f.themes ? [f.themes, ''] : null,
      monitor: f.monitor == null ? null : [f.monitor ? 'On' : 'Off', f.monitor ? 'ok' : 'off'],
      run: f.cost != null ? [money(f.cost), 'off'] : null
    };
    var group = '';
    return SECTIONS.map(function (s) {
      var head = '';
      if (s[2] !== group) {
        group = s[2];
        head = '<div class="mr-nav-h">' + (group === 'results' ? 'Results' : 'Set-up') + '</div>';
      }
      var b = badge[s[0]];
      return head + '<button type="button" class="mr-nav-i' + (s[0] === active ? ' on' : '') + '" data-act="section" data-section="' + s[0] +
        '"' + (s[0] === active ? ' aria-current="page"' : '') + '>' + icon(s[0]) + '<span>' + esc(s[1]) + '</span>' +
        (b ? '<em class="mr-badge ' + b[1] + '">' + esc(b[0]) + '</em>' : '') + '</button>';
    }).join('');
  }

  // == the map of rivals ==============================================================
  //
  // The Overview's map (static/js/market_radar_map.js) puts the client's sites and each rival where they are.
  // This only leaves a slot for it: the page repaints often, and mountMap() hands the slot to the map after
  // each repaint so the view the user chose is kept.

  function hashOf(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function renderMapSlot() {
    return '<div class="mr-mapslot" id="mrMapSlot"><div class="mr-map-wait"><i></i>Placing your rivals on the map…</div></div>';
  }

  // == the overview ====================================================================

  function renderOverview(state) {
    var v = state.view || {}, p = v.profile || {}, pf = p.fields || {}, f = facts(state), m = state.moves || null;
    var rows = (v.competitors || []).filter(function (r) { return r.status !== 'removed'; });
    var running = state.collect && state.collect.status === 'running' && !state.collect.stale;
    var watched = f.confirmed + f.proposed;
    var headline = !watched ? 'No rivals on the radar yet.'
      : f.proposed && !f.confirmed ? f.proposed + ' suggested rival' + (f.proposed > 1 ? 's are' : ' is') + ' waiting for your review.'
      : f.high ? f.high + ' move' + (f.high > 1 ? 's need' : ' needs') + ' your attention.'
      : f.collected ? 'No high-impact moves right now.' : 'Rivals found. Collect their moves next.';
    var kpi = function (key, cls, n, lab, sub) {
      return '<button type="button" class="mr-kpi ' + cls + '" data-act="section" data-section="' + key + '"><b>' + esc(n) + '</b><span>' +
        esc(lab) + '</span>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
    };
    var cmd = '<div class="mr-cmd"><div class="mr-cmd-l"><div class="mr-cmd-eye"><i></i>' +
      (watched ? 'Watching ' + esc(watched) + ' rival' + (watched > 1 ? 's' : '') : 'Radar idle') +
      (f.sites > 1 ? ' around ' + esc(f.sites) + ' sites' : '') + '</div>' +
      '<h3 class="mr-cmd-h">' + esc(headline) + '</h3>' +
      (pf.one_liner ? '<p class="mr-cmd-p">' + esc(pf.one_liner) + '</p>' : '') +
      '<div class="mr-kpis">' +
      kpi('competitors', 'k-acc', watched, 'Rivals', f.proposed ? f.proposed + ' to review' : f.confirmed + ' confirmed') +
      kpi('moves', 'k-paper', m ? f.high : '–', 'High-impact', m ? 'of ' + f.moves + ' moves' : 'loading') +
      kpi('nearby', 'k-sky', m ? f.near + f.brands : '–', 'New nearby', f.brands ? f.brands + ' new brands' : 'openings') +
      kpi('pulse', 'k-cream', m ? f.themes : '–', 'Industry themes', 'this month') +
      '</div></div><div class="mr-cmd-r">' + renderMapSlot() + '</div></div>';

    // The moves that matter most, at most three.
    var top = [];
    if (m) {
      var byId = {};
      (m.events || []).forEach(function (e) { byId[e.id] = e; });
      top = (m.top || []).map(function (id) { return byId[id]; }).filter(Boolean).slice(0, 3);
      if (!top.length) top = (m.events || []).filter(function (e) { return e.severity === 'HIGH' || e.severity === 'MEDIUM'; }).slice(0, 3);
    }
    var hot = '<div class="card mr-card mr-hot"><div class="mr-card-h"><div><h3>Most important now</h3><p>The moves that matter most to this business.</p></div>' +
      '<button type="button" class="mr-btn small" data-act="section" data-section="moves">All moves</button></div><div class="mr-card-b">' +
      (!m ? '<div class="mr-empty">Loading…</div>'
        : top.length ? '<ol class="mr-hotl">' + top.map(function (e) {
          var sev = SEVERITY[e.severity] || SEVERITY.LOW, href = safeUrl(e.url);
          return '<li class="s-' + (sev[0] || 'low') + '"><div class="mr-hot-t"><span class="mr-chip mr-sev ' + sev[0] + '">' + sev[1] + '</span>' +
            '<span class="mr-chip ' + esc(TONE[e.type] || '') + '">' + esc(e.label) + '</span><span class="mr-hint">' + esc(e.date || when(e.seen)) + '</span></div>' +
            '<b>' + esc(e.name) + '</b><p>' + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(e.title) + '</a>' : esc(e.title)) + '</p>' +
            (e.place ? '<small>' + esc(e.place) + (e.distance_km != null ? ' · ' + esc(Number(e.distance_km).toFixed(1)) + ' km from your nearest site' : '') + '</small>' : '') + '</li>';
        }).join('') + '</ol>'
        : '<div class="mr-empty"><b>' + (f.collected ? 'All quiet' : 'Nothing collected yet') + '</b>' +
          (f.collected ? 'No move stands out since the last collection.' : 'Collect the competitors\' moves to see what they are doing.') + '</div>') +
      '</div></div>';

    // The rivals to watch most closely.
    var lead = rows.slice().sort(function (a, b) {
      return (b.score != null ? b.score : -1) - (a.score != null ? a.score : -1);
    }).slice(0, 6);
    var board = '<div class="card mr-card mr-board"><div class="mr-card-h"><div><h3>Rivals to watch</h3><p>Ranked by how closely to watch them.</p></div>' +
      '<button type="button" class="mr-btn small" data-act="section" data-section="competitors">All rivals</button></div>' +
      (lead.length ? '<ol class="mr-boardl">' + lead.map(function (r) {
        var score = r.score != null ? r.score : (r.confidence != null ? Math.round(r.confidence * 100) : null);
        return '<li>' + mono(r.name || r.domain, r.kind) + '<div class="mr-board-m"><b>' + esc(r.name || r.domain) + '</b><small>' +
          esc([label(KINDS, r.kind), r.distance_km != null ? Number(r.distance_km).toFixed(1) + ' km' + (r.near_site ? ' from ' + r.near_site : '') : r.location,
            r.status === 'proposed' ? 'to review' : ''].filter(Boolean).join(' · ')) + '</small></div>' +
          (score != null ? '<span class="mr-board-s"><i style="--w:' + esc(Math.max(0, Math.min(100, score))) + '%"></i><em>' + esc(score) + '</em></span>' : '') + '</li>';
      }).join('') + '</ol>' : '<div class="mr-empty">No rivals yet. Press <b style="display:inline;font:inherit">Search again</b> above.</div>') + '</div>';

    // What to do next, in order.
    var steps = [
      [!!p.has_reading, 'Read the website', 'What the company sells, to whom, and where.', 'profile', 'See the profile'],
      [watched > 0 && !f.proposed, 'Review the suggested rivals', f.proposed ? f.proposed + ' waiting: confirm the ones you agree with.' : 'Confirmed rivals are the ones tracked.', 'competitors', 'Review'],
      [f.collected, 'Collect their moves', 'Free. Reads their sites, shops, jobs and the news.', 'collect', running ? 'Collecting…' : f.collected ? 'Collect again' : 'Collect now'],
      [false, 'Read the report', 'A cited brief: what matters, so what, and what to do.', 'report', 'Open the report'],
      [!!f.monitor, 'Turn on the weekly update', 'A short "what changed" email once a week.', 'monitor', 'Set up']
    ].filter(function (s) { return !(CLIENT && s[3] === 'monitor'); });
    var next = '<div class="card mr-card mr-next"><div class="mr-card-h"><div><h3>Next steps</h3></div></div><ol class="mr-steps2">' +
      steps.map(function (s, i) {
        var btn = s[3] === 'collect' ? '<button type="button" class="mr-btn small" data-act="collect"' + (running ? ' disabled' : '') + '>' + esc(s[4]) + '</button>'
          : s[3] === 'report' ? '<a class="mr-btn small" href="' + REPORT + encodeURIComponent((v.client || {}).id) + '">' + esc(s[4]) + '</a>'
          : '<button type="button" class="mr-btn small" data-act="section" data-section="' + s[3] + '">' + esc(s[4]) + '</button>';
        return '<li class="' + (s[0] ? 'done' : '') + '"><span class="mr-steps2-n">' + (s[0] ? '&#10003;' : i + 1) + '</span><div><b>' + esc(s[1]) +
          '</b><small>' + esc(s[2]) + '</small></div>' + btn + '</li>';
      }).join('') + '</ol></div>';

    return '<div class="mr-ov">' + cmd + '<div class="mr-ov-grid">' + hot + board + '</div>' + fieldNow(state.rivals, p.playbook) + next + '</div>';
  }

  // The field in one strip: is it heating up, what several rivals are doing, and what is watched for this kind of business.
  function fieldNow(r, pb) {
    var pats = ((r || {}).patterns || []).slice(0, 3);
    var heat = ((r || {}).heat || {}).label;
    var left = pats.length ? '<ul class="mr-fn-l">' + pats.map(function (x) {
      return '<li><i>' + (PATTERN_ICON[x.kind] || '&bull;') + '</i><span>' + esc(x.text) + '</span></li>';
    }).join('') + '</ul>' : '<p class="mr-hint">Patterns appear when several rivals have been collected.</p>';
    var watch = pb && (pb.watch || []).length ? '<div class="mr-fn-w"><span class="mr-k">What we watch for ' + esc(String(pb.label || '').toLowerCase()) +
      '</span><div>' + pb.watch.map(function (w) { return '<span class="mr-chip">' + esc(w) + '</span>'; }).join('') + '</div></div>' : '';
    if (!pats.length && !watch) return '';
    return '<div class="card mr-card mr-fn"><div class="mr-card-h"><div><h3>' + esc(HEAT[heat] || 'The field right now') +
      '</h3><p>What several rivals are doing at once.</p></div><button type="button" class="mr-btn small" data-act="section" data-section="rivals">Rival cards</button></div>' +
      '<div class="mr-card-b mr-fn-b">' + left + watch + '</div></div>';
  }

  // == the rail ======================================================================

  function renderClientList(clients, selectedId) {
    if (!clients || !clients.length) {
      return '<div class="mr-empty"><b>No companies yet</b>Add a website above to start.</div>';
    }
    return clients.map(function (c) {
      var run = c.last_run || {};
      var state = run.status === 'running' ? '<span class="mr-chip acc">Running</span>'
        : run.status === 'failed' ? '<span class="mr-chip bad">Last run failed</span>' : '';
      return '<button type="button" class="mr-co' + (c.client_id === selectedId ? ' on' : '') +
        '" data-act="select" data-id="' + esc(c.client_id) + '">' +
        '<b>' + esc(c.name || c.domain) + '</b><small>' + esc(c.domain) + '</small>' +
        '<span class="mr-co-meta">' +
        (c.confirmed ? '<span class="mr-chip ok">' + esc(c.confirmed) + ' confirmed</span>' : '') +
        (c.proposed ? '<span class="mr-chip">' + esc(c.proposed) + ' to review</span>' : '') +
        state + '</span></button>';
    }).join('');
  }

  // == progress ======================================================================

  function renderProgress(run) {
    var step = STAGE_STEP[run.stage] != null ? STAGE_STEP[run.stage] : 0;
    var steps = STEPS.map(function (name, i) {
      return '<div class="mr-step ' + (i < step ? 'done' : i === step ? 'now' : '') + '">' + esc(name) + '</div>';
    }).join('');
    var note = run.stale ? '<div class="mr-callout bad" style="margin-top:12px">' + esc(run.stale) + '</div>' : '';
    return '<div class="card mr-progress"><div class="mr-progress-line"><span><b>Finding competitors…</b> ' +
      esc(STEPS[Math.min(step, STEPS.length - 1)]) + '</span><span>' +
      (run.cost_usd != null ? 'Spent so far ' + esc(money(run.cost_usd)) : '') + '</span></div>' +
      '<div class="mr-steps">' + steps + '</div>' + note + '</div>';
  }

  // == the profile ===================================================================

  // How much of the company the profile could see, said plainly (tracker/market_radar_outside.read_quality).
  var QUALITY = { full: ['ok', 'Read in full'], partial: ['warn', 'Read in part'], thin: ['bad', 'Thin reading'],
    outside: ['bad', 'Website not read'] };
  function readQuality(q) {
    if (!q || !QUALITY[q.grade]) return '';
    var meta = QUALITY[q.grade];
    return '<div class="mr-rq mr-rq--' + meta[0] + '"><span class="mr-rq-chip">' + esc(meta[1]) + '</span><span>' + esc(q.why || '') + '</span></div>';
  }

  function renderProfile(view, editing, errors, tab) {
    var p = view.profile || {};
    var f = p.fields || {};
    var edited = p.edited || [];
    errors = errors || {};
    if (!p.has_reading && !edited.length) {
      return '<div class="card mr-card"><div class="mr-card-h"><div><h3>Profile</h3></div></div>' +
        '<div class="mr-empty"><b>Not read yet</b>The website has not been read for this company. Run it to build a profile.</div></div>';
    }
    var head = '<div class="mr-card-h"><div><h3>Profile</h3><p>' +
      ((p.facts || {}).read_from_wikidata_and_wikipedia && (p.read_quality || {}).grade === 'outside' ? 'The website could not be read, so this was built from Wikidata and Wikipedia' +
        (p.read_at ? ' ' + esc(when(p.read_at)) : '') + '. Check it more carefully than usual'
        : (p.facts || {}).read_from_apollo ? 'The website refused our reader, so this was read from Apollo\'s company record' +
        (p.read_at ? ' ' + esc(when(p.read_at)) : '') + '. Check it more carefully than usual'
        : (p.facts || {}).read_in_browser ? 'The website refuses our usual reader, so it was read in a real browser' +
          (p.read_at ? ' ' + esc(when(p.read_at)) : '')
        : p.read_at ? 'Read from the website ' + esc(when(p.read_at)) : 'Read from the website') +
      (edited.length ? '; ' + esc(edited.length) + ' field' + (edited.length > 1 ? 's' : '') + ' corrected by you' : '') +
      '</p></div>' + (editing ? '' : '<button type="button" class="mr-btn small" data-act="edit">Edit profile</button>') + '</div>';

    var checks = readQuality(p.read_quality) + (p.checks || []).map(function (c) {
      return '<div class="mr-callout">' + esc(c) + '</div>';
    }).join('');

    var body;
    if (editing) {
      body = '<form class="mr-form" id="mrProfileForm" novalidate><div class="mr-fields">' + FIELDS.map(function (d) {
        var name = d[0], v = f[name], input;
        var id = 'mrf-' + name.replace(/\./g, '-');
        if (d[2] === 'select') {
          input = '<select id="' + id + '" name="' + esc(name) + '">' + d[3].map(function (o) {
            return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
          }).join('') + '</select>';
        } else if (d[2] === 'textarea') {
          input = '<textarea id="' + id + '" name="' + esc(name) + '" rows="2">' + esc(v || '') + '</textarea>';
        } else {
          var val = Array.isArray(v) ? v.join(', ') : (name === 'location_count' && v === -1 ? '' : (v == null ? '' : v));
          input = '<input type="' + (d[2] === 'number' ? 'number' : 'text') + '" id="' + id + '" name="' + esc(name) +
            '" value="' + esc(val) + '"' + (d[2] === 'number' ? ' min="0" step="1"' : '') + ' />';
        }
        return '<div class="mr-field' + (d[4] ? ' wide' : '') + '"><label class="mr-k" for="' + id + '">' + esc(d[1]) + '</label>' +
          input + (d[5] ? '<div class="mr-hint">' + esc(d[5]) + '</div>' : '') +
          (errors[name] ? '<div class="mr-err">' + esc(errors[name]) + '</div>' : '') + '</div>';
      }).join('') + '</div><div class="mr-form-foot"><span class="mr-hint">Changing the address moves where nearby competitors are searched.</span>' +
        '<button type="button" class="mr-btn ghost" data-act="cancel-edit">Cancel</button>' +
        '<button type="submit" class="mr-btn primary">Save changes</button></div></form>';
    } else {
      body = '<div class="mr-fields">' + FIELDS.map(function (d) {
        var name = d[0], text = shown(name, f[name]), isEdited = edited.indexOf(name) >= 0;
        var was = isEdited ? shown(name, (p.site_reading || {})[name]) : null;
        var list = d[2] === 'list' && Array.isArray(f[name]) && f[name].length;
        return '<div class="mr-field' + (d[4] ? ' wide' : '') + (list ? ' pills' : '') + '"><div class="mr-k">' + esc(d[1]) +
          (isEdited ? ' <span class="mr-edited">Your correction</span>' : '') + '</div>' +
          (list ? '<div class="mr-v mr-pills">' + f[name].map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>'
            : '<div class="mr-v' + (text ? '' : ' muted') + '">' + esc(text || 'Not stated') + '</div>') +
          (isEdited ? '<div class="mr-was">The website said: ' + esc(was || 'nothing') +
            ' · <button type="button" class="mr-link" data-act="reset" data-field="' + esc(name) + '">Use the website\'s</button></div>' : '') +
          '</div>';
      }).join('') + '</div>';
    }

    if (editing) {
      return '<div class="card mr-card">' + head + '<div class="mr-card-b">' + checks + body + renderLocation(view) + '</div></div>';
    }
    var ev = renderEvidence(p), pub = renderPublic(p), nic = renderNiche(p);
    var keys = ['what'].concat(nic ? ['niche'] : [], ['where'], pub ? ['public'] : [], ev ? ['evidence'] : []);
    var names = { what: 'What they do', niche: 'Niche and buyer', where: 'Where', public: 'Public records', evidence: 'What the website says' };
    var on = pick(tab, keys);
    return '<div class="mr-ov">' + profileHead(view) + '<div class="card mr-card mr-prof">' + head + '<div class="mr-card-b">' + checks +
      tabs('profile', keys.map(function (k) { return [k, names[k]]; }), on) +
      pane('profile', 'what', on, body) + (nic ? pane('profile', 'niche', on, nic) : '') + pane('profile', 'where', on, renderLocation(view)) +
      (pub ? pane('profile', 'public', on, pub) : '') +
      (ev ? pane('profile', 'evidence', on, ev) : '') + '</div></div></div>';
  }

  /** The profile's head: who they are in a line, four figures, and where they are. */
  // What Wikidata and Wikipedia say about the company (tracker/market_radar_outside.py), when they were read.
  function renderPublic(p) {
    var o = p.outside;
    if (!o) return '';
    var list = function (v) { return Array.isArray(v) ? v.join(', ') : v; };
    var rows = [['Description', o.description], ['Kind of organisation', list(o.kind)], ['Industry', list(o.industry)],
      ['Head office', list(o.head_office)], ['Country', list(o.country)], ['Founded', o.founded], ['Staff', o.employees ? Number(o.employees).toLocaleString('en-US') + (o.employees_year ? ' (' + o.employees_year + ')' : '') : ''],
      ['Revenue', o.revenue ? (o.revenue >= 1e9 ? (o.revenue / 1e9).toFixed(1).replace(/\.0$/, '') + ' billion' : (o.revenue / 1e6).toFixed(0) + ' million') + (o.revenue_year ? ' (' + o.revenue_year + ')' : '') : ''],
      ['Chief executive', list(o.ceo)], ['Founders', list(o.founders)], ['Part of', list(o.parent)], ['Owned by', list(o.owners)],
      ['Listed on', list(o.listed_on)]].filter(function (r) { return r[1]; });
    if (!rows.length) return '';
    return '<div class="mr-public"><p class="mr-hint">From Wikidata' + (o.wikipedia_title ? ' and Wikipedia' : '') +
      ', the record whose official website is this company\'s. Revenue is in the record\'s own currency, which is not shown here.</p><dl class="mr-facts">' + rows.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('') + '</dl></div>';
  }

  function profileHead(view) {
    var p = view.profile || {}, f = p.fields || {}, c = view.client || {};
    var offers = f.offerings || [], mk = f.markets || [], locs = f.location_count, sites = p.sites || [];
    var addr = [f['hq.street'], [f['hq.city'], f['hq.region'], f['hq.postal_code']].filter(Boolean).join(' '), f['hq.country_code']]
      .filter(Boolean);
    var where = '<div class="mr-idc"><span class="mr-k">Where they are</span>' +
      (sites.length > 1 ? '<ol class="mr-idc-sites">' + sites.map(function (st, i) {
        return st.name ? '<li><span>' + (i + 1) + '</span>' + esc(st.name) + '</li>' : '';
      }).join('') + '</ol>' : addr.length ? '<p class="mr-idc-addr">' + PIN + '<span>' + addr.map(esc).join('<br>') + '</span></p>'
        : '<p class="mr-idc-addr">No address on the website.</p>') +
      (f.service_area ? '<p class="mr-idc-area"><b>Serves</b> ' + esc(f.service_area) + '</p>' : '') +
      '<div class="mr-idc-tags">' + [label(ARCHETYPES, f.archetype), f['positioning.niche'] || f['industry.plain_label'], label(CUSTOMERS, f.customer_type)]
        .filter(Boolean).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div></div>';
    return sectHead({
      eye: 'Company profile', quiet: true, h: f.name || c.name || c.domain || 'This company',
      p: f.one_liner || 'What the company does is not stated on its website.',
      kpis: [[locs == null || locs === -1 ? '–' : locs === 0 ? 'Online' : locs, 'Locations', sites.length > 1 ? sites.length + ' searched for rivals' : 'from the website', 'k-acc'],
        [offers.length || '–', 'Things they sell', offers.length ? offers.slice(0, 2).join(', ') : 'none listed', 'k-paper'],
        [mk.length ? mk.join(' · ') : '–', 'Markets', 'countries served', 'k-sky'],
        [f.price_positioning && f.price_positioning !== 'unknown' ? label(PRICES, f.price_positioning) : '–', 'Price level',
          f.price_positioning && f.price_positioning !== 'unknown'
            ? (label(CUSTOMERS, f.customer_type) ? 'sells to ' + label(CUSTOMERS, f.customer_type).toLowerCase() : '') : 'not stated', 'k-cream']],
      right: where
    });
  }

  function renderLocation(view) {
    var p = view.profile || {}, f = p.fields || {}, pt = p.hq_point;
    var local = f.archetype === 'local_single' || f.archetype === 'multi_location';
    var where = pt ? 'Located ' + ({ exact: 'exactly, from the website\'s own map data', street: 'by street address',
      postcode: 'by postcode', city: 'only by city: nearby competitors may be missed' }[pt.precision] || 'approximately') +
      (pt.label ? ' (' + pt.label + ')' : '') : 'Not located on the map yet';
    var radius = view.client && view.client.radius_km;
    var precisionWarn = pt && pt.precision === 'city' && f.archetype === 'local_single';
    // A business with a few sites is searched around each of them.
    var sites = (p.sites || []).length > 1 ? '<div class="mr-k" style="margin-top:16px">Sites searched</div>' +
      '<ul class="mr-sites">' + p.sites.map(function (s, i) {
        return s.name ? '<li><span>' + (i + 1) + '</span>' + esc(s.name) + '</li>' : '';
      }).join('') + '</ul>' : '';
    var chain = f.archetype === 'multi_location' && p.competes_locally === false ?
      '<div class="mr-hint" style="margin-top:6px">A chain: competitors are looked for among other chains, not around each branch.</div>' : '';
    return '<div class="mr-where"><div class="mr-k">Map location</div>' +
      '<div class="mr-v">' + esc(where) + '</div>' + sites + chain +
      (precisionWarn ? '<div class="mr-callout" style="margin-top:8px">Add the street address so the map search looks in the right neighbourhood.</div>' : '') +
      (local ? '<form class="mr-addrow" id="mrRadiusForm" style="border:0;background:none;padding:10px 0 0">' +
        '<label class="mr-k" for="mrRadius" style="align-self:center">Search radius</label>' +
        '<input type="number" id="mrRadius" min="0.5" max="25" step="0.5" style="flex:0 0 110px" value="' + esc(radius == null ? '' : radius) +
        '" placeholder="Automatic" /> <span class="mr-hint" style="align-self:center">km</span>' +
        '<button type="submit" class="mr-btn small">Save radius</button>' +
        (radius != null ? '<button type="button" class="mr-link" data-act="radius-auto">Back to automatic</button>' : '') +
        '</form>' : '') + '</div>';
  }

  /** The niche, who it sells to, and what the site itself keeps saying (tracker/market_radar_niche.py). */
  function renderNiche(p) {
    var pos = p.positioning || {}, nc = p.niche_check || {}, st = nc.stresses || {};
    if (!pos.niche && !(nc.flags || []).length) return '';
    var chips = function (xs, cls) {
      return (xs || []).length ? '<div class="mr-pills ' + (cls || '') + '">' + xs.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '';
    };
    var aud = pos.audience || {};
    var path = (pos.category_path || []).length ? '<p class="mr-niche-path">' + pos.category_path.map(esc).join(' <i>\u203a</i> ') + '</p>' : '';
    var attrs = (pos.defining_attributes || []).map(function (a) {
      var href = safeUrl(a.url);
      return '<li><span class="mr-k" style="display:inline">' + esc(String(a.kind || '').replace(/_/g, ' ')) + '</span> <b>' + esc(a.value) + '</b>' +
        (a.quote ? '<br><q>' + esc(a.quote) + '</q>' : '') + (href ? ' <a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">page</a>' : '') + '</li>';
    }).join('');
    var segs = (pos.customer_segments || []).map(function (c) {
      return '<div class="mr-icp"><b>' + esc(c.name) + '</b><p>' + esc(c.description) + '</p>' +
        (c.why_they_buy ? '<p class="mr-hint">Why they buy: ' + esc(c.why_they_buy) + '</p>' : '') + '</div>';
    }).join('');
    var who = [aud.gender, aud.age_range, aud.geography].filter(Boolean).map(esc).join(' \u00b7 ');
    var terms = (st.terms || []).slice(0, 10).map(function (t) { return t.term + ' \u00d7' + t.mentions; });
    var flags = (nc.flags || []).filter(function (f) { return f.kind !== 'no_audience'; }).map(function (f) {
      return '<div class="mr-callout">' + esc(f.text) + '</div>';
    }).join('');
    var ref = nc.refined ? '<p class="mr-hint">' + (nc.refined.failed ? 'The first reading was checked against the site and could not be improved (' + esc(nc.refined.failed) + ').'
      : 'The first reading, \u201c' + esc(nc.refined.before || '') + '\u201d, was too broad for what the site says, so it was read again.') + '</p>' : '';
    return '<div class="mr-niche"><div class="mr-k">Niche</div><p class="mr-niche-t">' + esc(pos.niche || 'Not stated') + '</p>' + path + ref + flags +
      (pos.broad_category ? '<p class="mr-hint">Broad category: ' + esc(pos.broad_category) + (pos.price_note ? ' \u00b7 ' + esc(pos.price_note) : '') + '</p>' : '') +
      (attrs ? '<div class="mr-k" style="margin-top:14px">What defines it</div><ul class="mr-quotes">' + attrs + '</ul>' : '') +
      (aud.who ? '<div class="mr-k" style="margin-top:14px">Who they sell to</div><p>' + esc(aud.who) + '</p>' + (who ? '<p class="mr-hint">' + who + '</p>' : '') +
        (aud.needs && aud.needs.length ? '<div class="mr-hint">Needs</div>' + chips(aud.needs) : '') +
        (aud.buying_triggers && aud.buying_triggers.length ? '<div class="mr-hint">Buys when</div>' + chips(aud.buying_triggers) : '') : '') +
      (segs ? '<div class="mr-k" style="margin-top:14px">Ideal customers</div><div class="mr-icps">' + segs + '</div>' : '') +
      ((pos.differentiators || []).length ? '<div class="mr-k" style="margin-top:14px">What sets them apart</div>' + chips(pos.differentiators) : '') +
      ((pos.not_this || []).length ? '<div class="mr-k" style="margin-top:14px">Not in</div>' + chips(pos.not_this, 'mr-not') : '') +
      (terms.length ? '<div class="mr-k" style="margin-top:14px">What the site keeps saying</div>' + chips(terms) +
        '<p class="mr-hint">Counted by a program from the site\'s title, headline, menu and text, not by a model.' +
        ((st.says_it_is_free_of || []).length ? ' It says it is free of: ' + esc(st.says_it_is_free_of.join(', ')) + '.' : '') + '</p>' : '') + '</div>';
  }

  function renderEvidence(p) {
    var quotes = (p.evidence || []).map(function (e) {
      var href = safeUrl(e.url);
      return '<li><span class="mr-k" style="display:inline">' + esc(String(e.field || '').replace(/_/g, ' ')) + '</span><br>' +
        '<q>' + esc(e.quote) + '</q>' + (href ? '<br><a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(href) + '</a>' : '') + '</li>';
    }).join('');
    var unknowns = (p.unknowns || []).map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('');
    var why = p.archetype_reason ? '<p class="mr-hint" style="font-size:13px">Why this type: ' + esc(p.archetype_reason) + '</p>' : '';
    if (!quotes && !unknowns && !why) return '';
    return why + (quotes ? '<ul class="mr-quotes">' + quotes + '</ul>' : '') +
      (unknowns ? '<div class="mr-k" style="margin-top:14px">Not stated on the website</div><ul class="mr-list">' + unknowns + '</ul>' : '');
  }

  // == competitors ===================================================================

  function counts(rows) {
    var c = { proposed: 0, confirmed: 0, removed: 0 };
    (rows || []).forEach(function (r) { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }

  function renderCompetitors(rows, filter, tracking, run) {
    rows = rows || [];
    var c = counts(rows);
    filter = filter || (c.proposed ? 'proposed' : 'confirmed');
    var tabs = [['proposed', 'To review'], ['confirmed', 'Confirmed'], ['removed', 'Removed']].map(function (t) {
      return '<button type="button" class="' + (filter === t[0] ? 'on' : '') + '" data-act="filter" data-filter="' + t[0] + '">' +
        esc(t[1]) + ' ' + esc(c[t[0]] || 0) + '</button>';
    }).join('');
    var list = rows.filter(function (r) { return r.status === filter; });
    var body = list.length ? list.map(renderRow).join('') : '<div class="mr-empty">' + esc({
      proposed: c.confirmed ? 'Nothing left to review.' : 'No suggestions yet. Run the search, or add a competitor below.',
      confirmed: 'None confirmed yet. Confirm suggestions you agree with.',
      removed: 'Nothing removed.'
    }[filter]) + '</div>';
    var bulk = filter === 'proposed' && list.length > 1
      ? '<button type="button" class="mr-btn small ok" data-act="confirm-all">Confirm all ' + esc(list.length) + '</button>' : '';
    var tr = tracking || {};
    var failed = run && run.status === 'failed' && !rows.length
      ? '<div class="mr-callout bad"><span>The last search did not finish' + (run.stage ? ' (at: ' + esc(String(run.stage).replace(/_/g, ' ')) + ')' : '') + '. ' +
        esc(run.error || 'No reason was recorded.') + ' Use Search again to retry.</span></div>' : '';
    var banner = failed + (tr.text && tr.mode !== 'none'
      ? '<div class="mr-callout mr-tracking' + (tr.mode === 'all_suggested' ? ' warn' : '') + '">' + esc(tr.text) + '</div>' : '');
    return '<div class="card mr-card"><div class="mr-card-h"><div><h3>Competitors</h3>' +
      '<p>Suggested by the agent, checked against each company\'s own website. Only the ones you confirm are researched: their moves, news and the report.</p></div>' +
      '<div class="mr-actions"><div class="mr-seg" role="tablist">' + tabs + '</div>' + bulk + '</div></div>' +
      banner + '<div class="mr-rows">' + body + '</div>' +
      '<form class="mr-addrow" id="mrAddCompetitor" autocomplete="off"><label class="mr-sr" for="mrCompUrl">Competitor website</label>' +
      '<input type="text" id="mrCompUrl" placeholder="Add a competitor by website, such as rival.com" />' +
      '<select id="mrCompKind" aria-label="Kind of competitor">' + KINDS.map(function (k) {
        return '<option value="' + k[0] + '">' + esc(k[1]) + '</option>';
      }).join('') + '</select><button type="submit" class="mr-btn small">Add</button></form></div>';
  }

  function renderRow(r) {
    var href = siteUrl(r.domain);
    var score = r.score != null ? r.score : (r.confidence != null ? Math.round(r.confidence * 100) : null);
    var meta = [];
    if (score != null) meta.push('<span class="mr-score" title="How closely to watch it, out of 100"><i style="--w:' +
      esc(Math.max(0, Math.min(100, score))) + '%"></i>' + esc(score) + '</span>');
    if (r.distance_km != null) meta.push(esc(Number(r.distance_km).toFixed(1)) + ' km ' +
      (r.near_site ? 'from your ' + esc(r.near_site) + ' site' : 'away') +
      (r.branches_nearby > 1 ? ' (' + esc(r.branches_nearby) + ' branches nearby)' : ''));
    if (r.location) meta.push(esc(r.location));
    if (r.added_by_user) meta.push('Added by you, not checked');
    else if (r.checked_on) meta.push('Checked on ' + esc(r.checked_on));
    var found = (r.found || []).filter(function (x) { return x !== 'added by you'; });
    if (found.length) meta.push('Found: ' + esc(found.slice(0, 3).join('; ')));
    var act;
    if (r.status === 'removed') {
      act = '<button type="button" class="mr-btn small" data-act="status" data-status="proposed" data-id="' + esc(r.entity_id) + '">Restore</button>';
    } else {
      act = '<select data-act="kind" data-id="' + esc(r.entity_id) + '" aria-label="Kind of competitor">' + KINDS.map(function (k) {
        return '<option value="' + k[0] + '"' + (k[0] === r.kind ? ' selected' : '') + '>' + esc(k[1]) + '</option>';
      }).join('') + '</select>' +
        (r.status === 'proposed' ? '<button type="button" class="mr-btn small ok" data-act="status" data-status="confirmed" data-id="' + esc(r.entity_id) + '">Confirm</button>'
          : '<span class="mr-chip ok">Confirmed</span>') +
        '<button type="button" class="mr-btn small bad" data-act="status" data-status="removed" data-id="' + esc(r.entity_id) + '" aria-label="Remove ' + esc(r.name) + '">Remove</button>';
    }
    return '<div class="mr-row ' + esc(r.status) + '">' + mono(r.name || r.domain, r.kind, 'big') +
      '<div class="mr-row-main"><div class="mr-row-top"><b>' + esc(r.name || r.domain) + '</b>' +
      (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(r.domain) + '</a>' : esc(r.domain)) +
      kindChip(r.kind) + '</div>' +
      (r.status === 'proposed' && r.researched === false ? '<div class="mr-hint" style="margin:2px 0 0">Not researched until you confirm it</div>' : '') +
      (r.niche_fit === 'yes' || r.niche_fit === 'adjacent' ? '<div class="mr-hint" style="margin:2px 0 0">' +
        (r.niche_fit === 'yes' ? 'Same niche' : 'Same category, not the same niche') + '</div>' : '') +
      (r.reason ? '<div class="mr-reason">' + esc(r.reason) + '</div>' : (r.sells ? '<div class="mr-reason">' + esc(r.sells) + '</div>' : '')) +
      (meta.length ? '<div class="mr-row-meta">' + meta.join('<span aria-hidden="true">·</span>') + '</div>' : '') +
      '</div><div class="mr-row-act">' + act + '</div></div>';
  }

  // == the last run ==================================================================

  function renderRun(run) {
    if (!run) return '';
    var failed = run.status === 'failed';
    var stats = '<div class="mr-stats">' +
      '<div class="mr-stat"><b>' + esc(failed ? 'Failed' : run.status === 'complete' ? 'Finished' : run.status) + '</b><span>' + esc(when(run.finished_at || run.created_at)) + '</span></div>' +
      (run.seconds != null ? '<div class="mr-stat"><b>' + esc(duration(run.seconds)) + '</b><span>Time taken</span></div>' : '') +
      '<div class="mr-stat"><b>' + esc(money(run.cost_usd)) + '</b><span>Cost' + (run.cost_partial ? ' (at most)' : '') + '</span></div>' +
      (run.checked && run.checked.candidates != null ? '<div class="mr-stat"><b>' + esc(run.checked.judged || 0) + ' of ' + esc(run.checked.candidates) + '</b><span>Candidates checked</span></div>' : '') +
      '</div>';
    var err = failed && run.error ? '<div class="mr-callout bad">' + esc(run.error) + '</div>' : '';
    var srcRows = Object.keys(run.sources || {}).map(function (k) {
      var s = run.sources[k], text;
      if (s.status === 'failed') text = 'Failed: ' + (s.error || 'no reason given');
      else if (s.status === 'skipped' || s.status === 'not_run') text = 'Not used: ' + (s.note || '');
      else if (k === 'places') text = (s.found != null ? s.found + ' places of the same kind within ' + s.radius_km + ' km' : 'Used') + (s.note ? '. ' + s.note : '');
      else if (k === 'search') text = (s.results != null ? s.results + ' results' : 'Used') + (s.status === 'partial' ? ' (some searches failed: ' + (s.error || '') + ')' : '');
      else text = (s.found || 0) + ' found';
      return '<tr><td>' + esc(s.label) + '</td><td>' + esc(text) + '</td></tr>';
    }).join('');
    var unread = (run.unread || []).map(function (u) {
      return '<li><b>' + esc(u.domain) + '</b>: ' + esc(u.why) + '</li>';
    }).join('');
    var gaps = (run.gaps || []).map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('');
    var left = (run.left_out || []).map(function (l) { return '<li><b>' + esc(l.domain) + '</b>: ' + esc(l.why) + '</li>'; }).join('');
    return '<div class="card mr-card"><div class="mr-card-h"><div><h3>Last search</h3><p>Where the suggestions came from, and what could not be checked.</p></div></div>' +
      '<div class="mr-card-b">' + err + stats +
      (srcRows ? '<table class="mr-src"><tbody>' + srcRows + '</tbody></table>' : '') +
      (unread ? '<details class="mr-more" open><summary>Websites that could not be read (' + esc(run.unread.length) + ')</summary>' +
        '<p class="mr-hint">Suggested competitors whose sites refused our reader. They are not on the list because they could not be checked; add any you know are competitors.</p><ul class="mr-list">' + unread + '</ul></details>' : '') +
      (gaps ? '<details class="mr-more"><summary>What this list may miss</summary><ul class="mr-list">' + gaps + '</ul></details>' : '') +
      (left ? '<details class="mr-more"><summary>Considered and left out (' + esc(run.left_out.length) + ')</summary><ul class="mr-list">' + left + '</ul></details>' : '') +
      '</div></div>';
  }

  // == competitor moves (Phase 3) ====================================================

  var MOVES_SHOWN = 25;
  var STATUS_WORD = { ok: 'Read', reused: 'Read earlier', empty: 'Nothing listed', none: 'Not there',
    failed: 'Could not read', skipped: 'Skipped' };
  var TONE = { new_location: 'ok', product_launch: 'ok', hiring_surge: 'ok', new_job_location: 'ok',
    promotion: 'warn', sale_started: 'warn', price_cut: 'warn', price_increase: 'warn',
    closed_location: 'bad', product_removed: 'bad', hiring_slowdown: 'bad', location_list_shrank: 'bad' };

  var SEVERITY = { HIGH: ['bad', 'High'], MEDIUM: ['warn', 'Medium'], LOW: ['', 'Low'] };
  var STATUS_SAYS = { planned: 'Planned', announced: 'Announced', rumored: 'Rumoured' };

  function renderMoveRow(e) {
    var href = safeUrl(e.url);
    var title = href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(e.title) + '</a>' : esc(e.title);
    var sev = SEVERITY[e.severity];
    var tier = e.severity === 'HIGH' ? 'hi' : e.severity === 'MEDIUM' ? 'md' : 'lo';
    return '<li class="mr-move mr-mv ' + tier + '">' + dateBlock(e.date || e.seen) +
      '<div class="mr-move-b"><div class="mr-mv-who">' + mono(e.name, KIND_OF[e.entity_id]) + '<b>' + esc(e.name) + '</b>' +
      (e.place ? '<span class="mr-mv-place">' + PIN + esc(e.place) +
        (e.distance_km != null ? ', ' + esc(Number(e.distance_km).toFixed(1)) + ' km from your nearest site' : '') + '</span>' : '') +
      '</div><div class="mr-move-title">' + title + '</div>' +
      (e.summary ? '<div class="mr-move-sum">' + esc(e.summary) + '</div>' : '') +
      '<div class="mr-move-t">' +
      (sev ? '<span class="mr-chip mr-sev ' + sev[0] + '" title="How much this matters to this client">' + sev[1] + '</span>' : '') +
      '<span class="mr-chip ' + esc(TONE[e.type] || '') + '">' + esc(e.label) + '</span>' +
      (STATUS_SAYS[e.status] ? '<span class="mr-chip">' + STATUS_SAYS[e.status] + '</span>' : '') +
      '<span class="mr-move-src">Seen in: ' + esc((e.detectors || []).join(', ') || 'unknown') +
      (e.articles > 1 ? ' (' + esc(e.articles) + ' articles)' : '') +
      (e.evidence > 1 ? '; ' + esc(e.evidence) + ' independent sources' : '') + '</span></div></div></li>';
  }

  /** Thirteen weeks of moves as stacked bars, high on top: when they moved. */
  function activityChart(events, today) {
    var end = Date.parse((today || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
    var weeks = [];
    for (var i = 0; i < 13; i++) weeks.push({ hi: 0, md: 0, lo: 0 });
    events.forEach(function (e) {
      var t = Date.parse(String(e.date || e.seen || '').slice(0, 10) + 'T00:00:00Z');
      if (isNaN(t) || t > end) return;
      var w = 12 - Math.floor((end - t) / (7 * 864e5));
      if (w < 0) return;
      weeks[w][e.severity === 'HIGH' ? 'hi' : e.severity === 'MEDIUM' ? 'md' : 'lo']++;
    });
    var max = Math.max.apply(null, weeks.map(function (w) { return w.hi + w.md + w.lo; }).concat([1]));
    var W = 320, H = 150, base = 124, bw = 17, gap = (W - 13 * bw) / 12;
    var bars = weeks.map(function (w, i) {
      var x = (i * (bw + gap)).toFixed(1), y = base, out = '';
      [['lo', 'mr-ac-lo'], ['md', 'mr-ac-md'], ['hi', 'mr-ac-hi']].forEach(function (k) {
        if (!w[k[0]]) return;
        var h = Math.max(3, w[k[0]] / max * 104);
        y -= h;
        out += '<rect class="' + k[1] + '" x="' + x + '" y="' + y.toFixed(1) + '" width="' + bw + '" height="' + (h - 1.5).toFixed(1) + '" rx="3"/>';
      });
      var n = w.hi + w.md + w.lo;
      return '<g><rect class="mr-ac-bg" x="' + x + '" y="20" width="' + bw + '" height="' + (base - 20) + '" rx="3"/>' + out +
        '<title>' + (12 - i ? (12 - i) + ' week' + (12 - i > 1 ? 's' : '') + ' ago' : 'This week') + ': ' + n + ' move' + (n === 1 ? '' : 's') + '</title></g>';
    }).join('');
    return '<figure class="mr-fig"><svg class="mr-ac" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Moves per week over the last 13 weeks">' + bars +
      '<text class="mr-pl-q" x="0" y="' + (H - 4) + '">13 weeks ago</text><text class="mr-pl-q" x="' + W + '" y="' + (H - 4) + '" text-anchor="end">This week</text></svg>' +
      '<figcaption class="mr-legend"><span class="h-acc"><i></i>High impact</span><span class="h-cream"><i></i>Medium</span><span class="h-dim"><i></i>Low</span></figcaption></figure>';
  }

  function movesHead(moves, events, ahead, top) {
    var high = events.filter(function (e) { return e.severity === 'HIGH'; }).length;
    var med = events.filter(function (e) { return e.severity === 'MEDIUM'; }).length;
    var by = {};
    events.concat(ahead).forEach(function (e) { by[e.name] = by[e.name] || { n: 0, id: e.entity_id }; by[e.name].n++; });
    var names = Object.keys(by).sort(function (a, b) { return by[b].n - by[a].n; });
    var tracked = (moves.competitors || []).length;
    var last = moves.last_collect || {};
    var h = high ? plural(high, 'move needs', 'moves need') + ' your attention.'
      : top.length ? plural(top.length, 'move is', 'moves are') + ' worth reading first.'
      : events.length ? plural(events.length, 'move') + ', none of them urgent.' : ahead.length ? 'Nothing yet, but moves are coming.' : 'No moves yet.';
    var active = names.slice(0, 3).map(function (n) {
      return '<li>' + mono(n, KIND_OF[by[n].id]) + '<b>' + esc(n) + '</b><em>' + esc(by[n].n) + '</em></li>';
    }).join('');
    return sectHead({
      eye: 'Competitor moves', quiet: !events.length,
      h: h,
      p: events.length || ahead.length ? (names.length + ' of ' + (tracked || names.length) + ' tracked rivals moved' +
        (last.finished_at ? '. Last collected ' + when(last.finished_at) : '') + '.') : 'Nothing differs from the last collection yet.',
      kpis: [[high, 'High impact', 'of ' + events.length + ' moves', 'k-acc'], [med, 'Medium', 'worth a look', 'k-cream'],
        [names.length, 'Rivals moving', tracked ? 'of ' + tracked + ' tracked' : '', 'k-sky'], [ahead.length, 'Coming up', 'dated ahead', 'k-paper']],
      right: activityChart(events, moves.today) + (active ? '<div class="mr-act"><span class="mr-k">Most active</span><ol>' + active + '</ol></div>' : '')
    });
  }

  function renderCollectProgress(run) {
    var stage = (run && run.stage) || '';
    var m = /collect (\d+)\/(\d+)/.exec(stage);
    var text = m ? 'Read ' + m[1] + ' of ' + m[2] + ' competitors'
      : stage === 'radar' ? 'Looking for new businesses nearby and new brands'
      : stage === 'pulse' ? 'Reading the industry news'
      : stage === 'signals' ? 'Reading competitor headlines and ranking the moves'
      : stage === 'report' ? 'Writing the report'
      : stage === 'digest' ? 'Writing the weekly update' : 'Starting';
    return '<div class="mr-callout">' + esc(text) + '… This runs in the background; you can leave the page.</div>';
  }

  function renderMoves(moves, collectRun, tab) {
    if (!moves) return '';
    var running = collectRun && collectRun.status === 'running' && !collectRun.stale;
    var last = moves.last_collect;
    var head = '<div class="mr-card-h"><div><h3>Competitor moves</h3><p>What competitors changed on their websites, ' +
      'shops and job boards, and what the news said, read the same way each time so the difference is the news.</p></div>' +
      '<button type="button" class="mr-btn" data-act="collect"' + (running ? ' disabled' : '') + '>' +
      (running ? 'Collecting…' : last ? 'Collect again' : 'Collect now') + '</button></div>';
    var body = '';
    if (moves.tracking && moves.tracking.text) {
      body += '<div class="mr-callout info">' + esc(moves.tracking.text) + '</div>';
    }
    if (running) body += renderCollectProgress(collectRun);
    if (!last && !running) {
      body += '<div class="mr-empty"><b>Nothing collected yet</b>Collecting is free (no paid search) and takes 2 to 6 minutes. ' +
        'The first collection stores what each competitor shows today; changes appear from the second one on.</div>';
      return '<div class="card mr-card" id="mrMoves">' + head + '<div class="mr-card-b">' + body + '</div></div>';
    }
    if (last && last.status === 'failed') body += '<div class="mr-callout bad">The last collection failed: ' + esc(last.error || 'no reason given') + '</div>';
    var events = moves.events || [];
    var byId = {};
    events.forEach(function (e) { byId[e.id] = e; });
    var top = (moves.top || []).map(function (id) { return byId[id]; }).filter(Boolean);
    // A launch or opening the news dates ahead ("releases 23 October") is
    // not the newest move: it gets its own list, soonest first.
    var today = moves.today || new Date().toISOString().slice(0, 10);
    var ahead = events.filter(function (e) { return e.date && e.date > today; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    events = events.filter(function (e) { return !(e.date && e.date > today); });
    // Three tabs: the few that matter, every move, and what was read.
    var hi = '', all = '', read = '';
    if (top.length) {
      hi += '<h4 class="mr-sub">Most important</h4><ul class="mr-moves mr-top">' + top.map(renderMoveRow).join('') + '</ul>';
    }
    if (ahead.length) {
      hi += '<h4 class="mr-sub">Coming up</h4><ul class="mr-moves">' + ahead.map(renderMoveRow).join('') + '</ul>';
    }
    if ((top.length || ahead.length) && events.length) all += '<h4 class="mr-sub">All moves, newest first</h4>';
    if (events.length) {
      all += '<ul class="mr-moves">' + events.slice(0, MOVES_SHOWN).map(renderMoveRow).join('') + '</ul>';
      if (events.length > MOVES_SHOWN) {
        all += '<details class="mr-more"><summary>' + esc(events.length - MOVES_SHOWN) + ' earlier moves</summary>' +
          '<ul class="mr-moves">' + events.slice(MOVES_SHOWN).map(renderMoveRow).join('') + '</ul></details>';
      }
    } else if (last && last.status === 'complete' && !ahead.length) {
      all += '<div class="mr-empty"><b>No moves yet</b>' + (moves.competitors || []).length + ' competitors are tracked. ' +
        'A move appears when something differs from the previous collection, or when a source dates it in the last 90 days.</div>';
    }
    if (last && last.coverage && last.coverage.length) {
      read += '<details class="mr-more" open><summary>What was read' +
        (last.finished_at ? ' (' + esc(when(last.finished_at)) + ')' : '') + '</summary><ul class="mr-list">' +
        last.coverage.map(function (c) { return '<li>' + esc(c.text) + '</li>'; }).join('') + '</ul>' +
        (last.left_out ? '<p class="mr-hint">' + esc(last.left_out) + ' more competitors were not collected: at most 12 are, confirmed ones first.</p>' : '') +
        (last.news_breaker_open ? '<p class="mr-hint">Google News stopped answering during this collection; some news was not read.</p>' : '') +
        (last.signals_note ? '<p class="mr-hint">' + esc(last.signals_note) + '.</p>' : '') +
        (last.demoted ? '<p class="mr-hint">' + esc(last.demoted) + ' moves scored High were shown as Medium, so High stays for the few that matter most.</p>' : '') +
        '</details>';
    }
    if (moves.hidden && moves.hidden.length) {
      read += '<details class="mr-more"><summary>Left out as not moves (' + esc(moves.hidden_count || moves.hidden.length) + ')</summary><ul class="mr-list">' +
        moves.hidden.map(function (h) {
          var href = safeUrl(h.url);
          var t = href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(h.title) + '</a>' : esc(h.title);
          return '<li><b>' + esc(h.name) + '</b>: ' + t + ' <span class="mr-hint">' +
            esc([h.publisher, h.date, h.why].filter(Boolean).join(', ')) + '</span></li>';
        }).join('') + '</ul></details>';
    }
    if (last && last.companies && last.companies.length) {
      read += '<details class="mr-more"><summary>Per competitor</summary>' + last.companies.map(function (c) {
        var rows = (c.rows || []).map(function (r) {
          return '<tr><td>' + esc(r.label) + '</td><td class="mr-st ' + esc(r.status) + '">' + esc(STATUS_WORD[r.status] || r.status) +
            '</td><td>' + esc(r.note || '') + '</td></tr>';
        }).join('');
        var site = c.site && c.site.status !== 'ok' ? '<p class="mr-hint">Website: ' + esc(c.site.note || c.site.status) + '</p>' : '';
        return '<div class="mr-trk"><h4>' + esc(c.name) + ' <span>' + esc(c.domain) + '</span></h4>' + site +
          '<table class="mr-src mr-trk-t"><tbody>' + rows + '</tbody></table></div>';
      }).join('') + '</details>';
    }
    var keys = [hi && 'top', all && 'all', read && 'read'].filter(Boolean);
    var on = pick(tab, keys);
    var lead = last ? movesHead(moves, events, ahead, top) : '';
    if (keys.length > 1) {
      body += tabs('moves', [['top', 'Highlights', top.length + ahead.length], ['all', 'All moves', events.length], ['read', 'What was read']]
        .filter(function (t) { return keys.indexOf(t[0]) >= 0; }), on) +
        (hi ? pane('moves', 'top', on, hi) : '') + pane('moves', 'all', on, all) + (read ? pane('moves', 'read', on, read) : '');
    } else {
      body += hi + all + read;
    }
    return '<div class="mr-ov">' + lead + '<div class="card mr-card" id="mrMoves">' + head + '<div class="mr-card-b">' + body + '</div></div></div>';
  }

  // == nearby and new (Phase 4) =======================================================

  function radarChip(f) {
    if (f.certain === false) return '<span class="mr-chip">Possibly new</span>';
    if (f.status === 'planned') return '<span class="mr-chip warn">Coming soon</span>';
    return '<span class="mr-chip ok">New</span>';
  }

  function renderFinding(f, local) {
    var href = safeUrl(f.website);
    var name = href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(f.name) + '</a>' : esc(f.name);
    var where = local
      ? [String(f.category || '').replace(/_/g, ' '), f.distance_km != null ? f.distance_km + ' km ' + (f.near ? 'from your ' + f.near + ' site' : 'away') : '', f.address].filter(Boolean).join(' · ')
      : [f.location, f.reason].filter(Boolean).join(' · ');
    var tier = f.certain === false ? 'lo' : f.status === 'planned' ? 'soon' : 'hi';
    var face = local && f.distance_km != null
      ? '<span class="mr-km" title="Distance from your nearest site"><b>' + esc(Number(f.distance_km) < 10 ? Number(f.distance_km).toFixed(1) : Math.round(f.distance_km)) +
        '</b><small>km</small></span>'
      : mono(f.name, 'ink');
    return '<li class="mr-move mr-mv mr-fd ' + tier + '">' + dateBlock(f.date) + '<div class="mr-move-b"><div class="mr-fd-h">' + face +
      '<div class="mr-fd-m"><div class="mr-move-t">' + radarChip(f) + '<b>' + name + '</b>' +
      (f.is_competitor ? '<span class="mr-chip acc">On your competitor list</span>' : '') + '</div>' +
      (where ? '<div class="mr-move-sum">' + esc(where) + '</div>' : '') + '</div></div>' +
      ((f.evidence || []).length ? '<ul class="mr-ev">' + f.evidence.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '') +
      '</div></li>';
  }

  function renderHeadlines(items, title) {
    if (!items || !items.length) return '';
    return '<details class="mr-more"><summary>' + esc(title) + ' (' + esc(items.length) + ')</summary><ul class="mr-list">' +
      items.map(function (h) {
        var href = safeUrl(h.link);
        var t = href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(h.title) + '</a>' : esc(h.title);
        return '<li>' + t + ' <span class="mr-hint">' + esc([h.publisher, h.date].filter(Boolean).join(', ')) + '</span></li>';
      }).join('') + '</ul></details>';
  }

  /** How a part was searched: the note is "Site: ...; Site: ...", one line per site. */
  function searchedNote(part) {
    var bits = String(part.note || '').split(/;\s+(?=[A-Z][^:;]{1,40}:)/).filter(Boolean);
    if (!bits.length) return part.reused ? '<p class="mr-hint">From a scan in the last day.</p>' : '';
    return '<details class="mr-more mr-how"><summary>How it was searched' + (part.reused ? ' (a scan from the last day)' : '') + '</summary>' +
      '<ul class="mr-list">' + bits.map(function (b) {
        var m = /^([^:]{1,40}):\s*(.*)$/.exec(b);
        return '<li>' + (m ? '<b>' + esc(m[1]) + '</b>: ' + esc(m[2]) : esc(b)) + '</li>';
      }).join('') + '</ul></details>';
  }

  function renderRadarPart(part, local) {
    if (!part) return '';
    var head = '<h4 class="mr-sub">' + (local ? 'New businesses like this one nearby' : 'New brands in this category') + '</h4>';
    if (part.status !== 'ok') return head + '<p class="mr-hint">' + esc(part.note || 'Not run.') + '</p>';
    var f = part.findings || [];
    return head + (f.length ? '<ul class="mr-moves">' + f.map(function (x) { return renderFinding(x, local); }).join('') + '</ul>'
        : '<div class="mr-empty"><b>Nothing new found</b>' + (local ? 'No business of this kind nearby shows a sign of having just opened.' : 'No new brand was confirmed this time.') + '</div>') +
      searchedNote(part) +
      renderHeadlines(part.news, local ? 'Local opening news' : 'Launch news read') +
      (part.left_out && part.left_out.length ? '<details class="mr-more"><summary>Considered and left out (' + esc(part.left_out.length) +
        ')</summary><ul class="mr-list">' + part.left_out.map(function (l) {
          return '<li><b>' + esc(l.name) + '</b>' + (l.domain && l.domain !== l.name ? ' <span class="mr-hint">' + esc(l.domain) + '</span>' : '') + ': ' + esc(l.why) + '</li>';
        }).join('') + '</ul></details>' : '');
  }

  /** New places around the client: distance to scale, direction not. */
  function proximityPlot(findings) {
    var pts = (findings || []).filter(function (f) { return f.distance_km != null; });
    if (!pts.length) return '';
    var S = 300, C = S / 2, R = C - 22;
    var far = Math.max.apply(null, pts.map(function (f) { return Number(f.distance_km); }));
    var scale = [1, 2, 5, 10, 15, 20, 25, 50, 100].filter(function (k) { return k >= far; })[0] || Math.ceil(far);
    var rings = [1, 2, 3, 4].map(function (i) {
      var r = 22 + (R - 22) * i / 4;
      return '<circle cx="' + C + '" cy="' + C + '" r="' + r.toFixed(1) + '" class="mr-pl-ring"/>' +
        (i % 2 === 0 ? '<text class="mr-pl-q" x="' + (C + 4) + '" y="' + (C - r - 4).toFixed(1) + '">' + esc(+(scale * i / 4).toFixed(1)) + ' km</text>' : '');
    }).join('');
    var placed = [];
    var dots = pts.map(function (f) {
      var a = (hashOf(f.name) % 360) * Math.PI / 180, d = 22 + Math.min(1, Number(f.distance_km) / scale) * (R - 22);
      var x = C + Math.sin(a) * d, y = C - Math.cos(a) * d;
      var hue = f.certain === false ? 'cream' : f.status === 'planned' ? 'sky' : 'ok';
      var lab = '';
      if (placed.length < 4 && !placed.some(function (q) { return Math.abs(q[1] - y) < 15 && Math.abs(q[0] - x) < 120; })) {
        placed.push([x, y]);
        var nm = String(f.name || '');
        lab = '<text class="mr-pl-lab" x="' + (x + (x > C ? 10 : -10)).toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="' + (x > C ? 'start' : 'end') + '">' +
          esc(nm.length > 18 ? nm.slice(0, 17) + '…' : nm) + '</text>';
      }
      return '<g class="mr-pl-b h-' + hue + '"><circle class="mr-pl-dot" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="6"/>' + lab +
        '<title>' + esc(f.name) + ' · ' + esc(f.distance_km) + ' km' + (f.near ? ' from your ' + esc(f.near) + ' site' : '') + '</title></g>';
    }).join('');
    return '<figure class="mr-fig"><svg class="mr-plot mr-prox" viewBox="0 0 ' + S + ' ' + S + '" role="img" aria-label="' + esc(pts.length) +
      ' new places by distance from your sites">' + rings + dots + '<circle cx="' + C + '" cy="' + C + '" r="8" class="mr-pl-you"/><circle cx="' + C + '" cy="' + C +
      '" r="15" class="mr-pl-you2"/></svg><figcaption class="mr-legend"><span class="h-ok"><i></i>New</span><span class="h-sky"><i></i>Coming soon</span>' +
      '<span class="h-cream"><i></i>Possibly new</span><span class="open">Distance to scale, direction not</span></figcaption></figure>';
  }

  function radarHead(radar) {
    var loc = (radar.local || {}).findings || [], ent = (radar.entrants || {}).findings || [];
    var sure = loc.filter(function (f) { return f.certain !== false; }).length, maybe = loc.length - sure;
    var near = loc.filter(function (f) { return f.distance_km != null; })
      .sort(function (a, b) { return a.distance_km - b.distance_km; })[0];
    var h = sure ? plural(sure, 'new business', 'new businesses') + ' like this one near you.'
      : loc.length ? plural(loc.length, 'place', 'places') + ' nearby may be new.'
      : ent.length ? plural(ent.length, 'new brand') + ' entering the category.' : 'Nothing new nearby.';
    return sectHead({
      eye: 'Nearby and new', quiet: !loc.length && !ent.length, h: h,
      p: 'Each one is listed only with a sign that it is really new: a fresh website, an opening notice or the chain\'s own store list.',
      kpis: [[sure, 'New nearby', 'with a clear sign', 'k-acc'], [maybe, 'Possibly new', 'a weaker sign', 'k-cream'],
        [ent.length, 'New brands', 'in the category', 'k-sky'],
        [near ? (Number(near.distance_km) < 10 ? Number(near.distance_km).toFixed(1) : Math.round(near.distance_km)) + ' km' : '–', 'Nearest', near ? near.name : 'nothing nearby', 'k-paper']],
      right: proximityPlot(loc)
    });
  }

  function renderRadar(radar, tab) {
    if (!radar) return '';
    var body = '';
    if (radar.error) body += '<div class="mr-callout bad">The radar failed: ' + esc(radar.error) + '</div>';
    if (radar.skipped) body += '<p class="mr-hint">' + esc(radar.skipped) + '</p>';
    if (radar.local && radar.entrants) {
      var on = pick(tab, ['local', 'entrants']);
      body += tabs('nearby', [['local', 'Near your sites', (radar.local.findings || []).length],
        ['entrants', 'New brands', (radar.entrants.findings || []).length]], on) +
        pane('nearby', 'local', on, renderRadarPart(radar.local, true)) +
        pane('nearby', 'entrants', on, renderRadarPart(radar.entrants, false));
    } else {
      body += renderRadarPart(radar.local, true) + renderRadarPart(radar.entrants, false);
    }
    var lead = radar.local || radar.entrants ? radarHead(radar) : '';
    return '<div class="mr-ov">' + lead + '<div class="card mr-card" id="mrRadar"><div class="mr-card-h"><div><h3>Nearby and new</h3>' +
      '<p>Businesses like this one that opened or are about to open nearby, and new brands entering its category. ' +
      'The reasons are under each name.</p></div></div>' +
      '<div class="mr-card-b">' + body + '</div></div></div>';
  }

  // == industry pulse (Phase 5) =======================================================

  var COUNTRY_NAME = { US: 'United States', GB: 'United Kingdom', DE: 'Germany', IN: 'India', AU: 'Australia',
    CA: 'Canada', IE: 'Ireland', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', BR: 'Brazil' };

  function renderArticle(a) {
    var href = safeUrl(a.link);
    var t = href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(a.title) + '</a>' : esc(a.title);
    return '<li>' + t + ' <span class="mr-hint">' + esc([a.publisher, a.date].filter(Boolean).join(', ')) + '</span></li>';
  }

  // Each kind of theme keeps one colour, on its card and in the head's chart.
  var THEME_HUE = { regulation: 'sky', workforce: 'acc', costs_and_prices: 'cream', demand: 'ok', competition_and_deals: 'asp',
    technology: 'ink', supply: 'clay', other: 'dim' };
  var THEME_ICON = {
    regulation: '<path d="M12 3v18M5 7h14M7 7l-3 7h6zM17 7l-3 7h6z"/>',
    workforce: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M17 11a2.6 2.6 0 1 0 0-5.2M21 20a5 5 0 0 0-4-4.9"/>',
    costs_and_prices: '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
    demand: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    competition_and_deals: '<path d="M8 12l3 3 5-6"/><path d="M3 12l4-4 3 2 4-4 3 3 4 3-7 7z"/>',
    technology: '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    supply: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16h.01"/>'
  };
  function themeKind(k) { return THEME_HUE[k] ? k : 'other'; }

  function renderTheme(t) {
    var n = (t.articles || []).length + (t.more || 0), kind = themeKind(t.kind);
    var pubs = [];
    (t.articles || []).forEach(function (a) { if (a.publisher && pubs.indexOf(a.publisher) < 0) pubs.push(a.publisher); });
    return '<li class="mr-theme h-' + THEME_HUE[kind] + '"><div class="mr-theme-top"><span class="mr-theme-ic" aria-hidden="true"><svg viewBox="0 0 24 24">' +
      THEME_ICON[kind] + '</svg></span><span class="mr-chip">' + esc(t.kind_label) + '</span>' +
      (t.latest ? '<span class="mr-theme-d">' + esc(t.latest) + '</span>' : '') + '</div>' +
      '<h5 class="mr-theme-h">' + esc(t.title) + '</h5>' +
      '<p class="mr-theme-sum">' + esc(t.summary) + '</p>' +
      (t.why_it_matters ? '<p class="mr-theme-why"><b>Why it matters:</b> ' + esc(t.why_it_matters) + '</p>' : '') +
      '<div class="mr-theme-f">' + (pubs.length ? '<span class="mr-pubs" aria-hidden="true">' + pubs.slice(0, 4).map(function (pb) {
        return '<i title="' + esc(pb) + '">' + esc((String(pb).match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase()) + '</i>';
      }).join('') + '</span>' : '') +
      '<details class="mr-more"><summary>' + esc(n) + ' articles from ' + esc(t.publishers) + ' publisher' + (t.publishers === 1 ? '' : 's') +
      (t.latest ? ', latest ' + esc(t.latest) : '') + '</summary><ul class="mr-list">' +
      (t.articles || []).map(renderArticle).join('') + '</ul>' +
      (t.more ? '<p class="mr-hint">and ' + esc(t.more) + ' more</p>' : '') + '</details></div></li>';
  }

  /** The kinds of theme this month, as bars: what the industry is talking about. */
  function themeMix(markets) {
    var by = {}, labels = {};
    markets.forEach(function (m) {
      (m.themes || []).forEach(function (t) {
        var k = themeKind(t.kind);
        by[k] = (by[k] || 0) + 1;
        labels[k] = t.kind_label || k;
      });
    });
    var keys = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
    if (!keys.length) return '';
    var max = by[keys[0]];
    return '<div class="mr-mix"><span class="mr-k">What the news is about</span><ul>' + keys.map(function (k) {
      return '<li class="h-' + THEME_HUE[k] + '"><span>' + esc(labels[k]) + '</span><i><em style="width:' + Math.round(by[k] / max * 100) + '%"></em></i><b>' +
        esc(by[k]) + '</b></li>';
    }).join('') + '</ul></div>';
  }

  function pulseHead(pulse) {
    var markets = pulse.markets || [];
    var themes = 0, read = 0, pubs = {}, asked = 0, answered = 0;
    markets.forEach(function (m) {
      themes += (m.themes || []).length;
      read += Number(m.articles) || 0;
      (m.themes || []).forEach(function (t) { (t.articles || []).forEach(function (a) { if (a.publisher) pubs[a.publisher] = 1; }); });
      (m.queries || []).forEach(function (q) { asked++; if (q.status === 'ok') answered++; });
    });
    var lab = (markets.filter(function (m) { return m.label; })[0] || {}).label;
    var where = markets.filter(function (m) { return m.status && m.status !== 'not_read'; })
      .map(function (m) { return COUNTRY_NAME[m.country] || m.country; });
    return sectHead({
      eye: 'Industry pulse', quiet: !themes,
      h: themes ? plural(themes, 'theme') + ' moving the industry this month.' : 'No clear themes this month.',
      p: (lab ? lab + ': ' : '') + (where.length ? 'read from the news in ' + where.join(', ') + '. Every theme rests on at least two articles.'
        : 'the news is read with the next collection.'),
      kpis: [[themes, 'Themes', 'each backed by 2+ articles', 'k-acc'], [read || '–', 'Headlines read', 'in the last month', 'k-paper'],
        [Object.keys(pubs).length || '–', 'Publishers', 'cited in the themes', 'k-sky'],
        [asked ? answered + '/' + asked : '–', 'Searches answered', markets.length > 1 ? 'across ' + markets.length + ' markets' : '', 'k-cream']],
      right: themeMix(markets)
    });
  }

  function renderPulseMarket(m) {
    var name = COUNTRY_NAME[m.country] || m.country;
    var head = '<h4 class="mr-sub">' + esc(name) + (m.label ? ': ' + esc(m.label) : '') + '</h4>';
    if (m.status === 'not_read') return head + '<p class="mr-hint">Not read yet. It is read with the next collection.</p>';
    var body = '<p class="mr-hint">' + esc(m.note || '') + (m.read_at ? ' Read ' + esc(when(m.read_at)) + '.' : '') + '</p>';
    if (m.status === 'failed') return head + '<div class="mr-callout bad">The industry news could not be read. ' + esc(m.note || '') + '</div>';
    var themes = m.themes || [];
    body += themes.length ? '<ul class="mr-themes">' + themes.map(renderTheme).join('') + '</ul>'
      : '<div class="mr-empty"><b>No themes</b>' + (m.status === 'partial' ? 'The headlines were read but could not be grouped this time; they are listed below.'
        : 'The headlines of the last ' + esc(m.window_days || 30) + ' days did not add up to a theme.') + '</div>';
    if (m.regulation && m.regulation.length) {
      body += '<details class="mr-more" open><summary>US federal rules naming this industry (' + esc(m.regulation.length) + ')</summary><ul class="mr-list">' +
        m.regulation.map(function (d) {
          return renderArticle({ title: d.type + ': ' + d.title, link: d.link, publisher: d.agency, date: d.date });
        }).join('') + '</ul></details>';
    } else if (m.regulation_note) {
      body += '<p class="mr-hint">Federal Register: ' + esc(m.regulation_note) + '.</p>';
    }
    if (m.other_headlines && m.other_headlines.length) {
      body += '<details class="mr-more"><summary>Other headlines (' + esc(m.other_headlines.length) + ')</summary><ul class="mr-list">' +
        m.other_headlines.map(renderArticle).join('') + '</ul></details>';
    }
    if (m.queries && m.queries.length) {
      body += '<details class="mr-more"><summary>What was searched</summary><ul class="mr-list">' +
        m.queries.map(function (q) {
          return '<li>' + esc(q.query) + ': ' + (q.status === 'ok' ? esc(q.kept) + ' kept of ' + esc(q.items)
            : '<span class="mr-st failed">not read</span> ' + esc(q.note || '')) + '</li>';
        }).join('') + '</ul>' +
        (m.feeds && m.feeds.length ? '<p class="mr-hint">Trade publications read directly: ' + esc(m.feeds.join(', ')) + '.</p>' : '') +
        '</details>';
    }
    return head + body;
  }

  function renderPulse(pulse, tab) {
    if (!pulse) return '';
    var body = '';
    if (pulse.skipped) body += '<p class="mr-hint">' + esc(pulse.skipped) + '</p>';
    var markets = pulse.markets || [];
    if (markets.length > 1) {
      var keys = markets.map(function (m) { return String(m.country); });
      var on = pick(tab, keys);
      body += tabs('pulse', markets.map(function (m) {
        return [String(m.country), COUNTRY_NAME[m.country] || m.country, (m.themes || []).length];
      }), on) + markets.map(function (m) { return pane('pulse', String(m.country), on, renderPulseMarket(m)); }).join('');
    } else {
      body += markets.map(renderPulseMarket).join('');
    }
    var lead = markets.length ? pulseHead(pulse) : '';
    return '<div class="mr-ov">' + lead + '<div class="card mr-card" id="mrPulse"><div class="mr-card-h"><div><h3>Industry pulse</h3>' +
      '<p>What the news says about this industry in each market this month, grouped into themes. ' +
      'Every theme rests on at least two articles, listed under it.</p></div></div>' +
      '<div class="mr-card-b">' + body + '</div></div></div>';
  }

  // == weekly update (Phase 8) =========================================================

  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var SENT = { sent: ['ok', 'Sent'], failed: ['bad', 'Failed'], not_configured: ['warn', 'Not set up on the server'], not_set_up: ['', 'Not used'] };

  function deliveryChip(name, d) {
    if (!d) return '';
    var s = SENT[d.status] || ['', d.status];
    return '<span class="mr-chip ' + s[0] + '" title="' + esc(d.error || (d.to || []).join(', ') || d.channel || '') + '">' + esc(name) + ': ' + esc(s[1]) + '</span>';
  }

  function renderUpdate(u) {
    var st = u.status === 'quiet' ? 'Quiet week' : u.status === 'failed' ? 'Not written'
      : u.status === 'unread' ? 'Nothing could be read' : (u.items || []).length + ' changes';
    return '<li class="mr-move"><div class="mr-move-when">' + esc(when(u.created_at)) + '</div><div class="mr-move-b">' +
      '<div class="mr-move-t"><b>' + esc(st) + '</b>' + deliveryChip('Email', (u.delivery || {}).email) + deliveryChip('Slack', (u.delivery || {}).slack) +
      (u.delivery && u.delivery.at ? '' : '<span class="mr-chip">Preview, not sent</span>') + '</div>' +
      (u.headline ? '<div class="mr-move-title">' + esc(u.headline) + '</div>' : '') +
      (u.note ? '<div class="mr-move-sum">' + esc(u.note) + '</div>' : '') +
      ((u.gaps || []).length ? '<div class="mr-move-sum">Not read: ' + u.gaps.map(esc).join(' ') + '</div>' : '') +
      ((u.items || []).length ? '<details class="mr-more"><summary>What it said</summary><ol class="mr-list">' + u.items.map(function (i) {
        return '<li>' + esc(i.text) + (i.so_what ? ' <span class="mr-hint">So what: ' + esc(i.so_what) + '</span>' : '') + '</li>';
      }).join('') + '</ol>' + (u.removed ? '<p class="mr-hint">' + esc(u.removed) + ' lines were removed by the fact check.</p>' : '') + '</details>' : '') +
      '</div></li>';
  }

  function renderMonitor(m, collectRun) {
    if (!m) return '';
    var running = collectRun && collectRun.status === 'running' && !collectRun.stale;
    var warn = [];
    if (!m.scheduler) warn.push('The schedule is switched off on this server, so updates only go out when you press "Send an update now".');
    if (!m.senders.email) warn.push('Email is not set up on the server, so emails cannot be sent.');
    if (m.slack_channel && !m.senders.slack) warn.push('Slack is not set up on the server, so Slack messages cannot be sent.');
    if (m.last_error) warn.push('The last scheduled update did not start: ' + m.last_error);
    var hours = '';
    for (var h = 0; h < 24; h++) hours += '<option value="' + h + '"' + (h === m.hour ? ' selected' : '') + '>' + (h < 10 ? '0' : '') + h + ':00 UTC</option>';
    var form = '<form id="mrMonitorForm" class="mr-mon">' +
      '<label class="mr-mon-on"><input type="checkbox" name="enabled"' + (m.enabled ? ' checked' : '') + '> Send a weekly update</label>' +
      '<label>Day <select name="weekday">' + DAYS.map(function (d, i) { return '<option value="' + i + '"' + (i === m.weekday ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></label>' +
      '<label>Time <select name="hour">' + hours + '</select></label>' +
      '<label class="mr-mon-wide">Email to <input type="text" name="email" value="' + esc((m.email || []).join(', ')) + '" placeholder="name@company.com, another@company.com"></label>' +
      '<label class="mr-mon-wide">Slack channel <input type="text" name="slack_channel" value="' + esc(m.slack_channel) + '" placeholder="Optional: a channel id such as C0123ABCD"></label>' +
      '<div class="mr-form-foot"><span class="mr-hint">' + (m.enabled && m.next ? 'Next update: ' + esc(when(m.next)) + '.' : 'Off: nothing is sent on a schedule.') + '</span>' +
      '<button type="submit" class="mr-btn primary">Save</button></div></form>';
    var head = '<div class="mr-card-h"><div><h3>Weekly update</h3><p>Once a week the competitors are collected again and a short "what changed since last time" update is written, fact-checked and sent. About $0.05 a week.</p></div>' +
      '<div class="mr-actions"><button type="button" class="mr-btn" data-act="update-preview"' + (running ? ' disabled' : '') + '>Preview</button>' +
      '<button type="button" class="mr-btn" data-act="update-now"' + (running ? ' disabled' : '') + '>Send an update now</button></div></div>';
    var body = warn.map(function (w) { return '<div class="mr-callout warn">' + esc(w) + '</div>'; }).join('') + form;
    body += (m.updates || []).length ? '<h4 class="mr-sub">Recent updates</h4><ul class="mr-moves">' + m.updates.map(renderUpdate).join('') + '</ul>'
      : '<p class="mr-hint">No update has been written yet.</p>';
    return '<div class="card mr-card" id="mrMonitor">' + head + '<div class="mr-card-b">' + body + '</div></div>';
  }

  function renderHead(view, running) {
    var c = view.client || {}, p = view.profile || {}, f = p.fields || {};
    var href = siteUrl(c.domain);
    var where = (p.sites || []).length > 1 ? p.sites.length + ' sites'
      : f['hq.city'] ? [f['hq.city'], f['hq.country_code']].filter(Boolean).join(', ') : '';
    return '<div class="mr-head">' + mono(f.name || c.name || c.domain, 'direct', 'xl') + '<div class="mr-head-m"><div class="eyebrow">Market Radar</div><h2>' +
      esc(f.name || c.name || c.domain) + '</h2><div class="mr-head-sub">' +
      (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(c.domain) + '</a>' : esc(c.domain)) +
      (f.archetype ? '<span class="mr-chip">' + esc(label(ARCHETYPES, f.archetype)) + '</span>' : '') +
      (where ? '<span class="mr-chip">' + esc(where) + '</span>' : '') +
      '</div></div><div class="mr-actions"><a class="mr-btn primary hot" href="' + REPORT + encodeURIComponent(c.id) + '">Open the report' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" class="mr-ico s"><path d="M7 17L17 7M9 7h8v8"/></svg></a>' +
      '<button type="button" class="mr-btn" data-act="run"' + (running ? ' disabled' : '') + '>' +
      (running ? 'Running…' : 'Search again') + '</button></div></div>';
  }

  function panel(key, active, html) {
    return '<section class="mr-panel" data-panel="' + key + '" id="mr-p-' + key + '"' + (key === active ? '' : ' hidden') + '>' + html + '</section>';
  }
  function waiting(title, text) {
    return '<div class="card mr-card"><div class="mr-card-h"><div><h3>' + esc(title) + '</h3></div></div><div class="mr-empty">' + text + '</div></div>';
  }

  // == rival cards ====================================================================
  //
  // Every rival on one card: is it speeding up, what is known about it (each fact with where it came
  // from), what to watch, its biggest recent moves. All from stored readings (tracker/market_radar_insight).

  var MOMENTUM = { speeding_up: ['hot', 'Speeding up'], steady: ['', 'Steady'], slowing: ['warn', 'Slowing'], quiet: ['off', 'Quiet'] };
  var HEAT = { heating_up: 'The field is heating up', cooling: 'The field is cooling down', steady: 'The field is steady', quiet: 'The field is quiet' };
  var PATTERN_ICON = { launching: '&#9889;', pricing: '$', expanding: '&#9906;', hiring: '&#9733;', reshaping: '&#8644;',
    under_pressure: '&#9660;', hiring_focus: '&#9733;', shared_tools: '&#9881;', apps: '&#9635;' };

  function rivalCard(c) {
    var m = MOMENTUM[(c.momentum || {}).label] || MOMENTUM.steady;
    var site = siteUrl(c.domain);
    var facts = (c.facts || []).map(function (f) {
      return '<div class="mr-rc-f"><dt>' + esc(f.label) + '</dt><dd>' + esc(f.value) + '</dd><small>' + esc(f.source) + '</small></div>';
    }).join('');
    var moves = (c.moves || []).map(function (e) {
      var href = safeUrl(e.url), sev = SEVERITY[e.severity] || SEVERITY.LOW;
      return '<li>' + dateBlock(e.date) + '<div><span class="mr-chip ' + sev[0] + '">' + esc(sev[1]) + '</span> ' +
        (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(e.title) + '</a>' : esc(e.title)) + '</div></li>';
    }).join('');
    var watch = (c.watch || []).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
    var h = c.hiring;
    var buzz = c.buzz ? '<p class="mr-rc-buzz"><b>On Hacker News</b> ' + esc(c.buzz.title) + ' <em>' + esc(c.buzz.points) + ' points</em></p>' : '';
    return '<article class="mr-rc mr-rc--' + esc((c.momentum || {}).label || 'steady') + '" data-domain="' + esc(c.domain) + '">' +
      '<header class="mr-rc-h">' + mono(c.name, c.kind) + '<div class="mr-rc-n"><b>' +
      (site ? '<a href="' + esc(site) + '" target="_blank" rel="noopener noreferrer">' + esc(c.name) + '</a>' : esc(c.name)) + '</b><span>' +
      esc(c.domain) + '</span></div><span class="mr-mom ' + m[0] + '">' + esc(m[1]) + '</span></header>' +
      (c.sells ? '<p class="mr-rc-sells">' + esc(c.sells) + '</p>' : '') +
      (c.kind ? '<div class="mr-rc-tags">' + kindChip(c.kind) + (h && h.open ? '<span class="mr-chip">' + esc(h.open) + ' open roles</span>' : '') + '</div>' : '') +
      (watch ? '<div class="mr-rc-watch"><span class="mr-k">Watch</span><ul>' + watch + '</ul></div>' : '') +
      (facts ? '<dl class="mr-rc-facts">' + facts + '</dl>' : '<p class="mr-rc-none">No public facts found yet. Collect again, or this company keeps little public data.</p>') +
      buzz +
      (moves ? '<div class="mr-rc-moves"><span class="mr-k">Biggest recent moves</span><ul>' + moves + '</ul></div>'
        : '<p class="mr-rc-none">No scored moves yet.</p>') + '</article>';
  }

  function renderRivals(r) {
    if (!r) return null;
    var cards = r.rivals || [];
    if (!cards.length) {
      return '<div class="card mr-card"><div class="mr-card-h"><div><h3>Rival cards</h3></div></div><div class="mr-empty"><b>No rivals yet</b>' +
        'Confirm the rivals you agree with, then collect their moves.</div></div>';
    }
    var c = r.counts || {}, pats = r.patterns || [];
    var right = pats.length ? '<div class="mr-idc mr-pat"><span class="mr-k">What several rivals are doing at once</span><ul>' + pats.map(function (p) {
      return '<li><i>' + (PATTERN_ICON[p.kind] || '&bull;') + '</i><div><b>' + esc(p.text) + '</b>' +
        ((p.rivals || []).length ? '<small>' + esc(p.rivals.join(', ')) + '</small>' : '') + '</div></li>';
    }).join('') + '</ul></div>' : '';
    var heat = (r.heat || {}).label;
    return '<div class="mr-ov">' + sectHead({
      eye: 'Rival cards', quiet: !c.speeding_up, h: HEAT[heat] || 'The field',
      p: c.speeding_up ? plural(c.speeding_up, 'rival is', 'rivals are') + ' speeding up. Each card shows what is known about it and where that came from.'
        : 'Each card shows what is known about a rival and where that came from.',
      kpis: [[c.total || 0, 'Rivals tracked', 'confirmed and suggested', 'k-paper'], [c.speeding_up || 0, 'Speeding up', 'more than the fortnight before', 'k-acc'],
        [c.quiet || 0, 'Quiet', 'little recent activity', 'k-sky'], [c.with_facts || 0, 'With public facts', 'staff, revenue, apps, tools', 'k-cream']],
      right: right
    }) + '<div class="mr-rc-grid">' + cards.map(rivalCard).join('') + '</div></div>';
  }

  function renderDetail(state) {
    var v = state.view;
    if (!v) return '<div class="card"><div class="mr-empty"><b>Pick a company</b>Or add one by its website above.</div></div>';
    var running = state.run && state.run.status === 'running';
    var active = sectionOf(state), t = state.tabs || {}, m = state.moves;
    KIND_OF = {};
    (v.competitors || []).forEach(function (r) { KIND_OF[r.entity_id] = r.kind; });
    var later = m ? '<b>Nothing yet</b>This fills in with the first collection. Open <i>Moves</i> and press Collect now.' : 'Loading…';
    return renderHead(v, running) + (running ? renderProgress(state.run) : '') + '<div class="mr-panels">' +
      panel('overview', active, renderOverview(state)) +
      panel('competitors', active, renderCompetitors(v.competitors, state.filter, v.tracking, v.last_run)) +
      panel('moves', active, m ? renderMoves(m, state.collect, t.moves) : waiting('Competitor moves', 'Loading…')) +
      panel('rivals', active, renderRivals(state.rivals) || waiting('Rival cards', 'Loading…')) +
      panel('nearby', active, renderRadar(m && m.radar, t.nearby) || waiting('Nearby and new', later)) +
      panel('pulse', active, renderPulse(m && m.pulse, t.pulse) || waiting('Industry pulse', later)) +
      panel('profile', active, renderProfile(v, state.editing, state.errors, t.profile)) +
      panel('monitor', active, renderMonitor(state.monitor, state.collect) || waiting('Weekly update', 'Loading…')) +
      panel('run', active, running ? waiting('Last search', 'A search is running; its summary appears here when it ends.')
        : renderRun(v.last_run) || waiting('Last search', '<b>No search yet</b>Press Search again to find competitors.')) +
      '</div>';
  }

  /** The edits a submitted form makes: only fields whose value changed. */
  function formChanges(values, current) {
    var out = {};
    FIELDS.forEach(function (d) {
      var name = d[0];
      if (!(name in values)) return;
      var v = values[name], cur = current[name];
      if (d[2] === 'list') {
        var list = String(v).split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (JSON.stringify(list) !== JSON.stringify(cur || [])) out[name] = list;
      } else if (d[2] === 'number') {
        var n = String(v).trim() === '' ? -1 : Number(v);
        if (n !== (cur == null ? -1 : cur)) out[name] = String(v).trim() === '' ? '' : n;
      } else if (String(v).trim() !== String(cur == null ? '' : cur)) {
        out[name] = String(v).trim();
      }
    });
    return out;
  }

  var MR = { esc: esc, safeUrl: safeUrl, siteUrl: siteUrl, renderClientList: renderClientList,
    renderProgress: renderProgress, renderProfile: renderProfile, renderCompetitors: renderCompetitors,
    renderRow: renderRow, renderRun: renderRun, renderDetail: renderDetail, formChanges: formChanges,
    renderMoves: renderMoves, renderMoveRow: renderMoveRow, renderRivals: renderRivals, renderRadar: renderRadar, renderPulse: renderPulse, renderMonitor: renderMonitor,
    renderNav: renderNav, renderOverview: renderOverview, renderMapSlot: renderMapSlot, SECTIONS: SECTIONS,
    FIELDS: FIELDS, STAGE_STEP: STAGE_STEP };
  root.MR = MR;

  // == the page ======================================================================

  if (typeof document === 'undefined' || !document.getElementById('mr')) return;

  var state = { clients: [], selected: null, view: null, filter: null, editing: false, errors: null,
    run: null, poll: null, moves: null, collect: null, collectPoll: null, monitor: null, rivals: null, map: null,
    section: 'overview', tabs: {} };
  var $ = function (id) { return document.getElementById(id); };

  function api(path, body) {
    var opts = body === undefined ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('Request failed (' + r.status + ')')); e.data = j; e.status = r.status; throw e; }
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
  function ask(title, text, optText) {
    return new Promise(function (resolve) {
      $('mrModalTitle').textContent = title; $('mrModalText').textContent = text;
      $('mrModalOptWrap').style.display = optText ? '' : 'none';
      $('mrModalOpt').checked = false; $('mrModalOptText').textContent = optText || '';
      var bg = $('mrModal'); bg.classList.add('open'); $('mrModalYes').focus();
      function done(ok) {
        bg.classList.remove('open');
        $('mrModalYes').onclick = $('mrModalNo').onclick = null; document.removeEventListener('keydown', onKey);
        resolve(ok ? { option: $('mrModalOpt').checked } : null);
      }
      function onKey(e) { if (e.key === 'Escape') done(false); }
      document.addEventListener('keydown', onKey);
      $('mrModalYes').onclick = function () { done(true); };
      $('mrModalNo').onclick = function () { done(false); };
    });
  }

  function paintRail() {
    $('mrClients').innerHTML = renderClientList(state.clients, state.selected);
    var hero = document.querySelector('.mr-hero');
    if (hero) hero.classList.toggle('mr-hero--compact', state.clients.length > 0);
  }
  function paintNav() {
    var nav = $('mrNav');
    if (!nav) return;
    nav.innerHTML = renderNav(state);
    nav.hidden = !state.view;
    // On a phone the menu is one row: keep the open section in sight.
    var on = nav.querySelector('.on');
    if (on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, on.offsetLeft - 16);
  }
  function paint() { $('mrDetail').innerHTML = renderDetail(state); paintNav(); mountMap(); }
  // Hands the Overview's slot to the map (static/js/market_radar_map.js), which keeps its view across repaints.
  function mountMap() {
    var slot = $('mrMapSlot');
    if (!slot || !window.MRMap) return;
    var status = {};
    ((state.view || {}).competitors || []).forEach(function (r) { status[r.entity_id] = r.status; });
    var found = ((((state.moves || {}).radar || {}).local || {}).findings) || [];
    window.MRMap.attach(slot, state.map, { key: state.selected, esc: esc, opened: found,
      status: function (id, fallback) { return status[id] || fallback; }, onOpen: openRival });
  }
  // A pin's "Open rival card": the Rival cards section, scrolled to that rival.
  function openRival(domain) {
    showSection('rivals');
    var cards = document.querySelectorAll('#mrDetail .mr-rc');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute('data-domain') === domain) {
        cards[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
        cards[i].classList.add('flash');
        setTimeout(function (c) { c.classList.remove('flash'); }.bind(null, cards[i]), 2200);
        return;
      }
    }
  }
  function setHash() {
    var h = '#company-' + state.selected + (state.section !== 'overview' ? '/' + state.section : '');
    try { history.replaceState(null, '', h); } catch (e) { /* ignore */ }
  }
  // A switch shows one panel and hides the rest without drawing again.
  function showSection(key) {
    state.section = sectionOf({ section: key });
    Array.prototype.forEach.call(document.querySelectorAll('#mrDetail .mr-panel'), function (p) {
      p.hidden = p.getAttribute('data-panel') !== state.section;
    });
    paintNav(); setHash();
    if (state.section === 'overview' && window.MRMap) window.MRMap.refresh();
    var top = $('mrDetail').getBoundingClientRect().top + window.pageYOffset - 96;
    if (window.pageYOffset > top) window.scrollTo({ top: top, behavior: 'smooth' });
  }
  function showTab(el) {
    var group = el.getAttribute('data-group'), key = el.getAttribute('data-tab');
    state.tabs[group] = key;
    var card = el.closest('.mr-card') || document;
    Array.prototype.forEach.call(card.querySelectorAll('[data-act="tab"][data-group="' + group + '"]'), function (b) {
      var on = b.getAttribute('data-tab') === key;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(card.querySelectorAll('.mr-pane[data-group="' + group + '"]'), function (p) {
      p.hidden = p.getAttribute('data-tab') !== key;
    });
  }

  function loadClients() {
    return api('/clients').then(function (j) { state.clients = j.clients || []; paintRail(); })
      .catch(function (e) { $('mrClients').innerHTML = '<div class="mr-empty">' + esc(e.message) + '</div>'; });
  }
  function select(id, section) {
    if (state.selected !== id) state.tabs = {};
    state.selected = id; state.filter = null; state.editing = false; state.errors = null;
    state.section = sectionOf({ section: section || 'overview' });
    setHash();
    paintRail();
    $('mrDetail').innerHTML = '<div class="card"><div class="mr-empty">Loading…</div></div>';
    return loadView();
  }
  function loadMonitor() {
    if (CLIENT) return Promise.resolve();
    var id = state.selected;
    return api('/clients/' + id + '/monitor').then(function (m) {
      if (state.selected !== id) return;
      state.monitor = m; paint();
    }).catch(function (e) { toast('Weekly update: ' + e.message); });
  }
  function loadRivals() {
    var id = state.selected;
    return api('/clients/' + id + '/rivals').then(function (r) {
      if (state.selected !== id) return;
      state.rivals = r; paint();
    }).catch(function (e) { toast('Rival cards: ' + e.message); });
  }
  // Rivals are placed a few at a time (each town is looked up once and remembered), so ask again while some are pending.
  function loadMap(tries) {
    var id = state.selected;
    return api('/clients/' + id + '/map').then(function (m) {
      if (state.selected !== id) return;
      state.map = m; paint();
      if (m.pending && (tries || 0) < 8) setTimeout(function () { if (state.selected === id) loadMap((tries || 0) + 1); }, 1200);
    }).catch(function (e) {
      if (state.selected === id) { state.map = { error: e.message }; paint(); }
    });
  }
  function loadMoves() {
    var id = state.selected;
    return api('/clients/' + id + '/moves').then(function (m) {
      if (state.selected !== id) return;
      state.moves = m;
      var last = m.last_collect;
      if (last && last.status === 'running') watchCollect(last.id); else { state.collect = null; paint(); }
    }).catch(function (e) { toast('Competitor moves: ' + e.message); });
  }
  function watchCollect(runId) {
    clearTimeout(state.collectPoll);
    var forClient = state.selected;
    function tick() {
      api('/runs/' + runId).then(function (r) {
        if (state.selected !== forClient) return;
        state.collect = r;
        if (r.status === 'running' && !r.stale) { paint(); state.collectPoll = setTimeout(tick, 5000); return; }
        state.collect = null;
        toast(r.status === 'complete' ? 'Collection finished.' : 'The collection did not finish: ' + (r.error || r.stale || r.status));
        loadMoves(); loadMonitor(); loadRivals(); loadMap();
      }).catch(function () { state.collectPoll = setTimeout(tick, 8000); });
    }
    tick();
  }
  function loadView() {
    var id = state.selected;
    state.moves = null; state.collect = null; state.monitor = null; state.rivals = null; state.map = null; clearTimeout(state.collectPoll);
    loadMoves(); loadMonitor(); loadRivals(); loadMap();
    return api('/clients/' + id).then(function (v) {
      if (state.selected !== id) return;
      state.view = v;
      var last = v.last_run;
      if (last && last.status === 'running') watch(last.id); else { state.run = null; paint(); }
    }).catch(function (e) {
      $('mrDetail').innerHTML = '<div class="card"><div class="mr-empty">' + esc(e.message) + '</div></div>';
    });
  }
  function watch(runId) {
    clearTimeout(state.poll);
    var forClient = state.selected;
    function tick() {
      api('/runs/' + runId).then(function (r) {
        if (state.selected !== forClient) return;
        state.run = r;
        if (r.status === 'running' && !r.stale) { paint(); state.poll = setTimeout(tick, 4000); return; }
        state.run = null;
        toast(r.status === 'complete' ? 'Search finished.' : 'The search did not finish: ' + (r.error || r.stale || r.status));
        loadClients(); loadView();
      }).catch(function () { state.poll = setTimeout(tick, 8000); });
    }
    tick();
  }
  function startRun(body, title, text, optText) {
    return ask(title, text, optText).then(function (ok) {
      if (!ok) return;
      body.confirm_spend = true;
      if (optText) body.refresh_profile = ok.option;
      return api('/runs', body).then(function (j) {
        return loadClients().then(function () {
          if (j.client_id) {
            state.selected = j.client_id; paintRail();
            state.view = state.view && state.view.client && state.view.client.id === j.client_id ? state.view : null;
            return api('/clients/' + j.client_id).then(function (v) { state.view = v; watch(j.run_id); });
          }
        });
      }).catch(function (e) {
        if (e.status === 409 && e.data && e.data.run_id) { toast(e.message); watch(e.data.run_id); return; }
        toast(e.message);
      });
    });
  }

  $('mrAddForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var url = $('mrAddUrl').value.trim();
    if (!url) { $('mrAddUrl').focus(); return; }
    startRun({ url: url }, 'Find competitors for ' + url + '?',
      'This reads the website and searches for competitors' + (CLIENT ? ', in 2 to 4 minutes.' : ': about $0.15 and 2 to 4 minutes.') +
      ' If the company is already on your list, its stored profile is reused.')
      .then(function () { $('mrAddUrl').value = ''; });
  });

  function setStatus(entityId, status, kind) {
    var body = {}; if (status) body.status = status; if (kind) body.kind = kind;
    return api('/clients/' + state.selected + '/competitors/' + entityId, body).then(function (j) {
      state.view.competitors = j.competitors; paint(); loadClients();
    }).catch(function (e) { toast(e.message); });
  }
  function saveProfile(body) {
    return api('/clients/' + state.selected + '/profile', body).then(function (j) {
      state.view = j.view; state.editing = false; state.errors = null; paint(); loadClients();
      toast((j.notes || []).join(' ') || 'Saved.');
    }).catch(function (e) {
      if (e.data && e.data.fields) { state.errors = e.data.fields; paint(); }
      toast(e.message);
    });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || !$('mr').parentNode.contains(el)) return;
    var act = el.getAttribute('data-act');
    if (act === 'select') select(Number(el.getAttribute('data-id')));
    else if (act === 'section') showSection(el.getAttribute('data-section'));
    else if (act === 'tab') showTab(el);
    else if (act === 'filter') { state.filter = el.getAttribute('data-filter'); paint(); }
    else if (act === 'status') setStatus(el.getAttribute('data-id'), el.getAttribute('data-status'));
    else if (act === 'edit') { state.section = 'profile'; state.editing = true; state.errors = null; paint(); var first = document.querySelector('#mrProfileForm input'); if (first) first.focus(); }
    else if (act === 'cancel-edit') { state.editing = false; state.errors = null; paint(); }
    else if (act === 'reset') saveProfile({ reset: [el.getAttribute('data-field')] });
    else if (act === 'radius-auto') saveProfile({ radius_km: null });
    else if (act === 'confirm-all') {
      var ids = state.view.competitors.filter(function (r) { return r.status === 'proposed'; }).map(function (r) { return r.entity_id; });
      ids.reduce(function (p, id) { return p.then(function () { return api('/clients/' + state.selected + '/competitors/' + id, { status: 'confirmed' }); }); }, Promise.resolve())
        .then(function () { toast('Confirmed ' + ids.length + '.'); state.filter = 'confirmed'; return loadView(); })
        .then(loadClients).catch(function (err) { toast(err.message); loadView(); });
    } else if (act === 'collect') {
      el.disabled = true;
      api('/clients/' + state.selected + '/collect', {}).then(function (j) {
        state.collect = { status: 'running', stage: 'queued' }; paint(); watchCollect(j.run_id);
      }).catch(function (err) {
        if (err.status === 409 && err.data && err.data.run_id) { toast(err.message); watchCollect(err.data.run_id); return; }
        toast(err.message); paint();
      });
    } else if (act === 'update-now' || act === 'update-preview') {
      var send = act === 'update-now';
      var who = state.monitor ? [].concat(state.monitor.email || [], state.monitor.slack_channel ? ['Slack ' + state.monitor.slack_channel] : []) : [];
      ask(send ? 'Send an update now?' : 'Write a preview?',
        send ? 'Collects the competitors again, writes the "what changed" update and sends it to ' + (who.join(', ') || 'no one yet') + '. About $0.05.'
          : 'Collects the competitors again and writes the update without sending it. It still counts as the latest update, so the next one starts from it. About $0.05.').then(function (ok) {
        if (!ok) return;
        api('/clients/' + state.selected + '/update-now', { send: send }).then(function (j) {
          state.collect = { status: 'running', stage: 'queued' }; paint(); watchCollect(j.run_id);
        }).catch(function (err) {
          if (err.status === 409 && err.data && err.data.run_id) { toast(err.message); watchCollect(err.data.run_id); return; }
          toast(err.message);
        });
      });
    } else if (act === 'run') {
      var name = (state.view.profile.fields || {}).name || state.view.client.domain;
      startRun({ client_id: state.selected }, 'Search again for ' + name + '?',
        'Searches for competitors again using the profile with your corrections' + (CLIENT ? ', in 2 to 4 minutes.' : ': about $0.07 and 2 to 4 minutes.') +
        ' Competitors you confirmed or removed keep your decision.',
        'Also re-read the website' + (CLIENT ? '.' : ' (about $0.05 more).') + ' Your corrections still apply.');
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.getAttribute && el.getAttribute('data-act') === 'kind') setStatus(el.getAttribute('data-id'), null, el.value);
  });
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.id === 'mrProfileForm') {
      e.preventDefault();
      var values = {};
      Array.prototype.forEach.call(form.elements, function (el) { if (el.name) values[el.name] = el.value; });
      var changes = formChanges(values, state.view.profile.fields || {});
      if (!Object.keys(changes).length) { state.editing = false; paint(); return; }
      saveProfile({ changes: changes });
    } else if (form.id === 'mrRadiusForm') {
      e.preventDefault();
      var v = $('mrRadius').value.trim();
      saveProfile({ radius_km: v === '' ? null : Number(v) });
    } else if (form.id === 'mrMonitorForm') {
      e.preventDefault();
      var f = form.elements;
      api('/clients/' + state.selected + '/monitor', {
        enabled: f.enabled.checked, weekday: Number(f.weekday.value), hour: Number(f.hour.value),
        email: f.email.value, slack_channel: f.slack_channel.value.trim()
      }).then(function (m) { state.monitor = m; paint(); toast(m.enabled ? 'Saved. Next update: ' + when(m.next) + '.' : 'Saved. Weekly updates are off.'); })
        .catch(function (err) { toast(err.data && err.data.errors ? Object.keys(err.data.errors).map(function (k) { return err.data.errors[k]; }).join('; ') : err.message); });
    } else if (form.id === 'mrAddCompetitor') {
      e.preventDefault();
      var url = $('mrCompUrl').value.trim();
      if (!url) return;
      api('/clients/' + state.selected + '/competitors', { url: url, kind: $('mrCompKind').value }).then(function (j) {
        state.view.competitors = j.competitors; state.filter = 'confirmed'; paint(); loadClients(); toast('Added.');
      }).catch(function (err) { toast(err.message); });
    }
  });

  loadClients().then(function () {
    var m = /#company-(\d+)(?:\/([a-z]+))?/.exec(location.hash);
    var id = m ? Number(m[1]) : (state.clients[0] && state.clients[0].client_id);
    if (id && state.clients.some(function (c) { return c.client_id === id; })) select(id, m && m[2]);
    else paint();
  });
  window.addEventListener('hashchange', function () {
    var m = /#company-(\d+)(?:\/([a-z]+))?/.exec(location.hash);
    if (!m) return;
    if (Number(m[1]) !== state.selected) select(Number(m[1]), m[2]);
    else if (sectionOf({ section: m[2] }) !== state.section) showSection(m[2]);
  });
})(typeof window !== 'undefined' ? window : globalThis);
