import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const entry = new URL('../index.html', import.meta.url).href;

async function positions(page, points) {
  return page.evaluate(pts => pts.map(([x, y]) => window.__OSS__.worldToScreen(x, y)), points);
}

async function draw(page, start, end) {
  const [a, b] = await positions(page, [start, end]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

async function waitDone(page) {
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'done', { timeout: 20000 });
}

test('three roof cuts produce distinct Planck.js physical outcomes', async ({ page }) => {
  // 1. Cut left pin only -> ball rolls into left alley, 0/4
  await page.goto('./');
  await draw(page, [96, 62], [96, 84]);
  await waitDone(page);
  await expect(page.locator('[data-cleared]')).toHaveText('0');
  await expect(page.locator('[data-outcome]')).toContainText('左侧空巷');
  let snap = await page.evaluate(() => window.__OSS__.getSnapshot());
  expect(snap.ball.x).toBeLessThan(96);
  expect(snap.springStatus).toBe('ready');

  // 2. Cut both pins -> awning & ball fall flat into central well, 0/4
  await page.getByRole('button', { name: '重画' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'ready');
  await draw(page, [96, 73], [192, 73]);
  await waitDone(page);
  await expect(page.locator('[data-cleared]')).toHaveText('0');
  await expect(page.locator('[data-outcome]')).toContainText('平落进空井');
  snap = await page.evaluate(() => window.__OSS__.getSnapshot());
  expect(Math.abs(snap.ball.x - 144)).toBeLessThan(12);
  expect(snap.ball.y).toBeGreaterThan(220);
  expect(snap.springStatus).toBe('ready');

  // 3. Cut right pin only -> smashes left rooms, triggers springboard, crosses street, 4/4
  await page.getByRole('button', { name: '重画' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'ready');
  await draw(page, [192, 62], [192, 84]);
  await waitDone(page);
  await expect(page.locator('[data-cleared]')).toHaveText('4');
  await expect(page.locator('[data-outcome]')).toContainText('全街打烊');
  await expect(page.locator('main')).toHaveAttribute('data-cleared-all', 'true');
  snap = await page.evaluate(() => window.__OSS__.getSnapshot());
  expect(snap.springStatus).toBe('spent');
  expect(snap.fractureOrder).toEqual(['room-0', 'room-1', 'room-2', 'room-3']);
  expect(snap.fx.shards).toBe(24);
  expect(snap.fx.poppedPins).toBe(1);
});

test('moving springboard or room in debug mode changes outcome for the exact same stroke', async ({ page }) => {
  await page.goto('./?debug=1');
  const debugBtn = page.locator('[data-debug]');
  await expect(debugBtn).toHaveAttribute('aria-pressed', 'true');

  // Shift springboard right so the same right-pin cut misses/overshoots opposite building
  await page.evaluate(() => window.__OSS__.setLevelOverrides({ spring: { left: 320, right: 411 } }));
  await draw(page, [192, 62], [192, 84]);
  await waitDone(page);
  const shiftedSpring = await page.evaluate(() => window.__OSS__.getSnapshot());
  expect(shiftedSpring.smashed).toBeLessThan(4);

  // Shift room-3 out of the flight arc -> same stroke breaks fewer than 4 rooms
  await page.evaluate(() => window.__OSS__.setLevelOverrides({ rooms: [null, null, null, { x: 330, y: 110 }] }));
  await draw(page, [192, 62], [192, 84]);
  await waitDone(page);
  const shiftedRoom = await page.evaluate(() => window.__OSS__.getSnapshot());
  expect(shiftedRoom.smashed).toBe(3);
  expect(shiftedRoom.fractureOrder).toEqual(['room-0', 'room-1', 'room-2']);
});

test('empty strokes are free, pointercancel preserves stroke, and mid-collapse redraw works', async ({ page }) => {
  await page.goto('./');

  // Empty stroke preserves 1 stroke
  await draw(page, [330, 56], [356, 74]);
  await expect(page.locator('[data-strokes]')).toHaveText('1');
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'ready');

  // pointercancel clears drag preview and preserves stroke
  await page.locator('[data-board]').evaluate(canvas => {
    canvas.addEventListener('pointerdown', e => { window.__pid = e.pointerId; }, { capture: true, once: true });
  });
  const [a, b] = await positions(page, [[192, 62], [192, 84]]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  expect((await page.evaluate(() => window.__OSS__.getSnapshot())).previewActive).toBe(true);
  await page.locator('[data-board]').evaluate(canvas => {
    canvas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: window.__pid }));
  });
  await page.mouse.up();
  expect((await page.evaluate(() => window.__OSS__.getSnapshot())).previewActive).toBe(false);
  await expect(page.locator('[data-strokes]')).toHaveText('1');

  // Mid-collapse redraw immediately interrupts animation and allows immediate retry
  await draw(page, [192, 62], [192, 84]);
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'moving');
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: '重画' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('[data-strokes]')).toHaveText('1');
  await expect(page.locator('[data-cleared]')).toHaveText('0');
  expect((await page.evaluate(() => window.__OSS__.getSnapshot())).fx.shards).toBe(0);

  // Redraw immediately and clear 4/4
  await draw(page, [192, 62], [192, 84]);
  await waitDone(page);
  await expect(page.locator('[data-cleared]')).toHaveText('4');
});

test('shipped index.html matches dist/index.html and clears offline without HTTP requests', async ({ page, context }) => {
  const [rootHtml, distHtml] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url)),
    readFile(new URL('../dist/index.html', import.meta.url))
  ]);
  expect(rootHtml.equals(distHtml)).toBe(true);
  expect(rootHtml.includes('\r\n')).toBe(false);

  const requests = [];
  const errors = [];
  page.on('request', req => { if (/^https?:/.test(req.url())) requests.push(req.url()); });
  page.on('pageerror', err => errors.push(err.message));
  await context.setOffline(true);
  await page.goto(entry);
  await page.reload();
  await draw(page, [192, 62], [192, 84]);
  await waitDone(page);
  await expect(page.locator('[data-cleared]')).toHaveText('4');
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('keyboard controls, opt-in sound, and reduced motion keep full physical animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  const sound = page.locator('[data-sound]');
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  if (await page.evaluate(() => Boolean(window.AudioContext || window.webkitAudioContext))) {
    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
  } else {
    await expect(sound).toBeDisabled();
  }
  await page.locator('summary').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '划右扣', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'moving');
  await waitDone(page);
  await expect(page.locator('[data-cleared]')).toHaveText('4');
});

test('real browser touch drag and touchCancel on mobile Chromium', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'mobile-chromium', 'Uses Chromium CDP touch input.');
  await page.goto('./');
  const session = await context.newCDPSession(page);
  const [a, b] = await positions(page, [[192, 62], [192, 84]]);
  const touch = (type, touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
  await touch('touchStart', [a]);
  await touch('touchMove', [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }]);
  expect((await page.evaluate(() => window.__OSS__.getSnapshot())).previewActive).toBe(true);
  await touch('touchCancel', []);
  expect((await page.evaluate(() => window.__OSS__.getSnapshot())).previewActive).toBe(false);
  await expect(page.locator('[data-strokes]')).toHaveText('1');

  await touch('touchStart', [a]);
  await touch('touchMove', [b]);
  await touch('touchEnd', []);
  await waitDone(page);
  await expect(page.locator('[data-cleared]')).toHaveText('4');
  await expect(page.locator('[data-outcome]')).toContainText('全街打烊');
});
