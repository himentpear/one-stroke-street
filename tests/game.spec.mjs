import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const entry = new URL('../index.html', import.meta.url).href;
async function positions(page, points) {
  return page.locator('[data-board]').evaluate((svg, points) => points.map(([x, y]) => {
    const point = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    return { x: point.x, y: point.y };
  }), points);
}
async function draw(page, start, end) {
  const [a, b] = await positions(page, [start, end]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}
async function translateOf(locator) {
  const transform = await locator.getAttribute('transform');
  const match = /translate\(\s*([-\d.eE]+)\s+([-\d.eE]+)\s*\)/.exec(transform || '');
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}
async function pencilLength(page) {
  return page.locator('[data-pencil-line]').evaluate(line => Math.hypot(
    Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')),
    Number(line.getAttribute('y2')) - Number(line.getAttribute('y1'))
  ));
}

test('fresh-round roof cuts produce expected falls and springboard behavior', async ({ page }) => {
  for (const [start, end, count, result, check] of [
    [[96, 62], [96, 84], '0', '左侧空巷', async () => {
      expect((await translateOf(page.locator('[data-ball]'))).x).toBeLessThan(96);
      expect((await translateOf(page.locator('[data-spring-top]'))).y).toBe(0);
    }],
    [[96, 73], [192, 73], '0', '平落进空井', async () => {
      const ball = await translateOf(page.locator('[data-ball]'));
      expect(Math.abs(ball.x - 144)).toBeLessThan(5);
      expect(ball.y).toBeGreaterThan(200);
      expect((await translateOf(page.locator('[data-spring-top]'))).y).toBe(0);
    }],
    [[192, 62], [192, 84], '4', '全街打烊', async () => {
      expect((await translateOf(page.locator('[data-spring-top]'))).y).not.toBe(0);
    }]
  ]) {
    await page.goto('./');
    await draw(page, start, end);
    await expect(page.locator('[data-outcome]')).toContainText(result);
    await expect(page.locator('[data-cleared]')).toHaveText(count);
    await expect(page.locator('[data-strokes]')).toHaveText('0');
    await check();
  }
  await page.getByRole('button', { name: '重画' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('[data-strokes]')).toHaveText('1');
  await expect(page.locator('[data-cleared]')).toHaveText('0');
  expect((await translateOf(page.locator('[data-spring-top]'))).y).toBe(0);
});

test('drag preview highlights hit targets, clamps stroke at 144 units, and preserves empty strokes', async ({ page }) => {
  await page.goto('./');
  await draw(page, [330, 66], [350, 82]);
  await expect(page.locator('[data-strokes]')).toHaveText('1');
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'ready');

  const [pinStart, roomEnd] = await positions(page, [[192, 68], [230, 170]]);
  await page.mouse.move(pinStart.x, pinStart.y);
  await page.mouse.down();
  await page.mouse.move(roomEnd.x, roomEnd.y, { steps: 5 });
  await expect(page.locator('[data-pencil]')).toHaveAttribute('visibility', 'visible');
  await expect(page.locator('[data-pin="right"].stroke-hit')).toHaveCount(1);
  await expect(page.locator('[data-rooms] .stroke-hit')).toHaveCount(1);
  await page.mouse.move(pinStart.x, pinStart.y, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('[data-pencil]')).toHaveAttribute('visibility', 'hidden');
  await expect(page.locator('.stroke-hit')).toHaveCount(0);
  await expect(page.locator('[data-strokes]')).toHaveText('1');

  const [overStart, overEnd] = await positions(page, [[223, 165], [497, 177]]);
  await page.mouse.move(overStart.x, overStart.y);
  await page.mouse.down();
  await page.mouse.move(overEnd.x, overEnd.y, { steps: 5 });
  await expect(page.locator('[data-pencil]')).toHaveAttribute('visibility', 'visible');
  await expect(page.locator('[data-rooms] .stroke-hit')).toHaveCount(1);
  expect(await pencilLength(page)).toBeCloseTo(144, 1);
  await page.mouse.up();
  await expect(page.locator('[data-cleared]')).toHaveText('1');
  await expect(page.locator('[data-strokes]')).toHaveText('0');

  await draw(page, [192, 62], [192, 84]);
  await expect(page.locator('[data-cleared]')).toHaveText('1');
});

test('pointercancel clears preview, removes highlights, and preserves the stroke', async ({ page }) => {
  await page.goto('./');
  await page.locator('[data-board]').evaluate(svg => {
    svg.addEventListener('pointerdown', event => { window.__dragPointerId = event.pointerId; }, { capture: true, once: true });
  });
  const [a, b] = await positions(page, [[192, 62], [192, 84]]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await expect(page.locator('[data-pencil]')).toHaveAttribute('visibility', 'visible');
  await expect(page.locator('.stroke-hit')).toHaveCount(1);

  await page.locator('[data-board]').evaluate(svg => {
    svg.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: window.__dragPointerId }));
  });
  await page.mouse.up();

  await expect(page.locator('[data-pencil]')).toHaveAttribute('visibility', 'hidden');
  await expect(page.locator('.stroke-hit')).toHaveCount(0);
  await expect(page.locator('[data-strokes]')).toHaveText('1');
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'ready');

  await draw(page, [192, 62], [192, 84]);
  await expect(page.locator('[data-cleared]')).toHaveText('4');
  await expect(page.locator('[data-outcome]')).toContainText('全街打烊');
});

