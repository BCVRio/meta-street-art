// Renders an HTML page with CSS animations to PNG frames by scrubbing animation time.
const { chromium } = require('../node_modules/playwright');
const fs = require('fs');
const exe = require('child_process').execSync('ls /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1').toString().trim();
(async () => {
  const [page_, out, secs, fps] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: exe });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('file://' + require('path').resolve(page_)); await p.waitForTimeout(800);
  await p.evaluate(() => document.fonts.ready);
  const n = Math.round(+secs * +fps);
  for (let f = 0; f < n; f++) {
    const t = f * 1000 / +fps;
    await p.evaluate((t) => document.getAnimations().forEach(a => { a.pause(); a.currentTime = t; }), t);
    await p.screenshot({ path: `${out}/f${String(f).padStart(4, '0')}.png` });
  }
  await b.close();
})();
