require('dotenv').config();
const axios = require('axios');
const BASE_URL = process.env.BASE_URL || 'http://20.207.122.201/evaluation-service';
const LOG_ENDPOINT = `${BASE_URL}/logs`;
const VALID_STACKS = new Set(['backend', 'frontend']);
const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
const VALID_PACKAGES = new Set([
  'cache', 'controller', 'cron_job', 'db', 'domain',
  'handler', 'repository', 'route', 'service',
  'api', 'component', 'hook', 'page', 'state', 'style',
  'auth', 'config', 'middleware', 'utils',
]);
async function Log(stack, level, pkg, message) {
  if (!VALID_STACKS.has(stack)) {
    throw new Error(`Invalid stack '${stack}'. Must be one of: ${[...VALID_STACKS].join(', ')}`);
  }
  if (!VALID_LEVELS.has(level)) {
    throw new Error(`Invalid level '${level}'. Must be one of: ${[...VALID_LEVELS].join(', ')}`);
  }
  if (!VALID_PACKAGES.has(pkg)) {
    throw new Error(`Invalid package '${pkg}'. Must be one of: ${[...VALID_PACKAGES].join(', ')}`);
  }
  const token = process.env.ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'ACCESS_TOKEN is not set. Ensure auth has been completed before calling Log().'
    );
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const payload = { stack, level, package: pkg, message };
  try {
    const response = await axios.post(LOG_ENDPOINT, payload, { headers, timeout: 10000 });
    return response.data;
  } catch (err) {
    if (err.response) {
      console.error(`[LogMiddleware] HTTP error sending log: ${err.response.status} | payload=${JSON.stringify(payload)}`);
      return { error: `HTTP ${err.response.status}`, payload };
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      console.error(`[LogMiddleware] Connection error — could not reach log server | payload=${JSON.stringify(payload)}`);
      return { error: 'connection_error', payload };
    } else if (err.code === 'ECONNABORTED') {
      console.error(`[LogMiddleware] Log request timed out | payload=${JSON.stringify(payload)}`);
      return { error: 'timeout', payload };
    } else {
      console.error(`[LogMiddleware] Unexpected error: ${err.message} | payload=${JSON.stringify(payload)}`);
      return { error: err.message, payload };
    }
  }
}
module.exports = { Log };
