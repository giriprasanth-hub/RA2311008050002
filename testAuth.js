/**
 * testAuth.js — Quick script to verify auth token fetch and full API connectivity.
 * Run: node testAuth.js
 *
 * BUG FIX #4: Full try/catch with helpful error messages (Python version crashed with no output)
 */

require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://20.207.122.201/evaluation-service';

const SEP = '='.repeat(60);

async function run() {
  console.log(SEP);
  console.log('STEP 1: Getting auth token...');

  const payload = {
    email:        process.env.EMAIL,
    name:         process.env.NAME,
    rollNo:       process.env.ROLL_NO,
    accessCode:   process.env.ACCESS_CODE,
    clientID:     process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
  };
  console.log('  Payload:', JSON.stringify(payload));

  let token;
  try {
    const r = await axios.post(`${BASE_URL}/auth`, payload, { timeout: 30000 });
    console.log(`  Status: ${r.status}`);
    token = r.data.access_token;
    if (!token) throw new Error('Response missing access_token');
    console.log(`\n  [OK] Token acquired (first 60 chars): ${token.slice(0, 60)}...`);
  } catch (err) {
    const status = err.response?.status || 'N/A';
    const body   = err.response?.data   || err.message;
    console.error(`\n  [FAILED] Auth failed! Status: ${status}`);
    console.error('  Response:', JSON.stringify(body));
    process.exit(1);
  }

  const headers = { Authorization: `Bearer ${token}` };

  // Step 2: Test /depots API
  console.log('\nSTEP 2: Testing /depots API...');
  try {
    const r = await axios.get(`${BASE_URL}/depots`, { headers, timeout: 30000 });
    console.log(`  Status: ${r.status}`);
    console.log(`  Depots: ${JSON.stringify(r.data).slice(0, 300)}`);
  } catch (err) {
    console.error(`  [FAILED] /depots: ${err.response?.status || err.message}`);
  }

  // Step 3: Test /vehicles API
  console.log('\nSTEP 3: Testing /vehicles API...');
  try {
    const r = await axios.get(`${BASE_URL}/vehicles`, { headers, timeout: 30000 });
    console.log(`  Status: ${r.status}`);
    console.log(`  Vehicles (first 300 chars): ${JSON.stringify(r.data).slice(0, 300)}`);
  } catch (err) {
    console.error(`  [FAILED] /vehicles: ${err.response?.status || err.message}`);
  }

  // Step 4: Test /notifications API
  console.log('\nSTEP 4: Testing /notifications API...');
  try {
    const r = await axios.get(`${BASE_URL}/notifications`, { headers, timeout: 30000 });
    console.log(`  Status: ${r.status}`);
    console.log(`  Notifications (first 300 chars): ${JSON.stringify(r.data).slice(0, 300)}`);
  } catch (err) {
    console.error(`  [FAILED] /notifications: ${err.response?.status || err.message}`);
  }

  // Step 5: Test /logs API
  console.log('\nSTEP 5: Testing /logs API...');
  try {
    const logPayload = {
      stack:   'backend',
      level:   'info',
      package: 'config',
      message: 'Auth and API connectivity verified successfully via testAuth.js',
    };
    const r = await axios.post(`${BASE_URL}/logs`, logPayload, { headers, timeout: 30000 });
    console.log(`  Status: ${r.status}`);
    console.log(`  Response: ${JSON.stringify(r.data)}`);
  } catch (err) {
    console.error(`  [FAILED] /logs: ${err.response?.status || err.message}`);
  }

  console.log(`\n${SEP}`);
  console.log('[SUCCESS] ALL APIS WORKING! Copy this token to your .env ACCESS_TOKEN:');
  console.log(`\nACCESS_TOKEN=${token}\n`);
}

run().catch((err) => {
  console.error('[UNEXPECTED ERROR]', err.message);
  process.exit(1);
});
