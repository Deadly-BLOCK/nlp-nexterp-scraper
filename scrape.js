require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STUDENT_CODE = process.argv[2];
if (!STUDENT_CODE) {
  console.error('❌ Usage: node scrape.js STUDENT_CODE');
  process.exit(1);
}

const { USERNAME, PASSWORD, CODE } = process.env;

(async () => {
  let browser;
  let capturedCurl = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    
    // ---------------------------------------------------------
    // REQUEST INTERCEPTION: Capture Request as CURL
    // ---------------------------------------------------------
    await page.setRequestInterception(true);

    page.on('request', request => {
      const url = request.url();
      
      // We only want the first XHR request that matches our pattern
      if (url.includes('get?categoryTypes=') && !capturedCurl) {
        const headers = request.headers();
        let curlCommand = `curl '${url}'`;

        // Add Headers to curl
        for (const [key, value] of Object.entries(headers)) {
          // Escape single quotes in header values
          const escapedValue = value.replace(/'/g, "'\\''");
          curlCommand += ` -H '${key}: ${escapedValue}'`;
        }

        // 1. Replace size=10 with size=10000
        // 2. We use a regex to ensure we catch size= followed by any number
        curlCommand = curlCommand.replace(/size=\d+/, 'size=10000');

        capturedCurl = curlCommand;
        console.log('🎯 Captured and modified XHR request to CURL');
      }
      
      request.continue();
    });

    // LOGIN PHASE
    console.log('🔐 Logging in...');
    await page.goto('https://nlp.nexterp.in/nlp/nlp/login', { waitUntil: 'networkidle2' });

    await page.type('input[name="username"]', USERNAME);
    await page.type('input[name="password"]', PASSWORD);
    await page.type('input[name="code"]', CODE);

    await Promise.all([
      page.click('button[name="btnSignIn"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

    // NAVIGATE TO FEED
    const feedUrl = 'https://nlp.nexterp.in/nlp/nlp/v1/workspace/studentlms?urlgroup=Student%20Workspace#/dashboard/discussion';
    await page.goto(feedUrl, { waitUntil: 'networkidle2' });

    // Wait for the first card to ensure the XHR actually triggered
    await page.waitForSelector('div.discussion-card.ng-scope', { timeout: 30000 });

    if (capturedCurl) {
      console.log('🚀 Executing modified CURL command...');
      
      // Execute the curl command and capture output
      const responseBuffer = execSync(capturedCurl, { maxBuffer: 1024 * 1024 * 50 }); // 50MB buffer
      const jsonResponse = JSON.parse(responseBuffer.toString());

      // SAVE DATA
      const outFile = path.resolve(`posts/posts-${STUDENT_CODE}.json`);
      const finalData = {
        capturedData: [jsonResponse], // Keep array format for compatibility
        _updatedAt: new Date().toISOString(),
        _source: "Modified CURL (size=10000)"
      };

      fs.writeFileSync(outFile, JSON.stringify(finalData, null, 2));
      console.log(`✅ Success! Saved data to ${outFile}`);
    } else {
      throw new Error('Could not capture the target XHR request.');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
