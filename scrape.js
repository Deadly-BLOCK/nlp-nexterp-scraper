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
// SCROLL HELPER (Modified for internal container)
// --------------------
async function autoScrollByCards(page, maxTime = 30000) {
  await page.evaluate(async (maxTime) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const start = Date.now();
    
    // Target the specific scrollable container for the cards
    const container = document.querySelector('md-content') || 
                      document.querySelector('.discussion-card')?.parentElement || 
                      window;

    let prevHeight = (container === window) ? document.body.scrollHeight : container.scrollHeight;
    let stable = 0;

    while (Date.now() - start < maxTime) {
      if (container === window) {
        window.scrollTo(0, document.body.scrollHeight);
      } else {
        container.scrollTop = container.scrollHeight;
      }
      
      await sleep(2000); // Wait for XHR to trigger and content to load

      let currHeight = (container === window) ? document.body.scrollHeight : container.scrollHeight;
      if (currHeight === prevHeight) {
        if (++stable >= 3) break;
      } else {
        prevHeight = currHeight;
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
    // LOGIN (Original Logic Restored)
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
    // FEED (Original Logic Restored)
    // --------------------
    const feedUrl = 'https://nlp.nexterp.in/nlp/nlp/v1/workspace/studentlms?urlgroup=Student%20Workspace#/dashboard/discussion';

    await page.goto(feedUrl, { waitUntil: 'domcontentloaded' });
    console.log('➡️ page.goto completed:', page.url());

    // Wait until Angular / server actually renders discussion cards
    await page.waitForSelector('div.discussion-card.ng-scope', { timeout: 20000 });
    console.log('➡️ Discussion feed rendered:', page.url());

    // Scroll to force-load all posts (Triggers XHRs)
    await autoScrollByCards(page, 45000);
    console.log('➡️ Finished auto-scrolling discussion feed');

    // --------------------
    // WRITE FILE (Combined JSON)
    // --------------------
    console.log(`✅ Collected ${capturedResponses.length} JSON responses.`);
    
    const outFile = path.resolve(`captured-responses-${STUDENT_CODE}.json`);
    
    // Combine all captured objects into one array in the final file
    const outputData = {
      student_code: STUDENT_CODE,
      timestamp: new Date().toISOString(),
      responses: capturedResponses
    };

    fs.writeFileSync(
      outFile,
      JSON.stringify(outputData, null, 2)
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
