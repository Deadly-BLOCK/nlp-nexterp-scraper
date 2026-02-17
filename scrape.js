require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STUDENT_CODE = process.argv[2];
const { USERNAME, PASSWORD, CODE } = process.env;

async function run() {
    try {
        console.log(`🚀 Browserless Scrape: ${STUDENT_CODE}`);
        const hashedPassword = crypto.createHash('md5').update(PASSWORD).digest('hex');

        // 1. LOGIN
        const loginParams = new URLSearchParams({
            platform: 'web',
            lang: 'en',
            username: USERNAME,
            password: hashedPassword,
            code: CODE
        });

        console.log('🔐 Authenticating...');
        const loginRes = await axios.post('https://nlp.nexterp.in/nlp/nlp/login', loginParams.toString(), {
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        // 2. EXTRACT TOKEN
        // Most NextERP systems return the token in a cookie or a 'token' field in JSON
        // We'll check the 'set-cookie' header for authToken
        const cookies = loginRes.headers['set-cookie'] || [];
        const authCookie = cookies.find(c => c.includes('authToken='));
        const token = authCookie 
            ? authCookie.split('authToken=')[1].split(';')[0] 
            : null;

        if (!token) {
            console.error('❌ Could not find authToken in login response.');
            // Debug: console.log(loginRes.headers);
            process.exit(1);
        }

        // 3. FETCH DATA (Using your exact URL with size=10000)
        console.log('📥 Fetching feeds...');
        
        // We use your exact copied URL but swap size=10 for size=10000
        const feedUrl = `https://nlp.nexterp.in/NextPostV2/nextpost/data/discussionBoard/posts/get?categoryTypes=Activity&categoryTypes=Announcement&categoryTypes=Assessment&categoryTypes=Homework&categoryTypes=LiveLecture&categoryTypes=Resource&cpids=907668&cpids=914359&cpids=914367&cpids=914380&cpids=914385&cpids=914266&cpids=914204&cpids=914198&cpids=914075&cpids=914386&defaultLocale=en&lasid=20893&lbid=11522&lstduid=&luid=9883276&lupid=18062342&page=1&ptype=STUDENT&sectionLevel=true&size=10000&supportDynamicFeedCategory=true`;

        const dataRes = await axios.get(feedUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        // 4. SAVE
        const outFile = path.resolve(`posts/posts-${STUDENT_CODE}.json`);
        if (!fs.existsSync('posts')) fs.mkdirSync('posts');

        fs.writeFileSync(outFile, JSON.stringify({
            capturedData: [dataRes.data],
            _updatedAt: new Date().toISOString()
        }, null, 2));

        console.log(`✅ Success! Fetched ${dataRes.data?.length || 'all'} items.`);

    } catch (err) {
        console.error(`❌ Error: ${err.response?.status || err.message}`);
        process.exit(1);
    }
}

run();
