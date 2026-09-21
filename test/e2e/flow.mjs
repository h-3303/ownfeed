// End-to-end pass against live youtube.com in Chrome for Testing: hide + persist, watch page, follow,
// history, both home views, settings page. Needs `npm i --no-save puppeteer`. Screenshots → /tmp/ownfeed-*.png
import puppeteer from 'puppeteer';
const EXT = new URL('../../', import.meta.url).pathname;
const browser = await puppeteer.launch({
  headless: true, pipe: true, enableExtensions: [EXT],
  args: ['--no-sandbox', '--window-size=1400,1000', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  defaultViewport: { width: 1400, height: 1000 },
});
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await browser.setCookie({ name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/', secure: true });
const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
const sw = await swTarget.worker();
const storage = (keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys);

const page = await browser.newPage();
page.on('console', (m) => { if (/ownfeed|chrome-extension/i.test(m.text() + JSON.stringify(m.location()))) log('[console]', m.type(), m.text().slice(0, 400), m.location().url); });
page.on('pageerror', (e) => log('[pageerror]', String(e.message).slice(0, 300)));

// A · persistence: hide a search result + block a topic, reload, both must be gone
const Q = 'https://www.youtube.com/results?search_query=hand+plane+restoration';
await page.goto(Q, { waitUntil: 'networkidle2' });
await page.waitForSelector('ytd-video-renderer.ownfeed-tile');
const before = await page.$$eval('ytd-video-renderer.ownfeed-tile:not(.ownfeed-hidden)', (els) => els.length);
const firstId = await page.$eval('ytd-video-renderer.ownfeed-tile a[href*="watch?v="]', (a) => a.href.match(/v=([\w-]{11})/)[1]);
await page.$eval('ytd-video-renderer.ownfeed-tile > .ownfeed-ni', (b) => b.click());
await page.waitForSelector('.ownfeed-panel');
await sleep(300);
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('ytd-video-renderer.ownfeed-tile');
await sleep(800);
const after = await page.evaluate((id) => {
  const tiles = [...document.querySelectorAll('ytd-video-renderer.ownfeed-tile')];
  const t = tiles.find((el) => el.querySelector(`a[href*="${id}"]`));
  return { visible: tiles.filter((el) => !el.classList.contains('ownfeed-hidden')).length, hiddenOne: t ? t.classList.contains('ownfeed-hidden') : 'absent',
           dimmed: tiles.filter((el) => el.classList.contains('ownfeed-dim')).map((el) => el.getAttribute('data-ownfeed-why')) };
}, firstId);
log('A persistence:', { before, ...after });
const st = await storage(['blocks', 'model']);
log('A stored:', Object.keys(st.blocks.videos), st.model.tok);

// B · watch page: sidebar tiles, follow button, watch recorded after 30 s
await page.goto('https://www.youtube.com/watch?v=aqz-KE-bpKQ', { waitUntil: 'networkidle2' });
await page.waitForSelector('.ownfeed-follow', { timeout: 20000 }).catch(() => log('!! no follow button'));
await sleep(1500);
log('B watch:', await page.evaluate(() => {
  const c = {};
  for (const el of document.querySelectorAll('.ownfeed-tile')) c[el.tagName.toLowerCase()] = (c[el.tagName.toLowerCase()] || 0) + 1;
  const v = document.querySelector('video');
  return { tiles: c, follow: (document.querySelector('.ownfeed-follow') || {}).textContent, playing: v && !v.paused, t: v && v.currentTime,
           err: (document.querySelector('.ytp-error, yt-playability-error-supported-renderers') || {}).innerText };
}));
// sidebar extraction, read through the panel
const side = await page.$('#secondary yt-lockup-view-model.ownfeed-tile, #secondary ytd-compact-video-renderer.ownfeed-tile');
if (side) {
  await side.$eval(':scope > .ownfeed-ni', (b) => b.click());
  await sleep(400);
  log('B sidebar panel:', await side.$eval('.ownfeed-panel', (p) => p.innerText.replace(/\n+/g, ' | ')));
  await side.$eval('.ownfeed-panel .ownfeed-link', (b) => b.click()); // undo
  await sleep(300);
} else log('!! no sidebar tile');
await page.$eval('.ownfeed-follow', (b) => b.click());
await sleep(800);
log('B follow ->', await page.$eval('.ownfeed-follow', (b) => b.textContent), Object.values((await storage('subs')).subs));
await page.screenshot({ path: '/tmp/ownfeed-watch.png' });
await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.play().catch(() => {}); } });
for (let i = 0; i < 9; i++) { await sleep(5000); const h = (await storage('history')).history || []; if (h.length) break; }
log('B history:', ((await storage('history')).history || []).map((h) => [h.id, h.title, h.channel]),
    't=', await page.evaluate(() => (document.querySelector('video') || {}).currentTime));

