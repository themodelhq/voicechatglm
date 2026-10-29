const { Repository } = require('./db/repository.cjs');
const { getPool } = require('./db/pool.cjs');
const { objectStorageConfig, createObjectStore } = require('./files/object-storage.cjs');
const { policy } = require('./files/policy.cjs');

async function recoverAndCleanup(env = process.env) {
  const repository = new Repository(getPool(env));
  await repository.recoverStaleJobs(Math.max(60_000, Number(env.FILE_ANALYSIS_MAX_PROCESSING_MS || 45_000) * 2));
  const expired = await repository.cleanupExpired();
  const storage = objectStorageConfig(env); if (!storage.error) { const store = createObjectStore(storage); await Promise.allSettled([...expired.files.flatMap(file => [store.delete(file.storageKey), file.extractionStorageKey ? store.delete(file.extractionStorageKey) : undefined].filter(Boolean)), ...expired.resultStorageKeys.map(key => store.delete(key)), ...(expired.artifacts || []).map(artifact => store.delete(artifact.storageKey))]); }
  // Synchronous jobs are failed/cancelled in their request path. A separate worker is not started by this release.
  return expired.files.length;
}
function startMaintenance(env = process.env) { const intervalMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number(env.MAINTENANCE_INTERVAL_MS || 15 * 60 * 1000))); const timer = setInterval(() => { void recoverAndCleanup(env).catch(() => undefined); }, intervalMs); timer.unref?.(); return () => clearInterval(timer); }
module.exports = { recoverAndCleanup, startMaintenance };
