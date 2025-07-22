// scrape.js
require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');

// Read credentials from environment variables
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;
const CODE     = process.env.CODE;
if (!USERNAME || !PASSWORD || !CODE) {
    console.error('❌ Missing credentials in environment. Please set USERNAME, PASSWORD, and CODE in .env');
    process.exit(1);
}

// Auto-scroll helper
async function autoScrollByCards(page, maxTime = 30000) {
    await page.evaluate(async (maxTime) => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const start = Date.now();
        let prev = 0, stable = 0;
        while (Date.now() - start < maxTime) {
            const cards = Array.from(document.querySelectorAll('div.discussion-card.ng-scope'));
            if (cards.length) cards[cards.length - 1].scrollIntoView({ block: 'end' });
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

(async () => {
    console.log('▶️ Scraper started');
    let browser;
    let posts = [];
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();

        // 1) LOGIN
        await page.goto('https://nlp.nexterp.in/nlp/nlp/login', { waitUntil: 'networkidle2' });
        await page.type('input[name="username"]', USERNAME);
        await page.type('input[name="password"]', PASSWORD);
        await page.type('input[name="code"]',     CODE);
        await Promise.all([
            page.click('button[name="btnSignIn"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
        if (!page.url().includes('student-dashboard')) {
            throw new Error('Login failed');
        }
        console.log('✅ Logged in');

        // 2) Navigate to feed
        const feedUrl = 'https://nlp.nexterp.in/nlp/nlp/v1/workspace/studentlms?urlgroup=Student%20Workspace#/dashboard/discussion';
        await page.goto(feedUrl, { waitUntil: 'networkidle2' });
        await page.waitForSelector('div.discussion-card.ng-scope', { timeout: 15000 });

        // 3) Scroll to load all posts
        await autoScrollByCards(page, 30000);

        // 4) Extract posts
        const cards = await page.$$('div.discussion-card.ng-scope');
        posts = [];
        for (const card of cards) {
            // Skip "Resource"
            const linkEl = await card.$('md-card.postLink p.postTitle');
            if (linkEl) {
                const txt = await page.evaluate(el => el.innerText, linkEl);
                if (txt.trim().toLowerCase() === 'resource') continue;
            }
            let teacher = '', datetime = '', content = '';
            // Teacher & datetime
            const hdr = await card.$('div.descTitleContent.layout-align-center-start');
            if (hdr) {
                teacher = await hdr.$eval('h3', el => el.innerText.trim()).catch(() => '');
                datetime = await hdr.$eval('span.direction-normal', el => el.innerText.trim()).catch(() => '');
            }
            if (!teacher || !datetime) {
                const items = await card.$$eval('ul.feed-details li', els => els.map(e => e.innerText));
                teacher = items[0]?.replace(/^By\s*/i, '').trim() || teacher;
                datetime = items[1]?.trim() || datetime;
            }
            // Content
            const foot = await card.$('div.disc-footer h3');
            if (foot) {
                content = await card.$eval('div.disc-footer h3', el => el.innerHTML.trim());
            } else {
                const desc = await card.$('div.descTitleContent p');
                if (desc) content = (await desc.evaluate(el => el.innerText)).trim();
            }
            // Attachments
            const attachments = [];
            const atEls = await card.$$('div.post-details-card.cursor');
            for (const el of atEls) {
                const vid = await el.$('video source');
                if (vid) {
                    attachments.push(await el.$eval('source', s => s.src));
                } else {
                    await el.click();
                    try {
                        await page.waitForSelector('div.galleryorginal', { timeout: 8000 });
                        const src = await page.evaluate(() => {
                            const g = document.querySelector('div.galleryorginal .gallery-img');
                            return g.querySelector('embed, img, video source, audio')?.src || null;
                        });
                        if (src) attachments.push(src);
                    } catch {}
                    await page.keyboard.press('Escape');
                    await page.waitForSelector('div.galleryorginal', { hidden: true, timeout: 5000 }).catch(() => {});
                }
            }
            posts.push({ teacher, datetime, content, attachments });
        }

        console.log('===== POSTS + ATTACHMENTS =====');
        console.log(JSON.stringify(posts, null, 2));

        // Write JSON file after posts is defined
        fs.writeFileSync('posts.json', JSON.stringify({ posts }, null, 2));
        console.log('✅ posts.json written');

        console.log('✅ Scrape complete');
    } catch (err) {
        console.error('❌ Unhandled error:', err);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
})();
