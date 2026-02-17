require('dotenv').config();
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STUDENT_CODE = process.argv[2];
const { USERNAME, PASSWORD, CODE } = process.env;

// Initialize Cookie Jar to handle sessions automatically
const jar = new CookieJar();
const client = wrapper(axios.create({ 
    jar, 
    withCredentials: true,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
    }
}));

async function run() {
    try {
        console.log(`🚀 Starting browserless scrape for: ${STUDENT_CODE}`);

        // 1. Hash the password to MD5 (matching your curl data)
        const hashedPassword = crypto.createHash('md5').update(PASSWORD).digest('hex');

        // 2. Perform Login (mimicking your --data-raw)
        const loginParams = new URLSearchParams({
            platform: 'web',
            lang: 'en',
            username: USERNAME,
            password: hashedPassword,
            code: CODE,
            ucid: '63e019b2-bfe3-4abb-a335-613088fcd3cb' // From your curl
        });

        console.log('🔐 Logging in...');
        await client.post('https://nlp.nexterp.in/nlp/nlp/login', loginParams.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // 3. Fetch the data with size=10000
        // Use the exact base URL you captured from the XHR previously
        const targetUrl = `https://nlp.nexterp.in/nlp/nlp/v1/get?categoryTypes=...&size=10000`; 
        
        console.log('📥 Fetching massive JSON payload...');
        const response = await client.get(targetUrl);

        // 4. Save the output
        const outFile = path.resolve(`posts/posts-${STUDENT_CODE}.json`);
        const finalData = {
            capturedData: [response.data],
            _updatedAt: new Date().toISOString(),
            _method: "Browserless/Axios"
        };

        fs.writeFileSync(outFile, JSON.stringify(finalData, null, 2));
        console.log(`✅ Success! Data saved to ${outFile}`);

    } catch (err) {
        console.error('❌ Error:', err.response?.status || err.message);
        process.exit(1);
    }
}

run();
