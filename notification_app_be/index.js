require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors    = require('cors');
const { getAuthToken }                         = require('./auth');
const { fetchNotifications, getTopNNotifications, TYPE_WEIGHTS } = require('./priorityInbox');
const { Log }                                  = require('../logging_middleware/logger');
const app  = express();
const PORT = 8001;
app.use(cors());
app.use(express.json());
async function startup() {
  try {
    const token = await getAuthToken();
    process.env.ACCESS_TOKEN = token;
    await Log('backend', 'info', 'config', 'Campus Notification Priority Inbox service starting up');
    await Log('backend', 'info', 'auth', 'Bearer token acquired and stored successfully');
    app.listen(PORT, () => {
      console.log(`[NotificationApp] Server running at http://localhost:${PORT}`);
      console.log(`[NotificationApp] Health:    http://localhost:${PORT}/health`);
      console.log(`[NotificationApp] All notifs:  http://localhost:${PORT}/evaluation-service/notifications`);
      console.log(`[NotificationApp] Priority:    http://localhost:${PORT}/evaluation-service/notifications/priority?n=10`);
    });
  } catch (err) {
    console.error(`[NotificationApp] FATAL: Startup authentication failed: ${err.message}`);
    process.exit(1);
  }
}
app.get('/health', async (req, res) => {
  await Log('backend', 'debug', 'route', 'Health check endpoint called');
  res.json({ status: 'healthy', service: 'campus-notification-priority-inbox' });
});
app.get('/evaluation-service/notifications', async (req, res) => {
  await Log('backend', 'info', 'route', 'GET /evaluation-service/notifications — fetching all notifications');
  try {
    const notifications = await fetchNotifications();
    await Log('backend', 'info', 'service',
      `Successfully fetched ${notifications.length} notifications from external API`);
    const typeCounts = notifications.reduce((acc, n) => {
      const t = n.Type || 'Unknown';
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});
    await Log('backend', 'debug', 'domain',
      `Notification type breakdown: ${JSON.stringify(typeCounts)}`);
    res.json({
      status:         'success',
      total_count:    notifications.length,
      type_breakdown: typeCounts,
      notifications,
    });
  } catch (err) {
    const isExternal = err.message.includes('API');
    await Log('backend', isExternal ? 'error' : 'fatal', 'handler',
      `Error fetching notifications: ${err.message}`);
    res.status(isExternal ? 502 : 500).json({
      error:  isExternal ? 'external_api_error' : 'internal_server_error',
      detail: err.message,
    });
  }
});
app.get('/evaluation-service/notifications/priority', async (req, res) => {
  const rawN = req.query.n !== undefined ? req.query.n : '10';
  const n    = parseInt(rawN, 10);
  if (isNaN(n) || n < 1 || n > 100) {
    return res.status(400).json({
      error:  'bad_request',
      detail: 'Query param "n" must be an integer between 1 and 100',
    });
  }
  await Log('backend', 'info', 'route',
    `GET /api/notifications/priority?n=${n} — priority inbox requested`);
  try {
    const notifications = await fetchNotifications();
    await Log('backend', 'info', 'service',
      `Fetched ${notifications.length} notifications, computing top ${n} by priority`);
    const priorityNotifications = getTopNNotifications(notifications, n);
    await Log('backend', 'info', 'domain',
      `Priority inbox computed: returned ${priorityNotifications.length} of ${notifications.length} total notifications`);
    if (priorityNotifications.length > 0) {
      const top = priorityNotifications[0];
      await Log('backend', 'debug', 'domain',
        `Top notification: Type=${top.Type}, Score=${top.priority_score}, Message='${top.Message}'`);
    }
    res.json({
      status:          'success',
      requested_n:     n,
      returned_count:  priorityNotifications.length,
      total_available: notifications.length,
      scoring_info: {
        type_weights:        TYPE_WEIGHTS,
        formula:             'score = (type_weight × 0.65) + (recency_score × 0.35)',
        recency_window_days: 7,
      },
      priority_notifications: priorityNotifications,
    });
  } catch (err) {
    const isExternal = err.message.includes('API');
    await Log('backend', isExternal ? 'error' : 'fatal', 'handler',
      `Error computing priority inbox: ${err.message}`);
    res.status(isExternal ? 502 : 500).json({
      error:  isExternal ? 'external_api_error' : 'internal_server_error',
      detail: err.message,
    });
  }
});
startup();
