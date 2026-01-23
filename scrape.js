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
// SCROLL HELPER (Modified to trigger XHRs via internal container)
// --------------------
async function autoScrollByCards(page, maxTime = 30000) {
  await page.evaluate(async (maxTime) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const start = Date.now();
    let prevCount = 0, stable = 0;

    // Find the internal scrollable container
    const container = document.querySelector('md-content') || 
                      document.querySelector('.discussion-card')?.parentElement || 
                      window;

    while (Date.now() - start < maxTime) {
      const cards = document.querySelectorAll('div.discussion-card.ng-scope');
      
      if (cards.length) {
        cards[cards.length - 1].scrollIntoView({ block: 'end' });
      } else if (container !== window) {
        container.scrollTop = container.scrollHeight;
      }

      await sleep(1500); // Wait for XHR "get?categoryTypes=" to trigger

      if (cards.length === prevCount) {
        if (++stable >= 3) break;
      } else {
        prevCount = cards.length;
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
  const capturedResponses = [];

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    // ---------------------------------------------------------
    // XHR INTERCEPTION (Enabled before navigation)
    // ---------------------------------------------------------
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('get?categoryTypes=')) {
        try {
          const json = await response.json();
          capturedResponses.push(json);
          console.log(`📥 Captured response: ...${url.split('?')[1]?.substring(0, 40)}`);
        } catch (e) {
          // Response body might be empty or not JSON
        }
      }
    });

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
    const feedUrl = 'https://nlp.nexterp.in/nlp/nlp/v1/workspace/studentlms?urlgroup=Student%20Workspace#/dashboard/discussion';

    await page.goto(feedUrl, { waitUntil: 'domcontentloaded' });
    console.log('➡️ page.goto completed:', page.url());

    // Wait until Angular / server actually renders discussion cards
    await page.waitForSelector('div.discussion-card.ng-scope', { timeout: 20000 });
    console.log('➡️ Discussion feed rendered:', page.url());

    // Scroll to force-load all posts (Now just scrolls, no clicking)
    await autoScrollByCards(page, 45000);
    console.log('➡️ Finished auto-scrolling discussion feed');

    // --------------------
    // WRITE FILE (Combined JSON using original path format)
    // --------------------
    const outFile = path.resolve(`posts-${STUDENT_CODE}.json`);
    
    // Combining the captured responses into one single JSON file
    // First response copied is first in array, last response is last.
    const finalData = {
      capturedData: capturedResponses,
      _updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(
      outFile,
      JSON.stringify(finalData, null, 2)
    );

    console.log(`✅ Written ${outFile} with ${capturedResponses.length} captured responses.`);
    process.exit(0);

  } catch (err) {
    console.error('❌ Scrape failed:', err.message || err);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();
