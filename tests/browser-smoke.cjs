const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const capture = process.argv.includes('--screenshots');
const recordGif = process.argv.includes('--gif-frames');
const label = baseline ? 'baseline' : 'release';
const mount = '/subways-of-budapest';
const files = {
  '/': ['index.html', 'text/html'],
  '/script.js': ['script.js', 'text/javascript'],
  '/rules.mjs': ['rules.mjs', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
  '/stations.json': ['stations.json', 'application/json'],
  '/lines.json': ['lines.json', 'application/json'],
};

async function captureGameplay(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 930 } });
  await page.addInitScript(() => { Math.random = () => 0.5; });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#playerName').fill('Demo Rider');
  await page.locator('[data-action="start"]').click();
  const directory = path.join(root, 'test-results', 'gif-frames');
  await fs.mkdir(directory, { recursive: true });
  const station = id => '.station[data-id="' + id + '"]';
  const actions = [
    [1100, '[data-action="draw"]'], [2400, station(19)], [3600, station(20)],
    [5400, station(20)], [6900, station(15)],
  ];
  const frames = [];
  const start = performance.now();
  while (performance.now() - start < 10500) {
    if (actions.length && performance.now() - start >= actions[0][0]) {
      const [, selector] = actions.shift();
      await page.locator(selector).click();
    }
    const filename = String(frames.length).padStart(3, '0') + '.png';
    const timestamp = Math.round(performance.now() - start);
    await page.screenshot({ path: path.join(directory, filename) });
    frames.push({ filename, timestamp });
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  assert.equal(actions.length, 0);
  assert.equal(await page.locator('.segment').count(), 2);
  await fs.writeFile(path.join(directory, 'frames.json'), JSON.stringify(frames));
  console.log('Recorded ' + frames.length + ' actual browser frames with two route placements');
  await page.close();
}

