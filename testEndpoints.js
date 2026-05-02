/**
 * testEndpoints.js — Smoke test for both local microservices.
 * Run: node testEndpoints.js
 *
 * BUG FIX #4: Full try/catch with helpful error messages if either service is down.
 *
 * Prerequisites:
 *   Terminal 1: npm run start:vehicle      (port 8000)
 *   Terminal 2: npm run start:notification (port 8001)
 */

require('dotenv').config();
const axios = require('axios');

const SEP = '-'.repeat(60);

async function testVehicleScheduler() {
  console.log(SEP);
  console.log('--- Vehicle Scheduler: GET /evaluation-service/depots ---');
  try {
    const rd = await axios.get('http://localhost:8000/evaluation-service/depots', { timeout: 60000 });
    console.log(`Status: ${rd.status}`);
    console.log(`Returned ${rd.data.depots?.length || 0} depots`);
  } catch (err) {
    console.error(`  [FAILED] /evaluation-service/depots: ${err.message}`);
  }

  console.log('\n--- Vehicle Scheduler: GET /evaluation-service/vehicles ---');
  try {
    const rv = await axios.get('http://localhost:8000/evaluation-service/vehicles', { timeout: 60000 });
    console.log(`Status: ${rv.status}`);
    console.log(`Returned ${rv.data.vehicles?.length || 0} vehicles`);
  } catch (err) {
    console.error(`  [FAILED] /api/vehicles: ${err.message}`);
  }

  console.log('\n--- Vehicle Scheduler: GET /api/schedule ---');
  try {
    const r = await axios.get('http://localhost:8000/api/schedule', { timeout: 60000 });
    console.log(`Status: ${r.status}`);
    const schedules = r.data.schedules || [];
    if (schedules.length === 0) {
      console.log('  [WARN] No schedules returned');
    }
    for (const s of schedules) {
      console.log(
        `  Depot ${s.depot_id}: ${s.tasks_scheduled_count} tasks | ` +
        `Impact=${s.total_impact_score} | ` +
        `Hours=${s.mechanic_hours_used}/${s.mechanic_hours_budget}`
      );
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error('  [FAILED] Vehicle Scheduler is NOT running on port 8000.');
      console.error('  Start it first: npm run start:vehicle');
    } else if (err.response) {
      console.error(`  [FAILED] HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error(`  [FAILED] ${err.message}`);
    }
  }
}

async function testNotificationPriority() {
  console.log('\n------------------------------------------------------------');
  console.log('--- Notification Priority Inbox: GET /evaluation-service/notifications/priority?n=10 ---');
  try {
    const r = await axios.get('http://localhost:8001/evaluation-service/notifications/priority?n=10', { timeout: 60000 });
    console.log(`Status: ${r.status}`);
    const notifications = r.data.priority_notifications || [];
    if (notifications.length === 0) {
      console.log('  [WARN] No priority notifications returned');
    }
    for (const n of notifications) {
      console.log(
        `  [${n.Type.padEnd(10)}] score=${n.priority_score} | ${n.Message}`
      );
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error('  [FAILED] Notification App is NOT running on port 8001.');
      console.error('  Start it first: npm run start:notification');
    } else if (err.response) {
      console.error(`  [FAILED] HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error(`  [FAILED] ${err.message}`);
    }
  }
}

async function run() {
  await testVehicleScheduler();
  await testNotificationPriority();
  console.log(`\n${SEP}`);
  console.log('Done.');
}

run().catch((err) => {
  console.error('[UNEXPECTED ERROR]', err.message);
  process.exit(1);
});
