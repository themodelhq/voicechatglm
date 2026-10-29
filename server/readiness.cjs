/* Safe, cached dependency-readiness diagnostics. No credential values are returned. */
const { databaseConfig, databaseReady } = require('./db/pool.cjs');
const { migrationStatus } = require('./db/migrate.cjs');
const { rateLimitConfig, limiterFor, limiterAvailable } = require('./rate-limit.cjs');
const { fileAnalysisConfig } = require('./files/policy.cjs');
const { objectStorageConfig, createObjectStore } = require('./files/object-storage.cjs');
const { scannerConfig, probeScanner } = require('./files/scanner.cjs');
const { ocrConfig } = require('./advanced-services.cjs');
const { probeLocalOcr } = require('./local-ocr.cjs');
const { probeLocalPdfOcr } = require('./pdf-ocr.cjs');

let cached; let expiresAt = 0; let inFlight;
function modelEndpoint(env) { try { const url = new URL(String(env.VOICECHATGLM_API_URL || '')); return ['http:', 'https:'].includes(url.protocol) && (env.NODE_ENV !== 'production' || url.protocol === 'https:') && !url.username && !url.password ? url.toString().replace(/\/$/, '') : undefined; } catch { return undefined; } }
function modelConfigured(env) { return Boolean(modelEndpoint(env)); }
function booleanState(value) { return value ? 'reachable' : 'unreachable'; }
async function within(operation, milliseconds) { const controller = new AbortController(); let rejectTimeout; const expired = new Promise((_, reject) => { rejectTimeout = reject; }); const timer = setTimeout(() => { controller.abort(); rejectTimeout(new Error('readiness probe timed out.')); }, milliseconds); try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), expired]); } finally { clearTimeout(timer); } }
async function probeModelReady(env, signal) {
  const endpoint = modelEndpoint(env); const key = typeof env.VOICECHATGLM_API_KEY === 'string' && env.VOICECHATGLM_API_KEY.trim() ? env.VOICECHATGLM_API_KEY : undefined; if (!endpoint || !key) return false;
  try { const result = await fetch(`${endpoint}/ready`, { method: 'GET', signal, headers: { 'X-API-Key': key, Accept: 'application/json' } }); return result.ok; } catch { return false; }
}
async function buildReadinessReport(env = process.env) {
  const database = databaseConfig(env); const limiter = rateLimitConfig(env); const fileFeature = fileAnalysisConfig(env); const storage = objectStorageConfig(env); const scanner = scannerConfig(env); const ocr = ocrConfig(env); const endpointConfigured = modelConfigured(env); const credentialsConfigured = Boolean(typeof env.VOICECHATGLM_API_KEY === 'string' && env.VOICECHATGLM_API_KEY.trim());
  let databaseReachable = false; let migrationsComplete = false;
  if (!database.error) { databaseReachable = await databaseReady(env); if (databaseReachable) migrationsComplete = Boolean((await migrationStatus()).ready); }
  let limiterReachable = false; if (!limiter.error) limiterReachable = await limiterAvailable(limiterFor(limiter));
  let storageReachability = storage.error ? 'not_configured' : 'not_checked'; let scannerReachability = scanner.error ? 'not_configured' : 'not_checked'; let scannerSignatures = scanner.error ? 'not_configured' : 'not_checked';
  // An enabled production feature performs a safe private canary write/read/delete and
  // a ClamAV PING/VERSION check. Disabled features do not generate storage/scanner traffic.
  if (fileFeature.enabled && fileFeature.mode === 'production') {
    storageReachability = await within(signal => createObjectStore(storage).verifyReadWriteDelete(signal), 8_000).then(() => 'reachable', () => 'unreachable');
    const scannerResult = await within(signal => probeScanner(scanner, signal), Math.min(scanner.timeoutMs, 8_000)).then(result => ({ reachability: 'reachable', signatures: result.signatures || 'unknown' }), () => ({ reachability: 'unreachable', signatures: 'unavailable' })); scannerReachability = scannerResult.reachability; scannerSignatures = scannerResult.signatures;
  }
  const modelReachability = endpointConfigured && credentialsConfigured ? booleanState(await within(signal => probeModelReady(env, signal), 8_000)) : 'not_configured';
  let ocrReachability = ocr.disabledByPolicy ? 'disabled' : !ocr.configured ? 'not_configured' : 'not_verified'; let ocrDetail;
  if (ocr.enabled && ocr.configured && ocr.provider === 'tesseract_js') { const result = await within(signal => probeLocalOcr({ configuration: ocr, signal }), Math.min(ocr.timeoutMs, 15_000)).then(value => value, () => undefined); ocrReachability = result?.ready ? 'reachable' : 'unreachable'; ocrDetail = result?.reason; }
  let pdfOcrReachability = ocr.disabledByPolicy ? 'disabled' : ocr.provider !== 'tesseract_js' ? 'not_verified' : !ocr.supportsPdf ? 'not_configured' : 'not_verified'; let pdfOcrDetail;
  if (ocr.enabled && ocr.provider === 'tesseract_js' && ocr.supportsPdf) { const result = await within(signal => probeLocalPdfOcr({ configuration: { local: ocr, pdf: ocr.pdf }, signal }), Math.min(ocr.pdf.timeoutMs, 30_000)).then(value => value, () => undefined); pdfOcrReachability = result?.ready ? 'reachable' : 'unreachable'; pdfOcrDetail = result?.reason; }
  const fileDependenciesReady = !fileFeature.enabled || storageReachability === 'reachable' && scannerReachability === 'reachable' && scannerSignatures === 'available';
  const ocrDependenciesReady = ocr.disabledByPolicy || ocr.enabled && ocrReachability === 'reachable' && (ocr.provider !== 'tesseract_js' || pdfOcrReachability === 'reachable');
  const report = {
    ready: databaseReachable && migrationsComplete && limiterReachable && modelReachability === 'reachable' && fileDependenciesReady && ocrDependenciesReady,
    database: { configured: !database.error, reachability: booleanState(databaseReachable), migrations: migrationsComplete ? 'complete' : databaseReachable ? 'incomplete' : 'not_checked' },
    rateLimiter: { configured: !limiter.error, reachability: booleanState(limiterReachable) },
    fileAnalysis: { enabled: fileFeature.enabled, mode: fileFeature.mode, storage: { configured: !storage.error, reachability: storageReachability }, scanner: { configured: !scanner.error, reachability: scannerReachability, signatures: scannerSignatures } },
    ocr: { profile: ocr.profile, enabled: ocr.enabled, disabledByPolicy: ocr.disabledByPolicy, configured: ocr.configured, provider: ocr.provider, readiness: ocrReachability, pdf: { supported: Boolean(ocr.supportsPdf), readiness: pdfOcrReachability, ...(pdfOcrDetail ? { reason: pdfOcrDetail } : {}) }, ...(ocrDetail ? { reason: ocrDetail } : {}) },
    model: { endpointConfigured, credentialsConfigured, readinessProbe: modelReachability },
  };
  return report;
}
async function verifyProductionFileAnalysisDependencies(env = process.env) {
  const report = await buildReadinessReport(env); const missing = [];
  if (!report.database.configured || report.database.reachability !== 'reachable' || report.database.migrations !== 'complete') missing.push('PostgreSQL migrations');
  if (!report.rateLimiter.configured || report.rateLimiter.reachability !== 'reachable') missing.push('shared Redis limiter');
  if (!report.fileAnalysis.enabled || report.fileAnalysis.mode !== 'production') missing.push('production file-analysis configuration');
  if (report.fileAnalysis.storage.reachability !== 'reachable') missing.push('private object storage read/write/delete');
  if (report.fileAnalysis.scanner.reachability !== 'reachable' || report.fileAnalysis.scanner.signatures !== 'available') missing.push('malware scanner signatures');
  if (!report.ocr.disabledByPolicy && (!report.ocr.enabled || !report.ocr.configured)) missing.push('valid OCR configuration');
  if (report.ocr.enabled && report.ocr.readiness !== 'reachable') missing.push('OCR engine and English language data');
  if (report.ocr.enabled && report.ocr.provider === 'tesseract_js' && report.ocr.pdf.readiness !== 'reachable') missing.push('PDF renderer and scanned-PDF OCR');
  if (report.model.readinessProbe !== 'reachable') missing.push('protected model readiness');
  return { ready: missing.length === 0, missing, report };
}
async function readinessReport(env = process.env, { maxAgeMs = 30_000 } = {}) {
  if (cached && Date.now() < expiresAt) return cached;
  if (!inFlight) inFlight = buildReadinessReport(env).then(report => { cached = report; expiresAt = Date.now() + maxAgeMs; return report; }).finally(() => { inFlight = undefined; });
  return inFlight;
}
function resetReadinessForTests() { cached = undefined; expiresAt = 0; inFlight = undefined; }
module.exports = { buildReadinessReport, verifyProductionFileAnalysisDependencies, readinessReport, resetReadinessForTests };