async function main() {
  const server = http.createServer(async (request, response) => {
    const resource = request.url.startsWith(mount + '/') ? request.url.slice(mount.length) : null;
    const file = files[resource];
    if (!file) {
      response.writeHead(request.url === '/favicon.ico' ? 204 : 404).end();
      return;
    }
    try {
      const bytes = await fs.readFile(path.join(root, file[0]));
      response.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8' }).end(bytes);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
    const url = 'http://127.0.0.1:' + server.address().port + mount + '/';
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    function watch(tab) {
      tab.on('pageerror', error => errors.push(error.message));
      tab.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      tab.on('response', response => { if (!response.ok()) errors.push(response.status() + ' ' + response.url()); });
    }
    watch(page);
    // Stable deck order exercises SWITCH followed by JOKER without changing the game.
    await page.addInitScript(() => { Math.random = () => 0.5; });
    await page.goto(url, { waitUntil: 'networkidle' });
    const button = action => page.locator('[data-action="' + action + '"]');
    const station = id => page.locator('.station[data-id="' + id + '"]');
    const snap = async (tab, name) => {
      if (!capture) return;
      const directory = path.join(root, 'docs', 'screenshots');
      await fs.mkdir(directory, { recursive: true });
      await tab.screenshot({ path: path.join(directory, label + '-' + name + '.png'), fullPage: true, animations: 'disabled' });
    };
    const hud = key => page.locator('[data-hud="' + key + '"]');
    const mapData = JSON.parse(await fs.readFile(path.join(root, 'stations.json'), 'utf8'));
    async function assertLayout(tab, width) {
      const metrics = await tab.evaluate(stations => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const board = rect('[data-board]');
        const card = rect('.card-slot');
        const line = rect('.hud-heading');
        const aligned = stations.every(({ id, x, y }) => {
          const node = rect('.station[data-id="' + id + '"]');
          return Math.abs(node.left + node.width / 2 - board.left - (x + 0.5) * board.width / 10) < 1 &&
            Math.abs(node.top + node.height / 2 - board.top - (y + 0.5) * board.height / 10) < 1;
        });
        const buttons = [...document.querySelectorAll('.control-buttons .btn')].every(button => {
          const bounds = button.getBoundingClientRect();
          return bounds.width > 0 && bounds.height >= 44 && bounds.left >= 0 && bounds.right <= innerWidth;
        });
        return {
          width: innerWidth, scroll: document.documentElement.scrollWidth, aligned, buttons,
          separate: card.left >= line.right || card.top >= line.bottom
        };
      }, mapData);
      assert.deepEqual(metrics, { width, scroll: width, aligned: true, buttons: true, separate: true });
    }
    await snap(page, 'menu');
    await page.locator('#playerName').fill('Demo Rider');
    if (baseline) await button('start').click();
    else await page.locator('#playerName').press('Enter');
    await station(19).waitFor();
    if (!baseline) {
      await assertLayout(page, 1440);
      await snap(page, 'empty-board');
    }
    assert.equal(await page.locator('.station').count(), 53);
    assert.equal(await hud('line-name').textContent(), 'M1');
    await button('draw').click();
    assert.equal(await hud('card').textContent(), 'JOKER');
    if (!baseline) {
      assert.equal(await hud('switch').isVisible(), true);
      assert.equal(await button('draw').isDisabled(), true);
      await snap(page, 'switch');
    }
    await station(20).click();
    assert.match(await page.locator('[data-toast]').textContent(), /visited station/i);
    await station(19).click();
    await station(21).click();
    assert.match(await page.locator('[data-toast]').textContent(), /45°/);
    assert.equal(await page.locator('.segment').count(), 0);
    if (!baseline) await snap(page, 'invalid');
    await station(19).click();
    if (!baseline) {
      assert.equal(await station(19).getAttribute('aria-pressed'), 'true');
      assert.match(await station(20).getAttribute('class'), /station--candidate/);
      assert.doesNotMatch(await station(21).getAttribute('class'), /station--candidate/);
    }
    await station(20).click();
    assert.equal(await page.locator('.segment').count(), 1);
    if (!baseline) assert.match(await station(20).getAttribute('class'), /station--endpoint/);
    await page.locator('.toast').last().waitFor({ state: 'detached' });
    await snap(page, 'game');
    await button('undo').click();
    assert.equal(await page.locator('.segment').count(), 0);
    if (!baseline) {
      assert.match(await station(19).getAttribute('class'), /station--endpoint/);
      assert.equal(await station(20).locator('.station-mark').evaluate(mark =>
        mark.style.getPropertyValue('--station-route')), '');
    }
    await station(19).click();
    await station(20).click();
    assert.equal(await page.locator('.segment').count(), 1);

    const scores = page.locator('[data-scores] li');
    const result = page.locator('[data-final]');
    async function advanceTo(rounds) {
      let observedLock = false;
      for (let i = 0; i < 60 && (await scores.count()) < rounds; i++) {
        if (await button('end-round').isEnabled()) {
          observedLock = true;
          assert.match(await hud('type-counts').textContent(), /(?:Side|Center) 5/);
          await button('end-round').click();
        } else if ((await hud('card').textContent()).match(/^(–|—)$/)) {
          await button('draw').click();
        } else {
          await button('skip').click();
        }
      }
      assert(observedLock);
      assert.equal(await scores.count(), rounds);
    }
    await advanceTo(4);
    assert.deepEqual((await scores.allTextContents()).map(score => score.slice(0, 2)), ['M1', 'M2', 'M3', 'M4']);
    assert.match(await scores.first().textContent(), /2 pts/);
    const final = await result.textContent();
    const endEnabled = await button('end-round').isEnabled();
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('subways_scores')));
    assert.equal(persisted[0].name, 'Demo Rider');
    if (!baseline) {
      assert.equal(await hud('switch').isVisible(), false);
      assert.match(final, /Final Score: 2/);
      assert.equal(persisted[0].score, 2);
      assert.equal(persisted.length, 1);
      assert.equal(endEnabled, false);
      const results = page.locator('[data-screen="results"]');
      await results.waitFor();
      assert.equal(await page.locator('[data-result="player"]').textContent(), 'Demo Rider');
      assert.equal(await page.locator('[data-result="total"]').textContent(), '2');
      assert.deepEqual(await page.locator('[data-result="lines"] li strong').allTextContents(), ['2 pts', '0 pts', '0 pts', '0 pts']);
      assert.equal(await page.locator('[data-result="round-points"]').textContent(), '2');
      assert.equal(await page.locator('[data-result="rail-points"]').textContent(), '0');
      assert.equal(await page.locator('[data-result="transfer-points"]').textContent(), '0');
      assert.match(await page.locator('[data-result="time"]').textContent(), /^\d{2}:\d{2}$/);
      await snap(page, 'results');
      await page.setViewportSize({ width: 390, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth === 390));
      assert.equal(await button('again').isVisible(), true);
      assert.equal(await button('results-menu').isVisible(), true);
      await snap(page, 'mobile-results');
      await page.setViewportSize({ width: 1440, height: 900 });
      await button('again').click();
      assert.equal(await scores.count(), 0);
      assert.equal(await page.locator('.segment').count(), 0);
      assert.equal(await hud('timer').textContent(), '00:00');
      assert.equal(await hud('cards').textContent(), '0 / 8');
      assert.equal(await hud('round').textContent(), 'Round 1 / 4');
      assert.equal(await hud('switch').isVisible(), false);
      await button('draw').click();
      await station(19).click();
      await station(20).click();
      await button('restart').click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.segment').count(), 1);
      await button('restart').click();
      await page.locator('[data-confirm-action]').click();
      await page.waitForFunction(() => document.querySelector('[data-hud="cards"]').textContent === '0 / 8');
      assert.equal(await page.locator('.segment').count(), 0);
      assert.equal(await scores.count(), 0);

      await button('draw').click();
      await station(19).click();
      await station(20).click();
      await advanceTo(1);
      if ((await hud('card').textContent()) === '–') await button('draw').click();
      await station(28).click();
      await station(33).click();
      assert.equal(await page.locator('.segment').count(), 2);
      if (capture) await page.locator('.toast').last().waitFor({ state: 'detached' });
      await snap(page, 'multi-line');
      await advanceTo(4);
      await button('results-menu').click();
      assert.match(await page.locator('[data-highscores]').textContent(), /Demo Rider.*2 pts/);
      await snap(page, 'highscores');
      assert.equal(await page.locator('[data-highscores] li').count(), 2);
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await page.locator('[data-highscores] li').count(), 2);
      await page.locator('#playerName').fill('New Rider');
      await button('start').click();
      assert.equal(await hud('player').textContent(), 'New Rider');
      await button('leave').click();
      await page.locator('[data-confirm-action]').click();
      await page.locator('[data-screen="menu"]').waitFor();
      assert.equal(await page.locator('[data-highscores] li').count(), 2);

      for (const [width, height] of [[1920, 1080], [1366, 768], [1024, 900], [768, 900], [390, 844]]) {
        const resized = await browser.newPage({ viewport: { width, height },
          isMobile: width === 390, hasTouch: width === 390 });
        watch(resized);
        await resized.goto(url, { waitUntil: 'networkidle' });
        await resized.locator('#playerName').fill('Demo Rider');
        await resized.locator('[data-action="start"]').click();
        await assertLayout(resized, width);
        await resized.close();
      }
      console.log('Layout: no horizontal overflow at 1920, 1440, 1366, 1024, 768, 390 or 360 px');
    }
    console.log('Desktop: station/card checks, rejected start and geometry, route, undo, four rounds, saved score');
    console.log(JSON.stringify({ final, endEnabled, savedScore: persisted[0].score }));

    const mobile = await browser.newPage({
      viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1
    });
    watch(mobile);
    await mobile.addInitScript(() => { Math.random = () => 0.5; });
    await mobile.goto(url, { waitUntil: 'networkidle' });
    await snap(mobile, 'mobile-menu');
    await mobile.locator('#playerName').fill('Demo Rider');
    await mobile.locator('[data-action="start"]').click();
    await mobile.locator('.station').first().waitFor();
    const sizes = await mobile.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      board: Math.round(document.querySelector('[data-board]').getBoundingClientRect().width),
      body: document.body.scrollWidth,
    }));
    if (!baseline) {
      assert.equal(sizes.viewport, 360);
      assert(sizes.document <= 360 && sizes.body <= 360);
      assert(sizes.board <= 360);
      await assertLayout(mobile, 360);
      await mobile.locator('[data-action="draw"]').tap();
      assert.equal(await mobile.locator('[data-hud="card"]').textContent(), 'JOKER');
      await mobile.locator('.station[data-id="19"]').tap();
      await mobile.locator('.station[data-id="20"]').tap();
      assert.equal(await mobile.locator('.segment').count(), 1);
    }
    await snap(mobile, 'mobile-game');
    assert.deepEqual(errors, []);
    console.log('Mobile: ' + JSON.stringify(sizes) + '; zero browser console/page errors or HTTP failures');

    if (!baseline) {
      const branch = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      watch(branch);
      await branch.addInitScript(() => {
        const order = [0.5, 0.5, 0.5, 0.5, ...Array(8).fill(0.1), 0.99, 0.8, 0.9];
        Math.random = () => order.shift() ?? 0.5;
      });
      await branch.goto(url, { waitUntil: 'networkidle' });
      await branch.locator('#playerName').fill('Branch test');
      await branch.locator('[data-action="start"]').click();
      await branch.locator('[data-action="draw"]').click();
      assert.equal(await branch.locator('[data-hud="card"]').textContent(), 'D');
      await branch.locator('.station[data-id="19"]').click();
      await branch.locator('.station[data-id="20"]').click();
      assert.equal(await branch.locator('[data-hud="switch"]').isVisible(), true);
      await branch.locator('.station[data-id="19"]').click();
      await branch.locator('.station[data-id="25"]').click();
      assert.equal(await branch.locator('.segment').count(), 2);
      const cardsUsed = await branch.locator('[data-hud="cards"]').textContent();
      await branch.locator('[data-action="undo"]').click();
      assert.equal(await branch.locator('.segment').count(), 1);
      assert.equal(await branch.locator('.station--endpoint').getAttribute('data-id'), '20');
      assert.equal(await branch.locator('[data-hud="cards"]').textContent(), cardsUsed);
      await branch.close();
      assert.deepEqual(errors, []);
      console.log('Switch branch: undo restored the earlier active endpoint and kept the spent card');

      const unavailable = await browser.newPage();
      await unavailable.addInitScript(() => localStorage.setItem('subways_scores', '{"unexpected":true}'));
      await unavailable.route('**/stations.json', route => route.fulfill({ status: 404 }));
      const uncaught = [];
      unavailable.on('pageerror', error => uncaught.push(error.message));
      await unavailable.goto(url, { waitUntil: 'networkidle' });
      assert.equal(await unavailable.locator('[data-action="start"]').isDisabled(), true);
      assert.match(await unavailable.locator('[data-load-error]').textContent(), /could not load/);
      assert.equal(await unavailable.locator('[data-empty-scores]').isVisible(), true);
      assert.deepEqual(uncaught, []);
      console.log('Failure paths: unexpected storage format and missing station data handled');
    }
    if (!baseline && recordGif) await captureGameplay(browser, url);
  } finally {
    try { await browser?.close(); }
    finally { await new Promise(resolve => server.close(resolve)); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
