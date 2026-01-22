// scrape.js
require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// --------------------
// CLI ARG
// --------------------
const STUDENT_CODE = process.argv[2];
if (!STUDENT_CODE) {
  console.error('❌ Usage: node scrape.js STUDENT_CODE');
  process.exit(1);
}

// --------------------
// ENV CREDS
// --------------------
const { USERNAME, PASSWORD, CODE } = process.env;
if (!USERNAME || !PASSWORD || !CODE) {
  console.error('❌ Missing USERNAME / PASSWORD / CODE in .env');
  process.exit(1);
}

console.log(`▶️ Scraping for student_code=${STUDENT_CODE}`);

// --------------------
// SCROLL HELPER (from long-running code)
// --------------------
async function autoScrollByCards(page, maxTime = 30000) {
  await page.evaluate(async (maxTime) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let prev = 0, stable = 0;
    const start = Date.now();

    while (Date.now() - start < maxTime) {
      const cards = Array.from(document.querySelectorAll('div.discussion-card.ng-scope'));
      if (cards.length) {
        cards[cards.length - 1].scrollIntoView({ block: 'end' });
      }
      await sleep(500);

      if (cards.length === prev) {
        if (++stable >= 3) break;
      } else {
        prev = cards.length;
        stable = 0;
      }
    }
  }, maxTime);
}

// --------------------
// MAIN
// --------------------
(async () => {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    // --------------------
    // LOGIN
    // --------------------
    console.log('🔐 Logging in...');
    await page.goto('https://nlp.nexterp.in/nlp/nlp/login', {
      waitUntil: 'networkidle2',
    });

    await page.type('input[name="username"]', USERNAME);
    await page.type('input[name="password"]', PASSWORD);
    await page.type('input[name="code"]', CODE);

    await Promise.all([
      page.click('button[name="btnSignIn"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

    if (!page.url().includes('student-dashboard')) {
      throw new Error('Login failed');
    }

    console.log('✅ Logged in');

    // --------------------
    // FEED
    // --------------------
    const feedUrl =
      'https://nlp.nexterp.in/nlp/nlp/v1/workspace/studentlms?urlgroup=Student%20Workspace#/dashboard/discussion';

    await page.goto(feedUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('div.discussion-card.ng-scope', { timeout: 20000 });

    await autoScrollByCards(page, 30000);

    // --------------------
    // EXTRACT (FROM LONG-RUNNING VERSION)
    // --------------------
    const cards = await page.$$('div.discussion-card.ng-scope');
    const posts = [];

    for (const card of cards) {
      // skip "resource"
      const linkEl = await card.$('md-card.postLink p.postTitle');
      if (linkEl) {
        const txt = (
          await card.$eval('md-card.postLink p.postTitle', el => el.textContent || '')
        )
          .trim()
          .toLowerCase();
        if (txt === 'resource') continue;
      }

      let teacher = '';
      let datetime = '';

      const hdr = await card.$('div.descTitleContent.layout-align-center-start');
      if (hdr) {
        try {
          teacher = await hdr.$eval('h3', el => el.textContent.trim());
        } catch {}
        try {
          datetime = await hdr.$eval('span.direction-normal', el => el.textContent.trim());
        } catch {}
      }

      if (!teacher || !datetime) {
        try {
          const items = await card.$$eval('ul.feed-details li', els =>
            els.map(e => e.textContent.trim())
          );
          teacher = items[0]?.replace(/^By\s*/i, '').trim() || teacher;
          datetime = items[1] || datetime;
        } catch {}
      }

      let content = '';
      const foot = await card.$('div.disc-footer h3');
      if (foot) {
        content = await card.$eval('div.disc-footer h3', el => el.innerHTML.trim());
      } else {
        const desc = await card.$('div.descTitleContent p');
        content = desc
          ? (await desc.evaluate(el => el.textContent)).trim()
          : '';
      }

      const attachments = [];
      const atEls = await card.$$('div.post-details-card.cursor');

      for (const el of atEls) {
        const vid = await el.$('video source');
        if (vid) {
          attachments.push(await el.$eval('source', s => s.src));
        } else {
          try {
            await el.click();
            await page.waitForSelector('div.galleryorginal', { timeout: 6000 });
            const src = await page.evaluate(() => {
              const g = document.querySelector('div.galleryorginal .gallery-img');
              const e = g?.querySelector('embed, img, video source, audio');
              return e?.src || null;
            });
            if (src) attachments.push(src);
          } catch {}
          await page.keyboard.press('Escape').catch(() => {});
          await page
            .waitForSelector('div.galleryorginal', { hidden: true, timeout: 3000 })
            .catch(() => {});
        }
      }

      posts.push({ teacher, datetime, content, attachments });
    }

    console.log(`✅ Extracted ${posts.length} posts`);

    // --------------------
    // WRITE FILE
    // --------------------
    const outFile = path.resolve(`posts-${STUDENT_CODE}.json`);
    fs.writeFileSync(
      outFile,
      JSON.stringify({ posts, _updatedAt: new Date().toISOString() }, null, 2)
    );

    console.log(`✅ Written ${outFile}`);
    process.exit(0);

  } catch (err) {
    console.error('❌ Scrape failed:', err.message || err);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();

