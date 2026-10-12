/* Market Radar: the map of the client's sites and its rivals.
 *
 * A real map (Leaflet over OpenStreetMap) with the client's own sites and every rival pinned where it is:
 * an exact spot for a rival the map data lists, the town its website states otherwise. Rivals that state no
 * base (an online brand, "worldwide") are listed under the map as not placed, never put somewhere to fill it.
 *
 *   MRMap.prepare(data, opts)       pure: the pins, counts and notes the map draws (no DOM, tested in Node)
 *   MRMap.attach(slot, data, opts)  draws it into `slot`, and keeps the map between page repaints
 *
 * The page repaints its whole detail pane often, so the map lives in a host element that is moved into each
 * new slot: the view, zoom and filters survive a repaint. Text from other companies' websites is escaped
 * (opts.esc); tile addresses must be https.
 */
(function (root) {
  'use strict';

  var HUE = { direct: 'acc', local: 'sky', indirect: 'cream', aspirational: 'asp' };
  var LABEL = { direct: 'Direct', local: 'Nearby', indirect: 'Indirect', aspirational: 'Bigger player' };
  var ORDER = ['direct', 'local', 'indirect', 'aspirational'];
  var CLUSTER_PX = 34;
  var MAX_NAMED = 5;
  var inst = null;

  function escFallback(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = Number(v); return v == null || v === '' || !isFinite(n) ? null : n; }
  function validPoint(lat, lon) { return lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }

  function km(a, b) {
    var p = Math.PI / 180, dl = (b.lon - a.lon) * p, la = a.lat * p, lb = b.lat * p;
    var h = Math.pow(Math.sin((lb - la) / 2), 2) + Math.cos(la) * Math.cos(lb) * Math.pow(Math.sin(dl / 2), 2);
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* == what the map draws (pure) ================================================================ */

  // data: the /map answer. opts.status(entity_id, fallback) lets the page say a rival was removed or is still
  // to review since the map was loaded; opts.opened: new places near the client (from the radar).
  function prepare(data, opts) {
    opts = opts || {};
    data = data || {};
    var status = opts.status || function (id, s) { return s; };
    var you = (data.you || []).map(function (y) {
      return { name: y.name || 'Your site', lat: num(y.lat), lon: num(y.lon), head: !!y.head_office, precision: y.precision };
    }).filter(function (y) { return validPoint(y.lat, y.lon); });
    var pins = [];
    (data.rivals || []).forEach(function (r) {
      var st = status(r.entity_id, r.status);
      var lat = num(r.lat), lon = num(r.lon);
      if (st === 'removed' || !validPoint(lat, lon)) return;
      pins.push({ id: r.entity_id, name: r.name || r.domain || '', domain: r.domain, kind: ORDER.indexOf(r.kind) >= 0 ? r.kind : 'direct',
        status: st, score: num(r.score) == null ? 0 : num(r.score), lat: lat, lon: lon, how: r.how, place: r.place,
        distance_km: num(r.distance_km), near_site: r.near_site, sells: r.sells, reason: r.reason });
    });
    pins.sort(function (a, b) { return b.score - a.score || (a.name < b.name ? -1 : 1); });
    var opened = (opts.opened || []).map(function (o) {
      return { name: o.name, lat: num(o.lat), lon: num(o.lon), status: o.status, category: o.category, date: o.date,
        address: o.address, certain: !!o.certain, distance_km: num(o.distance_km), evidence: (o.evidence || [])[0] };
    }).filter(function (o) { return validPoint(o.lat, o.lon) && (o.status === 'opened' || o.status === 'planned' || o.certain); });
    var counts = {};
    pins.forEach(function (p) { counts[p.kind] = (counts[p.kind] || 0) + 1; });
    var unplaced = (data.unplaced || []).filter(function (u) { return status(u.entity_id, 'x') !== 'removed'; });
    return { you: you, pins: pins, opened: opened, counts: counts, unplaced: unplaced, pending: data.pending || 0,
      radius_km: num(data.radius_km), local: !!data.local, tiles: data.tiles || null, name: data.name || '' };
  }

  // One line under the map: what is pinned, what is not, and how precise the pins are.
  function noteOf(d) {
    var parts = [plural(d.pins.length, 'rival') + ' on the map'];
    if (d.unplaced.length) {
      var names = d.unplaced.slice(0, 3).map(function (u) { return u.name || u.domain; });
      parts.push(d.unplaced.length + ' not placed (' + names.join(', ') + (d.unplaced.length > 3 ? ' and ' + (d.unplaced.length - 3) + ' more' : '') + '): no base is stated');
    }
    if (d.pending) parts.push('placing ' + d.pending + ' more');
    var towns = d.pins.filter(function (p) { return p.how === 'stated location'; }).length;
    var tail = towns ? ' A pin at the town a website states is a town, not a street.' : '';
    return parts.join(' · ') + '.' + tail;
  }

  // Pins that would overlap at this zoom become one counted pin. points: [{x, y}] in pixels, one per pin.
  function group(points, px) {
    var used = {}, out = [];
    points.forEach(function (a, i) {
      if (used[i]) return;
      var g = [i];
      used[i] = true;
      points.forEach(function (b, j) {
        if (used[j]) return;
        if (Math.abs(a.x - b.x) <= px && Math.abs(a.y - b.y) <= px && Math.hypot(a.x - b.x, a.y - b.y) <= px) { used[j] = true; g.push(j); }
      });
      out.push(g);
    });
    return out;
  }

  /* == the map ==================================================================================== */

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function tileUrl(t) {
    var u = t && t.url;
    return typeof u === 'string' && /^https:\/\//.test(u) ? u : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  }

  // A pin sitting on the client's own pin (an online brand's head office is often in the client's city) is drawn
  // beside it, so neither hides the other: `aside` moves the icon, not the place.
  var ASIDE = 30;
  function pinIcon(L, hue, cls, aside) {
    return L.divIcon({ className: 'mr-pinwrap', iconSize: [30, 34], iconAnchor: [15 - (aside ? ASIDE : 0), 32], popupAnchor: [0, -30], tooltipAnchor: [14, -16],
      html: '<span class="mr-pin h-' + hue + (cls ? ' ' + cls : '') + '"><i></i></span>' });
  }
  function clusterIcon(L, n, hue, aside) {
    return L.divIcon({ className: 'mr-pinwrap', iconSize: [38, 38], iconAnchor: [19 - (aside ? ASIDE : 0), 19 + (aside ? 8 : 0)], popupAnchor: [0, -18],
      html: '<span class="mr-cl h-' + hue + '"><b>' + n + '</b></span>' });
  }

  function build(slot, opts) {
    var L = root.L, esc = opts.esc || escFallback;
    var host = el('div', 'mr-map');
    host.setAttribute('role', 'region');
    var canvas = el('div', 'mr-map-canvas');
    var chips = el('div', 'mr-map-chips');
    var tools = el('div', 'mr-map-tools');
    var warn = el('div', 'mr-map-warn');
    warn.hidden = true;
    var note = el('p', 'mr-map-note');
    var stage = el('div', 'mr-map-stage');
    stage.appendChild(canvas);
    stage.appendChild(chips);
    stage.appendChild(tools);
    stage.appendChild(warn);
    host.appendChild(stage);
    host.appendChild(note);

    var map = L.map(canvas, { zoomControl: false, minZoom: 1, maxZoom: 18, zoomSnap: 0.5, scrollWheelZoom: false,
      worldCopyJump: false, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1 });
    map.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'topright' }).addTo(map);
    var tiles = null, loaded = 0, failed = 0;
    var layer = L.layerGroup().addTo(map), under = L.layerGroup().addTo(map), ties = L.layerGroup().addTo(map), yours = L.layerGroup().addTo(map);
    var s = { host: host, map: map, L: L, key: opts.key, tileKey: null, d: null, on: {}, opened: true, moved: false, busy: 0, esc: esc, onOpen: opts.onOpen };

    // Wheel zoom only after a click on the map, so scrolling the page past it does not zoom it.
    map.on('click', function () { map.scrollWheelZoom.enable(); });
    canvas.addEventListener('mouseleave', function () { map.scrollWheelZoom.disable(); });
    map.on('zoomstart movestart', function () { if (!s.busy) s.moved = true; });
    map.on('zoomend', function () { if (s.d) redraw(); });

    function programmatic(fn) { s.busy++; try { fn(); } finally { setTimeout(function () { s.busy--; }, 700); } }

    function mountTiles(t) {
      if (tiles && s.tileKey === tileUrl(t)) return;
      s.tileKey = tileUrl(t);
      if (tiles) map.removeLayer(tiles);
      tiles = L.tileLayer(tileUrl(t), { maxZoom: 19, attribution: (t && typeof t.attribution === 'string') ? t.attribution : '&copy; OpenStreetMap contributors' }).addTo(map);
      tiles.on('tileload', function () { loaded++; warn.hidden = true; });
      tiles.on('tileerror', function () {
        failed++;
        if (failed >= 4 && !loaded) { warn.textContent = 'The map background could not be loaded here. The pins still show where each rival is.'; warn.hidden = false; }
      });
    }

    // A short label on the map ("You", or "You · Waltham" with several sites); the full words are the pin's title.
    function youTip(y) { return s.d.you.length > 1 ? 'You · ' + esc(y.name) : 'You'; }

    function popup(p) {
      var where = [p.place, p.distance_km != null ? p.distance_km.toFixed(1) + ' km from ' + (p.near_site ? 'your ' + p.near_site + ' site' : 'your nearest site') : ''].filter(Boolean).join(' · ');
      var reason = p.reason ? (p.reason.length > 170 ? p.reason.slice(0, 169) + '…' : p.reason) : '';
      return '<div class="mr-pop h-' + HUE[p.kind] + '"><div class="mr-pop-k"><i></i>' + esc(LABEL[p.kind]) + (p.status === 'proposed' ? ' · to review' : '') +
        (p.score ? ' · watch score ' + esc(p.score) : '') + '</div><b>' + esc(p.name) + '</b>' +
        (where ? '<p class="mr-pop-w">' + esc(where) + '</p>' : '') + (reason ? '<p>' + esc(reason) + '</p>' : '') +
        '<small>' + (p.how === 'map listing' ? 'Pinned at its listing on the map.' : 'Pinned at the town its website states.') + '</small>' +
        '<button type="button" class="mr-pop-go" data-mrmap-open="' + esc(p.domain || '') + '">Open rival card</button></div>';
    }

    function nearestYou(p) {
      var best = null, bestKm = Infinity;
      (s.d.you || []).forEach(function (y) { var k = km(y, p); if (k < bestKm) { best = y; bestKm = k; } });
      return best;
    }
    function tie(p) {
      ties.clearLayers();
      var y = nearestYou(p);
      if (y) L.polyline([[y.lat, y.lon], [p.lat, p.lon]], { color: '#121213', weight: 2.5, opacity: .7, dashArray: '2 7', interactive: false }).addTo(ties);
    }

    function boxesOverlap(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }

    function redraw() {
      var d = s.d;
      layer.clearLayers();
      under.clearLayers();
      var vis = d.pins.filter(function (p) { return s.on[p.kind] !== false; });
      var pts = vis.map(function (p) { var c = map.latLngToContainerPoint([p.lat, p.lon]); return { x: c.x, y: c.y }; });
      var youAt = (d.you || []).map(function (y) { return map.latLngToContainerPoint([y.lat, y.lon]); });
      var taken = youAt.map(function (c) { return { x: c.x - 34, y: c.y - 44, w: 68, h: 40 }; });
      var onYou = function (c) { return youAt.some(function (y) { return Math.hypot(y.x - c.x, y.y - c.y) < 26; }); };
      var named = 0;
      group(pts, CLUSTER_PX).forEach(function (g) {
        var members = g.map(function (i) { return vis[i]; });
        if (members.length === 1) {
          var p = members[0];
          var m = L.marker([p.lat, p.lon], { icon: pinIcon(L, HUE[p.kind], p.status === 'proposed' ? 'open' : '', onYou(pts[g[0]])), title: p.name, riseOnHover: true, keyboard: true })
            .bindPopup(popup(p), { closeButton: true, autoPanPadding: [30, 30], maxWidth: 270 });
          m.on('mouseover popupopen', function () { tie(p); });
          m.on('mouseout', function () { if (!m.isPopupOpen()) ties.clearLayers(); });
          m.on('popupclose', function () { ties.clearLayers(); });
          m.addTo(layer);
          // A name beside the pins to watch most, unless it would sit on another.
          if (named < MAX_NAMED) {
            var c = pts[g[0]], w = Math.min(p.name.length, 22) * 6.6 + 14, size = map.getSize();
            // The name goes to the right of the pin, or to its left near the right-hand edge.
            var flip = c.x + w + 34 > size.x, box = { x: flip ? c.x - 16 - w : c.x + 16, y: c.y - 30, w: w, h: 20 };
            if (box.x > 2 && box.x + w < size.x - 2 && !taken.some(function (t) { return boxesOverlap(box, t); })) {
              taken.push(box);
              named++;
              m.bindTooltip(esc(p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name), { permanent: true, direction: flip ? 'left' : 'right', offset: [flip ? -8 : 8, -2], className: 'mr-tip' });
            }
          }
        } else {
          var lat = members.reduce(function (a, p) { return a + p.lat; }, 0) / members.length;
          var lon = members.reduce(function (a, p) { return a + p.lon; }, 0) / members.length;
          var counts = {};
          members.forEach(function (p) { counts[p.kind] = (counts[p.kind] || 0) + 1; });
          var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
          var cm = L.marker([lat, lon], { icon: clusterIcon(L, members.length, HUE[top], onYou(map.latLngToContainerPoint([lat, lon]))), title: members.length + ' rivals here', keyboard: true });
          var same = members.every(function (p) { return Math.abs(p.lat - members[0].lat) < 1e-4 && Math.abs(p.lon - members[0].lon) < 1e-4; });
          cm.on('click', function () {
            if (same || map.getZoom() >= map.getMaxZoom() - 1) {
              cm.unbindPopup().bindPopup('<div class="mr-pop"><div class="mr-pop-k">' + members.length + ' rivals here</div><ul class="mr-pop-l">' + members.map(function (p) {
                return '<li class="h-' + HUE[p.kind] + '"><i></i><button type="button" class="mr-pop-go" data-mrmap-open="' + esc(p.domain || '') + '">' + esc(p.name) + '</button></li>';
              }).join('') + '</ul></div>', { maxWidth: 260 }).openPopup();
            } else {
              map.fitBounds(L.latLngBounds(members.map(function (p) { return [p.lat, p.lon]; })), { padding: [60, 60], maxZoom: 17 });
            }
          });
          cm.addTo(layer);
        }
      });
      // New places near the client's sites, from the radar: small green marks under the pins.
      if (s.opened) {
        d.opened.forEach(function (o) {
          L.circleMarker([o.lat, o.lon], { radius: 6, color: '#fff', weight: 2, fillColor: o.status === 'planned' ? '#4DA3FF' : '#1FB36E', fillOpacity: 1 })
            .bindPopup('<div class="mr-pop"><div class="mr-pop-k">' + (o.status === 'planned' ? 'Coming soon' : 'New nearby') + '</div><b>' + esc(o.name || 'A new place') + '</b>' +
              (o.category ? '<p class="mr-pop-w">' + esc(String(o.category).replace(/_/g, ' ')) + (o.distance_km != null ? ' · ' + o.distance_km.toFixed(1) + ' km away' : '') + '</p>' : '') +
              (o.evidence ? '<p>' + esc(o.evidence) + '</p>' : '') + '</div>', { maxWidth: 260 }).addTo(under);
        });
      }
    }

    function drawYou() {
      var d = s.d;
      (d.you || []).forEach(function (y) {
        if (d.local && d.radius_km) L.circle([y.lat, y.lon], { radius: d.radius_km * 1000, color: '#FF6022', weight: 1.5, opacity: .8, dashArray: '5 7', fillColor: '#FF6022', fillOpacity: .05, interactive: false }).addTo(yours);
        L.marker([y.lat, y.lon], { icon: L.divIcon({ className: 'mr-pinwrap mr-you-wrap', iconSize: [40, 40], iconAnchor: [20, 20],
          html: '<span class="mr-you"><i></i></span>' }), title: y.name + (y.head ? ', your head office' : ', your site'), zIndexOffset: 1000, keyboard: true })
          .bindTooltip(youTip(y), { permanent: true, direction: 'top', offset: [0, -16], className: 'mr-tip you' }).addTo(yours);
      });
    }

    function visiblePins() { return s.d.pins.filter(function (p) { return s.on[p.kind] !== false; }); }
    function fitTo(pts) {
      programmatic(function () {
        if (!pts.length) map.setView([20, 0], 2);
        else if (pts.length === 1 || L.latLngBounds(pts).getNorthEast().equals(L.latLngBounds(pts).getSouthWest())) map.setView(pts[0], 11);
        else map.fitBounds(L.latLngBounds(pts), { padding: [84, 64], maxZoom: 14 });
      });
    }
    function youPts() { return s.d.you.map(function (y) { return [y.lat, y.lon]; }); }
    // Every pin: what "Show all" does.
    function fitAll() { fitTo(youPts().concat(visiblePins().map(function (p) { return [p.lat, p.lon]; }))); }
    // The opening view. A business that competes by neighbourhood opens on its neighbourhood: a national rival
    // far away would otherwise shrink the streets to a dot. Anything else opens on every pin.
    function near(p) { return km(nearestYou(p), p) <= focusKm(); }
    function focusKm() { return Math.max((s.d.radius_km || 5) * 2, 10); }
    function focusPins() {
      var all = visiblePins();
      if (!s.d.local || !s.d.you.length) return all;
      var close = all.filter(near);
      return close.length >= 2 ? close : all;
    }
    function fitFocus() { fitTo(youPts().concat(focusPins().map(function (p) { return [p.lat, p.lon]; }))); }
    function drawChips() {
      var d = s.d, html = '';
      ORDER.forEach(function (k) {
        if (!d.counts[k]) return;
        html += '<button type="button" class="mr-mk h-' + HUE[k] + (s.on[k] === false ? '' : ' on') + '" data-mrmap-kind="' + k + '" aria-pressed="' + (s.on[k] !== false) + '"><i></i>' + LABEL[k] + '<b>' + d.counts[k] + '</b></button>';
      });
      if (d.opened.length) html += '<button type="button" class="mr-mk h-ok' + (s.opened ? ' on' : '') + '" data-mrmap-kind="__opened" aria-pressed="' + s.opened + '"><i></i>New nearby<b>' + d.opened.length + '</b></button>';
      chips.innerHTML = html;
      tools.innerHTML = '<button type="button" class="mr-mt" data-mrmap-fit="all">Show all</button>' + (d.you.length ? '<button type="button" class="mr-mt" data-mrmap-fit="you">Around you</button>' : '');
    }

    host.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('button');
      if (!t || !host.contains(t)) return;
      if (t.hasAttribute('data-mrmap-kind')) {
        var k = t.getAttribute('data-mrmap-kind');
        if (k === '__opened') s.opened = !s.opened; else s.on[k] = s.on[k] === false;
        drawChips();
        redraw();
      } else if (t.hasAttribute('data-mrmap-fit')) {
        s.moved = false;
        if (t.getAttribute('data-mrmap-fit') === 'you') { if (s.d.local) fitFocus(); else fitTo(youPts()); } else fitAll();
      } else if (t.hasAttribute('data-mrmap-open')) {
        if (s.onOpen) s.onOpen(t.getAttribute('data-mrmap-open'));
      }
    });

    s.fit = fitFocus;
    s.set = function (d, o) {
      var first = !s.viewed;
      s.d = d;
      if (first) { s.viewed = true; fitFocus(); }      // Leaflet draws nothing until the map has a view
      mountTiles(d.tiles);
      host.setAttribute('aria-label', 'Map of ' + (d.name || 'the client') + ' and ' + plural(d.pins.length, 'rival'));
      yours.clearLayers();
      drawYou();
      drawChips();
      redraw();
      note.textContent = noteOf(d);
      if (!first && (!s.moved || (o && o.refit))) fitFocus();
      var far = visiblePins().length - focusPins().length;
      if (far > 0) note.textContent += ' ' + plural(far, 'rival is', 'rivals are') + ' too far away for this view: press Show all.';
    };
    return s;
  }

  function fallback(d, esc) {
    var rows = d.pins.map(function (p) {
      return '<li class="h-' + HUE[p.kind] + '"><i></i><b>' + esc(p.name) + '</b><span>' + esc([LABEL[p.kind], p.place].filter(Boolean).join(' · ')) + '</span></li>';
    }).join('');
    return '<div class="mr-map-fallback"><p>The map could not start in this browser. Here is where the rivals are:</p><ul>' + rows + '</ul></div>';
  }

  // Draw the map into `slot`. opts: {key (the client), esc, status, opened, onOpen}.
  function attach(slot, data, opts) {
    opts = opts || {};
    var esc = opts.esc || escFallback;
    if (!slot) return;
    if (!data) { slot.innerHTML = '<div class="mr-map-wait"><i></i>Placing your rivals on the map…</div>'; return; }
    if (data.error) { slot.innerHTML = '<div class="mr-map-wait"><b>The map could not be loaded.</b> ' + esc(data.error) + '</div>'; return; }
    var d = prepare(data, opts);
    if (!d.you.length && !d.pins.length) {
      slot.innerHTML = '<div class="mr-map-wait"><b>Nothing to put on a map yet.</b>' +
        (d.unplaced.length ? ' None of the ' + d.unplaced.length + ' rivals states where it is based.' : ' Run <em>Search again</em>, or set the head office address on the Profile.') + '</div>';
      return;
    }
    if (!root.L || !root.L.map) { slot.innerHTML = fallback(d, esc); return; }
    if (!inst || inst.key !== opts.key) {
      if (inst) { try { inst.map.remove(); } catch (e) { /* already gone */ } }
      inst = build(slot, { key: opts.key, esc: esc, onOpen: opts.onOpen });
    }
    inst.onOpen = opts.onOpen;
    slot.innerHTML = '';
    slot.appendChild(inst.host);
    // The page repaints for reasons that have nothing to do with the map (a collection polling): an unchanged map
    // is left alone, so an open popup stays open.
    var sig = JSON.stringify([d.you, d.pins.map(function (p) { return [p.id, p.lat, p.lon, p.kind, p.status, p.score]; }),
      d.opened, d.unplaced.length, d.pending, d.radius_km, d.local, d.name]);
    if (inst.sig !== sig) { inst.sig = sig; inst.set(d); }
    setTimeout(refresh, 60);
  }

  // The map was in a hidden panel or was resized: measure it again, and fit it again unless the user has moved it.
  function refresh() {
    if (!inst || !inst.d) return;
    inst.map.invalidateSize();
    if (!inst.moved) inst.fit();
  }

  root.MRMap = { prepare: prepare, noteOf: noteOf, group: group, attach: attach, refresh: refresh, km: km, HUE: HUE };
})(typeof window !== 'undefined' ? window : globalThis);
