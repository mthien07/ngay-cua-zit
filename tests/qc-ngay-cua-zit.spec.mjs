// QC suite for the single-page site index.html ("Ngày của Zịt").
// Runs read-only against the site: nothing here modifies index.html or assets.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SITE_HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

const BASE = 'http://127.0.0.1:4318/';
const ORIGIN = new URL(BASE).origin;
const PAGE_URL = 'https://mthien07.github.io/ngay-cua-zit/';

// Values read from index.html so the suite follows the site config instead of duplicating it.
const START_DATE = SITE_HTML.match(/startDate:\s*'(\d{4}-\d{2}-\d{2})'/)?.[1];
const STORY_MS = Number(SITE_HTML.match(/--story:\s*([\d.]+)s/)?.[1] ?? '4.6') * 1000;

// Labels on the "No" button, in order. Copied from the lines array in index.html.
const NO_LINES = ['Không', 'Chắc chưa?', 'Nghĩ lại đi', 'Zịt bấm nhầm hả?', 'Thôi, bấm Có đi mà'];
const ANSWER_YES = 'Anh biết mà. Anh cũng thương Zịt, nhiều hơn Zịt nghĩ.';

const SLIDE_ORDER = ['s0', 'sP', 's1', 's2', 's3', 's4', 's5', 's6'];

/* ---------- Network and console monitor ---------- */

const isSameOrigin = (url) => {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
};

// Collects problems per page. Same-origin problems fail the test; third-party ones are only annotated.
function monitor(page) {
  const m = { pageErrors: [], consoleErrors: [], failedRequests: [], badResponses: [], external: [] };
  page.on('pageerror', (e) => m.pageErrors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location().url || '';
    const text = `${msg.text()}${loc ? ` @ ${loc}` : ''}`;
    (loc && !isSameOrigin(loc) ? m.external : m.consoleErrors).push(text);
  });
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText ?? 'failed';
    // Browsers stream audio in pieces and abort the rest on purpose; that is not a broken asset.
    if (/\.m4a(\?|$)/.test(r.url()) && /ABORTED|cancel/i.test(err)) return;
    const text = `${r.url()} (${err})`;
    (isSameOrigin(r.url()) ? m.failedRequests : m.external).push(text);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const text = `${r.status()} ${r.url()}`;
    (isSameOrigin(r.url()) ? m.badResponses : m.external).push(text);
  });
  return m;
}

const monitors = new WeakMap();

test.beforeEach(async ({ page }) => {
  monitors.set(page, monitor(page));
});

test.afterEach(async ({ page }, testInfo) => {
  const m = monitors.get(page);
  if (!m) return;
  if (m.external.length) {
    testInfo.annotations.push({ type: 'third-party-requests', description: [...new Set(m.external)].join(' | ') });
  }
  // Tests that break an asset on purpose opt out of the request-failure check.
  if (testInfo.annotations.some((a) => a.type === 'allow-same-origin-failures')) return;
  expect(m.pageErrors, 'uncaught page errors').toEqual([]);
  expect(m.consoleErrors, 'console errors').toEqual([]);
  expect(m.failedRequests, 'failed same-origin requests').toEqual([]);
  expect(m.badResponses, 'same-origin responses with status >= 400').toEqual([]);
});

/* ---------- Helpers ---------- */

// The splash is a tap-to-open gate (the tap also unlocks background music on mobile).
async function openSite(page) {
  await page.goto('/');
  // The button fades in (opacity 0 still counts as visible to Playwright), so wait for the splash's loaded state.
  await expect(page.locator('#splash')).toHaveClass(/\bloaded\b/);
  // The button "breathes" forever, so Playwright never sees it as stable; any tap on the splash opens the site.
  await page.locator('#splash').click({ position: { x: 20, y: 20 } });
  await page.waitForFunction(() => document.documentElement.classList.contains('ready'));
  await expect(page.locator('#splash')).toBeHidden();
}

