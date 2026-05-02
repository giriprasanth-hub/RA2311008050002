/**
 * priorityInbox.js — Priority Inbox for Campus Notifications.
 *
 * Fetches notifications from the Affordmed API and ranks them by a composite
 * priority score combining:
 *   1. Type weight   : Placement (3) > Result (2) > Event (1)
 *   2. Recency score : More recent notifications score higher (decays over 7 days)
 *
 * Combined Score Formula:
 *   score = (type_weight * TYPE_ALPHA) + (recency_score * RECENCY_ALPHA)
 *
 * Where:
 *   TYPE_ALPHA    = 0.65  (65% weight on notification type importance)
 *   RECENCY_ALPHA = 0.35  (35% weight on recency)
 *   type_weight   ∈ {1, 2, 3}
 *   recency_score = max(0, 1 - age_ms / MAX_AGE_MS) * 3  (scaled 0-3 to match type_weight range)
 *
 * Efficient Top-N Selection:
 *   Uses a min-heap of size n → O(k log n) time, O(n) space
 *   Much more efficient than sorting all k notifications when k >> n.
 *
 * Uses the shared tokenManager for auto-refreshing tokens and 401 retry.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const { getHeaders } = require('../tokenManager');

const BASE_URL = process.env.BASE_URL || 'http://20.207.122.201/evaluation-service';
const NOTIFICATIONS_ENDPOINT = `${BASE_URL}/notifications`;

// Priority weights per type (Placement > Result > Event)
const TYPE_WEIGHTS = {
  Placement: 3,
  Result:    2,
  Event:     1,
};

// Score formula coefficients
const TYPE_ALPHA    = 0.65;
const RECENCY_ALPHA = 0.35;

// Recency decay window: notifications older than 7 days score 0 for recency
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 604800000 ms

// ---------------------------------------------------------------------------
// Min-Heap (implemented from scratch — no external libraries)
// Heap stores: { score, idx, notif }
// Min-heap by score — smallest score is at root
// ---------------------------------------------------------------------------
class MinHeap {
  constructor() {
    this._heap = [];
  }

  get size() {
    return this._heap.length;
  }

  peek() {
    return this._heap[0];
  }

  push(item) {
    this._heap.push(item);
    this._bubbleUp(this._heap.length - 1);
  }

  pop() {
    const top = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  replace(item) {
    // Replace root with item (equivalent to Python's heapreplace)
    this._heap[0] = item;
    this._sinkDown(0);
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this._heap[parent].score <= this._heap[i].score) break;
      [this._heap[parent], this._heap[i]] = [this._heap[i], this._heap[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this._heap.length;
    while (true) {
      let smallest = i;
      const left  = 2 * i + 1;
      const right = 2 * i + 2;
      if (left  < n && this._heap[left].score  < this._heap[smallest].score) smallest = left;
      if (right < n && this._heap[right].score < this._heap[smallest].score) smallest = right;
      if (smallest === i) break;
      [this._heap[smallest], this._heap[i]] = [this._heap[i], this._heap[smallest]];
      i = smallest;
    }
  }

  toArray() {
    return [...this._heap];
  }
}

// ---------------------------------------------------------------------------
// API Client (with 401 auto-retry via tokenManager)
// ---------------------------------------------------------------------------

/**
 * Fetches all notifications from the Affordmed evaluation API.
 * @returns {Promise<Array<{ ID, Type, Message, Timestamp }>>}
 */
async function fetchNotifications() {
  let headers = await getHeaders();

  try {
    let response = await axios.get(NOTIFICATIONS_ENDPOINT, { headers, timeout: 30000 });

    if (response.status === 401) {
      // Token expired — force refresh and retry once (BUG FIX #2 & #3)
      headers = await getHeaders(true);
      response = await axios.get(NOTIFICATIONS_ENDPOINT, { headers, timeout: 30000 });
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Notifications API failed (HTTP ${response.status}): ${JSON.stringify(response.data)}`
      );
    }

    return response.data.notifications;
  } catch (err) {
    if (err.response) {
      throw new Error(
        `Notifications API failed (HTTP ${err.response.status}): ${JSON.stringify(err.response.data)}`
      );
    }
    throw new Error(`Notifications API request error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Priority Scoring
// ---------------------------------------------------------------------------

/**
 * Computes composite priority score for a single notification.
 * @param {{ Type: string, Timestamp: string }} notification
 * @param {Date} now - Current time (passed in for consistency across batch)
 * @returns {number} Priority score (higher = more important)
 */
function calculatePriorityScore(notification, now) {
  // Type importance weight
  const typeWeight = TYPE_WEIGHTS[notification.Type] || 0;

  // Recency: compute age and decay linearly over MAX_AGE_MS
  let recencyScore = 0.0;
  try {
    const ts = new Date(notification.Timestamp);
    if (!isNaN(ts.getTime())) {
      const ageMs = now.getTime() - ts.getTime();
      // Clamp to [0, 1] then scale to [0, 3] to match type_weight range
      recencyScore = Math.max(0, 1 - ageMs / MAX_AGE_MS) * 3;
    }
  } catch (_) {
    // If timestamp parsing fails, treat as oldest possible (recency = 0)
    recencyScore = 0.0;
  }

  return typeWeight * TYPE_ALPHA + recencyScore * RECENCY_ALPHA;
}

// ---------------------------------------------------------------------------
// Top-N Selection via Min-Heap
// ---------------------------------------------------------------------------

/**
 * Efficiently selects and returns the top N priority notifications.
 *
 * Algorithm: Min-Heap of size n
 *   - For each notification, compute priority score
 *   - Maintain a min-heap of size n: if current score > heap root, replace it
 *   - Final heap contains the top n highest-scoring notifications
 *   - Time: O(k log n)   where k = total notifications
 *   - Space: O(n)
 *
 * @param {Array} notifications - All notifications from external API
 * @param {number} n - Number of top notifications to return
 * @returns {Array} Notifications sorted by priority score (descending),
 *                  each with added 'priority_score' and 'type_weight' fields.
 */
function getTopNNotifications(notifications, n = 10) {
  if (n <= 0 || !notifications || notifications.length === 0) return [];

  const now  = new Date();
  const heap = new MinHeap();

  notifications.forEach((notif, idx) => {
    const score = calculatePriorityScore(notif, now);
    const item  = { score, idx, notif };

    if (heap.size < n) {
      heap.push(item);
    } else if (score > heap.peek().score) {
      // Current notification beats the lowest score in our top-n set
      heap.replace(item);
    }
  });

  // Sort descending by score for final output
  const topN = heap.toArray().sort((a, b) => b.score - a.score);

  return topN.map(({ score, notif }) => ({
    ...notif,
    priority_score: Math.round(score * 10000) / 10000,
    type_weight:    TYPE_WEIGHTS[notif.Type] || 0,
  }));
}

module.exports = {
  fetchNotifications,
  getTopNNotifications,
  TYPE_WEIGHTS,
};
