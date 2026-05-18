const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

try {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["'](.*)["']$/, '$1');
  }
} catch { /* no .env file — fine if vars come from CI env */ }

const STUDENT_CODE = process.argv[2];
const { USERNAME, PASSWORD, CODE } = process.env;
const HASH_MODE = (process.env.HASH_MODE || 'md5').toLowerCase();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE = 'https://nlp.nexterp.in';
const LOGIN_URL = `${BASE}/nlp/nlp/login`;
const FEED_BASE = `${BASE}/NextPostV2/nextpost/data/discussionBoard/posts/get`;
const WORKSPACE_REFERER = `${BASE}/nlp/nlp/v1/workspace/studentlms?urlgroup=Student%20Workspace`;
const CATEGORY_TYPES = ['Activity', 'Announcement', 'Assessment', 'Homework', 'LiveLecture', 'Resource'];

function die(msg) { console.error(`❌ ${msg}`); process.exit(1); }
if (!STUDENT_CODE) die('Usage: node scrape.js <STUDENT_CODE>');
if (!/^[a-zA-Z0-9_-]{1,32}$/.test(STUDENT_CODE))
  die('STUDENT_CODE must match [a-zA-Z0-9_-]{1,32}');
if (!USERNAME || !PASSWORD || !CODE)
  die('Missing USERNAME / PASSWORD / CODE in .env');

const POSTS_DIR = path.resolve('posts');
const OUT_FILE = path.join(POSTS_DIR, `posts-${STUDENT_CODE}.json`);
const ERR_FILE = path.join(POSTS_DIR, `posts-${STUDENT_CODE}.error.json`);
fs.mkdirSync(POSTS_DIR, { recursive: true });

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

class Jar {
  constructor() { this.cookies = new Map(); }
  ingest(headers) {
    for (const h of headers.getSetCookie?.() || []) {
      const [pair] = h.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  set(k, v) { this.cookies.set(k, v); }
  get(k) { return this.cookies.get(k); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
}

function decodeJwt(token) {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function login() {
  const jar = new Jar();

  log('GET login page…');
  const gr = await fetch(LOGIN_URL, { headers: { 'user-agent': UA }, redirect: 'manual' });
  jar.ingest(gr.headers);
  const html = await gr.text();
  const m = html.match(/name=["']?_csrf["']?\s+value=["']?([a-f0-9-]+)["']?/i);
  if (!m) throw new Error('CSRF_NOT_FOUND');

  const passwordValue = HASH_MODE === 'md5'
    ? crypto.createHash('md5').update(PASSWORD).digest('hex')
    : PASSWORD;
  log(`POST login (hash mode: ${HASH_MODE})…`);

  const body = new URLSearchParams({
    _csrf: m[1],
    username: USERNAME,
    password: passwordValue,
    code: CODE,
    integration: '', platform: 'web', lang: 'en',
    latitude: '', longitude: '', city: '', region: '', country: '', country_code: '',
  });

  const lr = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      'content-type': 'application/x-www-form-urlencoded',
      cookie: jar.header(),
      referer: LOGIN_URL,
      origin: BASE,
    },
    body: body.toString(),
    redirect: 'manual',
  });
  jar.ingest(lr.headers);
  const location = lr.headers.get('location') || '';
  if (lr.status >= 400) throw new Error(`LOGIN_HTTP_${lr.status}`);
  if (lr.status === 200 || location.includes('/login')) throw new Error('LOGIN_FAILED');

  let next = location;
  for (let hop = 0; hop < 5 && next && !jar.get('authToken'); hop++) {
    const abs = new URL(next, BASE).toString();
    const r = await fetch(abs, {
      headers: { 'user-agent': UA, cookie: jar.header() },
      redirect: 'manual',
    });
    jar.ingest(r.headers);
    next = r.headers.get('location');
  }

  const token = jar.get('authToken');
  if (!token) throw new Error('NO_AUTH_TOKEN_AFTER_LOGIN');
  return { token, jar };
}

function buildFeedUrl(claims) {
  const p = new URLSearchParams();
  for (const c of CATEGORY_TYPES) p.append('categoryTypes', c);
  p.set('defaultLocale', 'en');
  p.set('lasid', claims.asid);
  p.set('lbid', claims.lcbid || claims.tid);
  p.set('lstduid', '');
  p.set('luid', claims.rid);
  p.set('lupid', claims.uid);
  p.set('page', '1');
  p.set('ptype', claims.type || 'STUDENT');
  p.set('sectionLevel', 'true');
  p.set('size', '10000');
  p.set('supportDynamicFeedCategory', 'true');
  return `${FEED_BASE}?${p.toString()}`;
}

(async () => {
  try {
    const { token, jar } = await login();
    const claims = decodeJwt(token);
    log(`Logged in`);

    log('GET feed…');
    const fr = await fetch(buildFeedUrl(claims), {
      headers: {
        'user-agent': UA,
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        cookie: jar.header(),
        referer: WORKSPACE_REFERER,
      },
    });
    if (!fr.ok) throw new Error(`FEED_HTTP_${fr.status}`);
    const data = await fr.json();

    fs.writeFileSync(
      OUT_FILE,
      JSON.stringify({ capturedData: [data], _updatedAt: new Date().toISOString() }, null, 2)
    );
    if (fs.existsSync(ERR_FILE)) fs.unlinkSync(ERR_FILE);
    log(`✅ Saved ${OUT_FILE}`);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    fs.writeFileSync(
      ERR_FILE,
      JSON.stringify({ error: err.message, _updatedAt: new Date().toISOString() }, null, 2)
    );
    process.exit(1);
  }
})();