// Scrolls the reel to a slide with no smooth animation and waits for IntersectionObserver to tag it .in.
async function gotoSlide(page, id) {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    document.getElementById('reel').scrollTo({ top: el.offsetTop, behavior: 'instant' });
  }, id);
  await expect
    .poll(() => page.evaluate((id) => document.getElementById(id).classList.contains('in'), id), {
      message: `slide #${id} should get class "in" after scrolling to it`,
    })
    .toBe(true);
}

const curIndex = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#photos .ph')].findIndex((f) => f.classList.contains('cur')));

// Returns the selected elements whose computed opacity is below minOpacity (empty array means all good).
function dimBlocks(page, selector, minOpacity) {
  return page.evaluate(
    ([sel, min]) =>
      [...document.querySelectorAll(sel)]
        .filter((el) => el.getClientRects().length && parseFloat(getComputedStyle(el).opacity) < min)
        .map((el) => `${el.tagName.toLowerCase()}: ${el.textContent.trim().slice(0, 40)}`),
    [selector, minOpacity],
  );
}

const fmtClock = (s) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor((s % 86400) / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

/* ---------- Load, splash, slides ---------- */

test.describe('load and structure', () => {
  test('page loads with the expected title and no console or request errors', async ({ page }) => {
    await openSite(page);
    await expect(page).toHaveTitle('Ngày của Zịt');
  });

  test('splash shows "Chạm để mở" within 3.5s and stays until tapped', async ({ page }) => {
    await page.goto('/');
    // The loaded fallback timer is 2.5s, so 3.5s leaves room for the fade-in.
    await expect(page.locator('#splash')).toHaveClass(/\bloaded\b/, { timeout: 3500 });
    expect(await page.evaluate(() => document.documentElement.classList.contains('ready'))).toBe(false);
    await page.locator('#openBtn').click({ force: true });
    await page.waitForFunction(() => document.documentElement.classList.contains('ready'));
    await expect(page.locator('#splash')).toBeHidden();
  });

  test('background music starts on open and the disc toggles it', async ({ page }) => {
    await openSite(page);
    const bgm = page.locator('#bgm');
    await expect.poll(() => bgm.evaluate((a) => !a.paused && a.readyState > 0 && !a.error)).toBe(true);
    await expect(page.locator('#music')).toHaveClass(/\bon\b/);
    await page.locator('#music').click({ force: true }); // the disc spins while playing, so it is never "stable"
    await expect.poll(() => bgm.evaluate((a) => a.paused)).toBe(true);
    await expect(page.locator('#music')).not.toHaveClass(/\bon\b/);
    await page.locator('#music').click({ force: true }); // the disc spins while playing, so it is never "stable"
    await expect.poll(() => bgm.evaluate((a) => !a.paused)).toBe(true);
  });

  test('every slide gets class "in" when scrolled to', async ({ page }) => {
    await openSite(page);
    for (const id of SLIDE_ORDER) {
      await gotoSlide(page, id);
    }
  });

  test('all 11 images load when scrolled to, and photo files match the album', async ({ page }) => {
    await openSite(page);
    await gotoSlide(page, 'sP');
    const albumCount = await page.locator('#photos .ph').count();
    expect(albumCount).toBe(10);
    for (let i = 0; i < albumCount; i++) {
      await page.evaluate((i) => {
        const a = document.getElementById('photos');
        a.scrollTo({ left: i * a.clientWidth, behavior: 'instant' });
      }, i);
      await expect
        .poll(() => page.locator('#photos .ph').nth(i).locator('img').evaluate((im) => im.complete && im.naturalWidth > 0), {
          message: `album image ${i + 1} should load`,
        })
        .toBe(true);
    }
    const imgs = await page.evaluate(() =>
      [...document.images].map((im) => ({
        src: im.getAttribute('src'),
        ok: im.complete && im.naturalWidth > 0,
        ratioDeclared: Number(im.getAttribute('width')) / Number(im.getAttribute('height')),
        ratioActual: im.naturalWidth / im.naturalHeight,
      })),
    );
    expect(imgs).toHaveLength(11);
    expect(imgs.filter((i) => !i.ok).map((i) => i.src)).toEqual([]);
    // Declared width/height reserve layout space; a mismatched ratio causes layout shift.
    expect(imgs.filter((i) => Math.abs(i.ratioDeclared - i.ratioActual) > 0.01).map((i) => i.src)).toEqual([]);
    const webpFiles = readdirSync(join(ROOT, 'photos')).filter((f) => f.endsWith('.webp')).sort();
    const usedFiles = imgs.map((i) => i.src.replace(/^(https:\/\/zit\.1bee\.vn\/)?photos\//, '')).filter((s) => s.endsWith('.webp')).sort();
    expect(usedFiles).toEqual(webpFiles);
  });

  test('stats, flags, cover and letter blocks end fully visible', async ({ page }) => {
    await openSite(page);
    // Notes use --o: .88 by design, so they are checked against 0.85 instead of 1.
    await gotoSlide(page, 's0');
    await expect.poll(() => dimBlocks(page, '#s0 .col > *', 0.85), { message: 'cover blocks' }).toEqual([]);
    await gotoSlide(page, 's1');
    await expect.poll(() => dimBlocks(page, '#s1 .col > *', 0.85), { message: 'stats blocks' }).toEqual([]);
    // A finished fill animation computes to identity: "none" or matrix(1, 0, 0, 1, 0, 0) depending on the engine.
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll('#s1 .bar i')].every((i) =>
            ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(i).transform),
          ),
        ),
        { message: 'stats bars should finish their fill animation' },
      )
      .toBe(true);
    await gotoSlide(page, 's2');
    await expect
      .poll(() => dimBlocks(page, '#s2 .col > *, #s2 .flags li', 0.85), { message: 'flags blocks' })
      .toEqual([]);
    await gotoSlide(page, 's4');
    await expect.poll(() => dimBlocks(page, '#s4 .letter p', 1), { message: 'letter paragraphs' }).toEqual([]);
    await expect.poll(() => dimBlocks(page, '#s4 .col > *', 0.85), { message: 'letter header' }).toEqual([]);
  });

  test('days counter matches startDate from index.html', async ({ page }) => {
    expect(START_DATE, 'startDate parsed from index.html').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const t0 = Date.parse(`${START_DATE}T00:00:00+07:00`);
    await openSite(page);
    await expect(page.locator('#s3')).not.toHaveAttribute('hidden', '');
    // Read the counter between two clock samples so a midnight or second boundary cannot cause a false failure.
    const before = Date.now();
    const days = Number(await page.locator('#days').textContent());
    const clock = (await page.locator('#clock').textContent()).trim();
    const after = Date.now();
    const expectedDays = [before, after].map((t) => Math.floor((t - t0) / 86400000));
    expect(expectedDays).toContain(days);
    const sFrom = Math.floor((before - t0) / 1000) - 1;
    const sTo = Math.floor((after - t0) / 1000);
    const candidates = [];
    for (let s = sFrom; s <= sTo; s++) candidates.push(fmtClock(s));
    expect(candidates).toContain(clock);
  });
});

