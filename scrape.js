require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STUDENT_CODE = process.argv[2];
const { USERNAME, PASSWORD, CODE } = process.env;

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const page = await browser.newPage();
    await page.setRequestInterception(true);

    // Listen for the specific request and execute CURL immediately
    const curlPromise = new Promise((resolve) => {
      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('get?categoryTypes=')) {
          let curl = `curl '${url.replace(/size=\d+/, 'size=10000')}'`;
          const headers = request.headers();
          for (const [key, val] of Object.entries(headers)) {
            curl += ` -H '${key}: ${val.replace(/'/g, "'\\''")}'`;
          }
          resolve(curl);
        }
        request.continue();
      });
    });

    console.log('Logging in...');
    await page.goto('https://nlp.nexterp.in/nlp/nlp/login', { waitUntil: 'networkidle2' });
    await page.type('input[name="username"]', USERNAME);
    await page.type('input[name="password"]', PASSWORD);
    await page.type('input[name="code"]', CODE);
    
    await Promise.all([
      page.click('button[name="btnSignIn"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    // 1) Login failure check
    if (page.url().includes('login')) throw new Error("LOGIN_FAILED: Incorrect Credentials");
    console.log('Logged in!');

    // Trigger the feed page
    const feedUrl = 'https://nlp.nexterp.in/nlp/nlp/v1/workspace/studentlms?urlgroup=Student%20Workspace#/dashboard/discussion';
    await page.goto(feedUrl, { waitUntil: 'domcontentloaded' });

    let command;
   while (!command) {
      console.log('Fetching curl...');
      try {
        command = await Promise.race([
          curlPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 20000))
        ]);
        console.log('Fetched curl!');
      } catch (err) {
        if (err.message === 'TIMEOUT') {
          console.log('::warning:: Timeout (20s) waiting for XHR. Reloading page...');
          await page.reload({ waitUntil: 'domcontentloaded' });
        } else {
          throw err;
        }
      }
    }
    console.log('🚀 Executing CURL...');
    
    const response = execSync(command, { maxBuffer: 1024 * 1024 * 50 });
    
    const outFile = path.resolve(`posts/posts-${STUDENT_CODE}.json`);
    fs.writeFileSync(outFile, JSON.stringify({
      capturedData: [JSON.parse(response.toString())],
      _updatedAt: new Date().toISOString()
    }, null, 2));

    console.log(`✅ Done!`);
    process.exit(0);

  } catch (err) {
    console.error(`::error title=Script Failed::${err.message}`);
    const outFile = path.resolve(`posts/posts-${STUDENT_CODE}.json`);
    
    let existingData = {};
    if (fs.existsSync(outFile)) {
      try { existingData = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) {}
    }

    // Append error to history
    existingData.errors = [...(existingData.errors || []), { msg: err.message, time: new Date().toISOString() }];
    fs.writeFileSync(outFile, JSON.stringify(existingData, null, 2));
    
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
