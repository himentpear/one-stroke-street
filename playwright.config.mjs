import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4175/one-stroke-street/';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  reporter: 'list',
  use: { baseURL, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } }
  ],
  webServer: {
    command: 'node scripts/serve.mjs --preview --base /one-stroke-street/ --port 4175',
    url: baseURL, timeout: 20000
  }
});
