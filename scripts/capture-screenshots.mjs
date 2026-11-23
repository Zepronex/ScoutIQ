// Captures the README screenshots from a running app with current projections.
//
//   SCOUTIQ_WEB_URL=http://localhost:3000 node scripts/capture-screenshots.mjs
//
// Set SCOUTIQ_BROWSER_CHANNEL=chrome to use an installed Chrome instead of the
// Playwright Chromium download. The run generates a fresh draft, so it does not
// depend on anything saved in a browser profile.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = process.env.SCOUTIQ_WEB_URL || 'http://localhost:3000';
const out = fileURLToPath(new URL('../docs/assets/screenshots', import.meta.url));
const channel = process.env.SCOUTIQ_BROWSER_CHANNEL;
const browser = await chromium.launch(channel ? { channel } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: 'en-GB', timezoneId: 'Europe/London' });
const page = await context.newPage();
await page.goto(base);
await page.getByText(/until the deadline/).waitFor();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/home.png` });
await page.goto(`${base}/squad`);
await page.getByRole('button', { name: 'Generate a draft' }).click();
await page.getByRole('heading', { name: 'Your squad 15/15' }).waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/squad-builder.png` });
await page.getByRole('link', { name: 'Review gameweek plan' }).first().click();
await page.getByRole('heading', { name: 'Recommended starting XI' }).waitFor();
await page.getByLabel('Free transfers').selectOption('1');
await page.getByRole('button', { name: 'Compare transfers', exact: true }).click();
await page.getByText(/Recommended transfer options|Keep your squad this gameweek/).waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/gameweek-plan.png`, fullPage: true });
await page.goto(`${base}/top-players`);
await page.locator('tbody a').first().waitFor();
await page.screenshot({ path: `${out}/top-players.png` });
await page.goto(`${base}/evaluation`);
await page.getByText('By position').waitFor();
await page.screenshot({ path: `${out}/model.png` });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-GB', timezoneId: 'Europe/London', storageState: await context.storageState() });
const mobile = await phone.newPage();
await mobile.goto(`${base}/analyze`);
await mobile.getByRole('heading', { name: 'Recommended starting XI' }).waitFor();
await mobile.evaluate(() => window.scrollTo(0, document.querySelector('.pitch').getBoundingClientRect().top + scrollY - 250));
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: `${out}/gameweek-plan-phone.png` });
await browser.close();
