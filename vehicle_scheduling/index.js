require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors    = require('cors');
const { getAuthToken }                          = require('./auth');
const { fetchDepots, fetchVehicles, knapsackSchedule } = require('./scheduler');
const { Log }                                   = require('../logging_middleware/logger');
const app  = express();
const PORT = 8000;
app.use(cors());
app.use(express.json());
async function startup() {
  try {
    const token = await getAuthToken();
    process.env.ACCESS_TOKEN = token;
    await Log('backend', 'info', 'config', 'Vehicle Maintenance Scheduler service starting up');
    await Log('backend', 'info', 'auth', 'Bearer token acquired and stored successfully');
    app.listen(PORT, () => {
      console.log(`[VehicleScheduler] Server running at http://localhost:${PORT}`);
      console.log(`[VehicleScheduler] Health check: http://localhost:${PORT}/health`);
      console.log(`[VehicleScheduler] Schedule:     http://localhost:${PORT}/api/schedule`);
    });
  } catch (err) {
    console.error(`[VehicleScheduler] FATAL: Startup authentication failed: ${err.message}`);
    process.exit(1);
  }
}
app.get('/health', async (req, res) => {
  await Log('backend', 'debug', 'route', 'Health check endpoint called');
  res.json({ status: 'healthy', service: 'vehicle-maintenance-scheduler' });
});
app.get('/evaluation-service/depots', async (req, res) => {
  await Log('backend', 'info', 'route', 'GET /evaluation-service/depots — fetching raw depots');
  try {
    const depots = await fetchDepots();
    res.json({ depots });
  } catch (err) {
    await Log('backend', 'error', 'handler', `Error fetching depots: ${err.message}`);
    res.status(502).json({ error: 'external_api_error', detail: err.message });
  }
});
app.get('/evaluation-service/vehicles', async (req, res) => {
  await Log('backend', 'info', 'route', 'GET /evaluation-service/vehicles — fetching raw vehicles');
  try {
    const vehicles = await fetchVehicles();
    res.json({ vehicles });
  } catch (err) {
    await Log('backend', 'error', 'handler', `Error fetching vehicles: ${err.message}`);
    res.status(502).json({ error: 'external_api_error', detail: err.message });
  }
});
app.get('/api/schedule', async (req, res) => {
  await Log('backend', 'info', 'route', 'GET /api/schedule — full schedule requested');
  try {
    const depots = await fetchDepots();
    await Log('backend', 'info', 'service',
      `Successfully fetched ${depots.length} depots from evaluation API`);
    const vehicles = await fetchVehicles();
    await Log('backend', 'info', 'service',
      `Successfully fetched ${vehicles.length} vehicle tasks from evaluation API`);
    const schedules = [];
    for (const depot of depots) {
      const depotId = depot.ID;
      const budget  = depot.MechanicHours;
      await Log('backend', 'debug', 'domain',
        `Running knapsack for depot ${depotId} with budget=${budget}h, tasks=${vehicles.length}`);
      const { selected, totalImpact, totalDuration } = knapsackSchedule(vehicles, budget);
      schedules.push({
        depot_id:                depotId,
        mechanic_hours_budget:   budget,
        mechanic_hours_used:     totalDuration,
        mechanic_hours_remaining: budget - totalDuration,
        total_impact_score:      totalImpact,
        tasks_scheduled_count:   selected.length,
        scheduled_tasks:         selected,
      });
      await Log('backend', 'info', 'domain',
        `Depot ${depotId}: ${selected.length} tasks scheduled | Impact=${totalImpact} | Hours=${totalDuration}/${budget}`);
    }
    await Log('backend', 'info', 'service',
      `Schedule computation complete for all ${depots.length} depots`);
    res.json({
      status:       'success',
      total_depots: schedules.length,
      schedules,
    });
  } catch (err) {
    const isExternal = err.message.includes('Failed to fetch');
    await Log('backend', isExternal ? 'error' : 'fatal', 'handler',
      `Error in full schedule computation: ${err.message}`);
    res.status(isExternal ? 502 : 500).json({
      error:   isExternal ? 'external_api_error' : 'internal_server_error',
      detail:  err.message,
    });
  }
});
app.get('/api/schedule/:depotId', async (req, res) => {
  const depotId = parseInt(req.params.depotId, 10);
  if (isNaN(depotId)) {
    return res.status(400).json({ error: 'bad_request', detail: 'depotId must be an integer' });
  }
  await Log('backend', 'info', 'route',
    `GET /api/schedule/${depotId} — depot-specific schedule requested`);
  try {
    const depots = await fetchDepots();
    const depot  = depots.find((d) => d.ID === depotId);
    if (!depot) {
      const available = depots.map((d) => d.ID);
      await Log('backend', 'warn', 'handler',
        `Depot ${depotId} not found. Available depot IDs: ${available}`);
      return res.status(404).json({
        error:  'not_found',
        detail: `Depot with ID ${depotId} not found`,
        available_depot_ids: available,
      });
    }
    const vehicles = await fetchVehicles();
    await Log('backend', 'info', 'service',
      `Fetched ${vehicles.length} vehicle tasks for depot ${depotId} schedule`);
    const budget = depot.MechanicHours;
    await Log('backend', 'debug', 'domain',
      `Running knapsack for depot ${depotId}: budget=${budget}h, tasks=${vehicles.length}`);
    const { selected, totalImpact, totalDuration } = knapsackSchedule(vehicles, budget);
    await Log('backend', 'info', 'domain',
      `Depot ${depotId} schedule: ${selected.length} tasks | Impact=${totalImpact} | Hours=${totalDuration}/${budget}`);
    res.json({
      status:                   'success',
      depot_id:                 depotId,
      mechanic_hours_budget:    budget,
      mechanic_hours_used:      totalDuration,
      mechanic_hours_remaining: budget - totalDuration,
      total_impact_score:       totalImpact,
      tasks_scheduled_count:    selected.length,
      scheduled_tasks:          selected,
    });
  } catch (err) {
    const isExternal = err.message.includes('Failed to fetch');
    await Log('backend', isExternal ? 'error' : 'fatal', 'handler',
      `Error scheduling depot ${depotId}: ${err.message}`);
    res.status(isExternal ? 502 : 500).json({
      error:  isExternal ? 'external_api_error' : 'internal_server_error',
      detail: err.message,
    });
  }
});
startup();