/* ---------- Album (story) ---------- */

test.describe('photo album', () => {
  test('album autoplay advances to the next photo after one story', async ({ page }) => {
    await openSite(page);
    await gotoSlide(page, 'sP');
    await expect.poll(() => curIndex(page)).toBe(0);
    await expect.poll(() => curIndex(page), { timeout: STORY_MS + 4000 }).toBe(1);
  });

  test('holding the album pauses the story and releasing resumes it', async ({ page }) => {
    await openSite(page);
    await gotoSlide(page, 'sP');
    await expect.poll(() => curIndex(page)).toBe(0);
    const box = await page.locator('#photos').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    try {
      await expect(page.locator('#sP')).toHaveClass(/paused/);
      const states = await page.evaluate(() => document.querySelector('#phBars i.cur b').getAnimations().map((a) => a.playState));
      expect(states).toContain('paused');
      // Negative check: the story must not advance while held. Waiting longer than one story is the only way to prove that.
      await page.waitForTimeout(STORY_MS + 800);
      expect(await curIndex(page)).toBe(0);
    } finally {
      await page.mouse.up();
    }
    await expect.poll(() => curIndex(page), { timeout: STORY_MS + 4000 }).toBe(1);
  });

  test('broken album image shows no alt text and the story still advances', async ({ page }, testInfo) => {
    // This test breaks p03.webp on purpose, so the same-origin request-failure check is skipped.
    testInfo.annotations.push({ type: 'allow-same-origin-failures' });
    await page.route('**/photos/p03.webp', (route) => route.fulfill({ status: 404, body: 'missing' }));
    await openSite(page);
    await gotoSlide(page, 'sP');
    await expect.poll(() => curIndex(page), { timeout: STORY_MS + 4000 }).toBe(1);
    const img = page.locator('#photos .ph').nth(1).locator('img');
    const state = await img.evaluate((im) => {
      const cs = getComputedStyle(im);
      return { complete: im.complete, naturalWidth: im.naturalWidth, color: cs.color, fontSize: cs.fontSize };
    });
    expect(state.complete).toBe(true);
    expect(state.naturalWidth).toBe(0);
    expect(state.color).toBe('rgba(0, 0, 0, 0)');
    expect(state.fontSize).toBe('0px');
    await expect(page.locator('#sP')).not.toHaveClass(/\bwait\b/);
    await testInfo.attach('broken-album-slide', { body: await page.locator('#sP').screenshot(), contentType: 'image/png' });
    await expect.poll(() => curIndex(page), { timeout: STORY_MS + 4000 }).toBe(2);
  });
});

