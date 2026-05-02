require('dotenv').config();
const axios = require('axios');
const BASE_URL = process.env.BASE_URL || 'http://20.207.122.201/evaluation-service';
const TOKEN_TTL_MS = 14 * 60 * 1000; 
let _token = '';
let _tokenFetchedAt = 0;
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
async function getToken(forceRefresh = false) {
  const age = Date.now() - _tokenFetchedAt;
  if (forceRefresh || !_token || age >= TOKEN_TTL_MS) {
    _token = await _fetchFreshToken();
    _tokenFetchedAt = Date.now();
    process.env.ACCESS_TOKEN = _token;
  }
  return _token;
}
async function getHeaders(forceRefresh = false) {
  const token = await getToken(forceRefresh);
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}
module.exports = { getToken, getHeaders };
