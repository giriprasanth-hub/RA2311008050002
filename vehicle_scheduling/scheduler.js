/**
 * scheduler.js — Core 0/1 Knapsack algorithm and external API client.
 *
 * Uses the shared tokenManager for auto-refreshing tokens and 401 retry logic.
 *
 * Exports:
 *   fetchDepots()              → [{ ID, MechanicHours }, ...]
 *   fetchVehicles()            → [{ TaskID, Duration, Impact }, ...]
 *   knapsackSchedule(v, cap)   → { selected, totalImpact, totalDuration }
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const { getHeaders } = require('../tokenManager');

const BASE_URL = process.env.BASE_URL || 'http://20.207.122.201/evaluation-service';

/**
 * Makes a GET request with auto-retry on 401 (token expired).
 * @param {string} url
 * @returns {Promise<Object>} Parsed JSON response body
 */
async function _get(url) {
  let headers = await getHeaders();
  let response = await axios.get(url, { headers, timeout: 30000 });

  if (response.status === 401) {
    // Token expired — force refresh and retry once
    headers = await getHeaders(true);
    response = await axios.get(url, { headers, timeout: 30000 });
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GET ${url} failed (${response.status}): ${JSON.stringify(response.data)}`);
  }

  return response.data;
}

/**
 * Fetches list of depots from Affordmed evaluation API.
 * @returns {Promise<Array<{ ID: number, MechanicHours: number }>>}
 */
async function fetchDepots() {
  try {
    const data = await _get(`${BASE_URL}/depots`);
    return data.depots;
  } catch (err) {
    throw new Error(`Failed to fetch depots: ${err.message}`);
  }
}

/**
 * Fetches list of vehicle maintenance tasks from Affordmed evaluation API.
 * @returns {Promise<Array<{ TaskID: string, Duration: number, Impact: number }>>}
 */
async function fetchVehicles() {
  try {
    const data = await _get(`${BASE_URL}/vehicles`);
    return data.vehicles;
  } catch (err) {
    throw new Error(`Failed to fetch vehicles: ${err.message}`);
  }
}

/**
 * Solves the 0/1 Knapsack problem to find the optimal vehicle maintenance schedule.
 *
 * Algorithm: Bottom-up Dynamic Programming
 *   dp[i][w] = max impact using first i tasks within w mechanic-hours
 *   Time:  O(n × W)
 *   Space: O(n × W)
 *
 * No external algorithm libraries used — implemented from scratch.
 *
 * @param {Array<{ TaskID: string, Duration: number, Impact: number }>} vehicles
 * @param {number} capacity - Available mechanic-hours budget
 * @returns {{ selected: Array, totalImpact: number, totalDuration: number }}
 */
function knapsackSchedule(vehicles, capacity) {
  const n = vehicles.length;
  if (n === 0 || capacity === 0) {
    return { selected: [], totalImpact: 0, totalDuration: 0 };
  }

  // Build DP table: (n+1) x (capacity+1) filled with 0
  const dp = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const duration = vehicles[i - 1].Duration;
    const impact   = vehicles[i - 1].Impact;
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w]; // skip item
      if (duration <= w) {
        const include = dp[i - 1][w - duration] + impact;
        if (include > dp[i][w]) {
          dp[i][w] = include; // include item
        }
      }
    }
  }

  // Backtrack to find selected tasks
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
