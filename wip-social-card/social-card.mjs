// Render the smocket social preview card (1280x640) to a PNG.
//
// Run from the repo root after installing the browser once:
//   pnpm exec playwright install chromium
//   node wip-social-card/social-card.mjs out.png
//
// This is a work-in-progress handoff. See HANDOFF.md in this folder for state,
// decisions, and the next step. Do NOT commit the output PNG or this folder to
// main. The final card is uploaded by hand at GitHub Settings > General >
// Social preview.

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const rocket = 'data:image/webp;base64,' + readFileSync(here('./assets/rocket.webp')).toString('base64');
const cat = 'data:image/webp;base64,' + readFileSync(here('./assets/cat.webp')).toString('base64');

// Faint background code tokens (JetBrains Mono). Left-column tokens were removed
// so nothing sits behind the heading. [text, x, y, fontSize].
const tokens = [
  ['disconnect', 150, 42, 22], ['rooms', 452, 96, 20], ["socket.on('event')", 656, 40, 22],
  ['namespace', 902, 66, 20], ["io.to('room-1')", 1096, 118, 22],
  ['broadcast', 176, 596, 22], ['ack', 452, 604, 20], ['emit', 560, 560, 20],
  ['join', 1188, 470, 20],
];
const tokenHtml = tokens.map(([t, x, y, s]) =>
  `<span class="tok" style="left:${x}px;top:${y}px;font-size:${s}px">${t}</span>`).join('');

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700;800&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1280px;height:640px}
  /* Brand values, measured off the landing page (smocket-site.vercel.app):
     bg #f5ecdb, text #241608, orange #f4a259, muted token #cf9a55,
     heading = system-ui weight 800, wordmark/tokens = JetBrains Mono. */
  body{background:#f5ecdb;color:#241608;width:1280px;height:640px;position:relative;overflow:hidden;
    font-family:-apple-system,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .tok{position:absolute;font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:500;
    color:#cf9a55;opacity:.30;white-space:nowrap}
  .dot{position:absolute;width:9px;height:9px;border-radius:50%;background:#f4a259;opacity:.55}
  .glow{position:absolute;right:70px;top:50%;transform:translateY(-50%);width:660px;height:660px;border-radius:50%;
    background:radial-gradient(circle,rgba(255,251,242,.85),rgba(255,251,242,.35) 45%,transparent 70%)}
  .rocket{position:absolute;right:70px;top:50%;transform:translateY(-52%);width:600px;
    filter:drop-shadow(0 18px 30px rgba(120,80,30,.16))}
  .col{position:absolute;left:96px;top:50%;transform:translateY(-50%);width:600px;z-index:3}
  .lockup{display:flex;align-items:center;gap:16px;margin-bottom:34px}
  .avatar{width:60px;height:60px;border-radius:50%;object-fit:cover}
  .wm{font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:700;font-size:32px;letter-spacing:-.5px}
  h1{font-weight:800;font-size:66px;line-height:1.05;letter-spacing:-1.5px}
  h1 .o{color:#f4a259}
  .tag{margin-top:30px;font-weight:800;font-size:27px;color:#f4a259;letter-spacing:.2px}
  .tag .s{margin-right:8px}
</style></head>
<body>
  ${tokenHtml}
  <div class="dot" style="left:238px;top:150px"></div>
  <div class="dot" style="left:520px;top:470px"></div>
  <div class="glow"></div>
  <img class="rocket" src="${rocket}" alt="">
  <div class="col">
    <div class="lockup"><img class="avatar" src="${cat}" alt=""><span class="wm">smocket</span></div>
    <h1>Test socket.io<br><span class="o">without a server.</span></h1>
    <div class="tag"><span class="s">✦</span>Sweet setup, rocket speed.</div>
  </div>
</body></html>`;

const out = process.argv[2] || 'social-card.png';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
