const { randomUUID } = require('node:crypto');
const { getPool } = require('./db/pool.cjs');
const { repositoryFor } = require('./auth.cjs');
const { fileAnalysisConfig } = require('./files/policy.cjs');
const { createObjectStore } = require('./files/object-storage.cjs');
const { loadRecords, buildCsvExport, buildXlsxExport } = require('./files/router.cjs');
const { analyzeRecords } = require('./files/analysis.cjs');
const { config: proxyConfig, callConfiguredModel } = require('./proxy-core.cjs');

const WORKER_ID = `file-analysis-${process.pid}-${randomUUID()}`;
const POLL_MS = 1500;
const LEASE_MS = 120000;
const HEARTBEAT_MS = 15000;

async function processJob(job) {
  const env = process.env;
  const feature = fileAnalysisConfig(env);
  if (!feature.enabled || feature.mode !== 'production') throw Object.assign(new Error('File analysis is not configured for background processing.'), { code: 'CAPABILITY_UNAVAILABLE' });
  const repository = repositoryFor(env);
  const store = createObjectStore(feature.storage);
  const request = job.request || {};
  const fileIds = await repository.analysisJobFileIds(job.id, job.user_id);
  if (!fileIds.length) throw Object.assign(new Error('The analysis job has no available files.'), { code: 'FILES_UNAVAILABLE' });
  const files = await repository.filesForOwner(job.user_id, fileIds);
  if (files.length !== fileIds.length) throw Object.assign(new Error('One or more selected files are no longer available.'), { code: 'FILES_UNAVAILABLE' });

  const controller = new AbortController();
  let heartbeatBusy = false;
  const initialLease = await repository.renewAnalysisJobLease(job.id, WORKER_ID, LEASE_MS);
  if (!initialLease) throw Object.assign(new Error('The analysis worker no longer owns this job lease.'), { code: 'JOB_LEASE_LOST' });
  if (initialLease.cancelRequested) controller.abort(Object.assign(new Error('Analysis was cancelled.'), { code: 'CANCELLED' }));
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      const lease = await repository.renewAnalysisJobLease(job.id, WORKER_ID, LEASE_MS);
      if (!lease || lease.cancelRequested) controller.abort(Object.assign(new Error('Analysis was cancelled.'), { code: 'CANCELLED' }));
    } catch (error) {
      console.error('[VoiceChatGLM file-analysis-worker] Lease renewal failed.', { jobId: job.id, code: error?.code || 'LEASE_RENEWAL_FAILED' });
    } finally { heartbeatBusy = false; }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    const records = await loadRecords(store, files, feature.policy, controller.signal, env);
    const model = proxyConfig(env);
    if (model.error) throw Object.assign(new Error('The configured model service is unavailable.'), { code: 'MODEL_CONFIGURATION' });
    const output = await analyzeRecords({
      ownerId: job.user_id, records, request,
      callModel: payload => callConfiguredModel(env, '/v1/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      }, model.timeout, controller.signal),
      signal: controller.signal
    });
    if (controller.signal.aborted || await repository.cancellationRequested(job.user_id, job.id)) throw Object.assign(new Error('Analysis was cancelled.'), { code: 'CANCELLED' });
    const finalLease = await repository.renewAnalysisJobLease(job.id, WORKER_ID, LEASE_MS);
    if (!finalLease) throw Object.assign(new Error('The analysis worker no longer owns this job lease.'), { code: 'JOB_LEASE_LOST' });
    if (finalLease.cancelRequested) throw Object.assign(new Error('Analysis was cancelled.'), { code: 'CANCELLED' });

    if (output.exportData) {
      const exportData = output.exportData;
      delete output.exportData;
      const base = exportData.baseFilename || 'analysis_results';
      const csvKey = store.keyFor(`artifacts/${job.user_id}/analysis/${job.id}/exports/${base}.csv`);
      const xlsxKey = store.keyFor(`artifacts/${job.user_id}/analysis/${job.id}/exports/${base}.xlsx`);
      const csvBytes = buildCsvExport(exportData.headers, exportData.rows);
      const xlsxBytes = await buildXlsxExport(exportData.headers, exportData.rows);
      await store.putBuffer(csvKey, csvBytes, 'text/csv; charset=utf-8', controller.signal);
      await store.putBuffer(xlsxKey, xlsxBytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', controller.signal);
      output.exports = [
        { format: 'csv', filename: `${base}.csv`, url: `/api/analysis/${job.id}/export.csv` },
        { format: 'xlsx', filename: `${base}.xlsx`, url: `/api/analysis/${job.id}/export.xlsx` }
      ];
      output.response += `\n\n**Download the extracted products:**\n\n- [Download CSV](${output.exports[0].url})\n- [Download Excel](${output.exports[1].url})`;
    }

    if (controller.signal.aborted || await repository.cancellationRequested(job.user_id, job.id)) throw Object.assign(new Error('Analysis was cancelled.'), { code: 'CANCELLED' });
    const resultKey = store.keyFor(`artifacts/${job.user_id}/analysis/${job.id}.json`);
    await store.putJson(resultKey, output, controller.signal);
    const persistenceLease = await repository.renewAnalysisJobLease(job.id, WORKER_ID, LEASE_MS);
    if (!persistenceLease) throw Object.assign(new Error('The analysis worker no longer owns this job lease.'), { code: 'JOB_LEASE_LOST' });
    if (persistenceLease.cancelRequested) throw Object.assign(new Error('Analysis was cancelled.'), { code: 'CANCELLED' });
    const status = output.partial ? 'partially_analyzed' : 'analysis_completed';

    // Persist the visible assistant response before publishing the terminal job state.
    if (request.conversationId && request.assistantMessageId) {
      const saved = await repository.updateConversationMessage({
        userId: job.user_id, conversationId: request.conversationId, id: request.assistantMessageId,
        content: output.response, status: output.partial ? 'partial' : 'complete',
        metadata: { route: 'file_analysis', analysisJobId: job.id, jobId: job.id, sources: output.sources,
          partial: Boolean(output.partial), truncated: Boolean(output.truncated), coverage: output.coverage || [],
          retention: output.retention, exports: output.exports || [] }
      });
      if (!saved) throw Object.assign(new Error('The completed analysis could not be attached to its conversation.'), { code: 'CONVERSATION_STORAGE' });
    }
    await Promise.all(files.map(file => repository.setFileStatus(job.user_id, file.id, status)));
    const finalized = await repository.completeAnalysisJob({ id: job.id, status, resultStorageKey: resultKey, workerId: WORKER_ID });
    if (!finalized) throw Object.assign(new Error('The analysis worker lost its job lease before finalization.'), { code: 'JOB_LEASE_LOST' });
  } catch (error) {
    const cancelled = error?.code === 'CANCELLED' || controller.signal.aborted;
    console.error('[VoiceChatGLM file-analysis-worker] Job processing failed.', {
      jobId: job.id,
      name: error?.name || 'Error',
      code: error?.code || 'ANALYSIS_FAILED',
      message: String(error?.message || 'Unknown error').slice(0, 300)
    });
    const terminal = cancelled ? 'cancelled' : 'failed';
    await repository.completeAnalysisJob({ id: job.id, status: terminal, errorCode: cancelled ? 'CANCELLED' : String(error?.code || 'ANALYSIS_FAILED').slice(0, 80), errorMessage: cancelled ? 'Analysis was cancelled.' : 'The file analysis could not be completed.', workerId: WORKER_ID }).catch(() => false);
    if (error?.code !== 'JOB_LEASE_LOST' && request.conversationId && request.assistantMessageId) {
      await repository.updateConversationMessage({
        userId: job.user_id, conversationId: request.conversationId, id: request.assistantMessageId,
        content: '', status: cancelled ? 'cancelled' : 'error',
        metadata: { route: 'file_analysis', analysisJobId: job.id, error: cancelled ? 'The file analysis was cancelled.' : 'The file analysis could not be completed.' }
      }).catch(() => undefined);
    }
  } finally { clearInterval(heartbeat); }
}

let active = false;
let stopped = false;
let timer;
async function tick() {
  if (active || stopped) return;
  active = true;
  try {
    const repository = repositoryFor(process.env);
    const job = await repository.claimAnalysisJob(WORKER_ID, LEASE_MS);
    if (job) await processJob(job);
  } catch (error) {
    console.error('[VoiceChatGLM file-analysis-worker] Queue poll/claim failed; will retry.', {
      name: error?.name || 'Error', code: error?.code || 'WORKER_POLL_FAILED'
    });
  } finally { active = false; }
}
function startAnalysisWorker() {
  if (timer) return stopAnalysisWorker;
  stopped = false;
  console.info('[VoiceChatGLM file-analysis-worker] Started durable queue polling.', { pollMs: POLL_MS, leaseMs: LEASE_MS });
  timer = setInterval(() => { void tick(); }, POLL_MS);
  timer.unref?.();
  void tick();
  return stopAnalysisWorker;
}
function stopAnalysisWorker() { stopped = true; if (timer) clearInterval(timer); timer = undefined; }
module.exports = { startAnalysisWorker, stopAnalysisWorker, processJob };
