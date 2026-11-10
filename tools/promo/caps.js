// Renders the caption overlays (transparent PNGs) and the phone bezel.
const { chromium } = require('../node_modules/playwright');
const fs = require('fs'), path = require('path');
const exe = require('child_process').execSync('ls /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1').toString().trim();
const caps = {
  c1: { t: "LONDON'S<br>STREET ART" },
  c2: { t: "JUST GOT<br>A <b>GUIDE</b>" },
  c3: { t: "<b>2,500</b> CITIES.<br><b>5,000+</b><br>WALKING TOURS.", s: "London · Paris · Berlin · New York" },
  c4: { t: "FOLLOW THE<br><b>PINK DOTS</b>", s: "AR walking directions" },
  c6: { t: "BIG MURALS.<br>HIDDEN <b>GEMS.</b>", s: "Murals · tunnels · legal walls" },
  c7: { t: "UNLOCK THE<br><b>STORY</b> BEHIND<br>EVERY WALL" },
  c8: { t: "FIND THE<br><b>WALL.</b>", s: "A story at every stop" },
  c9: { t: "ANY CITY.<br>ANY <b>WALL.</b>", s: "Built on OpenStreetMap" },
};
(async () => {
  const b = await chromium.launch({ executablePath: exe });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const [k, v] of Object.entries(caps)) {
    await p.goto('file://' + path.resolve('cap.html') + '?' + new URLSearchParams(v).toString());
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200);
    await p.screenshot({ path: `cap/${k}.png`, omitBackground: true });
  }
  await p.goto('file://' + path.resolve('bezel.html')); await p.screenshot({ path: 'bezel.png', omitBackground: true });
  await b.close(); console.log('captions + bezel done, chrome =', exe);
})();
