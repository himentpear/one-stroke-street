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

test('the three roof cuts produce different falls', async ({ page }) => {
  await page.goto('./');
  for (const [start, end, count, result] of [
    [[96, 62], [96, 84], '0', '左侧空巷'],
    [[96, 73], [192, 73], '0', '平落进空井'],
    [[192, 62], [192, 84], '4', '全街打烊']
  ]) {
    await draw(page, start, end);
    await expect(page.locator('[data-outcome]')).toContainText(result);
    await expect(page.locator('[data-cleared]')).toHaveText(count);
    await expect(page.locator('[data-strokes]')).toHaveText('0');
    await page.getByRole('button', { name: '重画' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-phase', 'ready');
  }
});

test('empty cuts are free and the line stops at three tiles', async ({ page }) => {
  await page.goto('./');
  await draw(page, [330, 66], [350, 82]);
  await expect(page.locator('[data-strokes]')).toHaveText('1');
  await draw(page, [223, 165], [497, 177]);
  await expect(page.locator('[data-cleared]')).toHaveText('1');
  await draw(page, [192, 62], [192, 84]);
  await expect(page.locator('[data-cleared]')).toHaveText('1');
});

test('reset interrupts animation and clears its pending frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./');
  await draw(page, [192, 62], [192, 84]);
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'moving');
  await page.getByRole('button', { name: '重画' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('[data-strokes]')).toHaveText('1');
  await draw(page, [192, 62], [192, 84]);
  await expect(page.locator('[data-outcome]')).toContainText('全街打烊', { timeout: 12000 });
});

test('the shipped file plays offline without HTTP or host APIs', async ({ page, context }) => {
  const requests = [], errors = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await context.setOffline(true);
  await page.goto(entry);
  await draw(page, [192, 62], [192, 84]);
  await expect(page.locator('[data-cleared]')).toHaveText('4');
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
  await touch('touchCancel', []);
  await expect(page.locator('[data-strokes]')).toHaveText('1');
  await touch('touchStart', [a]);
  await touch('touchMove', [b]);
  await touch('touchEnd', []);
  await expect(page.locator('[data-outcome]')).toContainText('全街打烊');
});