// C · home feed with a followed channel (+ related, if history was recorded)
await page.goto('https://www.youtube.com/', { waitUntil: 'networkidle2' });
await page.waitForSelector('#ownfeed-bar', { timeout: 15000 }).catch(() => log('!! no switcher bar'));
await sleep(1500);
await page.screenshot({ path: '/tmp/ownfeed-home-yt.png' });
const homeTile = await page.$('ytd-rich-item-renderer.ownfeed-tile');
if (homeTile) {
  await homeTile.$eval(':scope > .ownfeed-ni', (b) => b.click());
  await sleep(400);
  log('C0 yt-home panel:', await homeTile.$eval('.ownfeed-panel', (p) => p.innerText.replace(/\n+/g, ' | ')));
  await homeTile.$eval('.ownfeed-panel .ownfeed-link', (b) => b.click());
} else log('!! no rich-item tiles on YouTube home');
await page.$$eval('.ownfeed-tab', (tabs) => tabs.find((t) => t.textContent === 'My feed').click());
await page.waitForSelector('.ownfeed-card', { timeout: 20000 }).catch(async () => log('!! no cards', await page.evaluate(() => ({ own: (document.querySelector('#ownfeed-home') || {}).innerText, nudge: !!document.querySelector('ytd-feed-nudge-renderer'), browse: !!document.querySelector('ytd-browse[page-subtype="home"]'), path: location.pathname }))));
await sleep(1500);
log('C feed:', await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#ownfeed-home .ownfeed-grid .ownfeed-card')];
  return { n: cards.length, head: document.querySelector('.ownfeed-sub').textContent,
           sample: cards.slice(0, 6).map((c) => [c.querySelector('.ownfeed-title').textContent.slice(0, 40), c.querySelector('.ownfeed-reason')?.textContent.slice(0, 50)]),
           held: document.querySelector('.ownfeed-held')?.innerText };
}));
await page.screenshot({ path: '/tmp/ownfeed-home-feed.png' });
// not interested on a feed card → it must leave the feed on next render, model must change
const cardTitle = await page.$eval('.ownfeed-card .ownfeed-title', (a) => a.textContent);
await page.$eval('.ownfeed-card > .ownfeed-ni', (b) => b.click());
await sleep(500);
await page.screenshot({ path: '/tmp/ownfeed-home-panel.png' });
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('#ownfeed-bar');
await page.$$eval('.ownfeed-tab', (tabs) => tabs.find((t) => t.textContent === 'My feed').click());
await page.waitForSelector('.ownfeed-card');
await sleep(1000);
log('C after NI:', { gone: !(await page.$$eval('.ownfeed-card .ownfeed-title', (as, t) => as.some((a) => a.textContent === t), cardTitle)), cardTitle });

// D · options page renders state
const opt = await browser.newPage();
const extId = swTarget.url().split('/')[2];
await opt.goto(`chrome-extension://${extId}/src/options/options.html`);
await sleep(600);
log('D options:', await opt.evaluate(() => ({ subs: document.querySelector('#subs').innerText, videos: document.querySelector('#videos').innerText.slice(0, 200), neg: document.querySelector('#learned-neg').innerText.slice(0, 200) })));
await opt.screenshot({ path: '/tmp/ownfeed-options.png', fullPage: true });
await browser.close();
