const http = require('node:http');
const { nodeHandler, startupConfigurationErrors } = require('./proxy-core.cjs');
const { runMigrations } = require('./db/migrate.cjs');
const { closePool } = require('./db/pool.cjs');
const { startMaintenance } = require('./maintenance.cjs');
const { verifyProductionFileAnalysisDependencies } = require('./readiness.cjs');
const { startScrapeWorker } = require('./scrape-jobs.cjs');

const port = Number(process.env.PORT) || 10000; const production = process.env.NODE_ENV === 'production'; const requestedHost = process.env.BIND_HOST?.trim(); const loopback = new Set(['127.0.0.1', '::1', 'localhost']);
if (!production && requestedHost && !loopback.has(requestedHost) && process.env.ALLOW_PUBLIC_DEV_BIND !== 'true') throw new Error('Refusing a non-loopback development bind. Set ALLOW_PUBLIC_DEV_BIND=true only for a deliberate trusted-network test.');
const startupProblems = startupConfigurationErrors(); if (production && startupProblems.length) throw new Error(`Refusing production startup: missing or invalid ${startupProblems.join(', ')} configuration.`);
const host = production ? requestedHost || '0.0.0.0' : requestedHost || '127.0.0.1'; const server = http.createServer(nodeHandler); let stopMaintenance = () => undefined; let stopScrapeJobs = () => undefined; let shuttingDown = false; let startupStage = 'initialization';
function safeStartupError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  // Startup diagnostics must never print credentials embedded in provider connection URLs.
  return message.replace(/(postgres(?:ql)?|redis|rediss):\/\/[^\s"'\x60]+/gi, '$1://[REDACTED]');
}
async function shutdown() { if (shuttingDown) return; shuttingDown = true; stopMaintenance(); stopScrapeJobs(); const force = setTimeout(() => { server.closeAllConnections?.(); process.exit(1); }, 10_000); force.unref?.(); server.close(async () => { clearTimeout(force); await closePool().catch(() => undefined); process.exit(0); }); }
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
async function start() {
  // In production migrations run under a PostgreSQL advisory lock before accepting traffic.
  if (production) { startupStage = 'PostgreSQL migrations'; await runMigrations(); }
  // Enabling production file analysis is an explicit deployment decision. Require
  // database/migrations, Redis, private storage, OCR, and model readiness before
  // accepting traffic. The external scanner is also probed, but may sleep while idle;
  // the upload route enforces scanner readiness and fails closed with 503.
  if (production && (process.env.FILE_ANALYSIS_ENABLED === 'true' || process.env.KNOWLEDGE_OCR_ENABLED === 'true')) {
    startupStage = 'production dependency readiness checks';
    const verification = await verifyProductionFileAnalysisDependencies();
    // The scanner is an external free Hugging Face Space and may sleep while idle.
    // Permit the API to start when only scanner reachability is missing; uploads
    // still call scanBuffer and fail closed with 503 until the scanner is healthy.
    const blockingMissing = verification.missing.filter(item => item !== 'malware scanner signatures');
    if (blockingMissing.length) throw new Error(`Production dependencies are not ready: ${blockingMissing.join(', ')}.`);
    if (verification.missing.includes('malware scanner signatures')) {
      console.warn('Malware scanner is not currently reachable. File uploads will remain unavailable until the scanner is ready.');
    }
  }
  if (production) { startupStage = 'maintenance initialization'; stopMaintenance = startMaintenance(); stopScrapeJobs = startScrapeWorker(); }
  startupStage = 'HTTP port binding';
  server.listen(port, host, () => console.log(`VoiceChatGLM application listening on ${host}:${port}`));
}
start().catch(error => {
  process.stderr.write(`Application startup failed during ${startupStage}: ${safeStartupError(error)}\n`);
  void closePool().finally(() => { process.exitCode = 1; });
});
