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
  var STAGES = ['queued', 'searching', 'reading', 'drafting', 'sending emails', 'sending on LinkedIn', 'posting to Slack', 'done'];
  var STAGE_WORDS = { queued: 'Starting', searching: 'Searching LinkedIn', reading: 'Claude is reading the posts',
    drafting: 'Writing the messages', 'sending emails': 'Sending emails', 'sending on LinkedIn': 'Sending on LinkedIn',
    'posting to Slack': 'Posting to Slack', done: 'Done', failed: 'Stopped' };

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

  function renderLead(lead) {
    var p = lead.post || {}, v = lead.verdict || {}, a = p.author || {};
    var offers = (root.BR && root.BR.offers) || {};
    var st = STATUS[lead.status] || STATUS['new'];
    var sends = lead.sends || [];
    var sent = sends.filter(function (s) { return s.status === 'sent'; });
    var meta = [chip('br-offer br-offer--' + esc(lead.offer), (offers[lead.offer] || {}).label || lead.offer),
                chip('', INTENT[v.intent] || v.intent_label || ''), chip(st[0], st[1])];
    if (v.deadline) meta.push(chip('warn', 'By ' + v.deadline));
    if (v.region) meta.push(chip('', v.region));
    var did = sent.map(function (s) {
      return '<li>' + esc(s.channel === 'email' ? 'Emailed' : 'LinkedIn') + (s.to && s.channel === 'email' ? ' ' + esc(s.to) : '') +
        ' <span>' + esc(ago(s.at)) + (s.by === '' && !CLIENT ? ' · automatic' : '') + '</span></li>';
    }).join('');
    var acts = '';
    if (!CLIENT) {
      acts = '<button type="button" class="mr-btn small primary" data-act="open" data-id="' + esc(lead.id) + '">Message</button>';
    }
    acts += link(p.url, 'Open the post', 'mr-btn small ghost');
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
        '<details class="br-post-x"><summary>' + esc(excerpt(p.text, 220)) + '</summary><p>' + esc(p.text || '') + '</p>' +
          (v.reason ? '<p class="br-why"><b>Why Claude kept it:</b> ' + esc(v.reason) + '</p>' : '') + '</details>' +
        (did ? '<ul class="br-did">' + did + '</ul>' : '') +
        '<div class="br-acts">' + acts + '</div>' +
      '</div></article>';
  }

  function renderLeads(leads, filter) {
    if (!leads || !leads.length) {
      return '<div class="br-none"><b>' + (filter && filter !== 'all' ? 'Nothing here with this filter.' : 'No leads yet.') + '</b>' +
        '<span>' + (filter && filter !== 'all' ? 'Try another filter.' : 'Search LinkedIn now, or switch on the daily search in Settings.') + '</span></div>';
    }
    return leads.map(renderLead).join('');
  }

  function renderFilters(cur, offers) {
    var f = [['all', 'All'], ['strong', 'Strong'], ['new', 'New'], ['contacted', 'Contacted'], ['replied', 'Replied'], ['dismissed', 'Not a fit']];
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
        if (s.read != null && s.read !== s.posts) bits.push(s.read + ' read by Claude');
        if (s.source) bits.push('via ' + (s.source === 'unipile' ? 'Unipile' : 'Apify'));
        if (s.strong) bits.push(s.strong + ' strong');
        if (s.emailed || s.messaged) bits.push(((s.emailed || 0) + (s.messaged || 0)) + ' written to');
      }
      if (!CLIENT && r.spent_usd != null) bits.push(money(r.spent_usd));
      return '<li id="run-' + esc(r.id) + '" class="br-r br-r--' + esc(r.status) + '"><span class="br-r-dot"></span><span class="br-r-t"><b>' + esc(label) + '</b>' +
        '<small>' + esc((r.trigger === 'daily' ? 'Daily · ' : '') + ago(r.created_at)) + (bits.length ? ' · ' + esc(bits.join(' · ')) : '') + '</small>' +
        (r.status === 'failed' && r.error ? '<small class="br-err">' + esc(r.error) + '</small>' : '') +
        (r.status === 'ready' && !s.kept ? renderClosest(s.closest) : '') + '</span></li>';
    }).join('') + '</ol>';
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
    var steps = ['searching', 'reading', 'drafting'].map(function (k) {
      var i = STAGES.indexOf(k);
      return '<li class="' + (i < at ? 'done' : i === at ? 'now' : '') + '">' + esc(STAGE_WORDS[k]) + '</li>';
    }).join('');
    var n = [];
    if (s.posts) n.push(s.posts + ' posts found');
    if (s.read) n.push(s.read + ' read');
    if (s.kept) n.push(s.kept + ' kept');
    return '<ol class="br-steps-live">' + steps + '</ol>' + (n.length ? '<p class="br-live-n">' + esc(n.join(' · ')) + '</p>' : '');
  }

  function renderEstimate(est) {
    if (!est) return '';
    var uni = est.source === 'unipile';
    return (uni ? '<p class="br-cost">The search is free through Unipile; Claude reading the posts is the cost.</p>' : '') +
      '<p class="br-cost">Usually about ' + esc(money(est.typical_usd)) + ', never more than ' + esc(money(Math.min(est.worst_usd, est.usd_cap))) + ' (the run\'s cap). Every day for a month: up to ' + esc(money(est.month_usd)) + '.</p>';
  }

  // ── the message drawer ───────────────────────────────────────────────────
  function renderDrawer(lead, ready) {
    var d = lead.draft || {}, p = lead.post || {}, a = p.author || {};
    var person = String(lead.person || '');
    var sentOn = {};
    (lead.sends || []).forEach(function (s) { if (s.status === 'sent') sentOn[s.channel] = s; });
    var company = person.indexOf('company/') === 0;
    function sentLine(ch) {
      var s = sentOn[ch];
      return s ? '<p class="mr-callout ok">Already sent ' + esc(ago(s.at)) + '. Nobody is written to twice.</p>' : '';
    }
    return '<p class="br-dr-who"><b>' + esc(a.name || 'Someone') + '</b> ' + esc(excerpt(a.headline, 90)) + '</p>' +
      '<blockquote class="br-dr-post">' + esc(excerpt(p.text, 420)) + '</blockquote>' +
      (lead.draft ? '' : '<p class="mr-callout warn">No message was written for this lead (the run reached its cost cap). Write one below.</p>') +
      '<section class="br-dr-sec"><h5>Email</h5>' + sentLine('email') +
        '<label class="mr-k" for="brTo">To</label><input type="email" id="brTo" value="' + esc(lead.email || '') + '" placeholder="Their email address">' +
        '<div class="mr-hint">' + (lead.email_source === 'post' ? 'From their post: they asked to be written to here.' : lead.email_source === 'saleshandy' ? 'Found by Saleshandy.' : 'Not in the post. Type it in if you have it.') + '</div>' +
        '<label class="mr-k" for="brSubj">Subject</label><input type="text" id="brSubj" maxlength="120" value="' + esc(d.subject || '') + '">' +
        '<label class="mr-k" for="brBody">Message</label><textarea id="brBody" rows="8">' + esc(d.email || '') + '</textarea>' +
        '<div class="mr-hint">Your name and an opt-out line are added at the bottom.</div>' +
        '<div class="br-dr-acts"><button type="button" class="mr-btn primary" data-act="send" data-channel="email"' + (ready.email && !sentOn.email ? '' : ' disabled') + '>Send email</button>' +
        (ready.email ? '' : '<span class="mr-hint">Email is not set up on the service.</span>') + '</div></section>' +
      '<section class="br-dr-sec"><h5>LinkedIn</h5>' + sentLine('linkedin') +
        (company ? '<p class="mr-hint">This post is from a company page; LinkedIn messages go to people.</p>' :
        '<label class="mr-k" for="brNote">Connection note <span class="br-n" id="brNoteN"></span></label><textarea id="brNote" rows="4" maxlength="300">' + esc(d.note || '') + '</textarea>' +
        '<div class="mr-hint">Sent with a connection request when you are not connected yet.</div>' +
        '<label class="mr-k" for="brMsg">Message, if you are already connected</label><textarea id="brMsg" rows="5" maxlength="1000">' + esc(d.message || '') + '</textarea>' +
        '<div class="br-dr-acts"><button type="button" class="mr-btn primary" data-act="send" data-channel="linkedin"' + (ready.linkedin && !sentOn.linkedin ? '' : ' disabled') + '>Send on LinkedIn</button>' +
        (ready.linkedin ? '' : '<span class="mr-hint">LinkedIn is not set up on the service.</span>') + '</div>') + '</section>' +
      '<div class="br-dr-foot"><button type="button" class="mr-btn ghost" data-act="save">Save changes</button>' + link(p.url, 'Open the post', 'mr-btn ghost') + '</div>';
  }

  // ── settings ─────────────────────────────────────────────────────────────
  function sw(id, on, title, sub) {
    return '<label class="br-sw"><input type="checkbox" id="' + esc(id) + '"' + (on ? ' checked' : '') + '><span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span></label>';
  }
  function numIn(id, label, val, min, max, step, hint) {
    return '<div class="br-num"><label class="mr-k" for="' + esc(id) + '">' + esc(label) + '</label><input type="number" id="' + esc(id) + '" value="' + esc(val) +
      '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '">' + (hint ? '<div class="mr-hint">' + esc(hint) + '</div>' : '') + '</div>';
  }

  function renderSettings(s, offers, defaults) {
    var o = Object.keys(offers).map(function (k) {
      var on = (s.offers || []).indexOf(k) >= 0;
      var qs = ((s.queries || {})[k] || (defaults || {})[k] || offers[k].queries || []).join('\n');
      var snd = (s.senders || {})[k] || {};
      return '<fieldset class="br-offer-set"><legend>' + sw('brOn-' + k, on, offers[k].label, offers[k].site) + '</legend>' +
        '<label class="mr-k" for="brQ-' + esc(k) + '">Searches, one a line</label><textarea id="brQ-' + esc(k) + '" rows="5" data-offer="' + esc(k) + '">' + esc(qs) + '</textarea>' +
        '<div class="mr-hint">LinkedIn search words. Quotes for a phrase, AND / OR / NOT (5 at most a line). Clear the box to go back to the defaults.</div>' +
        '<div class="br-grid3"><div><label class="mr-k" for="brSn-' + esc(k) + '">Sender name</label><input type="text" id="brSn-' + esc(k) + '" value="' + esc(snd.name || '') + '"></div>' +
        '<div><label class="mr-k" for="brSt-' + esc(k) + '">Sender title</label><input type="text" id="brSt-' + esc(k) + '" value="' + esc(snd.title || '') + '"></div>' +
        '<div><label class="mr-k" for="brSe-' + esc(k) + '">Send from</label><input type="email" id="brSe-' + esc(k) + '" value="' + esc(snd.email || '') + '" placeholder="the platform sender"></div></div>' +
        '</fieldset>';
    }).join('');
    var posted = ['24h', 'week', 'month', '3months'].map(function (p) {
      return '<option value="' + p + '"' + (s.posted === p ? ' selected' : '') + '>' + { '24h': 'Last day', week: 'Last week', month: 'Last month', '3months': 'Last 3 months' }[p] + '</option>';
    }).join('');
    return '<h4 class="br-set-t">What to look for</h4>' + o +
      '<div class="br-grid3"><div><label class="mr-k" for="brPosted">How far back</label><select id="brPosted">' + posted + '</select></div>' +
        numIn('brPer', 'Posts per search', s.per_query, 5, 100, 5) + numIn('brKeep', 'Keep leads scoring at least', s.keep_score, 0, 100, 5) + '</div>' +
      '<h4 class="br-set-t">Every day</h4>' +
      sw('brDaily', s.daily, 'Search LinkedIn every day', 'Once a day, early morning India time. Skipped once this month\'s spend reaches the monthly cap.') +
      '<div class="br-grid3">' + numIn('brCap', 'Most one search may cost ($)', s.run_cap_usd, 0.1, 20, 0.1) + numIn('brMonth', 'Monthly cap ($)', s.monthly_cap_usd, 1, 500, 1) +
        numIn('brAlert', 'Strong lead score', s.alert_score, 0, 100, 5, 'Posted to Slack and shown under Strong.') + '</div>' +
      '<div class="br-grid3"><div><label class="mr-k" for="brSlack">Slack channel</label><input type="text" id="brSlack" value="' + esc(s.slack_channel || '') + '" placeholder="#buyer-leads">' +
        '<div class="mr-hint">Invite the bot to the channel first.</div></div></div>' +
      '<h4 class="br-set-t">Sending for you</h4>' +
      '<p class="mr-callout warn">Automatic sending writes to strangers in your name. Start with a high score and low daily caps, and read the first messages it sends.</p>' +
      sw('brAutoEmail', s.auto_email, 'Email strong leads automatically', 'Only leads with an email address in their post, or found by Saleshandy below.') +
      sw('brAutoLi', s.auto_linkedin, 'Send on LinkedIn automatically', 'A connection request with the note, or a message if you are already connected.') +
      sw('brFind', s.find_emails, 'Find work emails with Saleshandy', 'One credit (about $0.026) per email found, only for leads about to be emailed.') +
      '<div class="br-grid3">' + numIn('brSend', 'Send only to leads scoring at least', s.send_score, 50, 100, 5) +
        numIn('brEcap', 'Emails a day, at most', s.daily_email_cap, 0, 100, 1) + numIn('brLcap', 'LinkedIn sends a day, at most', s.daily_linkedin_cap, 0, 80, 1, 'LinkedIn restricts accounts that send too many.') + '</div>' +
      '<label class="mr-k" for="brAddr">Postal address for the email footer</label><input type="text" id="brAddr" value="' + esc(s.postal_address || '') + '" placeholder="Company name, street, city, country">' +
      '<div class="mr-hint">Anti-spam laws (CAN-SPAM in the US) ask for one in every commercial email.</div>' +
      '<div class="br-set-foot"><span class="br-set-msg" id="brSetMsg" aria-live="polite"></span><button type="submit" class="mr-btn primary">Save settings</button></div>';
  }

  function readSettings($, offers) {
    var body = { offers: [], queries: {}, senders: {} };
    Object.keys(offers).forEach(function (k) {
      if ($('brOn-' + k).checked) body.offers.push(k);
      var q = $('brQ-' + k).value.trim();
      body.queries[k] = q ? q.split('\n') : [];
      body.senders[k] = { name: $('brSn-' + k).value, title: $('brSt-' + k).value, email: $('brSe-' + k).value };
    });
    body.posted = $('brPosted').value;
    body.per_query = $('brPer').value;
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
    if (filter && filter !== 'all') return '?status=' + encodeURIComponent(filter);
    return '';
  }

  root.BR = { esc: esc, safeUrl: safeUrl, renderSource: renderSource, renderLead: renderLead, renderLeads: renderLeads, renderRuns: renderRuns,
    renderStats: renderStats, renderReady: renderReady, renderDrawer: renderDrawer, renderSettings: renderSettings,
    renderEstimate: renderEstimate, renderFilters: renderFilters, renderLive: renderLive, leadQuery: leadQuery, offers: {} };

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
        $('brSettings').innerHTML = renderSettings(st.settings, OFFERS, st.defaults);
        $('brSettings').dataset.drawn = '1';
      }
      $('brRunBtn').disabled = !(st.ready.search && st.ready.claude);
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
    $('brDrawerBody').innerHTML = renderDrawer(lead, state.status.ready || {});
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

  function draftFromDrawer() {
    return { subject: $('brSubj').value, email: $('brBody').value,
             note: $('brNote') ? $('brNote').value : '', message: $('brMsg') ? $('brMsg').value : '' };
  }
  function saveDrawer() {
    var lead = state.open;
    return api('/leads/' + lead.id, { method: 'POST', body: { email: $('brTo').value.trim(), draft: draftFromDrawer() } })
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
