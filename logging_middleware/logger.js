/**
 * logger.js — Logging Middleware
 * --------------------------------
 * Reusable module that sends structured logs to the Affordmed evaluation server.
 *
 * Usage:
 *   const { Log } = require('../logging_middleware/logger');
 *   await Log('backend', 'info', 'route', 'Request received for /api/schedule');
 *   await Log('backend', 'error', 'handler', 'Failed to fetch depots');
 *
 * Function Signature:
 *   Log(stack, level, package, message)
 *
 * Allowed values:
 *   stack   : 'backend' | 'frontend'
 *   level   : 'debug' | 'info' | 'warn' | 'error' | 'fatal'
 *   package : See VALID_PACKAGES below
 */

require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://20.207.122.201/evaluation-service';
const LOG_ENDPOINT = `${BASE_URL}/logs`;

// Valid enum values as per Affordmed specification
const VALID_STACKS = new Set(['backend', 'frontend']);
const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
const VALID_PACKAGES = new Set([
  // Backend only
  'cache', 'controller', 'cron_job', 'db', 'domain',
  'handler', 'repository', 'route', 'service',
  // Frontend only
  'api', 'component', 'hook', 'page', 'state', 'style',
  // Both
  'auth', 'config', 'middleware', 'utils',
]);

/**
 * Sends a structured log entry to the Affordmed evaluation server.
 *
 * @param {string} stack   - 'backend' or 'frontend'
 * @param {string} level   - 'debug' | 'info' | 'warn' | 'error' | 'fatal'
 * @param {string} pkg     - Module/layer context (e.g. 'route', 'service')
 * @param {string} message - Descriptive log message
 * @returns {Promise<Object>} Server response or error object (never throws)
 */
async function Log(stack, level, pkg, message) {
  // Validate inputs
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
    // Log failures should never crash the application
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
