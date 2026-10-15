/* ADMIN PANEL (/admin) -- draws every section from its own JSON route.

   /admin/panel/spend?days=N   what every agent cost, by workspace, agent and person
   /admin/panel/team           staff sign-ins and page views
   /admin/panel/clients        the client workspaces shared with clients
   /admin/panel/traffic        the public site's visitors and sign-ins
   /admin/panel/inbox          access requests, feedback on agent reports, public agent use
   /admin/panel/account/<slug>   one shared workspace, in full, for the side panel

   A section that fails says so in place and offers a retry; the rest of the page is unaffected.
   Every value that came from a server is escaped (esc) before it is written into markup. */
(function () {
  'use strict';

  var S = { days: 30, tab: 'workspaces', spend: null, team: null, clients: null, traffic: null, inbox: null,
            agentColour: {}, query: '', reqTab: 'form', open: {}, acct: '' };

  // ── helpers ───────────────────────────────────────────────────────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { return (+v || 0).toLocaleString('en-US'); }
  function usd(v) {
    v = +v || 0;
    if (v >= 1000) return '$' + Math.round(v).toLocaleString('en-US');
    if (v >= 100) return '$' + v.toFixed(0);
    if (v >= 0.01 || v === 0) return '$' + v.toFixed(2);
    if (v < 0.001) return '<$0.001';
    return '$' + v.toFixed(3);
  }
  function pct(v) { return (+v || 0).toFixed(1).replace(/\.0$/, '') + '%'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function ago(iso) {
    if (!iso) return '—';
    var t = Date.parse(iso);
    if (isNaN(t)) return String(iso).slice(0, 16);
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + ' d ago';
    return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function dayLabel(iso) {
    var d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? String(iso) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function initials(name) {
    var p = String(name || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  var AV = ['--sky', '--cream', '--acc', '--clay', '--sky-hi', '--acc-hi'];
  function avColour(seed) {
    var h = 0; String(seed || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return 'var(' + AV[h % AV.length] + ')';
  }
  function avatar(name, seed, big) {
    return '<span class="ctl-av' + (big ? ' ctl-av--lg' : '') + '" style="background:' + avColour(seed || name) + '">' + esc(initials(name)) + '</span>';
  }
  function setText(sel, text) { var e = $(sel); if (e) e.textContent = text; }

  // The colours a chart takes, in rank order: ink, orange, sky, amber, red, green; the rest are stone.
  var RANK = ['--ink', '--acc', '--sky', '--cream', '--clay', '--ok'];
  function rankColour(i) { return 'var(' + (RANK[i] || '--tx3') + ')'; }
  function agentColour(slug) { return S.agentColour[slug] || 'var(--tx3)'; }
  // On the ink card the ink colour would vanish, so the paper colour stands in for it.
  function onInk(c) { return c === 'var(--ink)' ? 'var(--tx-on-ink)' : c; }

  function skeleton() {
    return '<div class="ctl-card"><div class="ctl-skel"><i class="bn-skel tall bn-sweep"></i><i class="bn-skel bn-sweep" style="width:62%"></i><i class="bn-skel bn-sweep" style="width:44%"></i></div></div>';
  }
  function failed(section, msg) {
    return '<div class="ctl-fail"><div><b>This section could not be loaded.</b><span>' + esc(msg || 'Try again in a moment.') +
      '</span></div><button type="button" data-retry="' + esc(section) + '">Try again</button></div>';
  }
  function body(section) { return $('#' + section + 'Body'); }

  function getJSON(url) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('The server answered ' + r.status + '.'));
        return j;
      });
    });
  }
  function postJSON(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify(body) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('The server answered ' + r.status + '.'));
        return j;
      });
    });
  }
  function csv(filename, head, rows) {
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var text = [head.map(q).join(',')].concat(rows.map(function (r) { return r.map(q).join(','); })).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ── charts ────────────────────────────────────────────────────────────────
  // columns: [{label, parts:[[value, colour]...], now}], drawn as stacked columns the height of their total
  function columns(cols, opts) {
    opts = opts || {};
    var max = 0;
    cols.forEach(function (c) { c.total = c.parts.reduce(function (a, p) { return a + p[0]; }, 0); max = Math.max(max, c.total); });
    var html = cols.map(function (c) {
      var h = max ? Math.max(c.total ? 3 : 0, (c.total / max) * 100) : 0;
      var segs = c.parts.filter(function (p) { return p[0] > 0; }).map(function (p) {
        return '<i style="height:' + (p[0] / c.total * 100) + '%;background:' + p[1] + '"></i>';
      }).join('');
      return '<div class="ctl-col' + (c.total ? '' : ' is-zero') + (c.now ? ' is-now' : '') + '" title="' + esc(c.title) + '">' +
        '<span class="ctl-colv" style="height:' + h + '%">' + segs + '</span></div>';
    }).join('');
    var ax = cols.length ? '<div class="ctl-axis"><span>' + esc(cols[0].label) + '</span><span>' + esc(cols[Math.floor(cols.length / 2)].label) +
      '</span><span>' + esc(cols[cols.length - 1].label) + '</span></div>' : '';
    return '<div class="ctl-chart' + (opts.short ? ' ctl-chart--short' : '') + '" role="img" aria-label="' + esc(opts.aria || 'Chart') + '">' + html + '</div>' + ax;
  }
  function spark(values, colour) {
    var max = Math.max.apply(null, values.concat([0.0000001])), w = 64, h = 18, n = values.length;
    if (n < 2) return '';
    var d = values.map(function (v, i) {
      return (i ? 'L' : 'M') + (i * w / (n - 1)).toFixed(1) + ' ' + (h - 2 - (v / max) * (h - 4)).toFixed(1);
    }).join('');
    return '<svg class="ctl-spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" style="color:' + colour + '"><path d="' + d + '"/></svg>';
  }
  function ranked(items, opts) {
    opts = opts || {};
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([0.0000001]));
    return '<ul class="ctl-rank">' + items.map(function (i, idx) {
      return '<li><span class="nm">' + (i.colour ? '<i class="ctl-dot" style="background:' + i.colour + '"></i>' : '') + '<span>' + esc(i.name) + '</span>' + (i.spark || '') +
        '</span><span class="v">' + esc(i.text) + '</span><span class="bar"><i style="width:' + Math.max(2, (i.value / max) * 100) + '%;background:' +
        (i.colour || (idx === 0 ? 'var(--acc)' : 'var(--ink)')) + '"></i></span>' + (i.meta ? '<span class="meta">' + esc(i.meta) + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function pairs(list, name) { return (list || []).map(function (p) { return { name: p[0] || '—', value: p[1], text: num(p[1]) }; }); }

  // ── SPEND ─────────────────────────────────────────────────────────────────
  function renderSpend(d) {
    S.spend = d;
    S.agentColour = {};
    d.agents.forEach(function (a, i) { S.agentColour[a.agent] = rankColour(i); });
    var top = d.agents.slice(0, 5), topIds = top.map(function (a) { return a.agent; });
    var cols = d.series.map(function (p, i) {
      var parts = top.map(function (a) { return [a.spark[i] || 0, agentColour(a.agent)]; });
      var other = p.usd - parts.reduce(function (s, x) { return s + x[0]; }, 0);
      parts.push([Math.max(0, other), 'var(--tx3)']);
      return { label: dayLabel(p.day), title: dayLabel(p.day) + ': ' + usd(p.usd), parts: parts, now: i === d.series.length - 1 };
    });
    var change = d.change_pct == null
      ? '<span class="ctl-pill">No earlier spend to compare</span>'
      : '<span class="ctl-pill ' + (d.change_pct > 0 ? 'ctl-pill--up' : 'ctl-pill--down') + '">' + (d.change_pct > 0 ? '▲ ' : '▼ ') + pct(Math.abs(d.change_pct)) +
        ' vs the ' + d.days + ' days before (' + usd(d.previous) + ')</span>';
    var legend = top.map(function (a) { return '<span><i style="background:' + agentColour(a.agent) + '"></i>' + esc(a.label) + '</span>'; }).join('') +
      (d.agents.length > top.length ? '<span><i style="background:var(--tx3)"></i>Other</span>' : '');

    var chart = '<div class="ctl-card"><div class="ctl-card-h"><h3>Spend per day</h3><span>last ' + d.days + ' days, by agent</span></div>' +
      '<div class="ctl-big"><b>' + usd(d.total) + '</b>' + change + '</div>' +
      '<div class="ctl-mini"><div><b>' + usd(d.per_day) + '</b><span>a day on average</span></div><div><b>' + usd(d.projected_month) +
      '</b><span>at this pace, a month</span></div><div><b>' + usd(d.today) + '</b><span>today so far</span></div><div><b>' + num(d.calls) +
      '</b><span>paid calls</span></div></div>' + columns(cols, { aria: 'Spend per day' }) + '<div class="ctl-legend">' + legend + '</div></div>';

    var agents = '<div class="ctl-card ctl-card--ink"><div class="ctl-card-h"><h3>By agent</h3><span>' + plural(d.agents.length, 'agent') + ' with spend</span></div>' +
      (d.agents.length ? ranked(d.agents.slice(0, 8).map(function (a) {
        return { name: a.label, value: a.usd, text: usd(a.usd), colour: onInk(agentColour(a.agent)), spark: spark(a.spark, onInk(agentColour(a.agent))),
                 meta: pct(a.share) + ' · ' + plural(a.calls, 'call') + ' · ' + plural(a.workspaces, 'workspace') };
      })) : '<div class="ctl-empty">No agent has spent anything in this period.</div>') + '</div>';

    var empty = d.total === 0 && !d.agents.length;
    var html = (d.missing.length ? '<div class="ctl-warn"><b>Some ledgers could not be read:</b> ' + esc(d.missing.join(', ')) +
      '. The figures below leave them out; the list at the bottom says why.</div>' : '') +
      '<div class="ctl-two">' + chart + agents + '</div>' + breakdown(d) + heat(d) + credits(d) + ledgers(d);
    if (empty && !d.missing.length) html = '<div class="ctl-card"><div class="ctl-empty"><b>No spend recorded in the last ' + d.days + ' days.</b>Every agent&rsquo;s ledger was read; none has a paid call in this period.</div></div>' + ledgers(d);
    body('spend').innerHTML = html;
    updateFigs();
    if (S.team) renderTeam(S.team);
    if (S.clients) renderClients(S.clients);
  }

  function rowsFor(d, tab) {
    if (tab === 'agents') return d.agents.map(function (a) { return { key: a.agent, name: a.label, sub: plural(a.people, 'person', 'people') + ' · ' + plural(a.workspaces, 'workspace'), usd: a.usd, share: a.share, calls: a.calls, top: '', last: '', tag: '' }; });
    if (tab === 'people') return d.people.map(function (p) {
      return { key: p.email, name: p.name, sub: p.email || 'Work filed under a client account with no name kept', usd: p.usd, share: p.share, calls: p.calls, top: labelOf(d, p.top_agent), last: p.last, tag: !p.recorded ? '' : (p.staff ? 'Staff' : 'Client') };
    });
    return d.workspaces.map(function (w) {
      return { key: w.space, name: w.name, sub: plural(w.people, 'person', 'people'), usd: w.usd, share: w.share, calls: w.calls, top: labelOf(d, w.top_agent), last: w.last, tag: w.general ? 'Personal' : 'Client workspace' };
    });
  }
  function labelOf(d, slug) { var a = d.agents.filter(function (x) { return x.agent === slug; })[0]; return a ? a.label : ''; }

  function breakdown(d) {
    var rows = rowsFor(d, S.tab), q = S.query.trim().toLowerCase();
    var shown = q ? rows.filter(function (r) { return (r.name + ' ' + r.sub).toLowerCase().indexOf(q) >= 0; }) : rows;
    var strip = rows.slice(0, 8).map(function (r, i) { return '<i style="flex:' + r.usd + ' 1 0;background:' + rankColour(i) + '" title="' + esc(r.name + ': ' + usd(r.usd)) + '"></i>'; }).join('');
    var tabs = [['workspaces', 'Workspaces'], ['agents', 'Agents'], ['people', 'People']].map(function (t) {
      return '<button type="button" data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' class="is-on" aria-pressed="true"' : '') + '>' + t[1] + '</button>';
    }).join('');
    var th = S.tab === 'agents' ? '<th>Agent</th><th class="r">Spent</th><th>Share</th><th class="r">Calls</th>'
      : '<th>' + (S.tab === 'people' ? 'Person' : 'Workspace') + '</th><th class="r">Spent</th><th>Share</th><th class="r">Calls</th><th>Mostly</th><th>Last spend</th>';
    var maxShare = Math.max.apply(null, rows.map(function (r) { return r.share; }).concat([0.0001]));
    var tr = shown.map(function (r) {
      var who = S.tab === 'people' ? '<span class="ctl-who">' + avatar(r.name, r.key) + '<span><b>' + esc(r.name) + '</b><small>' + esc(r.sub) + '</small></span></span>'
        : '<span class="ctl-who"><span><b>' + esc(r.name) + '</b><small>' + esc(r.sub) + '</small></span></span>';
      var tag = r.tag ? ' <span class="ctl-pill' + (r.tag === 'Staff' ? ' ctl-pill--sky' : (r.tag === 'Client' || r.tag === 'Client workspace' ? ' ctl-pill--acc' : '')) + '">' + esc(r.tag) + '</span>' : '';
      return '<tr><td>' + who + '</td><td class="r strong">' + usd(r.usd) + '</td><td><span class="ctl-share"><i style="width:' + Math.max(3, r.share / maxShare * 100) + '%"></i></span>' + pct(r.share) + '</td><td class="r">' + num(r.calls) + '</td>' +
        (S.tab === 'agents' ? '' : '<td>' + esc(r.top || '—') + tag + '</td><td>' + esc(ago(r.last)) + '</td>') + '</tr>';
    }).join('');
    return '<div class="ctl-card"><div class="ctl-tools"><div class="ctl-tabs" role="group" aria-label="Group spend by">' + tabs + '</div>' +
      '<label class="ctl-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><input type="search" id="spendQ" placeholder="Search ' + S.tab + '" value="' + esc(S.query) + '"></label></div>' +
      (rows.length ? '<div class="ctl-strip" aria-hidden="true">' + strip + '</div>' : '') +
      (shown.length ? '<div class="ctl-scroll"><table class="ctl-table"><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table></div>'
        : '<div class="ctl-empty">' + (q ? 'Nothing matches &ldquo;' + esc(S.query) + '&rdquo;.' : 'Nothing has been spent in this period.') + '</div>') + '</div>';
  }

  function heat(d) {
    var g = d.grid;
    if (!g.rows.length || !g.agents.length) return '';
    var max = 0; g.rows.forEach(function (r) { r.cells.forEach(function (c) { max = Math.max(max, c); }); });
    var head = '<tr><th></th>' + g.agents.map(function (a) { return '<th class="colh">' + esc(a.label) + '</th>'; }).join('') + '<th></th></tr>';
    var rows = g.rows.map(function (r) {
      return '<tr><th class="rowh" title="' + esc(r.name) + '">' + esc(r.name) + '</th>' + r.cells.map(function (c) {
        var step = !c ? '' : (c / max < .1 ? 'h1' : (c / max < .3 ? 'h2' : (c / max < .6 ? 'h3' : 'h4')));
        return '<td class="' + step + '" title="' + esc(r.name + ' · ' + usd(c)) + '">' + (c ? usd(c) : '·') + '</td>';
      }).join('') + '<td class="tot">' + usd(r.total) + '</td></tr>';
    }).join('');
    return '<div class="ctl-card"><div class="ctl-card-h"><h3>Workspace by agent</h3><span>the costliest ' + g.rows.length + ' workspaces; deeper red is more money</span></div>' +
      '<div class="ctl-scroll"><table class="ctl-grid"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function credits(d) {
    if (!d.credits.length) return '';
    return '<div class="ctl-card"><div class="ctl-card-h"><h3>Credits, not dollars</h3><span>these agents are paid for in credits, so they are not in the totals above</span></div><div class="ctl-chips">' +
      d.credits.map(function (c) { return '<span class="ctl-pill ctl-pill--sky">' + esc(c.label) + ' &middot; ' + num(c.credits) + ' credits</span>'; }).join('') + '</div></div>';
  }
  function ledgers(d) {
    var ok = d.sources.filter(function (s) { return s.ok; }).length;
    return '<details class="ctl-ledgers"><summary>Ledgers read: ' + ok + ' of ' + d.sources.length + '</summary><ul>' + d.sources.map(function (s) {
      return '<li class="' + (s.ok ? '' : 'bad') + '"><b>' + esc(s.label) + '</b><span>' + esc(s.ok ? (s.runs ? plural(s.runs, 'row') + ' in range' : (s.note || 'none in range')) : s.note) + '</span></li>';
    }).join('') + '</ul></details>';
  }

  // ── TEAM ──────────────────────────────────────────────────────────────────
  function spendOf(email) {
    var p = S.spend && S.spend.people.filter(function (x) { return x.email === (email || '').toLowerCase(); })[0];
    return p ? p.usd : 0;
  }
  function renderTeam(d) {
    S.team = d;
    var k = d.kpis, q = (S.teamQ || '').toLowerCase();
    var days = (d.login_days || []).map(function (p) { return { label: dayLabel(p[0]), title: dayLabel(p[0]) + ': ' + plural(p[1], 'sign-in'), parts: [[p[1], 'var(--ink)']] }; });
    var users = d.users.filter(function (u) { return !q || (u.name + ' ' + u.email).toLowerCase().indexOf(q) >= 0; });
    var rows = users.map(function (u) {
      var open = S.open[u.email];
      var detail = (u.recent || []).length ? '<ul class="ctl-dsec" style="padding:0;list-style:none;margin:0">' + u.recent.map(function (e) {
        return '<li style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:13px"><span>' + esc(e.label) + '</span><small style="color:var(--tx3)">' + esc(String(e.t || '').slice(0, 16)) + '</small></li>';
      }).join('') + '</ul>' : '<span class="ctl-sub">No activity recorded.</span>';
      return '<tr class="is-click" tabindex="0" role="button" aria-expanded="' + (open ? 'true' : 'false') + '" data-user="' + esc(u.email) + '"><td><span class="ctl-who">' + avatar(u.name, u.email) + '<span><b>' + esc(u.name) + '</b><small>' + esc(u.email) + '</small></span></span></td>' +
        '<td>' + esc(ago(u.last_active)) + '</td><td class="r">' + num(u.logins) + '</td><td class="r">' + num(u.page_views) + '</td><td class="r">' + esc(u.time) + '</td>' +
        '<td class="r strong">' + (S.spend ? usd(spendOf(u.email)) : '…') + '</td></tr>' +
        (open ? '<tr class="is-detail"><td colspan="6">' + detail + '</td></tr>' : '');
    }).join('');
    body('team').innerHTML =
      '<div class="ctl-stats"><div class="ctl-stat" data-lead><b>' + num(k.users) + '</b><span>Staff who signed in</span></div>' +
      '<div class="ctl-stat"><b>' + num(k.logins) + '</b><span>Sign-ins</span></div><div class="ctl-stat"><b>' + num(k.page_views) + '</b><span>Pages opened</span></div>' +
      '<div class="ctl-stat"><b>' + esc(k.time) + '</b><span>Time on the platform</span><small>' + esc(k.avg_view) + ' a page</small></div>' +
      '<div class="ctl-stat"><b>' + esc(k.views_per_user) + '</b><span>Pages per person</span></div></div>' +
      '<div class="ctl-even"><div class="ctl-card"><div class="ctl-card-h"><h3>Sign-ins per day</h3><span>last ' + days.length + ' days with activity</span></div>' + (days.length ? columns(days, { short: true, aria: 'Sign-ins per day' }) : '<div class="ctl-empty">No sign-ins recorded.</div>') + '</div>' +
      '<div class="ctl-card"><div class="ctl-card-h"><h3>Most opened pages</h3><span>by staff</span></div>' + (d.top_pages.length ? ranked(pairs(d.top_pages)) : '<div class="ctl-empty">No page views recorded.</div>') + '</div></div>' +
      '<div class="ctl-card"><div class="ctl-tools"><div class="ctl-card-h" style="margin:0"><h3>People</h3><span>' + plural(users.length, 'person', 'people') + ' &middot; spend is the last ' + (S.spend ? S.spend.days : S.days) + ' days</span></div>' +
      '<label class="ctl-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><input type="search" id="teamQ" placeholder="Search people" value="' + esc(S.teamQ || '') + '"></label></div>' +
      (users.length ? '<div class="ctl-scroll"><table class="ctl-table"><thead><tr><th>Person</th><th>Last active</th><th class="r">Sign-ins</th><th class="r">Pages</th><th class="r">Time</th><th class="r">Spent</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="ctl-empty">' + (q ? 'Nobody matches.' : 'No staff sign-ins recorded.') + '</div>') + '</div>';
    updateFigs();
  }

  // ── CLIENTS ───────────────────────────────────────────────────────────────
  function spaceSpend(space) {
    var w = S.spend && S.spend.workspaces.filter(function (x) { return x.space === space; })[0];
    return w ? w.usd : 0;
  }
  function renderClients(d) {
    S.clients = d;
    var t = d.totals;
    var cards = d.accounts.map(function (a) {
      var limit = +a.limit || 0, used = +a.runs || 0, fill = limit ? Math.min(100, used / limit * 100) : 0;
      var shared = a.tools.length;
      return '<button type="button" class="ctl-cc' + (a.withdrawn ? ' is-withdrawn' : '') + '" data-account="' + esc(a.slug) + '"><span class="ctl-cc-top"><span class="ctl-av ctl-av--lg" style="background:' + esc(a.avatar.bg) + ';color:' + esc(a.avatar.fg) + '">' + esc(a.avatar.initials) + '</span>' +
        '<span><b>' + esc(a.name) + '</b><small>' + plural(a.people.length, 'person', 'people') + ' can sign in</small></span><span class="go" aria-hidden="true">&rarr;</span></span>' +
        '<span class="ctl-chips">' + a.pages.slice(0, 4).map(function (p) { return '<span class="ctl-pill">' + esc(p) + '</span>'; }).join('') +
        a.tools.slice(0, 3).map(function (p) { return '<span class="ctl-pill ctl-pill--acc">' + esc(p) + '</span>'; }).join('') +
        ((a.pages.length > 4 || a.tools.length > 3) ? '<span class="ctl-pill">+' + ((a.pages.length > 4 ? a.pages.length - 4 : 0) + (a.tools.length > 3 ? a.tools.length - 3 : 0)) + ' more</span>' : '') +
        (!a.pages.length && !a.tools.length ? '<span class="ctl-pill">' + (a.withdrawn ? 'Access withdrawn' : 'Nothing shared yet') + '</span>' : '') + '</span>' +
        '<span class="ctl-meter"><span><span>Agent runs this month</span><b>' + used + (limit ? ' of ' + limit : '') + '</b></span><span class="bar"><i class="' + (fill >= 100 ? 'is-full' : (fill >= 75 ? 'is-hot' : '')) + '" style="width:' + fill + '%"></i></span></span>' +
        '<span class="ctl-cc-foot"><span><b>' + num(a.visits_30) + '</b> visits by <b>' + num(a.visitors_30) + '</b> in 30 days</span><span>Agents shared: <b>' + shared + '/' + a.tools_total + '</b></span>' +
        '<span>Last visit <b>' + esc(ago(a.last_visit)) + '</b></span><span>Spent <b>' + (S.spend ? usd(spaceSpend(a.space)) : '…') + '</b></span></span></button>';
    }).join('');
    body('clients').innerHTML =
      '<div class="ctl-stats"><div class="ctl-stat" data-lead><b>' + num(t.accounts) + '</b><span>Workspaces shared</span></div><div class="ctl-stat"><b>' + num(t.people) + '</b><span>People invited</span></div>' +
      '<div class="ctl-stat"><b>' + num(t.visitors_30) + '</b><span>Active in 30 days</span></div><div class="ctl-stat"><b>' + num(t.runs) + '</b><span>Agent runs this month</span></div></div>' +
      (cards ? '<div class="ctl-cards">' + cards + '</div>' : '<div class="ctl-card"><div class="ctl-empty"><b>Nothing is shared with a client yet.</b>A workspace appears here once an admin invites someone to it or shares a page or agent.</div></div>');
    updateFigs();
  }

  // ── TRAFFIC ───────────────────────────────────────────────────────────────
  function renderTraffic(d) {
    S.traffic = d;
    var k = d.kpis || {}, f = d.funnel || {}, s = d.signins || {};
    var cols = (d.series || []).map(function (p) { return { label: dayLabel(p[0]), title: dayLabel(p[0]) + ': ' + plural(p[1], 'page view'), parts: [[p[1], 'var(--ink)']] }; });
    if (cols.length) cols[cols.length - 1].now = true;
    var funnel = [['Visitors', f.visitors], ['Engaged', f.engaged], ['Signed in', f.members], ['Came back', f.returning]];
    body('traffic').innerHTML =
      (d.configured === false ? '<div class="ctl-warn"><b>The analytics sheet is not connected,</b> so these figures read zero. The note at the top of the page says what to set.</div>' : '') +
      '<div class="ctl-stats"><div class="ctl-stat" data-lead><b>' + num(k.visitors) + '</b><span>Visitors</span><small>' + num(k.new) + ' new, ' + num(k.returning) + ' returning</small></div>' +
      '<div class="ctl-stat"><b>' + num(k.pageviews) + '</b><span>Page views</span></div><div class="ctl-stat"><b>' + num(k.sessions) + '</b><span>Sessions</span></div>' +
      '<div class="ctl-stat"><b>' + esc(k.bounce_rate == null ? '—' : k.bounce_rate + '%') + '</b><span>Bounce rate</span><small>' + esc(k.avg_engaged || '—') + ' engaged</small></div>' +
      '<div class="ctl-stat"><b>' + num(s.members) + '</b><span>Members signed in</span><small>' + num(s.new) + ' new &middot; ' + esc(s.conv_rate == null ? '—' : s.conv_rate + '%') + ' of visitors</small></div>' +
      '<div class="ctl-stat"><b>' + num(k.conversions) + '</b><span>Access requests</span></div></div>' +
      '<div class="ctl-two"><div class="ctl-card"><div class="ctl-card-h"><h3>Page views per day</h3><span>last ' + cols.length + ' days</span></div>' + (cols.length ? columns(cols, { aria: 'Page views per day' }) : '<div class="ctl-empty">No visits recorded.</div>') + '</div>' +
      '<div class="ctl-card ctl-card--ink"><div class="ctl-card-h"><h3>From visit to member</h3><span>the whole period</span></div><div class="ctl-funnel">' + funnel.map(function (x) { return '<div><span>' + x[0] + '</span><b>' + num(x[1]) + '</b></div>'; }).join('') + '</div></div></div>' +
      '<div class="ctl-three"><div class="ctl-card"><div class="ctl-card-h"><h3>Top pages</h3></div>' + (d.top_pages.length ? ranked(pairs(d.top_pages)) : '<div class="ctl-empty">None yet.</div>') + '</div>' +
      '<div class="ctl-card"><div class="ctl-card-h"><h3>Where they came from</h3></div>' + (d.referrers.length ? ranked(pairs(d.referrers)) : '<div class="ctl-empty">None yet.</div>') + '</div>' +
      '<div class="ctl-card"><div class="ctl-card-h"><h3>Devices</h3></div>' + (d.devices.length ? ranked(pairs(d.devices).map(function (x) { x.colour = 'var(--sky)'; return x; })) : '<div class="ctl-empty">None yet.</div>') + '</div></div>';
    updateFigs();
  }

  // ── INBOX ─────────────────────────────────────────────────────────────────
  function renderInbox(d) {
    S.inbox = d;
    var reqs = S.reqTab === 'agent' ? d.agent_requests : d.requests;
    var rows = reqs.rows.map(function (r) {
      return '<div class="ctl-req"><b>' + esc(r.name || r.email || 'Someone') + (r.company ? ' &middot; ' + esc(r.company) : '') + '</b><small>' + esc(r.email || '') + ' &middot; ' + esc(String(r.ts || '').slice(0, 16)) +
        (S.reqTab === 'agent' ? ' &middot; wants ' + esc(r.agent_name || r.slug) : (r.interest ? ' &middot; ' + esc(r.interest) : '')) + '</small>' + (r.message ? '<p>' + esc(r.message) + '</p>' : '') + '</div>';
    }).join('');
    var fb = d.feedback.agents.map(function (a) {
      var t = a.up + a.down;
      return '<li class="ctl-fb"><div><b>' + esc(a.label) + '</b><span>' + a.up + ' up &middot; ' + a.down + ' down</span></div><div class="ctl-vote"><i style="width:' + (t ? a.up / t * 100 : 0) + '%;background:var(--ok)"></i><i style="width:' + (t ? a.down / t * 100 : 0) + '%;background:var(--clay)"></i></div></li>';
    }).join('');
    var down = d.feedback.down.map(function (r) {
      return '<p class="ctl-quote">' + esc(r.reason || 'No reason given') + '<small>' + esc(r.label) + ' &middot; ' + esc(r.section_label || r.section_key) + ' &middot; ' + esc(ago(r.created_at)) + '</small></p>';
    }).join('');
    var u = d.agent_use;
    body('inbox').innerHTML =
      '<div class="ctl-two"><div class="ctl-card"><div class="ctl-tools"><div class="ctl-tabs" role="group" aria-label="Kind of request"><button type="button" data-req="form"' + (S.reqTab === 'form' ? ' class="is-on"' : '') + '>Access requests &middot; ' + d.requests.total + '</button>' +
      '<button type="button" data-req="agent"' + (S.reqTab === 'agent' ? ' class="is-on"' : '') + '>Agent access &middot; ' + d.agent_requests.total + '</button></div>' +
      (reqs.rows.length ? '<button type="button" class="ctl-link" data-csv="' + S.reqTab + '">Download CSV</button>' : '') + '</div>' +
      (rows || '<div class="ctl-empty"><b>Nothing here yet.</b>' + (S.reqTab === 'agent' ? 'Requests for agents that are not connected yet appear here.' : 'People who use the request-access form appear here.') + '</div>') +
      (reqs.total > reqs.rows.length ? '<p class="ctl-sub">Showing the latest ' + reqs.rows.length + ' of ' + reqs.total + '. Download the CSV for these rows.</p>' : '') + '</div>' +
      '<div class="ctl-card ctl-card--sky"><div class="ctl-card-h"><h3>Public agents</h3><span>runs against the per-person cap</span></div><div class="ctl-stats" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="ctl-stat"><b>' + num(u.runs) + '</b><span>Runs</span></div><div class="ctl-stat"><b>' + num(u.users) + '</b><span>People</span></div><div class="ctl-stat"><b>' + num(u.at_cap) + '</b><span>At the cap of ' + esc(u.cap) + '</span></div></div>' +
      (u.agents.length ? '<div style="margin-top:var(--sp-5)">' + ranked(u.agents.map(function (a) { return { name: a.name, value: a.runs, text: num(a.runs), colour: 'var(--ink)' }; })) + '</div>' : '<p class="ctl-sub" style="margin-top:var(--sp-4)">No public agent runs recorded.</p>') + '</div></div>' +
      '<div class="ctl-even"><div class="ctl-card"><div class="ctl-card-h"><h3>Thumbs on agent reports</h3><span>last 30 days</span></div>' + (fb ? '<ul class="ctl-fbl">' + fb + '</ul>' : '<div class="ctl-empty">No feedback yet.</div>') + '</div>' +
      '<div class="ctl-card"><div class="ctl-card-h"><h3>Latest thumbs down</h3><span>with the reason given</span></div>' + (down || '<div class="ctl-empty">Nothing to fix.</div>') + '</div></div>';
  }

  // ── the hero figures ──────────────────────────────────────────────────────
  function updateFigs() {
    var f = function (k, v, sub) { var b = $('[data-fig="' + k + '"]'); if (b) b.textContent = v; var s = $('[data-fig-sub="' + k + '"]'); if (s) s.textContent = sub || ''; };
    setText('[data-fig="days"]', S.days + ' days');
    if (S.spend) {
      var d = S.spend;
      f('spend', usd(d.total), (d.change_pct == null ? 'nothing earlier to compare' : (d.change_pct > 0 ? '▲ ' : '▼ ') + pct(Math.abs(d.change_pct)) + ' on the period before') + (d.agents[0] ? ' · most on ' + d.agents[0].label : ''));
    }
    if (S.team) f('staff', num(S.team.kpis.users), num(S.team.kpis.logins) + ' sign-ins in all');
    if (S.clients) f('clients', num(S.clients.totals.accounts), num(S.clients.totals.people) + ' people invited, ' + num(S.clients.totals.visitors_30) + ' active in 30 days');
    if (S.traffic) f('visitors', num((S.traffic.kpis || {}).visitors), num((S.traffic.signins || {}).members) + ' have signed in');
  }
  function stamp(state, text) {
    var e = $('#ctlStamp'); if (!e) return;
    e.className = 'ctl-live' + (state ? ' is-' + state : '');
    e.lastChild.textContent = text;
  }

  // ── loading ───────────────────────────────────────────────────────────────
  var RENDER = { spend: renderSpend, team: renderTeam, clients: renderClients, traffic: renderTraffic, inbox: renderInbox };
  var pending = 0, problems = 0;
  function load(section, fresh) {
    var url = '/admin/panel/' + section + '?' + (section === 'spend' ? 'days=' + S.days + '&' : '') + (fresh ? 'fresh=1' : '');
    if (!S[section]) body(section).innerHTML = skeleton();
    pending++;
    return getJSON(url).then(function (d) { RENDER[section](d); }).catch(function (e) {
      problems++;
      body(section).innerHTML = failed(section, e.message);
    }).then(function () {
      pending--;
      if (!pending) stamp(problems ? 'warn' : 'ok', problems ? plural(problems, 'section') + ' could not be read' : 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    });
  }
  function loadAll(fresh) {
    problems = 0; stamp('', 'Reading every ledger…');
    var b = $('#ctlRefresh'); if (b) b.disabled = true;
    var jobs = ['spend', 'team', 'clients', 'traffic', 'inbox'].map(function (s) { return load(s, fresh); });
    Promise.all(jobs).then(function () { if (b) b.disabled = false; });
  }

  // ── side panel ────────────────────────────────────────────────────────────
  var lastFocus = null;
  function drawer(kind, html) {
    setText('#ctlDrawerK', kind);
    $('#ctlDrawerBody').innerHTML = html;
    $('#ctlDrawer').classList.add('is-open'); $('#ctlOvl').classList.add('is-open');
    $('#ctlDrawer').setAttribute('aria-hidden', 'false');
  }
  function closeDrawer() {
    $('#ctlDrawer').classList.remove('is-open'); $('#ctlOvl').classList.remove('is-open');
    $('#ctlDrawer').setAttribute('aria-hidden', 'true');
    if (/^#client-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  // One client workspace, in full. Everything an admin has given the client can be withdrawn from here: a person
  // or a whole domain loses sign-in, a dashboard or an agent stops being shared, or all of it at once.
  function renderAccount(slug, a, note) {
    var limit = +a.limit || 0;
    var list = function (title, items, fn, empty) {
      return '<div class="ctl-dsec"><h4>' + title + '</h4>' + (items.length ? '<ul>' + items.map(fn).join('') + '</ul>' : '<span class="ctl-sub">' + empty + '</span>') + '</div>';
    };
    var items = a.share_items || [];
    var chips = items.map(function (it) {
      return '<span class="ctl-pill' + (it.kind === 'agent' ? ' ctl-pill--acc' : '') + ' ctl-rv">' + esc(it.label) +
        '<button type="button" data-revoke-share="' + esc(it.key) + '" data-label="' + esc(it.label) + '" aria-label="Stop sharing ' + esc(it.label) + '" title="Stop sharing ' + esc(it.label) + '">&times;</button></span>';
    }).join('');
    var anything = items.length || a.people.length;
    drawer('Client workspace',
      '<div class="ctl-dh"><span class="ctl-av ctl-av--lg" style="background:' + esc(a.avatar.bg) + ';color:' + esc(a.avatar.fg) + '">' + esc(a.avatar.initials) + '</span><h2 id="ctlDrawerT">' + esc(a.name) + '</h2></div>' +
      (note ? '<p class="ctl-dnote" role="status">' + esc(note) + '</p>' : '') +
      '<div class="ctl-tiles"><div class="ctl-tile" data-lead><b>' + (S.spend ? usd(spaceSpend(a.space)) : '—') + '</b><span>spent in ' + (S.spend ? S.spend.days : S.days) + ' days</span></div>' +
      '<div class="ctl-tile"><b>' + num(a.runs) + (limit ? ' / ' + limit : '') + '</b><span>agent runs this month</span></div>' +
      '<div class="ctl-tile"><b>' + num(a.visits_30) + '</b><span>visits in 30 days</span></div><div class="ctl-tile"><b>' + num(a.visitors_30) + '</b><span>people active</span></div></div>' +
      '<div class="ctl-dsec"><h4>Shared with the client</h4><div class="ctl-chips">' + (chips || '<span class="ctl-sub">Nothing is shared yet.</span>') + '</div>' +
        '<p class="ctl-sub" style="margin:8px 0 0">' + a.tools.length + ' of ' + a.tools_total + ' agents are shared.' + (items.length ? ' Press &times; on one to stop sharing it.' : '') + '</p></div>' +
      list('People who can sign in', a.people, function (p) {
        return '<li><span>' + esc(p.who) + ' <span class="ctl-pill">' + (p.kind === 'domain' ? 'whole domain' : 'person') + '</span></span><span class="ctl-rowact"><small>' +
          (p.added_by ? 'added by ' + esc(p.added_by) + ' &middot; ' : '') + esc(ago(p.at)) + '</small>' +
          '<button type="button" class="ctl-danger-sm" data-revoke-person="' + esc(p.who) + '" aria-label="Remove ' + esc(p.who) + '">Remove</button></span></li>';
      }, 'Nobody is invited yet.') +
      (anything ? '<div class="ctl-dsec ctl-danger"><h4>Withdraw access</h4><p class="ctl-sub">Stops every dashboard and agent being shared and removes everyone who can sign in. The client loses access at once. You can share again later.</p>' +
        '<button type="button" class="ctl-danger-btn" data-revoke-all="1">Withdraw all access</button></div>' : '') +
      list('Who uses it', a.by_person, function (p) { return '<li><span>' + esc(p.name) + '<br><small>' + esc(p.email) + '</small></span><small>' + p.visits + ' visits &middot; ' + p.runs + ' runs<br>' + esc(ago(p.last)) + '</small></li>'; }, 'No client has opened it yet.') +
      list('Latest activity', a.events.slice(0, 12), function (e) { return '<li><span>' + esc(e.who) + (e.kind === 'run' ? ' ran ' : ' opened ') + esc(e.where) + '</span><small>' + esc(ago(e.at)) + '</small></li>'; }, 'No activity yet.') +
      list('Changes to what is shared', a.audit, function (x) { return '<li><span>' + esc(x.text) + '</span><small>' + esc(ago(x.at)) + '</small></li>'; }, 'No changes recorded.'));
  }
  function openAccount(slug) {
    lastFocus = document.activeElement;
    S.acct = slug;
    drawer('Client workspace', '<div class="ctl-skel"><i class="bn-skel tall bn-sweep"></i><i class="bn-skel bn-sweep"></i></div>');
    getJSON('/admin/panel/account/' + encodeURIComponent(slug)).then(function (a) {
      renderAccount(slug, a);
      $('#ctlDrawerX').focus();
    }).catch(function (e) { drawer('Client workspace', failed('account', e.message)); });
  }
  // Withdraw something and redraw the panel with what is left. The clients section behind it is read again so its
  // cards and the hero figures match.
  function revoke(body, ask, done) {
    if (!S.acct || !window.confirm(ask)) return;
    var busy = $$('#ctlDrawerBody button'); busy.forEach(function (b) { b.disabled = true; });
    postJSON('/admin/panel/account/' + encodeURIComponent(S.acct) + '/revoke', body).then(function (a) {
      renderAccount(S.acct, a, done);
      load('clients', true);
    }).catch(function (e) {
      busy.forEach(function (b) { b.disabled = false; });
      window.alert('That could not be withdrawn: ' + e.message);
    });
  }
  function fromHash() {
    var m = /^#client-(.+)$/.exec(location.hash);
    if (m) openAccount(decodeURIComponent(m[1]));
  }

  // ── events ────────────────────────────────────────────────────────────────
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-revoke-share],[data-revoke-person],[data-revoke-all],[data-retry],[data-tab],[data-req],[data-csv],[data-account],[data-user],[data-days],#ctlRefresh,#ctlDrawerX,#ctlOvl') : null;
    if (!t) return;
    if (t.dataset.revokeShare) {
      revoke({ shares: [t.dataset.revokeShare] }, 'Stop sharing ' + (t.dataset.label || 'this') + '? The client loses it at once.', 'Stopped sharing ' + (t.dataset.label || 'it') + '.');
      return;
    }
    if (t.dataset.revokePerson) {
      revoke({ people: [t.dataset.revokePerson] }, 'Remove ' + t.dataset.revokePerson + '? They lose access at once.', 'Removed ' + t.dataset.revokePerson + '.');
      return;
    }
    if (t.dataset.revokeAll) {
      revoke({ shares: 'all', people: 'all' }, 'Withdraw all access for this client? Everyone is removed and nothing stays shared. They lose access at once.', 'All access withdrawn. You can share again at any time from the account.');
      return;
    }
    if (t.dataset.retry) { var s = t.dataset.retry; if (RENDER[s]) load(s, true); else fromHash(); return; }
    if (t.dataset.tab) { S.tab = t.dataset.tab; S.query = ''; if (S.spend) renderSpendBreakdown(); return; }
    if (t.dataset.req) { S.reqTab = t.dataset.req; if (S.inbox) renderInbox(S.inbox); return; }
    if (t.dataset.csv) {
      var rows = (t.dataset.csv === 'agent' ? S.inbox.agent_requests : S.inbox.requests).rows;
      if (t.dataset.csv === 'agent') csv('agent-access-requests.csv', ['When', 'Name', 'Email', 'Agent', 'Reason'], rows.map(function (r) { return [r.ts, r.name, r.email, r.agent_name, r.message]; }));
      else csv('access-requests.csv', ['When', 'Name', 'Email', 'Company', 'Interest', 'Message'], rows.map(function (r) { return [r.ts, r.name, r.email, r.company, r.interest, r.message]; }));
      return;
    }
    if (t.dataset.account) { location.hash = 'client-' + t.dataset.account; return; }
    if (t.dataset.user) { S.open[t.dataset.user] = !S.open[t.dataset.user]; if (S.team) renderTeam(S.team); return; }
    if (t.dataset.days) {
      S.days = +t.dataset.days;
      $$('#ctlPeriod button').forEach(function (b) { var on = b === t; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      S.spend = null; setText('[data-fig="days"]', S.days + ' days'); load('spend');
      return;
    }
    if (t.id === 'ctlRefresh') { loadAll(true); return; }
    if (t.id === 'ctlDrawerX' || t.id === 'ctlOvl') closeDrawer();
  });
  function renderSpendBreakdown() {
    // Only the breakdown card changes with its tab and search; redraw the whole section from the data in hand.
    renderSpend(S.spend);
  }
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'spendQ') {
      S.query = ev.target.value; var pos = ev.target.selectionStart; renderSpend(S.spend);
      var i = $('#spendQ'); if (i) { i.focus(); i.setSelectionRange(pos, pos); }
    } else if (ev.target.id === 'teamQ') {
      S.teamQ = ev.target.value; var p2 = ev.target.selectionStart; renderTeam(S.team);
      var j = $('#teamQ'); if (j) { j.focus(); j.setSelectionRange(p2, p2); }
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && $('#ctlDrawer').classList.contains('is-open')) closeDrawer();
    var row = ev.target.closest && ev.target.closest('tr[data-user]');
    if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); row.click(); }
  });
  window.addEventListener('hashchange', function () {
    if (/^#client-/.test(location.hash)) fromHash(); else if ($('#ctlDrawer').classList.contains('is-open')) closeDrawer();
  });

  // Which section chip is lit follows the page as it scrolls.
  function watchSections() {
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        $$('#ctlNav a').forEach(function (a) { a.classList.toggle('is-on', a.getAttribute('href') === '#' + e.target.id); });
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    $$('.ctl-sec').forEach(function (s) { io.observe(s); });
  }

  function start() {
    watchSections();
    loadAll(false);
    fromHash();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
