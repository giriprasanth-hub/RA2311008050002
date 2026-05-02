/**
 * tokenManager.js — Shared auto-refreshing Bearer token manager.
 *
 * Caches the access token and refreshes it automatically when:
 *   - It's missing
 *   - It's older than TOKEN_TTL_MS (14 minutes)
 *   - force_refresh=true is passed (called on 401 response)
 *
 * Usage:
 *   const { getToken, getHeaders } = require('./tokenManager');
 *   const headers = await getHeaders();            // normal
 *   const headers = await getHeaders(true);        // force refresh on 401
 */

require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://20.207.122.201/evaluation-service';
const TOKEN_TTL_MS = 14 * 60 * 1000; // 14 minutes (token expires in ~15 min)

// Module-level cache
let _token = '';
let _tokenFetchedAt = 0;

/**
 * Calls the Affordmed auth API and returns a fresh Bearer token.
 * @returns {Promise<string>}
 */
async function _fetchFreshToken() {
  const payload = {
    email:        process.env.EMAIL,
    name:         process.env.NAME,
    rollNo:       process.env.ROLL_NO,
    accessCode:   process.env.ACCESS_CODE,
    clientID:     process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
  };

  const response = await axios.post(`${BASE_URL}/auth`, payload, { timeout: 30000 });
  const { status, data } = response;

  if (![200, 201].includes(status)) {
    throw new Error(`Auth refresh failed (HTTP ${status}): ${JSON.stringify(data)}`);
  }

  const token = data.access_token;
  if (!token) {
    throw new Error(`Auth response missing access_token: ${JSON.stringify(data)}`);
  }
  return token;
}

/**
 * Returns a valid Bearer token, refreshing automatically if expired.
 * @param {boolean} forceRefresh - If true, bypasses cache and fetches fresh token.
 * @returns {Promise<string>}
 */
async function getToken(forceRefresh = false) {
  const age = Date.now() - _tokenFetchedAt;

  if (forceRefresh || !_token || age >= TOKEN_TTL_MS) {
    _token = await _fetchFreshToken();
    _tokenFetchedAt = Date.now();
    // Keep env var in sync so logger can pick it up too
    process.env.ACCESS_TOKEN = _token;
  }

  return _token;
}

/**
 * Returns Authorization headers with a valid Bearer token.
 * @param {boolean} forceRefresh
 * @returns {Promise<Object>}
 */
async function getHeaders(forceRefresh = false) {
  const token = await getToken(forceRefresh);
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

module.exports = { getToken, getHeaders };