/* ---------- Question, gift, interactions ---------- */

test.describe('question, gift and interactions', () => {
  test('No button dodges when the mouse hovers over it', async ({ page }) => {
    await openSite(page);
    await gotoSlide(page, 's5');
    const no = page.locator('#no');
    // Mouse pointerenter is the dodge trigger for pointerType "mouse" only.
    await no.hover();
    await expect(no).toHaveText(NO_LINES[1]);
    await expect(page.locator('#answer')).toHaveText('');
  });

  test('No button label advances one step per tap until the last label', async ({ page }) => {
    await openSite(page);
    await gotoSlide(page, 's5');
    const no = page.locator('#no');
    for (let k = 1; k < NO_LINES.length; k++) {
      await no.tap();
      await expect(no, `label after ${k} tap(s)`).toHaveText(NO_LINES[k]);
    }
    await expect(page.locator('#answer')).toHaveText('');
  });

  test('fifth press on No hides the button without accepting', async ({ page }) => {
    await openSite(page);
    await gotoSlide(page, 's5');
    const no = page.locator('#no');
    for (let k = 1; k < NO_LINES.length; k++) {
      await no.tap();
      await expect(no).toHaveText(NO_LINES[Math.min(k, NO_LINES.length - 1)]);
    }
    await no.tap();
    // Current behavior: No shrinks away (class gone, then hidden after ~380ms). Only Yes answers.
    await expect(no).toHaveClass(/\bgone\b/);
    await expect(no).toBeHidden({ timeout: 2000 });
    await expect(page.locator('#answer')).toHaveText('');
    await expect(page.locator('#next')).toBeHidden();
    await expect(page.locator('#yes')).toBeEnabled();
  });

  test('Yes shows the answer and Next scrolls to the gift', async ({ page }) => {
    await openSite(page);
    await gotoSlide(page, 's5');
    await page.locator('#yes').tap();
    await expect(page.locator('#answer')).toHaveText(ANSWER_YES);
    await expect(page.locator('#next')).toBeVisible();
    await expect(page.locator('#yes')).toBeDisabled();
    await expect(page.locator('#no')).toBeHidden({ timeout: 2000 });
    await page.locator('#next').tap();
    await expect
      .poll(() =>
        page.evaluate(() => Math.abs(document.getElementById('reel').scrollTop - document.getElementById('s6').offsetTop) <= 2),
      )
      .toBe(true);
    await expect(page.locator('#s6')).toHaveClass(/\bin\b/);
  });

  test('gift opens and the ticket appears', async ({ page }) => {
    await openSite(page);
    await gotoSlide(page, 's6');
    await expect(page.locator('#ticket')).toBeHidden();
    // force: the gift wiggles forever, so Playwright's stability check would never pass.
    await page.locator('#gift').tap({ force: true });
    await expect(page.locator('#ticket')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#gift')).toBeHidden();
    await expect(page.locator('#gtA')).toBeHidden();
    await expect(page.locator('#gtB')).toBeVisible();
    await expect(page.locator('#ticket li')).toHaveCount(3);
  });

  test('like button increments the count', async ({ page }) => {
    await openSite(page);
    await gotoSlide(page, 's0');
    const like = page.locator('#like');
    await expect(page.locator('#likeCount')).toHaveText('0');
    await like.click();
    await expect(page.locator('#likeCount')).toHaveText('1');
    await like.click();
    await expect(page.locator('#likeCount')).toHaveText('2');
    await expect(like).toHaveClass(/liked/);
  });

  test('double tap on the reel likes and draws hearts on the canvas', async ({ page }) => {
    await openSite(page);
    await gotoSlide(page, 's0');
    const box = await page.locator('#reel').boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.4);
    await expect(page.locator('#likeCount')).toHaveText('1');
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const c = document.getElementById('fx');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
            return n;
          }),
        { intervals: [50], timeout: 1500 },
      )
      .toBeGreaterThan(0);
  });

  test('replay button scrolls back to the first slide', async ({ page }) => {
    await openSite(page);
    await gotoSlide(page, 's5');
    await page.locator('#replay').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('reel').scrollTop)).toBe(0);
  });

  test('no standalone "em" in any rendered text, including states revealed by interaction', async ({ page }) => {
    await openSite(page);
    for (const id of SLIDE_ORDER.slice(0, 6)) await gotoSlide(page, id);
    await gotoSlide(page, 's5');
    const no = page.locator('#no');
    for (let k = 1; k < NO_LINES.length; k++) await no.tap();
    await page.locator('#yes').tap();
    await page.locator('#next').tap();
    await expect(page.locator('#s6')).toHaveClass(/\bin\b/);
    await page.locator('#gift').tap({ force: true });
    await expect(page.locator('#ticket')).toBeVisible({ timeout: 4000 });
    // Clone the body and strip script, style, and canvas so JS source comments do not count as visible text.
    const text = await page.evaluate(() => {
      const c = document.body.cloneNode(true);
      // The marquee credits the song title (a proper name kept as-is), so it is excluded.
      c.querySelectorAll('script,style,noscript,canvas,.marq').forEach((n) => n.remove());
      return `${document.title} ${c.textContent}`;
    });
    const hits = text.match(/(?<![\p{L}\p{M}])em(?![\p{L}\p{M}])/giu) ?? [];
    expect(hits).toEqual([]);
  });

  test('og meta tags point to ngay-cua-zit and the cover image matches its declared size', async ({ page }) => {
    await page.goto('/');
    const meta = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('meta[property], meta[name]')].map((m) => [
          m.getAttribute('property') || m.getAttribute('name'),
          m.getAttribute('content'),
        ]),
      ),
    );
    expect(meta['og:url']).toBe(PAGE_URL);
    expect(meta['og:image']).toBe(`${PAGE_URL}og-cover.jpg`);
    expect(meta['og:title']).toBeTruthy();
    expect(meta['og:description']).toBeTruthy();
    expect(meta['og:image:width']).toBe('1200');
    expect(meta['og:image:height']).toBe('630');
    expect(meta['twitter:card']).toBe('summary_large_image');
    const res = await page.request.get(`${BASE}og-cover.jpg`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/jpeg');
    const actual = await page.evaluate(
      (src) =>
        new Promise((resolve) => {
          const im = new Image();
          im.onload = () => resolve([im.naturalWidth, im.naturalHeight]);
          im.onerror = () => resolve(null);
          im.src = src;
        }),
      `${BASE}og-cover.jpg`,
    );
    expect(actual).toEqual([1200, 630]);
  });
});

