const path = require('node:path');
const { objectStorageConfig } = require('./object-storage.cjs');
const { scannerConfig } = require('./scanner.cjs');

const MiB = 1024 * 1024;
const DEFAULTS = Object.freeze({
  maxFilesPerMessage: 3,
  maxIndividualBytes: 8 * MiB,
  maxTotalBytes: 15 * MiB,
  maxStoredFilesPerOwner: 12,
  maxStoredBytesPerOwner: 40 * MiB,
  retentionMs: 15 * 60 * 1000,
  maxExtractedCharacters: 120_000,
  maxAnalysisCharacters: 60_000,
  maxPdfPages: 40,
  maxCsvRows: 5_000,
  maxCsvColumns: 50,
  maxWorkbookSheets: 8,
  maxWorkbookRows: 5_000,
  maxWorkbookColumns: 50,
  maxWorkbookCells: 100_000,
  maxImagePixels: 20_000_000,
  maxUploadRequestsPerMinute: 10,
  maxProcessingMs: 45_000,
  // ZIP archives are constrained independently from ordinary attachment limits.
  maxZipCompressedBytes: 8 * MiB,
  maxZipEntries: 100,
  maxZipUncompressedBytes: 16 * MiB,
  maxZipMemberBytes: 2 * MiB,
  maxZipExpansionRatio: 100,
  maxZipDirectoryDepth: 12,
  maxZipNestedDepth: 0,
  maxZipSupportedFiles: 40,
  maxZipProcessingMs: 30_000,
  maxConcurrentProcessingJobsPerOwner: 2,
});

