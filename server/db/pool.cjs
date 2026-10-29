const { Pool } = require('pg');

let sharedPool;
function positiveInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}
function databaseConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const connectionString = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  if (!connectionString) return { error: 'database configuration' };
  try {
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password) throw new Error();
    const max = positiveInteger(env.DATABASE_POOL_MAX, 10, 1, 40);
    const connectTimeoutMillis = positiveInteger(env.DATABASE_CONNECT_TIMEOUT_MS, 5_000, 500, 30_000);
    const idleTimeoutMillis = positiveInteger(env.DATABASE_IDLE_TIMEOUT_MS, 30_000, 1_000, 300_000);
    const mode = String(env.DATABASE_SSL_MODE || 'auto').toLowerCase();
    if (!max || !connectTimeoutMillis || !idleTimeoutMillis || !['auto', 'require', 'verify-full'].includes(mode)) throw new Error();
    if (production && url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error();
    // Render internal URLs can use a private connection; external URLs should carry their own sslmode
    // or explicitly select require/verify-full. No code path disables certificate verification.
    const ssl = mode === 'auto' ? undefined : { rejectUnauthorized: true };
    return { connectionString, max, connectTimeoutMillis, idleTimeoutMillis, ssl, mode };
  } catch { return { error: 'database configuration' }; }
}
function createPool(configuration) {
  if (configuration?.error) throw new Error('Database configuration is invalid.');
  return new Pool({ connectionString: configuration.connectionString, max: configuration.max, connectionTimeoutMillis: configuration.connectTimeoutMillis, idleTimeoutMillis: configuration.idleTimeoutMillis, ...(configuration.ssl ? { ssl: configuration.ssl } : {}) });
}
function getPool(env = process.env) {
  if (!sharedPool) {
    const configuration = databaseConfig(env);
    if (configuration.error) throw new Error('Database configuration is invalid.');
    sharedPool = createPool(configuration);
    sharedPool.on('error', () => undefined);
  }
  return sharedPool;
}
async function databaseReady(env = process.env) {
  try { await getPool(env).query('SELECT 1 AS ready'); return true; } catch { return false; }
}
async function closePool() { const pool = sharedPool; sharedPool = undefined; if (pool) await pool.end(); }
function setPoolForTests(pool) { sharedPool = pool; }
module.exports = { databaseConfig, createPool, getPool, databaseReady, closePool, setPoolForTests };