/* ---------- Narrow viewport ---------- */

test.describe('narrow viewport 320px', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('no horizontal page overflow and no clipped slide content', async ({ page }) => {
    await openSite(page);
    for (const id of SLIDE_ORDER) await gotoSlide(page, id);
    await gotoSlide(page, 's5');
    await page.locator('#no').tap();
    await gotoSlide(page, 's6');
    const report = await page.evaluate(() => {
      const phone = document.getElementById('phone').getBoundingClientRect();
      const docOverflow = document.documentElement.scrollWidth - window.innerWidth;
      const outside = [];
      const textOverflow = [];
      document.querySelectorAll('.slide .col *').forEach((el) => {
        if (!el.getClientRects().length) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const label = `${el.tagName.toLowerCase()}.${el.className?.baseVal ?? el.className}: ${el.textContent.trim().slice(0, 30)}`;
        if (r.left < phone.left - 0.5 || r.right > phone.right + 0.5) outside.push(label);
      });
      // Measure the actual text ranges. Box-based scrollWidth gives false positives from rotated papers and glitch offsets.
      // Album figures other than the current one sit off-screen to the right by design, so they are skipped.
      const walker = document.createTreeWalker(document.querySelector('.reel'), NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const fig = node.parentElement.closest('#photos .ph');
        if (fig && !fig.classList.contains('cur')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < phone.left - 0.5 || r.right > phone.right + 0.5) {
          textOverflow.push(`${node.textContent.trim().slice(0, 40)} [${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(phone.left)}..${Math.round(phone.right)}]`);
        }
      }
      return { docOverflow, outside, textOverflow };
    });
    expect(report.docOverflow, 'document scrollWidth minus viewport width').toBeLessThanOrEqual(0);
    expect(report.outside).toEqual([]);
    expect(report.textOverflow).toEqual([]);
  });
});

