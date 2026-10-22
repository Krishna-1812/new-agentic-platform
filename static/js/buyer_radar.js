/* Buyer Radar page (templates/buyer_radar.html).
 *
 * The render* functions are pure: data in, HTML out, every value escaped
 * (post text, names and headlines come from LinkedIn, needs and drafts from
 * a model), every link through safeUrl. They are exported as window.BR so
 * tests can run them under Node. The wiring at the bottom only runs on the
 * page.
 *
 * Flow: Search now (paid, after a yes) -> leads -> open one -> edit the
 * email or LinkedIn note -> Send (after a yes). Settings are the
 * workspace's. A client of the workspace searches and reads; nothing else.
 */
(function (root) {
  'use strict';

  var API = '/strategic-agents/buyer-radar/api';
  var DOC = typeof document !== 'undefined' ? document : null;
  var CLIENT = !!(DOC && DOC.body && DOC.body.hasAttribute('data-br-client'));
  var STATUS = { 'new': ['acc', 'New'], contacted: ['ok', 'Contacted'], replied: ['ok', 'Replied'], dismissed: ['', 'Dismissed'] };
  var INTENT = { seeking_vendor: 'Looking for a vendor', asking_recommendations: 'Asking for recommendations',
    hiring_for_it: 'Hiring for it', pain_point: 'Has the problem', none: 'Not buying' };
  var STAGES = ['queued', 'searching', 'reading', 'reading comments', 'reading Reddit', 'searching for RFPs', 'finding people',
    'finding decision makers', 'drafting', 'adding to Saleshandy', 'sending emails', 'sending on LinkedIn', 'updating the Google Sheet',
    'posting to Slack', 'done'];
  var STAGE_WORDS = { queued: 'Starting', searching: 'Searching LinkedIn', reading: 'Claude is reading what it found',
    'reading comments': 'Reading the comments', 'reading Reddit': 'Reading Reddit', 'searching for RFPs': 'Searching the web for RFPs',
    'finding people': 'Finding people who fit your profiles', 'finding decision makers': 'Finding who decides',
    'adding to Saleshandy': 'Adding to Saleshandy', 'updating the Google Sheet': 'Updating the Google Sheet',
    drafting: 'Writing the messages', 'sending emails': 'Sending emails', 'sending on LinkedIn': 'Sending on LinkedIn',
    'posting to Slack': 'Posting to Slack', done: 'Done', failed: 'Stopped' };
  // Where a lead came from: [chip, what it means, the filter's name].
  var SOURCE = { post: ['Post', 'They posted asking for it', 'Posts'], comment: ['Comment', 'They said so under a buyer\'s post', 'Comments'],
    jobs: ['Hiring', 'Their company is hiring for the work', 'Hiring'], icp: ['Profile', 'Fits your customer profile, at a moment that matters', 'Profiles'],
    rfp: ['RFP', 'They published a request for proposals', 'RFPs'], reddit: ['Reddit', 'They asked on Reddit', 'Reddit'] };
  var LEAD_SOURCES = { posts: ['LinkedIn posts', 'People posting that they need it.'],
    comments: ['Their comments', 'People under those posts saying they need it too. Read through Unipile.'],
    jobs: ['Job ads', 'Companies whose LinkedIn job ads are the work, and who decides there. Read through Unipile; people found by Saleshandy, free.'],
    icp: ['Customer profiles', 'People who fit your customers at a moment that matters: new in their role, recently funded, hiring, using a rival. From Saleshandy, free to search.'],
    rfps: ['RFPs and tenders', 'Open requests for proposals on the web, found by Claude\'s web search. About $0.03 a search, run once every few days.'],
    reddit: ['Reddit', 'Threads asking for recommendations, answered in the thread by you. Free; needs a Reddit app\'s keys on the service.'] };
  var ICP_LISTS = [['titles', 'Job titles'], ['levels', 'Seniority'], ['departments', 'Departments'], ['industries', 'Industries'],
    ['locations', 'Locations'], ['keywords', 'Company keywords'], ['technologies', 'Products their company uses'], ['hiring', 'Jobs their company advertises']];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) {
    return /^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : null;
  }
  function link(url, text, cls) {
    var h = safeUrl(url);
    return h ? '<a' + (cls ? ' class="' + esc(cls) + '"' : '') + ' href="' + esc(h) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + '</a>' : esc(text);
  }
  function chip(cls, text, title) {
    return '<span class="mr-chip ' + esc(cls || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>';
  }
  function money(v) { return v == null ? '–' : '$' + Number(v).toFixed(Number(v) < 1 ? 3 : 2); }
  function ago(iso) {
    var d = new Date(iso || '');
    if (isNaN(d)) return '';
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 14) return Math.round(s / 86400) + 'd ago';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function initials(name) {
    var w = String(name || '?').trim().split(/\s+/);
    return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase();
  }
  function hue(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 6;
    return 'h' + h;
  }
  // A time of day as India shows it ("9:00 AM"), from an hour (0..23) or a Date.
  function hourLabel(h) {
    if (h instanceof Date) {
      if (isNaN(h)) return '';
      var ist = new Date(h.getTime() + 330 * 60000);
      h = ist.getUTCHours();
      var m = ist.getUTCMinutes();
      return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'AM' : 'PM');
    }
    h = Number(h) || 0;
    return ((h % 12) || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
  }
  function band(score) { return score >= 85 ? 'hot' : score >= 70 ? 'warm' : 'cool'; }

  // ── the numbers across the top ───────────────────────────────────────────
  function renderStats(st) {
    var c = (st && st.counts) || {};
    var items = [['New', c['new'] || 0, 'acc'], ['This week', c.week || 0, ''], ['Contacted', c.contacted || 0, 'ok'], ['Replied', c.replied || 0, 'ok']];
    if (!CLIENT && st && st.month) items.push(['Spent this month', money(st.month.usd), '']);
    return items.map(function (it) {
      return '<div class="br-stat br-stat--' + esc(it[2]) + '"><b>' + esc(it[1]) + '</b><span>' + esc(it[0]) + '</span></div>';
    }).join('');
  }

  // ── what is connected ────────────────────────────────────────────────────
  function renderReady(st) {
    var r = (st && st.ready) || {};
    var out = [];
    var uni = st && st.source === 'unipile';
    out.push(chip(r.search ? 'ok' : 'bad', r.search ? 'LinkedIn search' : 'Search not set up',
      r.search ? (uni ? 'Unipile' : 'Apify') + ' is connected' : (uni ? 'UNIPILE_API_KEY' : 'APIFY_API_TOKEN') + ' is not set'));
    out.push(chip(r.claude ? 'ok' : 'bad', r.claude ? 'Claude' : 'Claude not set up', r.claude ? '' : 'ANTHROPIC_API_KEY is not set'));
    if (!CLIENT) {
      out.push(chip(r.email ? 'ok' : 'warn', r.email ? 'Email' : 'Email not set up', r.email ? '' : 'Needs GMAIL_SENDER with GOOGLE_SA_JSON'));
      out.push(chip(r.linkedin ? 'ok' : 'warn', r.linkedin ? 'LinkedIn sending' : 'LinkedIn not set up', r.linkedin ? 'Unipile is set up' : 'Needs UNIPILE_API_KEY and UNIPILE_DSN'));
      if (r.sending === false) out.push(chip('bad', 'Sending switched off', 'BUYER_RADAR_SEND is off on the service'));
      if (((st.settings || {}).sources || []).indexOf('reddit') >= 0) {
        out.push(chip(r.reddit ? 'ok' : 'warn', r.reddit ? 'Reddit' : 'Reddit not set up', r.reddit ? '' : 'Needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET'));
      }
    }
    return out.join(' ');
  }

  // ── who runs the search ──────────────────────────────────────────────────
  var SOURCE_NOTES = {
    unipile: 'Free per post. Runs as your connected LinkedIn account, up to 900 results a day, the last month at most.',
    apify: 'About $0.002 a post. No LinkedIn account used, and up to 3 months back.'
  };
  function renderSource(current, sources) {
    sources = sources || { unipile: 'Unipile', apify: 'Apify' };
    var btns = Object.keys(sources).map(function (k) {
      var on = k === current;
      return '<button type="button" class="br-src-b' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-source="' + esc(k) + '">' + esc(sources[k]) + '</button>';
    }).join('');
    return '<span class="br-src-l" id="brSourceL">Search with</span><span class="br-src-g" role="radiogroup" aria-labelledby="brSourceL">' + btns + '</span>' +
      '<span class="br-src-n">' + esc(SOURCE_NOTES[current] || '') + '</span>';
  }

  // ── a lead ───────────────────────────────────────────────────────────────
  function excerpt(text, n) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    return text.length > n ? text.slice(0, n).replace(/\s+\S*$/, '') + '…' : text;
  }

  // A company's open roles, and the people Saleshandy says decide there.
  function renderJobs(p) {
    var jobs = (p.jobs || []).slice(0, 4).map(function (j) {
      return '<li>' + link(j.url, j.title) + (j.location ? ' <span>' + esc(j.location) + '</span>' : '') + '</li>';
    }).join('');
    var more = (p.jobs || []).length > 4 ? '<li><span>and ' + esc(p.jobs.length - 4) + ' more</span></li>' : '';
    var people = (p.contacts || []).map(function (c) {
      return '<li><b>' + (c.linkedin ? link(c.linkedin, c.name) : esc(c.name)) + '</b> <span>' + esc(c.title || '') + '</span></li>';
    }).join('');
    return '<ul class="br-jobs">' + jobs + more + '</ul>' +
      (people ? '<div class="br-dm"><small>Who decides</small><ul>' + people + '</ul></div>' :
        '<p class="br-dm br-dm--none"><small>Nobody found yet. ' + link(p.url ? String(p.url).replace(/\/?$/, '/people/') : '', 'See their people on LinkedIn') + '</small></p>');
  }

  function renderLead(lead) {
    var p = lead.post || {}, v = lead.verdict || {}, a = p.author || {};
    var offers = (root.BR && root.BR.offers) || {};
    var st = STATUS[lead.status] || STATUS['new'];
    var sends = lead.sends || [];
    var sent = sends.filter(function (s) { return s.status === 'sent'; });
    var kind = SOURCE[lead.source] ? lead.source : 'post';
    var meta = [chip('br-kind br-kind--' + esc(kind), SOURCE[kind][0], SOURCE[kind][1]),
                chip('br-offer br-offer--' + esc(lead.offer), (offers[lead.offer] || {}).label || lead.offer),
                chip('', INTENT[v.intent] || v.intent_label || ''), chip(st[0], st[1])];
    if (v.deadline) meta.push(chip('warn', 'By ' + v.deadline));
    if (v.region) meta.push(chip('', v.region));
    var also = (v.signals || []).filter(function (x) { return x !== kind && SOURCE[x]; });
    if (also.length) meta.push(chip('acc br-multi', 'Also: ' + also.map(function (x) { return SOURCE[x][0]; }).join(', '),
      'This company was found in ' + (also.length + 1) + ' places, which raised its score'));
    var did = sent.map(function (s) {
      return '<li>' + esc(s.channel === 'email' ? 'Emailed' : 'LinkedIn') + (s.to && s.channel === 'email' ? ' ' + esc(s.to) : '') +
        ' <span>' + esc(ago(s.at)) + (s.by === '' && !CLIENT ? ' · automatic' : '') + '</span></li>';
    }).join('');
    var acts = '';
    if (!CLIENT) {
      acts = '<button type="button" class="mr-btn small primary" data-act="open" data-id="' + esc(lead.id) + '">Message</button>';
    }
    if (kind !== 'icp') acts += link(p.url, OPEN[kind] || 'Open the post', 'mr-btn small ghost');
    if (lead.status !== 'replied') acts += '<button type="button" class="mr-btn small ghost" data-act="status" data-status="replied" data-id="' + esc(lead.id) + '">They replied</button>';
    if (lead.status !== 'dismissed') acts += '<button type="button" class="mr-btn small ghost br-dim" data-act="status" data-status="dismissed" data-id="' + esc(lead.id) + '">Not a fit</button>';
    else acts += '<button type="button" class="mr-btn small ghost" data-act="status" data-status="new" data-id="' + esc(lead.id) + '">Bring back</button>';
    return '<article class="br-lead br-lead--' + band(lead.score) + (lead.status === 'dismissed' ? ' is-dim' : '') + '" id="lead-' + esc(lead.id) + '">' +
      '<div class="br-score" title="How likely a message is welcome now, 0 to 100"><svg viewBox="0 0 36 36" aria-hidden="true">' +
        '<circle cx="18" cy="18" r="15.9" class="trk"/><circle cx="18" cy="18" r="15.9" class="val" stroke-dasharray="' + esc(Math.max(0, Math.min(100, lead.score))) + ' 100"/></svg>' +
        '<b>' + esc(lead.score) + '</b></div>' +
      '<div class="br-lead-b">' +
        '<div class="br-who"><span class="br-av ' + hue(a.name) + '">' + esc(initials(a.name)) + '</span>' +
          '<span class="br-who-t"><b>' + link(a.url, a.name || 'Someone') + '</b><small>' + esc(excerpt(a.headline, 110)) + '</small></span>' +
          '<span class="br-when">' + esc(ago(p.posted_at || lead.created_at)) + '</span></div>' +
        '<p class="br-need">' + esc(v.need || '') + '</p>' +
        '<div class="br-meta">' + meta.join('') + '</div>' +
        (kind === 'icp' ? '<p class="br-parent">Fits &ldquo;' + esc((p.icp || {}).name || '') + '&rdquo;' +
          ((p.company || {}).name ? ' &middot; ' + esc(p.company.name) : '') + '</p>' :
        kind === 'rfp' ? '<p class="br-parent">' + link(p.url, (p.rfp || {}).title || 'The RFP') +
          ((p.rfp || {}).due ? ' &middot; due ' + esc(p.rfp.due) : '') + ((p.rfp || {}).location ? ' &middot; ' + esc(p.rfp.location) : '') + '</p>' +
          (v.reason ? '<p class="br-why"><b>Why Claude kept it:</b> ' + esc(v.reason) + '</p>' : '') :
        kind === 'jobs' ? renderJobs(p) + (v.reason ? '<p class="br-why"><b>Why Claude kept it:</b> ' + esc(v.reason) + '</p>' : '') :
        (kind === 'comment' && p.parent ? '<p class="br-parent">Under ' + link(p.parent.url, (p.parent.author || 'a') + '\'s post') +
          (p.parent.need ? ' asking for ' + esc(excerpt(p.parent.need, 90)) : '') + '</p>' : '') +
        '<details class="br-post-x"><summary>' + esc(excerpt(p.text, 220)) + '</summary><p>' + esc(p.text || '') + '</p>' +
          (v.reason ? '<p class="br-why"><b>Why Claude kept it:</b> ' + esc(v.reason) + '</p>' : '') + '</details>') +
        (did ? '<ul class="br-did">' + did + '</ul>' : '') +
        '<div class="br-acts">' + acts + '</div>' +
      '</div></article>';
  }

  var OPEN = { jobs: 'Open the company', rfp: 'Open the RFP', reddit: 'Open the thread', comment: 'Open the post' };

  function renderLeads(leads, filter) {
    if (!leads || !leads.length) {
      return '<div class="br-none"><b>' + (filter && filter !== 'all' ? 'Nothing here with this filter.' : 'No leads yet.') + '</b>' +
        '<span>' + (filter && filter !== 'all' ? 'Try another filter.' : 'Search LinkedIn now, or switch on the daily search in Settings.') + '</span></div>';
    }
    return leads.map(renderLead).join('');
  }

  function renderFilters(cur, offers) {
    var f = [['all', 'All'], ['strong', 'Strong'], ['new', 'New'], ['contacted', 'Contacted'], ['replied', 'Replied'], ['dismissed', 'Not a fit']];
    Object.keys(SOURCE).forEach(function (k) { f.push(['source:' + k, SOURCE[k][2]]); });
    Object.keys(offers || {}).forEach(function (k) { f.push(['offer:' + k, offers[k].label]); });
    return f.map(function (x) {
      return '<button type="button" class="br-f' + (x[0] === cur ? ' on' : '') + '" data-filter="' + esc(x[0]) + '" aria-pressed="' + (x[0] === cur) + '">' + esc(x[1]) + '</button>';
    }).join('');
  }

  // ── searches ─────────────────────────────────────────────────────────────
  function renderRuns(runs) {
    if (!runs || !runs.length) return '<div class="mr-empty">No searches yet.</div>';
    return '<ol class="br-runlist">' + runs.slice(0, 8).map(function (r) {
      var s = r.summary || {};
      var label = r.status === 'running' ? (STAGE_WORDS[r.stage] || 'Running') : r.status === 'failed' ? 'Stopped' : (s.kept || 0) + ' lead' + (s.kept === 1 ? '' : 's');
      var bits = [];
      if (r.status === 'ready') {
        bits.push((s.posts || 0) + ' posts found');
        if (s.companies) bits.push(s.companies + ' companies hiring');
        if (s.comments) bits.push(s.comments + ' comments');
        if (s.threads) bits.push(s.threads + ' Reddit threads');
        if (s.rfps) bits.push(s.rfps + ' RFPs');
        if (s.multi) bits.push(s.multi + ' in several places');
        if (s.repeats) bits.push(s.repeats + ' repeat' + (s.repeats === 1 ? '' : 's') + ' skipped');
        if (s.slack === 'waiting' && s.slack_at) bits.push('Slack at ' + hourLabel(new Date(s.slack_at)));
        if (s.sheet && s.sheet.added != null) bits.push(s.sheet.added + ' added to the sheet');
        if (s.read != null && s.read !== s.posts) bits.push(s.read + ' read by Claude');
        if (s.source) bits.push('via ' + (s.source === 'unipile' ? 'Unipile' : 'Apify'));
        if (s.strong) bits.push(s.strong + ' strong');
        if (s.emailed || s.messaged) bits.push(((s.emailed || 0) + (s.messaged || 0)) + ' written to');
      }
      if (!CLIENT && r.spent_usd != null) bits.push(money(r.spent_usd));
      return '<li id="run-' + esc(r.id) + '" class="br-r br-r--' + esc(r.status) + '"><span class="br-r-dot"></span><span class="br-r-t"><b>' + esc(label) + '</b>' +
        '<small>' + esc((r.trigger === 'daily' ? 'Daily · ' : '') + ago(r.created_at)) + (bits.length ? ' · ' + esc(bits.join(' · ')) : '') + '</small>' +
        (r.status === 'failed' && r.error ? '<small class="br-err">' + esc(r.error) + '</small>' : '') +
        (r.status === 'ready' && !CLIENT ? renderNotes(s.notes) : '') +
        (r.status === 'ready' && !s.kept ? renderClosest(s.closest) : '') + '</span></li>';
    }).join('') + '</ol>';
  }

  // What went wrong along the way (posts Claude could not read, a search cut short), in the run's own words.
  // Team only: a note can name the run's cost cap.
  function renderNotes(notes) {
    if (!notes || !notes.length) return '';
    return notes.slice(0, 3).map(function (n) { return '<small class="br-note">' + esc(excerpt(n, 220)) + '</small>'; }).join('');
  }

  // A search that kept nothing says how close the best post came, so an empty list explains itself.
  function renderClosest(closest) {
    var c = (closest || [])[0];
    if (!c) return '';
    return '<small class="br-closest">Best post not kept: scored ' + esc(c.score) + (c.role && c.role !== 'buyer' ? ', a ' + esc(String(c.role).replace('_', ' ')) : '') +
      '. ' + esc(excerpt(c.reason, 140)) + ' ' + link(c.url, 'Open') + '</small>';
  }

  function renderLive(run) {
    var at = Math.max(0, STAGES.indexOf(run.stage));
    var s = run.summary || {};
    var extra = ['reading comments', 'reading Reddit', 'searching for RFPs', 'finding people', 'finding decision makers'].indexOf(run.stage) >= 0 ? [run.stage] : [];
    var steps = ['searching', 'reading'].concat(extra, ['drafting']).map(function (k) {
      var i = STAGES.indexOf(k);
      return '<li class="' + (i < at ? 'done' : i === at ? 'now' : '') + '">' + esc(STAGE_WORDS[k]) + '</li>';
    }).join('');
    var n = [];
    if (s.posts) n.push(s.posts + ' posts found');
    if (s.companies) n.push(s.companies + ' companies hiring');
    if (s.read) n.push(s.read + ' read');
    if (s.kept) n.push(s.kept + ' kept');
    return '<ol class="br-steps-live">' + steps + '</ol>' + (n.length ? '<p class="br-live-n">' + esc(n.join(' · ')) + '</p>' : '');
  }

  function renderEstimate(est) {
    if (!est) return '';
    var uni = est.source === 'unipile';
    return (uni ? '<p class="br-cost">The search is free through Unipile; Claude reading what it finds is the cost.</p>' : '') +
      '<p class="br-cost">Usually about ' + esc(money(est.typical_usd)) + ', never more than ' + esc(money(Math.min(est.worst_usd, est.usd_cap))) + ' (the run\'s cap). Every day for a month: up to ' + esc(money(est.month_usd)) + '.</p>';
  }

  // ── the message drawer ───────────────────────────────────────────────────
  // A Reddit thread is answered in the thread, by a person: the reply to copy, and the thread to open.
  function renderRedditDrawer(lead) {
    var d = lead.draft || {}, p = lead.post || {}, a = p.author || {};
    return '<p class="br-dr-who"><b>' + esc(a.name || 'Someone') + '</b> ' + esc(a.headline || '') + '</p>' +
      '<blockquote class="br-dr-post">' + esc(excerpt(p.text, 600)) + '</blockquote>' +
      '<section class="br-dr-sec"><h5>Reply in the thread</h5>' +
        '<p class="mr-hint">Nobody on Reddit is emailed or messaged from here. Read the subreddit&rsquo;s rules on self-promotion, then post this yourself.</p>' +
        '<label class="mr-k" for="brMsg">Reply</label><textarea id="brMsg" rows="7" maxlength="1000">' + esc(d.message || '') + '</textarea>' +
        '<div class="br-dr-acts"><button type="button" class="mr-btn primary" data-act="copy">Copy the reply</button>' + link(p.url, 'Open the thread', 'mr-btn ghost') + '</div></section>' +
      '<div class="br-dr-foot"><button type="button" class="mr-btn ghost" data-act="save">Save changes</button>' +
        '<button type="button" class="mr-btn ghost" data-act="status" data-status="contacted">I replied</button></div>';
  }

  function renderDrawer(lead, ready, settings) {
    if (lead.source === 'reddit') return renderRedditDrawer(lead);
    var d = lead.draft || {}, p = lead.post || {}, a = p.author || {};
    var person = String(lead.person || '');
    var sentOn = {};
    (lead.sends || []).forEach(function (s) { if (s.status === 'sent') sentOn[s.channel] = s; });
    var company = person.indexOf('company/') === 0 || (lead.source === 'jobs' && !person);
    var jobs = lead.source === 'jobs', rfp = lead.source === 'rfp';
    var unrevealed = person.indexOf('sh/') === 0;
    var contacts = p.contacts || [];
    function sentLine(ch) {
      var s = sentOn[ch];
      return s ? '<p class="mr-callout ok">Already sent ' + esc(ago(s.at)) + '. Nobody is written to twice.</p>' : '';
    }
    // At a hiring company, the team picks who of its decision makers to write to.
    var pick = '';
    if (jobs) {
      var on = 0;
      contacts.forEach(function (c, i) { if (c.key === person || (c.linkedin && person && String(c.linkedin).toLowerCase().indexOf(person) >= 0)) on = i; });
      pick = contacts.length ? '<fieldset class="br-pick"><legend class="mr-k">Write to</legend>' + contacts.map(function (c, i) {
        return '<label><input type="radio" name="brWho" value="' + i + '"' + (i === on ? ' checked' : '') + '><span><b>' + esc(c.name) + '</b> ' + esc(c.title || '') + '</span></label>';
      }).join('') + '</fieldset>' :
        '<p class="mr-callout warn">Saleshandy knew nobody senior at this company. ' + link(p.url ? String(p.url).replace(/\/?$/, '/people/') : '', 'Look at their people on LinkedIn') + ' and type an address below.</p>';
    }
    var canFind = !lead.email && ready.saleshandy && (unrevealed || person.indexOf('in/') === 0 || (jobs && contacts.length));
    var find = canFind ? '<div class="br-dr-acts"><button type="button" class="mr-btn ghost" data-act="find">Find their email</button>' +
      '<span class="mr-hint">Saleshandy, one credit (about $0.026) if it finds one.</span></div>' : '';
    var seq = ((settings || {}).sequences || {})[lead.offer];
    var sentSeq = (lead.sends || []).some(function (x) { return x.status === 'sent' && /Saleshandy sequence/.test(x.detail || ''); });
    var sequence = ready.saleshandy ? '<section class="br-dr-sec"><h5>Saleshandy sequence</h5>' +
      (sentSeq ? '<p class="mr-callout ok">Already added. Saleshandy sends and follows up.</p>' : seq ?
        '<p class="mr-hint">Adds them to &ldquo;' + esc(seq.title || 'the sequence') + '&rdquo;, which sends and follows up on its own schedule.' +
          (lead.email ? '' : ' Their email is not known yet: Saleshandy finds it as it adds them, for one credit.') + '</p>' +
          '<div class="br-dr-acts"><button type="button" class="mr-btn primary" data-act="sequence"' + (sentOn.email ? ' disabled' : '') + '>Add to the sequence</button></div>' :
        '<p class="mr-hint">Choose a sequence for this offer in Settings to send with follow-ups.</p>') + '</section>' : '';
    var top = rfp ? '<p class="br-dr-who"><b>' + esc(a.name || 'An organisation') + '</b> ' + link(p.url, (p.rfp || {}).title || 'Request for proposals') +
        ((p.rfp || {}).due ? ' &middot; due ' + esc(p.rfp.due) : '') + '</p><blockquote class="br-dr-post">' + esc(excerpt(p.text, 420)) + '</blockquote>' +
        '<p class="mr-hint">An RFP is answered by your team with a proposal. This email asks for the documents or the next step; it is never sent automatically.</p>' :
      lead.source === 'icp' ? '<p class="br-dr-who"><b>' + esc(a.name || 'Someone') + '</b> ' + esc(a.headline || '') + '</p>' +
        '<blockquote class="br-dr-post">' + esc(p.text || '') + '</blockquote>' :
      jobs ? '<p class="br-dr-who"><b>' + esc(a.name || 'A company') + '</b> ' + esc(a.headline || '') + '</p>' + renderJobs(p) :
      '<p class="br-dr-who"><b>' + esc(a.name || 'Someone') + '</b> ' + esc(excerpt(a.headline, 90)) + '</p>' +
      '<blockquote class="br-dr-post">' + esc(excerpt(p.text, 420)) + '</blockquote>';
    return top + pick +
      (lead.draft ? '' : '<p class="mr-callout warn">No message was written for this lead (the run reached its cost cap). Write one below.</p>') +
      '<section class="br-dr-sec"><h5>Email</h5>' + sentLine('email') +
        '<label class="mr-k" for="brTo">To</label><input type="email" id="brTo" value="' + esc(lead.email || '') + '" placeholder="Their email address">' +
        '<div class="mr-hint">' + (lead.email_source === 'rfp' ? 'The contact the RFP gives.' : lead.email_source === 'post' ? 'From their post: they asked to be written to here.' : lead.email_source === 'saleshandy' ? 'Found by Saleshandy.' : 'Not known yet. Type it in if you have it.') + '</div>' + find +
        '<label class="mr-k" for="brSubj">Subject</label><input type="text" id="brSubj" maxlength="120" value="' + esc(d.subject || '') + '">' +
        '<label class="mr-k" for="brBody">Message</label><textarea id="brBody" rows="8">' + esc(d.email || '') + '</textarea>' +
        '<div class="mr-hint">Your name and an opt-out line are added at the bottom.</div>' +
        '<div class="br-dr-acts"><button type="button" class="mr-btn primary" data-act="send" data-channel="email"' + (ready.email && !sentOn.email ? '' : ' disabled') + '>Send email</button>' +
        (ready.email ? '' : '<span class="mr-hint">Email is not set up on the service.</span>') + '</div></section>' +
      '<section class="br-dr-sec"><h5>LinkedIn</h5>' + sentLine('linkedin') +
        (rfp ? '<p class="mr-hint">An RFP has a contact address, not a LinkedIn profile.</p>' :
        company ? '<p class="mr-hint">' + (jobs ? 'There is no person to write to at this company yet.' : 'This post is from a company page; LinkedIn messages go to people.') + '</p>' :
        unrevealed ? '<p class="mr-hint">Find their email first: Saleshandy brings their LinkedIn profile with it.</p>' :
        '<label class="mr-k" for="brNote">Connection note <span class="br-n" id="brNoteN"></span></label><textarea id="brNote" rows="4" maxlength="300">' + esc(d.note || '') + '</textarea>' +
        '<div class="mr-hint">Sent with a connection request when you are not connected yet.</div>' +
        '<label class="mr-k" for="brMsg">Message, if you are already connected</label><textarea id="brMsg" rows="5" maxlength="1000">' + esc(d.message || '') + '</textarea>' +
        '<div class="br-dr-acts"><button type="button" class="mr-btn primary" data-act="send" data-channel="linkedin"' + (ready.linkedin && !sentOn.linkedin ? '' : ' disabled') + '>Send on LinkedIn</button>' +
        (ready.linkedin ? '' : '<span class="mr-hint">LinkedIn is not set up on the service.</span>') + '</div>') + '</section>' +
      (rfp ? '' : sequence) +
      '<div class="br-dr-foot"><button type="button" class="mr-btn ghost" data-act="save">Save changes</button>' + (lead.source === 'icp' ? '' : link(p.url, OPEN[lead.source] || 'Open the post', 'mr-btn ghost')) + '</div>';
  }

  // ── settings ─────────────────────────────────────────────────────────────
  function sw(id, on, title, sub) {
    return '<label class="br-sw"><input type="checkbox" id="' + esc(id) + '"' + (on ? ' checked' : '') + '><span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span></label>';
  }
  function numIn(id, label, val, min, max, step, hint) {
    return '<div class="br-num"><label class="mr-k" for="' + esc(id) + '">' + esc(label) + '</label><input type="number" id="' + esc(id) + '" value="' + esc(val) +
      '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '">' + (hint ? '<div class="mr-hint">' + esc(hint) + '</div>' : '') + '</div>';
  }

  // One customer profile, every field editable; lists are written with commas.
  function renderIcp(icp, offer, extra) {
    icp = icp || {};
    var triggers = (extra && extra.triggers) || { none: 'Fit alone' };
    var opts = Object.keys(triggers).map(function (t) {
      return '<option value="' + esc(t) + '"' + (icp.trigger === t ? ' selected' : '') + '>' + esc(triggers[t]) + '</option>';
    }).join('');
    var lists = ICP_LISTS.map(function (f) {
      return '<label class="br-icp-f"><span>' + esc(f[1]) + '</span><input type="text" data-f="' + f[0] + '" value="' + esc((icp[f[0]] || []).join(', ')) + '"></label>';
    }).join('');
    return '<fieldset class="br-icp" data-offer="' + esc(offer) + '">' +
      '<div class="br-icp-h"><label class="br-icp-on"><input type="checkbox" data-f="on"' + (icp.on === false ? '' : ' checked') + '><span class="mr-hint">On</span></label>' +
        '<input type="text" class="br-icp-name" data-f="name" value="' + esc(icp.name || '') + '" placeholder="Who they are" aria-label="Profile name">' +
        '<button type="button" class="mr-btn small ghost" data-icp="remove">Remove</button></div>' +
      '<div class="br-icp-g"><label class="br-icp-f"><span>When to write</span><select data-f="trigger">' + opts + '</select></label>' +
        '<label class="br-icp-f"><span>New in role within (months)</span><input type="number" min="1" max="12" data-f="months" value="' + esc(icp.months || 3) + '"></label>' +
        '<label class="br-icp-f"><span>Company size from</span><input type="number" min="0" data-f="size_min" value="' + esc(icp.size_min || '') + '"></label>' +
        '<label class="br-icp-f"><span>to (employees)</span><input type="number" min="0" data-f="size_max" value="' + esc(icp.size_max || '') + '"></label>' +
        lists + '</div></fieldset>';
  }

  function readIcps(box) {
    return Array.prototype.slice.call(box.querySelectorAll('.br-icp')).map(function (f) {
      function v(k) { var el = f.querySelector('[data-f="' + k + '"]'); return el ? el.value : ''; }
      var out = { name: v('name'), trigger: v('trigger'), months: v('months'), size_min: v('size_min'), size_max: v('size_max'),
        on: f.querySelector('[data-f="on"]').checked };
      ICP_LISTS.forEach(function (x) { out[x[0]] = v(x[0]).split(',').map(function (t) { return t.trim(); }).filter(Boolean); });
      return out;
    });
  }

  function seqOptions(current, list) {
    var opts = '<option value="">No sequence: one email</option>';
    var seen = false;
    (list || []).forEach(function (q) {
      var step = (q.steps || [])[0];
      if (!step) return;
      var val = q.id + '|' + step.id + '|' + q.title;
      var on = current && current.id === q.id;
      seen = seen || on;
      opts += '<option value="' + esc(val) + '"' + (on ? ' selected' : '') + '>' + esc(q.title + (q.active ? '' : ' (paused)')) + '</option>';
    });
    if (current && current.id && !seen) {
      opts += '<option value="' + esc(current.id + '|' + current.step_id + '|' + (current.title || '')) + '" selected>' + esc(current.title || current.id) + '</option>';
    }
    return opts;
  }

  function renderSettings(s, offers, defaults, jobDefaults, extra) {
    var where = Object.keys(LEAD_SOURCES).map(function (k) {
      return sw('brSrc-' + k, (s.sources || []).indexOf(k) >= 0, LEAD_SOURCES[k][0], LEAD_SOURCES[k][1]);
    }).join('');
    var o = Object.keys(offers).map(function (k) {
      var on = (s.offers || []).indexOf(k) >= 0;
      var qs = ((s.queries || {})[k] || (defaults || {})[k] || offers[k].queries || []).join('\n');
      var js = ((s.job_queries || {})[k] || (jobDefaults || {})[k] || offers[k].jobs || []).join('\n');
      var rs = ((s.rfp_queries || {})[k] || ((extra && extra.rfpDefaults) || {})[k] || []).join('\n');
      var ds = ((s.reddit_queries || {})[k] || ((extra && extra.redditDefaults) || {})[k] || []).join('\n');
      var snd = (s.senders || {})[k] || {};
      return '<fieldset class="br-offer-set"><legend>' + sw('brOn-' + k, on, offers[k].label, offers[k].site) + '</legend>' +
        '<label class="mr-k" for="brQ-' + esc(k) + '">Post searches, one a line</label><textarea id="brQ-' + esc(k) + '" rows="5" data-offer="' + esc(k) + '">' + esc(qs) + '</textarea>' +
        '<div class="mr-hint">LinkedIn search words. Quotes for a phrase, AND / OR / NOT (5 at most a line). Clear the box to go back to the defaults.</div>' +
        '<label class="mr-k" for="brJ-' + esc(k) + '">Job titles that mean they need it, one a line</label><textarea id="brJ-' + esc(k) + '" rows="4">' + esc(js) + '</textarea>' +
        '<div class="mr-hint">A company advertising these jobs is doing the work in house. Clear the box to go back to the defaults.</div>' +
        '<label class="mr-k" for="brR-' + esc(k) + '">RFP searches, one a line</label><textarea id="brR-' + esc(k) + '" rows="3">' + esc(rs) + '</textarea>' +
        '<div class="mr-hint">Web searches for open RFPs and tenders; {year} is this year. About $0.03 each. Clear the box to go back to the defaults.</div>' +
        '<label class="mr-k" for="brRd-' + esc(k) + '">Reddit searches, one a line</label><textarea id="brRd-' + esc(k) + '" rows="3">' + esc(ds) + '</textarea>' +
        '<div class="mr-hint">Reddit&rsquo;s own search, the last month. Quotes for a phrase. Clear the box to go back to the defaults.</div>' +
        '<h5 class="br-icp-t">Customer profiles</h5><div class="br-icps" id="brIcps-' + esc(k) + '">' +
          (((extra && extra.icps) || {})[k] || []).map(function (x) { return renderIcp(x, k, extra); }).join('') + '</div>' +
        '<div class="br-icp-acts"><button type="button" class="mr-btn small ghost" data-icp="add" data-offer="' + esc(k) + '">Add a profile</button>' +
          '<input type="text" id="brIcpNotes-' + esc(k) + '" placeholder="Notes for Claude: who you sell to, where, what size" aria-label="Notes for Claude">' +
          '<button type="button" class="mr-btn small" data-icp="suggest" data-offer="' + esc(k) + '">Suggest with Claude</button></div>' +
        '<label class="mr-k" for="brSeq-' + esc(k) + '">Saleshandy sequence</label><select id="brSeq-' + esc(k) + '" data-seq="' + esc(k) + '">' +
          seqOptions((s.sequences || {})[k], null) + '</select>' +
        '<div class="mr-hint">Leads added to a sequence get Saleshandy&rsquo;s follow-ups. Pick one to use it.</div>' +
        '<div class="br-grid3"><div><label class="mr-k" for="brSn-' + esc(k) + '">Sender name</label><input type="text" id="brSn-' + esc(k) + '" value="' + esc(snd.name || '') + '"></div>' +
        '<div><label class="mr-k" for="brSt-' + esc(k) + '">Sender title</label><input type="text" id="brSt-' + esc(k) + '" value="' + esc(snd.title || '') + '"></div>' +
        '<div><label class="mr-k" for="brSe-' + esc(k) + '">Send from</label><input type="email" id="brSe-' + esc(k) + '" value="' + esc(snd.email || '') + '" placeholder="the platform sender"></div></div>' +
        '</fieldset>';
    }).join('');
    var posted = ['24h', 'week', 'month', '3months'].map(function (p) {
      return '<option value="' + p + '"' + (s.posted === p ? ' selected' : '') + '>' + { '24h': 'Last day', week: 'Last week', month: 'Last month', '3months': 'Last 3 months' }[p] + '</option>';
    }).join('');
    return '<h4 class="br-set-t">Where to look</h4>' + where +
      '<h4 class="br-set-t">What to look for</h4>' + o +
      '<div class="br-grid3"><div><label class="mr-k" for="brPosted">Posts: how far back</label><select id="brPosted">' + posted + '</select></div>' +
        numIn('brPer', 'Posts per search', s.per_query, 5, 100, 5) + numIn('brKeep', 'Keep leads scoring at least', s.keep_score, 0, 100, 5) + '</div>' +
      '<div class="br-grid3"><div><label class="mr-k" for="brJobLoc">Job ads in</label><input type="text" id="brJobLoc" value="' + esc((s.job_locations || []).join(', ')) + '" placeholder="Anywhere">' +
          '<div class="mr-hint">Up to 5 places, with commas: India, Dubai, London.</div></div>' +
        numIn('brJobDays', 'Job ads posted in the last (days)', s.jobs_days, 1, 30, 1) + numIn('brJobPer', 'Job ads per title', s.jobs_per_query, 5, 100, 5) + '</div>' +
      '<div class="br-grid3">' + numIn('brComPosts', 'Read the comments of the best', s.comment_posts, 0, 30, 1, 'posts kept in each search.') +
        numIn('brIcpN', 'People from customer profiles a search', s.icp_per_run, 0, 100, 5, 'All profiles together. Free to find; a message is written for each.') +
        numIn('brRfpDays', 'Search for RFPs every (days)', s.rfp_days, 1, 30, 1, 'An RFP stays open for weeks; each search is paid.') + '</div>' +
      '<div class="br-grid3">' + numIn('brRdPer', 'Reddit threads per search', s.reddit_per_query, 5, 100, 5) + '</div>' +
      '<h4 class="br-set-t">Every day</h4>' +
      sw('brDaily', s.daily, 'Search every day', 'Starts an hour before the time below; the Slack message goes out at that time. Skipped once this month\'s spend reaches the monthly cap.') +
      '<div class="br-grid3"><div><label class="mr-k" for="brHour">Slack message at (India time)</label><select id="brHour">' +
        Array.apply(null, Array(24)).map(function (_, h) {
          return '<option value="' + h + '"' + (Number(s.daily_hour) === h ? ' selected' : '') + '>' + hourLabel(h) + '</option>';
        }).join('') + '</select></div>' +
        numIn('brDailyN', 'New leads a search, about', s.daily_leads, 0, 100, 5, 'Customer profiles fill what the other places leave, so every day brings about this many. 0: no filling.') + '</div>' +
      '<h4 class="br-set-t">Google Sheet</h4>' +
      '<label class="mr-k" for="brSheet">Sheet link</label><input type="text" id="brSheet" value="' + esc(s.sheet_id ? 'https://docs.google.com/spreadsheets/d/' + s.sheet_id + '/edit' : '') + '" placeholder="https://docs.google.com/spreadsheets/d/...">' +
      '<div class="mr-hint">Every lead gets one row, never twice, with everything Buyer Radar knows; status, email and who was written to are kept up to date. ' +
        (((extra || {}).sheet || {}).email ? 'Share the sheet with <b>' + esc(extra.sheet.email) + '</b> as an Editor first.' : 'The service account (GOOGLE_SA_JSON) is not set on the service.') + '</div>' +
      '<div class="br-dr-acts"><button type="button" class="mr-btn small ghost" data-sheet="check">Check the sheet</button>' +
        '<button type="button" class="mr-btn small ghost" data-sheet="sync">Update the sheet now</button>' +
        (s.sheet_id ? link('https://docs.google.com/spreadsheets/d/' + s.sheet_id + '/edit', 'Open the sheet', 'mr-btn small ghost') : '') + '</div>' +
      '<div class="br-grid3">' + numIn('brCap', 'Most one search may cost ($)', s.run_cap_usd, 0.1, 20, 0.1) + numIn('brMonth', 'Monthly cap ($)', s.monthly_cap_usd, 1, 500, 1) +
        numIn('brAlert', 'Strong lead score', s.alert_score, 0, 100, 5, 'Posted to Slack and shown under Strong.') + '</div>' +
      '<div class="br-grid3"><div><label class="mr-k" for="brSlack">Slack channel</label><input type="text" id="brSlack" value="' + esc(s.slack_channel || '') + '" placeholder="#buyer-leads">' +
        '<div class="mr-hint">Invite the bot to the channel first.</div></div></div>' +
      '<h4 class="br-set-t">Sending for you</h4>' +
      '<p class="mr-callout warn">Automatic sending writes to strangers in your name. Start with a high score and low daily caps, and read the first messages it sends.</p>' +
      sw('brAutoEmail', s.auto_email, 'Email strong leads automatically', 'Only leads with an email address in their post, or found by Saleshandy below.') +
      sw('brAutoLi', s.auto_linkedin, 'Send on LinkedIn automatically', 'A connection request with the note, or a message if you are already connected.') +
      sw('brFind', s.find_emails, 'Find work emails with Saleshandy', 'One credit (about $0.026) per email found, only for leads about to be emailed.') +
      sw('brAutoSeq', s.auto_sequence, 'Add strong leads to the offer\'s Saleshandy sequence', 'In place of one email, for offers with a sequence chosen above. Saleshandy sends and follows up.') +
      '<label class="mr-k" for="brSeqField">Saleshandy field for the message written</label><input type="text" id="brSeqField" value="' + esc(s.sequence_field || '') + '" placeholder="Leave empty to send the sequence\'s own copy">' +
      '<div class="mr-hint">Make a custom field in Saleshandy (Settings &rarr; Prospect fields), name it here, and put it in the sequence&rsquo;s first email.</div>' +
      '<div class="br-grid3">' + numIn('brSend', 'Send only to leads scoring at least', s.send_score, 50, 100, 5) +
        numIn('brEcap', 'Emails a day, at most', s.daily_email_cap, 0, 100, 1) + numIn('brLcap', 'LinkedIn sends a day, at most', s.daily_linkedin_cap, 0, 80, 1, 'LinkedIn restricts accounts that send too many.') + '</div>' +
      '<label class="mr-k" for="brAddr">Postal address for the email footer</label><input type="text" id="brAddr" value="' + esc(s.postal_address || '') + '" placeholder="Company name, street, city, country">' +
      '<div class="mr-hint">Anti-spam laws (CAN-SPAM in the US) ask for one in every commercial email.</div>' +
      '<div class="br-set-foot"><span class="br-set-msg" id="brSetMsg" aria-live="polite"></span><button type="submit" class="mr-btn primary">Save settings</button></div>';
  }

  function readSettings($, offers) {
    var body = { offers: [], queries: {}, job_queries: {}, rfp_queries: {}, reddit_queries: {}, senders: {}, sources: [], icps: {}, sequences: {} };
    Object.keys(LEAD_SOURCES).forEach(function (k) { if ($('brSrc-' + k).checked) body.sources.push(k); });
    Object.keys(offers).forEach(function (k) {
      if ($('brOn-' + k).checked) body.offers.push(k);
      var q = $('brQ-' + k).value.trim();
      body.queries[k] = q ? q.split('\n') : [];
      var j = $('brJ-' + k).value.trim();
      body.job_queries[k] = j ? j.split('\n') : [];
      if ($('brR-' + k)) { var r = $('brR-' + k).value.trim(); body.rfp_queries[k] = r ? r.split('\n') : []; }
      if ($('brRd-' + k)) { var rd = $('brRd-' + k).value.trim(); body.reddit_queries[k] = rd ? rd.split('\n') : []; }
      if ($('brIcps-' + k)) body.icps[k] = readIcps($('brIcps-' + k));
      var sq = $('brSeq-' + k) ? $('brSeq-' + k).value.split('|') : [];
      if (sq.length >= 2 && sq[0]) body.sequences[k] = { id: sq[0], step_id: sq[1], title: sq.slice(2).join('|') };
      body.senders[k] = { name: $('brSn-' + k).value, title: $('brSt-' + k).value, email: $('brSe-' + k).value };
    });
    body.posted = $('brPosted').value;
    body.per_query = $('brPer').value;
    body.job_locations = $('brJobLoc').value;
    body.jobs_days = $('brJobDays').value;
    body.jobs_per_query = $('brJobPer').value;
    body.comment_posts = $('brComPosts').value;
    body.icp_per_run = $('brIcpN').value;
    body.daily_hour = $('brHour').value;
    body.daily_leads = $('brDailyN').value;
    body.sheet_id = $('brSheet').value.trim();
    body.rfp_days = $('brRfpDays').value;
    body.reddit_per_query = $('brRdPer').value;
    body.auto_sequence = $('brAutoSeq').checked;
    body.sequence_field = $('brSeqField').value;
    body.keep_score = $('brKeep').value;
    body.daily = $('brDaily').checked;
    body.run_cap_usd = $('brCap').value;
    body.monthly_cap_usd = $('brMonth').value;
    body.alert_score = $('brAlert').value;
    body.slack_channel = $('brSlack').value;
    body.auto_email = $('brAutoEmail').checked;
    body.auto_linkedin = $('brAutoLi').checked;
    body.find_emails = $('brFind').checked;
    body.send_score = $('brSend').value;
    body.daily_email_cap = $('brEcap').value;
    body.daily_linkedin_cap = $('brLcap').value;
    body.postal_address = $('brAddr').value;
    return body;
  }

  // "Strong" is the workspace's own strong-lead score (Settings), 70 until the status has loaded.
  function leadQuery(filter, strong) {
    if (filter === 'strong') return '?min=' + encodeURIComponent(strong == null ? 70 : strong);
    if (filter && filter.indexOf('offer:') === 0) return '?offer=' + encodeURIComponent(filter.slice(6));
    if (filter && filter.indexOf('source:') === 0) return '?source=' + encodeURIComponent(filter.slice(7));
    if (filter && filter !== 'all') return '?status=' + encodeURIComponent(filter);
    return '';
  }

  root.BR = { esc: esc, safeUrl: safeUrl, renderSource: renderSource, renderLead: renderLead, renderLeads: renderLeads, renderRuns: renderRuns,
    renderStats: renderStats, renderReady: renderReady, renderDrawer: renderDrawer, renderSettings: renderSettings,
    renderEstimate: renderEstimate, renderFilters: renderFilters, renderRedditDrawer: renderRedditDrawer, hourLabel: hourLabel, renderJobs: renderJobs, renderIcp: renderIcp, seqOptions: seqOptions, renderLive: renderLive, leadQuery: leadQuery, offers: {} };

  // ── the page ─────────────────────────────────────────────────────────────
  if (!DOC || !DOC.getElementById('br')) return;
  function $(id) { return DOC.getElementById(id); }
  var offerList = [];
  try { offerList = JSON.parse($('brOffers').textContent || '[]'); } catch (e) { offerList = []; }
  var OFFERS = {};
  offerList.forEach(function (o) { OFFERS[o.key] = o; });
  root.BR.offers = OFFERS;
  var state = { status: null, leads: [], filter: 'all', open: null, poll: null };

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
    if (opts.body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.data = j; throw e; }
        return j;
      });
    });
  }

  function confirmBox(title, text) {
    return new Promise(function (resolve) {
      $('brModalTitle').textContent = title;
      $('brModalText').textContent = text;
      var bg = $('brModal');
      bg.classList.add('open');
      $('brModalYes').focus();
      function done(v) { bg.classList.remove('open'); $('brModalYes').onclick = $('brModalNo').onclick = null; resolve(v); }
      $('brModalYes').onclick = function () { done(true); };
      $('brModalNo').onclick = function () { done(false); };
    });
  }

  function toast(msg, bad) {
    var t = DOC.createElement('div');
    t.className = 'br-toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    DOC.body.appendChild(t);
    setTimeout(function () { t.classList.add('go'); }, 3600);
    setTimeout(function () { t.remove(); }, 4200);
  }

  function loadStatus() {
    return api('/status').then(function (st) {
      state.status = st;
      $('brReady').innerHTML = renderReady(st);
      $('brStats').innerHTML = renderStats(st);
      if (!CLIENT && st.estimate) $('brEstimate').innerHTML = renderEstimate(st.estimate);
      if (!CLIENT && $('brSource')) $('brSource').innerHTML = renderSource(st.source, st.sources);
      if (!CLIENT && $('brSettings') && !$('brSettings').dataset.drawn) {
        $('brSettings').innerHTML = renderSettings(st.settings, OFFERS, st.defaults, st.job_defaults,
          { icps: st.icps, triggers: st.triggers, levels: st.levels, rfpDefaults: st.rfp_defaults, redditDefaults: st.reddit_defaults, sheet: st.sheet });
        $('brSettings').dataset.drawn = '1';
      }
      $('brRunBtn').disabled = !((st.ready.run == null ? st.ready.search : st.ready.run) && st.ready.claude);
      if (st.running) watch(st.running);
      return st;
    }).catch(function (e) { $('brReady').innerHTML = chip('bad', e.message); });
  }

  function loadLeads() {
    var strong = state.status && state.status.settings && state.status.settings.alert_score;
    return api('/leads' + leadQuery(state.filter, strong)).then(function (j) {
      state.leads = j.leads || [];
      $('brLeads').innerHTML = renderLeads(state.leads, state.filter);
    }).catch(function (e) { $('brLeads').innerHTML = '<div class="mr-empty">' + esc(e.message) + '</div>'; });
  }

  function loadRuns() {
    return api('/runs').then(function (j) { $('brRuns').innerHTML = renderRuns(j.runs); })
      .catch(function (e) { $('brRuns').innerHTML = '<div class="mr-empty">' + esc(e.message) + '</div>'; });
  }

  function watch(runId) {
    if (state.poll) return;
    $('brLive').hidden = false;
    $('brRunBtn').disabled = true;
    function tick() {
      api('/runs/' + runId).then(function (run) {
        $('brLive').innerHTML = renderLive(run);
        if (run.status === 'running' && !run.stale) { state.poll = setTimeout(tick, 4000); return; }
        state.poll = null;
        $('brLive').hidden = true;
        $('brRunBtn').disabled = false;
        if (run.status === 'failed') toast('The search stopped: ' + (run.error || 'unknown reason'), true);
        else toast('Done: ' + ((run.summary || {}).kept || 0) + ' new leads.');
        loadLeads(); loadRuns(); loadStatus();
      }).catch(function () { state.poll = setTimeout(tick, 8000); });
    }
    tick();
  }

  $('brRunBtn').addEventListener('click', function () {
    var est = state.status && state.status.estimate;
    var text = CLIENT ? 'Search LinkedIn for new posts now?' :
      'This searches LinkedIn and has Claude read every post. It usually costs about ' + money(est && est.typical_usd) +
      ' and never more than ' + money(est && Math.min(est.worst_usd, est.usd_cap)) + '.' +
      ((state.status.settings.auto_email || state.status.settings.auto_linkedin) ? ' Automatic sending is on: strong leads will be written to.' : '');
    confirmBox('Search LinkedIn now?', text).then(function (yes) {
      if (!yes) return;
      api('/runs', { method: 'POST', body: { confirm_spend: true } }).then(function (j) { watch(j.run_id); loadRuns(); })
        .catch(function (e) { toast(e.message, true); if (e.data && e.data.run_id) watch(e.data.run_id); });
    });
  });

  if ($('brSource')) {
    $('brSource').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-source]');
      if (!b || !state.status || b.getAttribute('data-source') === state.status.source) return;
      var to = b.getAttribute('data-source');
      api('/settings', { method: 'POST', body: { source: to } })
        .then(function () { toast('Searches now run through ' + (to === 'unipile' ? 'Unipile' : 'Apify') + '.'); return loadStatus(); })
        .catch(function (e) { toast(e.message, true); });
    });
  }

  // The file comes through fetch, not a plain link, so it carries the workspace (X-Account) like every call.
  $('brExport').addEventListener('click', function () {
    var btn = $('brExport');
    var strong = state.status && state.status.settings && state.status.settings.alert_score;
    btn.disabled = true;
    fetch(API + '/leads/export' + leadQuery(state.filter, strong), { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); });
        var m = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '');
        return r.blob().then(function (b) {
          var a = DOC.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = m ? m[1] : 'buyer-radar-leads.csv';
          DOC.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        });
      })
      .catch(function (e) { toast('Export failed: ' + e.message, true); })
      .then(function () { btn.disabled = false; });
  });

  $('brFilters').innerHTML = renderFilters(state.filter, OFFERS);
  $('brFilters').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.getAttribute('data-filter');
    $('brFilters').innerHTML = renderFilters(state.filter, OFFERS);
    loadLeads();
  });

  function leadById(id) { return state.leads.filter(function (l) { return String(l.id) === String(id); })[0]; }

  function openDrawer(lead) {
    state.open = lead;
    $('brDrawerTitle').textContent = 'Message ' + ((lead.post || {}).author || {}).name;
    $('brDrawerBody').innerHTML = renderDrawer(lead, state.status.ready || {}, state.status.settings);
    $('brDrawer').hidden = $('brDrawerBg').hidden = false;
    requestAnimationFrame(function () { $('brDrawer').classList.add('open'); });
    var note = $('brNote');
    if (note) {
      var n = function () { $('brNoteN').textContent = note.value.length + ' / 300'; };
      note.addEventListener('input', n); n();
    }
  }
  function closeDrawer() {
    $('brDrawer').classList.remove('open');
    $('brDrawer').hidden = $('brDrawerBg').hidden = true;
    state.open = null;
  }
  $('brDrawerClose').addEventListener('click', closeDrawer);
  $('brDrawerBg').addEventListener('click', closeDrawer);
  DOC.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) closeDrawer(); });

  function val(id) { return $(id) ? $(id).value : ''; }
  function draftFromDrawer() {
    return { subject: val('brSubj'), email: val('brBody'), note: val('brNote'), message: val('brMsg') };
  }
  function saveDrawer() {
    var lead = state.open, body = { draft: draftFromDrawer() };
    if ($('brTo')) body.email = $('brTo').value.trim();
    return api('/leads/' + lead.id, { method: 'POST', body: body })
      .then(function (j) { state.open = j.lead; return j.lead; });
  }

  $('brLeads').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var lead = leadById(b.getAttribute('data-id'));
    if (!lead) return;
    var act = b.getAttribute('data-act');
    if (act === 'open') openDrawer(lead);
    if (act === 'status') {
      api('/leads/' + lead.id, { method: 'POST', body: { status: b.getAttribute('data-status') } })
        .then(function () { loadLeads(); loadStatus(); }).catch(function (e) { toast(e.message, true); });
    }
  });

  $('brDrawerBody').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]');
    if (!b || !state.open) return;
    var act = b.getAttribute('data-act');
    if (act === 'save') {
      saveDrawer().then(function () { toast('Saved.'); loadLeads(); }).catch(function (e) { toast(e.message, true); });
    }
    if (act === 'copy') {
      var text = val('brMsg');
      (root.navigator && navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
        .then(function () { toast('Copied. Paste it in the thread.'); })
        .catch(function () { $('brMsg').select(); toast('Select and copy the reply.', true); });
    }
    if (act === 'status') {
      saveDrawer().then(function (lead) { return api('/leads/' + lead.id, { method: 'POST', body: { status: b.getAttribute('data-status') } }); })
        .then(function () { toast('Marked as contacted.'); closeDrawer(); loadLeads(); loadStatus(); })
        .catch(function (e) { toast(e.message, true); });
    }
    if (act === 'sequence') {
      var noEmail = !state.open.email;
      confirmBox('Add them to the Saleshandy sequence?', 'Saleshandy will send the sequence\'s emails and follow-ups to them.' +
        (noEmail ? ' Their email is not known yet: Saleshandy finds it as it adds them, for one credit.' : '')).then(function (yes) {
        if (!yes) return;
        b.disabled = true;
        saveDrawer().then(function (lead) {
          return api('/leads/' + lead.id + '/sequence', { method: 'POST', body: { confirm: true, reveal: noEmail } });
        }).then(function (j) { toast(j.detail.charAt(0).toUpperCase() + j.detail.slice(1) + '.'); closeDrawer(); loadLeads(); loadStatus(); })
          .catch(function (e) { b.disabled = false; toast(e.message, true); });
      });
    }
    if (act === 'find') {
      var who = DOC.querySelector('input[name="brWho"]:checked');
      confirmBox('Find their email?', 'Saleshandy looks up their work email. It spends one credit (about $0.026) if it finds one, and nothing if not.').then(function (yes) {
        if (!yes) return;
        b.disabled = true;
        api('/leads/' + state.open.id + '/find-email', { method: 'POST', body: { confirm: true, contact: who ? Number(who.value) : 0 } })
          .then(function (j) { toast('Found ' + j.lead.email + '.'); openDrawer(j.lead); loadLeads(); })
          .catch(function (e) { b.disabled = false; toast(e.message, true); });
      });
    }
    if (act === 'send') {
      var ch = b.getAttribute('data-channel');
      var who = ((state.open.post || {}).author || {}).name || 'them';
      var text = ch === 'email' ? 'Send this email to ' + ($('brTo').value.trim() || 'them') + ' now?' :
        'Send this on LinkedIn to ' + who + ' now? If you are not connected, it goes as a connection request with the note.';
      confirmBox(ch === 'email' ? 'Send the email?' : 'Send on LinkedIn?', text).then(function (yes) {
        if (!yes) return;
        b.disabled = true;
        saveDrawer().then(function (lead) {
          return api('/leads/' + lead.id + '/send', { method: 'POST', body: { channel: ch, confirm: true } });
        }).then(function (j) { toast(j.detail.charAt(0).toUpperCase() + j.detail.slice(1) + '.'); closeDrawer(); loadLeads(); loadStatus(); })
          .catch(function (e) { b.disabled = false; toast(e.message, true); });
      });
    }
  });

  if ($('brSetToggle')) {
    $('brSetToggle').addEventListener('click', function () {
      var f = $('brSettings'), open = f.hidden;
      f.hidden = !open;
      $('brSetToggle').setAttribute('aria-expanded', String(open));
      if (open && !f.dataset.seqs && state.status.ready.saleshandy) {
        f.dataset.seqs = '1';
        api('/sequences').then(function (j) {
          Object.keys(OFFERS).forEach(function (k) {
            var el = $('brSeq-' + k);
            if (el) el.innerHTML = seqOptions((state.status.settings.sequences || {})[k], j.sequences);
          });
        }).catch(function (e) { toast('Saleshandy sequences: ' + e.message, true); });
      }
    });
    // Customer profiles: add one, remove one, or have Claude suggest them (shown to edit, saved with Settings).
    // The Google Sheet: check it (sets up its tabs) or send what is not in it yet. Save the link first.
    $('brSettings').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-sheet]');
      if (!b) return;
      b.disabled = true;
      api('/sheet', { method: 'POST', body: { action: b.getAttribute('data-sheet') } })
        .then(function (j) { toast(j.detail || ('Sheet updated: ' + j.added + ' added, ' + j.updated + ' brought up to date.')); })
        .catch(function (e) { toast(e.message, true); })
        .then(function () { b.disabled = false; });
    });
    $('brSettings').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-icp]');
      if (!b) return;
      var what = b.getAttribute('data-icp');
      if (what === 'remove') { b.closest('.br-icp').remove(); return; }
      var k = b.getAttribute('data-offer'), box = $('brIcps-' + k);
      var extra = { triggers: state.status.triggers };
      if (what === 'add') { box.insertAdjacentHTML('beforeend', renderIcp({ trigger: 'new_in_role', months: 3 }, k, extra)); return; }
      if (what === 'suggest') {
        confirmBox('Ask Claude for customer profiles?', 'Claude reads ' + OFFERS[k].label + '\'s description and your notes and suggests profiles to edit. About a cent. Nothing is saved until you save Settings.').then(function (yes) {
          if (!yes) return;
          b.disabled = true;
          api('/icps/suggest', { method: 'POST', body: { offer: k, notes: $('brIcpNotes-' + k).value, confirm: true } })
            .then(function (j) {
              box.innerHTML = j.icps.map(function (x) { return renderIcp(x, k, extra); }).join('');
              toast('Claude suggested ' + j.icps.length + ' profiles. Save settings to keep them.');
            })
            .catch(function (e) { toast(e.message, true); })
            .then(function () { b.disabled = false; });
        });
      }
    });
    $('brSettings').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var msg = $('brSetMsg');
      msg.textContent = 'Saving…';
      msg.className = 'br-set-msg';
      api('/settings', { method: 'POST', body: readSettings($, OFFERS) }).then(function (j) {
        state.status.settings = j.settings;
        state.status.estimate = j.estimate;
        $('brEstimate').innerHTML = renderEstimate(j.estimate);
        msg.textContent = 'Saved.';
        msg.className = 'br-set-msg ok';
      }).catch(function (e) { msg.textContent = e.message; msg.className = 'br-set-msg bad'; });
    });
  }

  loadStatus();
  loadLeads();
  loadRuns();
})(typeof window !== 'undefined' ? window : this);
