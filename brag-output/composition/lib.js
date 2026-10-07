// Shared helpers. Every frame is a pure function of time: the page builds one
// paused GSAP timeline and the renderer calls window.__seek(t) per frame.
window.LOGO = (size = 40) => `
<svg width="${size}" height="${size}" viewBox="-3 -3 38 38" fill="none" style="overflow:visible">
  <path class="lg-arc" d="M20.4 3.9A13.6 13.6 0 1 0 28.1 15.4" stroke="currentColor" stroke-width="4.4" stroke-linecap="butt"/>
  <path class="lg-head" d="M20.6 4.6H29V13" stroke="var(--orange)" stroke-width="4.4" stroke-linecap="butt" stroke-linejoin="miter"/>
  <path class="lg-shaft" d="M28.4 5.2L19.1 14.5" stroke="var(--orange)" stroke-width="4.4" stroke-linecap="butt"/>
</svg>`;

// Wrap each word of every [data-split] element in a mask.
window.splitWords = (root = document) => {
  root.querySelectorAll('[data-split]').forEach(el => {
    const walk = node => {
      [...node.childNodes].forEach(c => {
        if (c.nodeType === 3) {
          const frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span'); w.className = 'w';
            const i = document.createElement('i'); i.textContent = part; w.appendChild(i); frag.appendChild(w);
          });
          c.replaceWith(frag);
        } else if (c.nodeType === 1 && !c.classList.contains('w')) walk(c);
      });
    };
    walk(el);
  });
};
window.words = sel => document.querySelectorAll(`${sel} .w > i`);

// Deterministic pseudo-random
window.rand = seed => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

window.boot = (tl, duration, drawFns = []) => {
  tl.pause(0);
  window.__duration = duration;
  window.__seek = t => { tl.seek(t, false); drawFns.forEach(f => f(t)); };
  window.__ready = document.fonts.ready.then(() => { window.__seek(0); return true; });
  const q = new URLSearchParams(location.search);
  if (q.has('t')) window.__ready.then(() => window.__seek(parseFloat(q.get('t'))));
  if (q.has('play')) window.__ready.then(() => { const t0 = performance.now(); const loop = () => { window.__seek(((performance.now() - t0) / 1000) % duration); requestAnimationFrame(loop); }; loop(); });
};