/* ---------- Short screen layout ---------- */

test.describe('short screen 375x548', () => {
  test.use({ viewport: { width: 375, height: 548 } });

  test('every slide content block stays between the top tabs and the caption', async ({ page }) => {
    await openSite(page);
    for (const id of SLIDE_ORDER.filter((id) => id !== 'sP')) {
      await gotoSlide(page, id);
      const box = await page.evaluate((id) => {
        const col = document.querySelector(`#${id} .col`);
        const top = document.querySelector('.top').getBoundingClientRect();
        const cap = document.querySelector('.cap').getBoundingClientRect();
        const r = col.getBoundingClientRect();
        return { top: top.bottom, capTop: cap.top, colTop: r.top, colBottom: r.bottom };
      }, id);
      expect(box.colTop, `#${id} content must start below the top tabs`).toBeGreaterThanOrEqual(box.top - 0.5);
      expect(box.colBottom, `#${id} content must end above the caption`).toBeLessThanOrEqual(box.capTop + 0.5);
    }
  });
});

/* ---------- Reduced motion ---------- */

test.describe('prefers-reduced-motion', () => {
  // test.use({ reducedMotion }) did not reach the page in this Playwright setup, so emulateMedia is used.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('every block is visible without motion', async ({ page }) => {
    await openSite(page);
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    // Blocks reset to opacity 0 when their slide leaves view (by design), so each slide is checked while it is in view.
    for (const id of SLIDE_ORDER) {
      await gotoSlide(page, id);
      if (id !== 'sP') {
        await expect
          .poll(() => dimBlocks(page, `#${id} .col > *`, 0.85), { message: `blocks in #${id}` })
          .toEqual([]);
      }
    }
    await gotoSlide(page, 's2');
    await expect.poll(() => dimBlocks(page, '#s2 .flags li', 1), { message: 'flag items' }).toEqual([]);
    await gotoSlide(page, 's4');
    await expect.poll(() => dimBlocks(page, '#s4 .letter p', 1), { message: 'letter paragraphs' }).toEqual([]);
    await gotoSlide(page, 'sP');
    await expect(page.locator('.ph.cur')).toHaveCount(1);
  });

  test('album does not autoplay', async ({ page }) => {
    await openSite(page);
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await gotoSlide(page, 'sP');
    await expect.poll(() => curIndex(page)).toBe(0);
    // Negative check: waiting past one story length is the only way to prove autoplay does not start.
    await page.waitForTimeout(STORY_MS + 1200);
    expect(await curIndex(page)).toBe(0);
  });
});
