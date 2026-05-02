require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const { getHeaders } = require('../tokenManager');
const BASE_URL = process.env.BASE_URL || 'http://20.207.122.201/evaluation-service';
const NOTIFICATIONS_ENDPOINT = `${BASE_URL}/notifications`;
const TYPE_WEIGHTS = {
  Placement: 3,
  Result:    2,
  Event:     1,
};
const TYPE_ALPHA    = 0.65;
const RECENCY_ALPHA = 0.35;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; 
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
async function fetchNotifications() {
  let headers = await getHeaders();
  try {
    let response = await axios.get(NOTIFICATIONS_ENDPOINT, { headers, timeout: 30000 });
    if (response.status === 401) {
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
function calculatePriorityScore(notification, now) {
  const typeWeight = TYPE_WEIGHTS[notification.Type] || 0;
  let recencyScore = 0.0;
  try {
    const ts = new Date(notification.Timestamp);
    if (!isNaN(ts.getTime())) {
      const ageMs = now.getTime() - ts.getTime();
      recencyScore = Math.max(0, 1 - ageMs / MAX_AGE_MS) * 3;
    }
  } catch (_) {
    recencyScore = 0.0;
  }
  return typeWeight * TYPE_ALPHA + recencyScore * RECENCY_ALPHA;
}
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
      heap.replace(item);
    }
  });
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
