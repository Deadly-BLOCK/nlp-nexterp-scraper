require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STUDENT_CODE = process.argv[2];
const { USERNAME, PASSWORD, CODE } = process.env;
const MAX_ATTEMPTS = 10;
const CURL_TIMEOUT_MS = 30000;
const MAX_CURL_RELOADS = 3;

const OUT_FILE = path.resolve(`posts/posts-${STUDENT_CODE}.json`);

function ensureOutDir() {
  const dir = path.dirname(OUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(payload) {
  ensureOutDir();
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
}

async function runAttempt() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const page = await browser.newPage();
    await page.setRequestInterception(true);

    let curlResolver;
    const curlPromise = new Promise((resolve) => { curlResolver = resolve; });

    page.on('request', (request) => {
      try {
        const url = request.url();
        if (url.includes('get?categoryTypes=')) {
          let curl = `curl '${url.replace(/size=\d+/, 'size=10000')}'`;
          const headers = request.headers();
          for (const [key, val] of Object.entries(headers)) {
            curl += ` -H '${key}: ${val.replace(/'/g, "'\\''")}'`;
          }
          curlResolver(curl);
        }
      } catch (_) {}
      request.continue().catch(() => {});
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

    if (page.url().includes('login')) {
      return { status: 'LOGIN_FAILED' };
    }

    console.log('Logged in!');

    const feedUrl = 'https://nlp.nexterp.in/nlp/nlp/v1/workspace/studentlms?urlgroup=Student%20Workspace#/dashboard/discussion';
    await page.goto(feedUrl, { waitUntil: 'domcontentloaded' });

    let command;
    let reloads = 0;
    while (!command) {
      console.log('Fetching curl...');
      try {
        command = await Promise.race([
          curlPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), CURL_TIMEOUT_MS))
        ]);
        console.log('Fetched curl!');
      } catch (err) {
        if (err.message !== 'TIMEOUT') throw err;
        reloads++;
        if (reloads > MAX_CURL_RELOADS) {
          throw new Error(`No XHR captured after ${MAX_CURL_RELOADS} reloads`);
        }
        console.log(`Timeout waiting for XHR. Reload ${reloads}/${MAX_CURL_RELOADS}...`);
        await page.reload({ waitUntil: 'domcontentloaded' });
      }
    }

    console.log('🚀 Executing CURL...');
    const response = execSync(command, { maxBuffer: 1024 * 1024 * 50 });
    const parsed = JSON.parse(response.toString());

    return { status: 'SUCCESS', data: parsed };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}

(async () => {
  if (!STUDENT_CODE) {
    console.error('❌ Missing STUDENT_CODE argument.');
    process.exit(1);
  }
  if (!USERNAME || !PASSWORD || !CODE) {
    console.error('❌ Missing USERNAME / PASSWORD / CODE in environment.');
    process.exit(1);
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`\n=== Attempt ${attempt}/${MAX_ATTEMPTS} ===`);
    try {
      const result = await runAttempt();

      if (result.status === 'LOGIN_FAILED') {
        writeJson({
          error: 'LOGIN_FAILED',
          message: 'Incorrect credentials',
          _updatedAt: new Date().toISOString()
        });
        console.log('🔒 Login failed — wrote credentials-error file. Exiting.');
        process.exit(0);
      }

      if (result.status === 'SUCCESS') {
        writeJson({
          capturedData: [result.data],
          _updatedAt: new Date().toISOString()
        });
        console.log('✅ Done!');
        process.exit(0);
      }

      throw new Error(`Unexpected attempt status: ${result.status}`);
    } catch (err) {
      lastError = err;
      console.error(`❌ Attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) {
        console.log('Retrying...');
      }
    }
  }

  writeJson({
    error: 'MAX_ATTEMPTS_EXCEEDED',
    message: lastError ? lastError.message : 'Unknown failure',
    attempts: MAX_ATTEMPTS,
    _updatedAt: new Date().toISOString()
  });

  console.error(`❌ Failed after ${MAX_ATTEMPTS} attempts.`);
  process.exit(1);
})();