const TYPES = Object.freeze({
  '.pdf': 'pdf', '.docx': 'docx', '.pptx': 'pptx', '.txt': 'text', '.md': 'markdown', '.markdown': 'markdown', '.json': 'json', '.csv': 'csv', '.xlsx': 'xlsx',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.zip': 'zip',
});
function boundedInteger(value, fallback, minimum, maximum) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback; }
function policy(env = process.env) {
  const configured = {
    ...DEFAULTS,
    maxFilesPerMessage: boundedInteger(env.FILE_ANALYSIS_MAX_FILES, DEFAULTS.maxFilesPerMessage, 1, 10),
    maxIndividualBytes: boundedInteger(env.FILE_ANALYSIS_MAX_FILE_BYTES, DEFAULTS.maxIndividualBytes, 1024, 25 * MiB),
    maxTotalBytes: boundedInteger(env.FILE_ANALYSIS_MAX_TOTAL_BYTES, DEFAULTS.maxTotalBytes, 1024, 50 * MiB),
    retentionMs: boundedInteger(env.FILE_ANALYSIS_RETENTION_MS, DEFAULTS.retentionMs, 60_000, 24 * 60 * 60 * 1000),
    maxProcessingMs: boundedInteger(env.FILE_ANALYSIS_MAX_PROCESSING_MS, DEFAULTS.maxProcessingMs, 1_000, 120_000),
    maxZipCompressedBytes: boundedInteger(env.FILE_ANALYSIS_MAX_ZIP_COMPRESSED_BYTES, DEFAULTS.maxZipCompressedBytes, 1024, 25 * MiB),
    maxZipEntries: boundedInteger(env.FILE_ANALYSIS_MAX_ZIP_ENTRIES, DEFAULTS.maxZipEntries, 1, 500),
    maxZipUncompressedBytes: boundedInteger(env.FILE_ANALYSIS_MAX_ZIP_UNCOMPRESSED_BYTES, DEFAULTS.maxZipUncompressedBytes, 1024, 32 * MiB),
    maxZipMemberBytes: boundedInteger(env.FILE_ANALYSIS_MAX_ZIP_MEMBER_BYTES, DEFAULTS.maxZipMemberBytes, 1024, 8 * MiB),
    maxZipExpansionRatio: boundedInteger(env.FILE_ANALYSIS_MAX_ZIP_RATIO, DEFAULTS.maxZipExpansionRatio, 1, 200),
    maxZipDirectoryDepth: boundedInteger(env.FILE_ANALYSIS_MAX_ZIP_DEPTH, DEFAULTS.maxZipDirectoryDepth, 1, 32),
    maxZipSupportedFiles: boundedInteger(env.FILE_ANALYSIS_MAX_ZIP_SUPPORTED_FILES, DEFAULTS.maxZipSupportedFiles, 1, 100),
    maxZipProcessingMs: boundedInteger(env.FILE_ANALYSIS_MAX_ZIP_PROCESSING_MS, DEFAULTS.maxZipProcessingMs, 1_000, DEFAULTS.maxProcessingMs),
    maxConcurrentProcessingJobsPerOwner: boundedInteger(env.FILE_ANALYSIS_MAX_CONCURRENT_JOBS_PER_OWNER, DEFAULTS.maxConcurrentProcessingJobsPerOwner, 1, 8),
  };
  configured.maxZipCompressedBytes = Math.min(configured.maxIndividualBytes, configured.maxZipCompressedBytes);
  configured.maxZipProcessingMs = Math.min(configured.maxProcessingMs, configured.maxZipProcessingMs);
  configured.maxZipMemberBytes = Math.min(configured.maxZipMemberBytes, configured.maxZipUncompressedBytes);
  return configured;
}
function fileTypeForName(name) { return TYPES[path.extname(name || '').toLowerCase()] || undefined; }
function safeName(name) { const base = path.basename(typeof name === 'string' ? name : 'file').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').trim(); return (base || 'file').slice(0, 160); }
function signature(buffer) { return buffer.subarray(0, 4).toString('ascii'); }
function isText(buffer) { if (!buffer.length) return true; if (buffer.includes(0)) return false; const sample = buffer.subarray(0, Math.min(buffer.length, 4096)); let controls = 0; for (const byte of sample) if (byte < 9 || byte > 13 && byte < 32) controls += 1; return controls / sample.length < 0.02; }
function detectedType(buffer, filename) {
  const declared = fileTypeForName(filename); if (!declared) return { error: 'Unsupported file type.' };
  if (declared === 'pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-' ? { type: 'pdf' } : { error: 'The file extension does not match a PDF signature.' };
  if (declared === 'docx' || declared === 'xlsx' || declared === 'pptx' || declared === 'zip') return signature(buffer) === 'PK\x03\x04' || signature(buffer) === 'PK\x05\x06' ? { type: declared } : { error: declared === 'zip' ? 'The file extension does not match a ZIP signature.' : 'The file extension does not match an Office document signature.' };
  if (declared === 'image') {
    const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff; const webp = signature(buffer) === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    return png || jpeg || webp ? { type: 'image' } : { error: 'The file extension does not match a supported image signature.' };
  }
  return isText(buffer) ? { type: declared } : { error: 'Text-based files must contain decodable text, not binary data.' };
}
function invalidPolicyConfiguration(env) {
  const bounded = [['FILE_ANALYSIS_MAX_FILES', 1, 10], ['FILE_ANALYSIS_MAX_FILE_BYTES', 1024, 25 * MiB], ['FILE_ANALYSIS_MAX_TOTAL_BYTES', 1024, 50 * MiB], ['FILE_ANALYSIS_RETENTION_MS', 60_000, 24 * 60 * 60 * 1000], ['FILE_ANALYSIS_MAX_PROCESSING_MS', 1_000, 120_000], ['FILE_ANALYSIS_MAX_ZIP_COMPRESSED_BYTES', 1024, 25 * MiB], ['FILE_ANALYSIS_MAX_ZIP_ENTRIES', 1, 500], ['FILE_ANALYSIS_MAX_ZIP_UNCOMPRESSED_BYTES', 1024, 32 * MiB], ['FILE_ANALYSIS_MAX_ZIP_MEMBER_BYTES', 1024, 8 * MiB], ['FILE_ANALYSIS_MAX_ZIP_RATIO', 1, 200], ['FILE_ANALYSIS_MAX_ZIP_DEPTH', 1, 32], ['FILE_ANALYSIS_MAX_ZIP_SUPPORTED_FILES', 1, 100], ['FILE_ANALYSIS_MAX_ZIP_PROCESSING_MS', 1_000, DEFAULTS.maxProcessingMs], ['FILE_ANALYSIS_MAX_CONCURRENT_JOBS_PER_OWNER', 1, 8]];
  for (const [name, min, max] of bounded) if (env[name] !== undefined && (!Number.isInteger(Number(env[name])) || Number(env[name]) < min || Number(env[name]) > max)) return 'File-analysis limit configuration is invalid.';
  const individual = Number(env.FILE_ANALYSIS_MAX_FILE_BYTES || DEFAULTS.maxIndividualBytes); const compressed = Number(env.FILE_ANALYSIS_MAX_ZIP_COMPRESSED_BYTES || DEFAULTS.maxZipCompressedBytes); const total = Number(env.FILE_ANALYSIS_MAX_ZIP_UNCOMPRESSED_BYTES || DEFAULTS.maxZipUncompressedBytes); const member = Number(env.FILE_ANALYSIS_MAX_ZIP_MEMBER_BYTES || DEFAULTS.maxZipMemberBytes);
  if (compressed > individual || member > total) return 'File-analysis limit configuration is contradictory.';
  return undefined;
}
function fileAnalysisConfig(env = process.env) {
  if (env.FILE_ANALYSIS_ENABLED !== 'true') return { enabled: false, mode: 'disabled', error: 'File analysis is not configured on this proxy.' };
  const invalid = invalidPolicyConfiguration(env); if (invalid) return { enabled: false, mode: 'disabled', error: invalid };
  if (env.NODE_ENV !== 'production') return { enabled: true, mode: 'development', ownerMode: 'loopback-session', policy: policy(env) };
  const storage = objectStorageConfig(env); const scanner = scannerConfig(env);
  if (storage.error || scanner.error) return { enabled: false, mode: 'disabled', error: 'File analysis requires configured private object storage and a malware scanner.' };
  return { enabled: true, mode: 'production', ownerMode: 'authenticated-user', storage, scanner, policy: policy(env) };
}
module.exports = { DEFAULTS, TYPES, policy, fileTypeForName, safeName, detectedType, fileAnalysisConfig, invalidPolicyConfiguration, isText };
