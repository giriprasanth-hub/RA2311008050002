require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const { getHeaders } = require('../tokenManager');
const BASE_URL = process.env.BASE_URL || 'http://20.207.122.201/evaluation-service';
async function _get(url) {
  let headers = await getHeaders();
  let response = await axios.get(url, { headers, timeout: 30000 });
  if (response.status === 401) {
    headers = await getHeaders(true);
    response = await axios.get(url, { headers, timeout: 30000 });
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GET ${url} failed (${response.status}): ${JSON.stringify(response.data)}`);
  }
  return response.data;
}
async function fetchDepots() {
  try {
    const data = await _get(`${BASE_URL}/depots`);
    return data.depots;
  } catch (err) {
    throw new Error(`Failed to fetch depots: ${err.message}`);
  }
}
async function fetchVehicles() {
  try {
    const data = await _get(`${BASE_URL}/vehicles`);
    return data.vehicles;
  } catch (err) {
    throw new Error(`Failed to fetch vehicles: ${err.message}`);
  }
}
function knapsackSchedule(vehicles, capacity) {
  const n = vehicles.length;
  if (n === 0 || capacity === 0) {
    return { selected: [], totalImpact: 0, totalDuration: 0 };
  }
  const dp = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const duration = vehicles[i - 1].Duration;
    const impact   = vehicles[i - 1].Impact;
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w]; 
      if (duration <= w) {
        const include = dp[i - 1][w - duration] + impact;
        if (include > dp[i][w]) {
          dp[i][w] = include; 
        }
      }
    }
  }
  const selected = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(vehicles[i - 1]);
      w -= vehicles[i - 1].Duration;
    }
  }
  const totalImpact   = dp[n][capacity];
  const totalDuration = selected.reduce((sum, t) => sum + t.Duration, 0);
  return { selected, totalImpact, totalDuration };
}
module.exports = { fetchDepots, fetchVehicles, knapsackSchedule };
