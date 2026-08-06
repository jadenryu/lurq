/**
 * Screenshot the landing page at real viewport sizes with a real browser, so the
 * design can be reviewed rather than guessed at. Throwaway QA helper.
 *
 *   npx tsx scripts/tmp/shots.mts [outDir]
 */
import { chromium, type Browser } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv[2] ?? '/tmp/lurq-shots';
await mkdir(OUT, { recursive: true });

const browser: Browser = await chromium.launch();

async function page(width: number, height: number, reduced = false) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2600);
  // The Clerk dev badge is local-only noise; hide it so it can't cover a section.
  await p.addStyleTag({
    content:
      '[data-clerk-keyless-prompt],iframe,[class^="cl-"],[class*=" cl-"]{visibility:hidden!important}',
  });
  return { ctx, p };
}

async function shootSections(
  label: string,
  width: number,
  height: number,
  sections: [string, string][],
  reduced = false,
) {
  const { ctx, p } = await page(width, height, reduced);
  for (const [name, sel] of sections) {
    const el = p.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await p.waitForTimeout(1400);
    await el.screenshot({ path: `${OUT}/${label}-${name}.png` });
    console.log(`${label}-${name}.png`);
  }
  await ctx.close();
}

const DESKTOP: [string, string][] = [
  ['hero', 'main > section:nth-of-type(1)'],
  ['matrix', '#stack'],
  ['numbers', 'main > section:nth-of-type(3)'],
  ['usage', '#capabilities'],
  ['verify', 'main > section:nth-of-type(5)'],
  ['weights', '#weights'],
  ['provenance', 'main > section:nth-of-type(7)'],
  ['install', '#install'],
  ['limits', '#limits'],
  ['faq', '#faq'],
  ['cta', 'main > section:last-of-type'],
  ['footer', 'footer'],
];

await shootSections('d', 1440, 900, DESKTOP);
await shootSections('m', 390, 844, [
  ['hero', 'main > section:nth-of-type(1)'],
  ['matrix', '#stack'],
  ['numbers', 'main > section:nth-of-type(3)'],
  ['usage', '#capabilities'],
  ['install', '#install'],
  ['faq', '#faq'],
  ['footer', 'footer'],
]);

// Horizontal overflow + reachable-target audit at the narrowest supported width.
{
  const { ctx, p } = await page(390, 844);
  const audit = await p.evaluate(() => {
    const docW = document.documentElement.scrollWidth;
    const wide: string[] = [];
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > docW + 1 || r.left < -1)) {
        wide.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
    });
    return { docW, viewport: window.innerWidth, overflowing: wide.slice(0, 12) };
  });
  console.log('MOBILE AUDIT', JSON.stringify(audit, null, 1));
  await ctx.close();
}

await browser.close();
