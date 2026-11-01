const { runMigrations } = require('./db/migrate.cjs');
const { closePool } = require('./db/pool.cjs');
const { startScrapeWorker } = require('./scrape-jobs.cjs');
const { webRetrievalConfig } = require('./web-retrieval.cjs');

let stopWorker = () => undefined;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info('[VoiceChatGLM scrape-worker] Shutdown requested.', { signal });
  stopWorker();
  await closePool().catch(error => {
    console.error('[VoiceChatGLM scrape-worker] Database pool shutdown failed.', {
      message: String(error?.message || 'unknown').slice(0, 200)
    });
  });
  process.exit(0);
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

async function start() {
  const retrieval = webRetrievalConfig(process.env);
  console.info('[VoiceChatGLM scrape-worker] Initializing dedicated worker.', {
    buildCommit: process.env.RENDER_GIT_COMMIT || process.env.COMMIT_REF || process.env.SOURCE_VERSION || 'unknown',
    retrievalEnabled: retrieval.enabled, retrievalConfigured: retrieval.configured,
    configuredPageLimit: retrieval.maxPages, concurrency: retrieval.concurrency,
    workerMode: 'dedicated-background'
  });
  await runMigrations();
  stopWorker = startScrapeWorker();
  console.info('[VoiceChatGLM scrape-worker] Dedicated worker is ready.');
}

start().catch(async error => {
  console.error('[VoiceChatGLM scrape-worker] Startup failed.', {
    name: error?.name || 'Error',
    code: error?.code,
    message: String(error?.message || 'unknown').replace(/[\\r\\n\\t]+/g, ' ').slice(0, 300)
  });
  await closePool().catch(() => undefined);
  process.exit(1);
});
