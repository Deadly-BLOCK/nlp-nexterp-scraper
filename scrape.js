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

console.log(`▶️ Capturing XHR responses for student_code=${STUDENT_CODE}`);

// --------------------
// SCROLL HELPER
// --------------------
// Updated to just scroll and wait for XHR to trigger, no longer looking for cards
async function autoScroll(page, maxTime = 45000) {
  console.log('📜 Scrolling to trigger network requests...');
  await page.evaluate(async (maxTime) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const start = Date.now();
    let lastHeight = document.body.scrollHeight;

    while (Date.now() - start < maxTime) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(2000); // Wait for lazy loading to trigger XHR
      
      let newHeight = document.body.scrollHeight;
      if (newHeight === lastHeight) break; // Stop if no more content loads
      lastHeight = newHeight;
    }
  }, maxTime);
}

// --------------------
// MAIN
// --------------------
(async () => {
  let browser;
  const capturedResponses = []; // Array to store filtered XHR results

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    // ---------------------------------------------------------
    // NEW: NETWORK INTERCEPTION LOGIC
    // ---------------------------------------------------------
    page.on('response', async (response) => {
      const url = response.url();
      
      // Filter by the specific endpoint requested
      if (url.includes('get?categoryTypes=')) {
        try {
          const json = await response.json();
          capturedResponses.push(json); // Pushed in chronological order
          console.log(`📥 Captured response: ...${url.substring(url.length - 40)}`);
        } catch (e) {
          // If response isn't valid JSON or already consumed
        }
      }
    });

    // --------------------
    // LOGIN (Intact)
    // --------------------
    console.log('🔐 Logging in...');
    await page.goto('https://nlp.nexterp.in/nlp/nlp/login', {
      waitUntil: 'networkidle2',
    });

    await page.type('input[name="username"]', USERNAME);
    await page.type('input[name="password"]|', PASSWORD); // Fixed a typo from original code if needed
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
    // FEED NAVIGATION
    // --------------------
    const feedUrl = 'https://nlp.nexterp.in/nlp/nlp/v1/workspace/studentlms?urlgroup=Student%20Workspace#/dashboard/discussion';
    
    await page.goto(feedUrl, { waitUntil: 'networkidle2' });
    console.log('➡️ Navigation to feed complete.');

    // --------------------
    // SCROLLING (Simplified)
    // --------------------
    // We only scroll now. Clicking, opening, and closing are removed.
    await autoScroll(page, 60000); 

    // ---------------------------------------------------------
    // WRITE FILE (Combined JSON)
    // ---------------------------------------------------------
    const outFile = path.resolve(`captured-data-${STUDENT_CODE}.json`);
    
    // Compiling captured responses into one single object/file
    const finalOutput = {
      student_code: STUDENT_CODE,
      timestamp: new Date().toISOString(),
      total_requests_captured: capturedResponses.length,
      responses: capturedResponses // Ordered from first captured to last
    };

    fs.writeFileSync(
      outFile,
      JSON.stringify(finalOutput, null, 2)
    );

    console.log(`✅ Success! Combined ${capturedResponses.length} responses into ${outFile}`);

  } catch (err) {
    console.error('❌ Scrape failed:', err.message || err);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => {});
    process.exit(0);
  }
})();
