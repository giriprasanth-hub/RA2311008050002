/**
 * auth.js — Authentication helper for Campus Notification Service.
 * Identical logic to vehicle_scheduling/auth.js — shared via env vars.
 */

require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://20.207.122.201/evaluation-service';
const AUTH_ENDPOINT = `${BASE_URL}/auth`;

/**
 * Authenticates with the Affordmed test server and returns a Bearer token.
 *
 * Reads credentials from environment variables:
 *   EMAIL, NAME, ROLL_NO, ACCESS_CODE, CLIENT_ID, CLIENT_SECRET
 *
 * @returns {Promise<string>} Bearer access token
 * @throws {Error} If required env vars are missing or auth request fails
 */
async function getAuthToken() {
  const required = ['EMAIL', 'NAME', 'ROLL_NO', 'ACCESS_CODE', 'CLIENT_ID', 'CLIENT_SECRET'];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: [${missing.join(', ')}]. ` +
      'Please fill in your .env file.'
    );
  }

  const payload = {
    email:        process.env.EMAIL,
    name:         process.env.NAME,
    rollNo:       process.env.ROLL_NO,
    accessCode:   process.env.ACCESS_CODE,
    clientID:     process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
  };

  try {
    const response = await axios.post(AUTH_ENDPOINT, payload, { timeout: 30000 });
    const { status, data } = response;

    if (![200, 201].includes(status)) {
      throw new Error(`Auth failed (HTTP ${status}): ${JSON.stringify(data)}`);
    }

    const token = data.access_token;
    if (!token) {
      throw new Error(`Auth response missing 'access_token': ${JSON.stringify(data)}`);
    }
    return token;
  } catch (err) {
    if (err.response) {
      throw new Error(`Auth failed (HTTP ${err.response.status}): ${JSON.stringify(err.response.data)}`);
    }
    throw new Error(`Auth request error: ${err.message}`);
  }
}

module.exports = { getAuthToken };
