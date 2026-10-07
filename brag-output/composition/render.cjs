// Render a composition to frames or video.
//   node render.cjs <playwright-core dir> <page.html> stills <outdir> t1,t2,...
//   node render.cjs <playwright-core dir> <page.html> video <out.mp4> [fps]
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(path.join(process.argv[2], 'node_modules/playwright-core'));
const [page_, mode, out, arg] = process.argv.slice(3);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.error('PAGE ERROR', e.message));
  await page.goto('file://' + path.resolve(page_));
  await page.evaluate(() => window.__ready);
  const D = await page.evaluate(() => window.__duration);
  const shot = async t => { await page.evaluate(t => window.__seek(t), t); return page.screenshot({ type: 'png' }); };

  if (mode === 'stills') {
    const fs = require('fs'); fs.mkdirSync(out, { recursive: true });
    for (const t of arg.split(',').map(Number)) fs.writeFileSync(path.join(out, `t${t.toFixed(2).padStart(5, '0')}.png`), await shot(t));
  } else {
    const fps = Number(arg || 30), n = Math.round(D * fps);
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let i = 0; i < n; i++) {
      const buf = await shot(i / fps);
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 90 === 0) console.log(`frame ${i}/${n}`);
    }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
  }
  await browser.close();
})();