test('animated collapse supports mid-collapse redraw and spawns 24 shards for 4/4', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./');
  await draw(page, [192, 62], [192, 84]);
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'moving');
  await page.getByRole('button', { name: '重画' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('[data-strokes]')).toHaveText('1');
  await expect(page.locator('[data-cleared]')).toHaveText('0');
  await expect(page.locator('.shard')).toHaveCount(0);

  await draw(page, [192, 62], [192, 84]);
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'done', { timeout: 15000 });
  await expect(page.locator('[data-outcome]')).toContainText('全街打烊');
  await expect(page.locator('[data-cleared]')).toHaveText('4');
  await expect(page.locator('.shard')).toHaveCount(24);
});

test('shipped file matches dist/index.html byte-for-byte and plays offline across reloads', async ({ page, context }) => {
  const [rootHtml, distHtml] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url)),
    readFile(new URL('../dist/index.html', import.meta.url))
  ]);
  expect(rootHtml.equals(distHtml)).toBe(true);
  expect(rootHtml.includes('\r\n')).toBe(false);

  const requests = [], errors = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await context.setOffline(true);
  await page.goto(entry);
  await page.reload();
  await draw(page, [192, 62], [192, 84]);
  await expect(page.locator('[data-cleared]')).toHaveText('4');
  await expect(page.locator('[data-outcome]')).toContainText('全街打烊');
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('keyboard controls use the same cut and sound is opt-in', async ({ page }) => {
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
  await expect(page.locator('[data-cleared]')).toHaveText('4');
});

test('Android touch drag and cancelled gestures', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'mobile-chromium', 'Uses Chromium touch input through CDP.');
  await page.goto('./');
  const session = await context.newCDPSession(page);
  const [a, b] = await positions(page, [[192, 62], [192, 84]]);
  const touch = (type, touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
  await touch('touchStart', [a]);
  await touch('touchMove', [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }]);
  await expect(page.locator('[data-pencil]')).toHaveAttribute('visibility', 'visible');
  await expect(page.locator('.stroke-hit')).toHaveCount(1);
  await touch('touchCancel', []);
  await expect(page.locator('[data-pencil]')).toHaveAttribute('visibility', 'hidden');
  await expect(page.locator('.stroke-hit')).toHaveCount(0);
  await expect(page.locator('[data-strokes]')).toHaveText('1');
  await touch('touchStart', [a]);
  await touch('touchMove', [b]);
  await touch('touchEnd', []);
  await expect(page.locator('[data-outcome]')).toContainText('全街打烊');
  await expect(page.locator('[data-cleared]')).toHaveText('4');
});
