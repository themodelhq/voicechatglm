// Development-only loopback staging adapter. Production routing uses PostgreSQL metadata plus private object storage instead.
const { randomUUID } = require('node:crypto');

const records = new Map();
const uploadWindows = new Map();
const processingJobs = new Map();
function now() { return Date.now(); }
function dispose(record) { if (!record) return; record.buffer = undefined; record.archive = undefined; record.extraction = undefined; }
function prune() {
  const timestamp = now();
  for (const [id, record] of records) if (record.expiresAt <= timestamp) { records.delete(id); dispose(record); }
  for (const [owner, window] of uploadWindows) if (window.resetAt <= timestamp) uploadWindows.delete(owner);
}
function ownerRecords(ownerId) { prune(); return [...records.values()].filter(record => record.ownerId === ownerId); }
function allowUpload(ownerId, policy) {
  prune(); const timestamp = now(); const current = uploadWindows.get(ownerId);
  if (!current || current.resetAt <= timestamp) { uploadWindows.set(ownerId, { count: 1, resetAt: timestamp + 60_000 }); return true; }
  if (current.count >= policy.maxUploadRequestsPerMinute) return false; current.count += 1; return true;
}
function acquireProcessing(ownerId, policy) { const current = processingJobs.get(ownerId) || 0; if (current >= policy.maxConcurrentProcessingJobsPerOwner) return false; processingJobs.set(ownerId, current + 1); return true; }
function releaseProcessing(ownerId) { const current = processingJobs.get(ownerId) || 0; if (current <= 1) processingJobs.delete(ownerId); else processingJobs.set(ownerId, current - 1); }
function store(ownerId, uploads, policy) {
  const existing = ownerRecords(ownerId); const incomingBytes = uploads.reduce((total, upload) => total + upload.buffer.length, 0); const existingBytes = existing.reduce((total, record) => total + record.size, 0);
  if (existing.length + uploads.length > policy.maxStoredFilesPerOwner || existingBytes + incomingBytes > policy.maxStoredBytesPerOwner) throw new Error('Temporary file staging capacity is full. Delete files or wait for expiry before uploading more.');
  const uploadedAt = new Date().toISOString(); const expiresAt = now() + policy.retentionMs;
  return uploads.map(upload => {
    const id = randomUUID();
    // ZIP bytes are not needed after safe inspection/extraction. Retain only bounded extracted text/manifest for authorized follow-up questions.
    const record = { id, ownerId, filename: upload.filename, type: upload.type, size: upload.buffer.length, uploadedAt, expiresAt, state: upload.extraction.processingStatus || (upload.extraction.analysisAvailable ? 'ready' : 'unavailable'), extraction: upload.extraction, ...(upload.archive ? { archive: upload.archive } : {}), ...(upload.type === 'zip' ? {} : { buffer: upload.buffer }) };
    records.set(id, record); return publicRecord(record);
  });
}
function getOwned(ownerId, id) { prune(); const record = records.get(id); return record && record.ownerId === ownerId ? record : undefined; }
function getManyOwned(ownerId, ids) { return ids.map(id => getOwned(ownerId, id)).filter(Boolean); }
function removeOwned(ownerId, id) { const record = getOwned(ownerId, id); if (!record) return false; records.delete(id); dispose(record); return true; }
function removeManyOwned(ownerId, ids) { ids.forEach(id => removeOwned(ownerId, id)); }
function publicRecord(record) {
  return { id: record.id, filename: record.filename, type: record.type, size: record.size, uploadedAt: record.uploadedAt, expiresAt: new Date(record.expiresAt).toISOString(), state: record.state, analysisAvailable: record.extraction.analysisAvailable, inspectionAvailable: Boolean(record.extraction.inspectionAvailable), contentAnalysisAvailable: Boolean(record.extraction.contentAnalysisAvailable ?? record.extraction.analysisAvailable), processingStatus: record.extraction.processingStatus || record.state, notices: record.extraction.notices, sources: record.extraction.sources, truncated: record.extraction.truncated, ...(record.archive ? { archive: record.archive.manifest } : {}) };
}
function resetForTests() { for (const record of records.values()) dispose(record); records.clear(); uploadWindows.clear(); processingJobs.clear(); }
module.exports = { allowUpload, acquireProcessing, releaseProcessing, store, getOwned, getManyOwned, removeOwned, removeManyOwned, publicRecord, resetForTests, prune };
