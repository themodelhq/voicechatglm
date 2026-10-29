const http = require('node:http');
const { nodeHandler, startupConfigurationErrors } = require('./proxy-core.cjs');
const { runMigrations } = require('./db/migrate.cjs');
const { closePool } = require('./db/pool.cjs');
const { startMaintenance } = require('./maintenance.cjs');
const { verifyProductionFileAnalysisDependencies } = require('./readiness.cjs');

const port = Number(process.env.PORT) || 10000; const production = process.env.NODE_ENV === 'production'; const requestedHost = process.env.BIND_HOST?.trim(); const loopback = new Set(['127.0.0.1', '::1', 'localhost']);
if (!production && requestedHost && !loopback.has(requestedHost) && process.env.ALLOW_PUBLIC_DEV_BIND !== 'true') throw new Error('Refusing a non-loopback development bind. Set ALLOW_PUBLIC_DEV_BIND=true only for a deliberate trusted-network test.');
const startupProblems = startupConfigurationErrors(); if (production && startupProblems.length) throw new Error(`Refusing production startup: missing or invalid ${startupProblems.join(', ')} configuration.`);
const host = production ? requestedHost || '0.0.0.0' : requestedHost || '127.0.0.1'; const server = http.createServer(nodeHandler); let stopMaintenance = () => undefined; let shuttingDown = false;
async function shutdown() { if (shuttingDown) return; shuttingDown = true; stopMaintenance(); const force = setTimeout(() => { server.closeAllConnections?.(); process.exit(1); }, 10_000); force.unref?.(); server.close(async () => { clearTimeout(force); await closePool().catch(() => undefined); process.exit(0); }); }
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
async function start() {
  // In production migrations run under a PostgreSQL advisory lock before accepting traffic.
  if (production) await runMigrations();
  // Enabling production file analysis is an explicit deployment decision. Refuse to
  // accept traffic when its real private storage, scanner, Redis, database/migrations,
  // and protected-model readiness checks have not all succeeded.
  if (production && (process.env.FILE_ANALYSIS_ENABLED === 'true' || process.env.KNOWLEDGE_OCR_ENABLED === 'true')) { const verification = await verifyProductionFileAnalysisDependencies(); if (!verification.ready) throw new Error(`Production file-analysis/OCR dependencies are unavailable: ${verification.missing.join(', ')}.`); }
  if (production) stopMaintenance = startMaintenance();
  server.listen(port, host, () => console.log(`VoiceChatGLM application listening on ${host}:${port}`));
}
start().catch(() => { process.stderr.write('Application startup failed.\n'); void closePool().finally(() => { process.exitCode = 1; }); });
