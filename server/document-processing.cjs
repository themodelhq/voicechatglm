/* Shared scanner-gated document extraction facade for chat analysis and knowledge jobs.
 * Callers must perform owner and clean-scan checks before passing private bytes here. */
const { createHash } = require('node:crypto');
const { ocrConfig, runOcr } = require('./advanced-services.cjs');
const { redactSecrets } = require('./files/zipAnalysis.cjs');

function processingError(message, code, status = 503) { return Object.assign(new Error(message), { code, status }); }
function supportedOcrType(type, contentType) { return String(type || '').toLowerCase() === 'image' || String(type || '').toLowerCase() === 'pdf' || ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(String(contentType || '').toLowerCase()); }
function pageHash(text) { return createHash('sha256').update(String(text || '')).digest('hex'); }
function boundedDocumentText(pages, maximum) {
  let remaining = maximum; let truncated = false; const retained = [];
  for (const page of pages) {
    const value = String(page.text || ''); const text = value.slice(0, Math.max(0, remaining));
    if (text.length < value.length) truncated = true;
    remaining -= text.length; retained.push({ ...page, text });
    if (remaining <= 0 && value.length) truncated = true;
  }
  return { pages: retained, truncated };
}
// OCR/native PDF page text is untrusted just like ordinary uploaded document text. Redact it
// before hashing, persistence, Knowledge chunks, or a model-facing payload; never retain raw
// page text as a provenance field after an exclusion decision.
function redactDocumentPages(rawPages, filename) {
  const notices = []; let redactedAny = false; let excludedAny = false;
  const pages = (rawPages || []).map(page => {
    const redacted = redactSecrets(String(page?.text || ''), filename);
    if (redacted.excluded) {
      excludedAny = true;
      notices.push(`Page ${page?.pageNumber || '?'} was excluded because sensitive data could not be safely redacted.`);
      return { ...page, text: '', status: 'excluded', redacted: false, excluded: true };
    }
    if (redacted.redacted) {
      redactedAny = true;
      return { ...page, text: redacted.text, redacted: true };
    }
    return { ...page, text: String(page?.text || '') };
  });
  if (redactedAny) notices.push('Sensitive values were redacted before analysis.');
  return { pages, notices: [...new Set(notices)], redacted: redactedAny, excluded: excludedAny };
}
function extractionFromOcr(result, { filename, maximumCharacters }) {
  const protectedPages = redactDocumentPages(result.pages || [], filename);
  const bounded = boundedDocumentText(protectedPages.pages, maximumCharacters);
  const pages = bounded.pages.map(page => ({
    pageNumber: page.pageNumber,
    text: page.text,
    extractionMethod: page.extractionMethod || 'ocr',
    status: page.status || (page.text ? 'completed' : 'partial'),
    // Confidence is copied only when the actual OCR engine returned one; native extraction
    // and reconciliation never invent a score.
    ...(page.confidence === undefined ? {} : { confidence: page.confidence }),
    provenance: { nativeTextUsed: Boolean(page.nativeTextUsed), ocrUsed: Boolean(page.ocrUsed), mixedContent: Boolean(page.mixedContent), rasterDetected: Boolean(page.rasterDetected), ...(page.pageClassification ? { pageClassification: page.pageClassification } : {}), ...(Number.isInteger(page.rasterOperations) ? { rasterOperations: page.rasterOperations } : {}), ...(page.errorCode ? { errorCode: page.errorCode } : {}) },
    ...(page.redacted ? { redacted: true } : {}),
    ...(page.excluded ? { excluded: true } : {}),
    contentHash: pageHash(page.text),
  }));
  const readable = pages.filter(page => page.text.trim());
  const text = readable.map(page => `[Page ${page.pageNumber}]\n${page.text}`).join('\n\n');
  const notices = [...(result.notices || []), ...protectedPages.notices];
  if (!readable.length) notices.push('No readable text was detected in this document.');
  return {
    extraction: {
      text,
      analysisAvailable: readable.length > 0,
      contentAnalysisAvailable: readable.length > 0,
      truncated: Boolean(result.truncated || bounded.truncated),
      notices: [...new Set(notices)].slice(0, 30),
      sources: readable.map(page => ({ filename, location: `page ${page.pageNumber} (${page.extractionMethod})` })),
      pages,
      ...(protectedPages.redacted ? { redacted: true } : {}),
      processing: {
        engine: result.engine,
        engineVersion: result.engineVersion,
        ...(result.renderer ? { renderer: result.renderer, rendererVersion: result.rendererVersion } : {}),
        status: result.status,
      },
    },
    pages,
    ocr: result,
  };
}
async function processOcrDocument({ bytes, filename, type, contentType, configuration = ocrConfig(), signal, maximumCharacters = 500_000 }) {
  if (!supportedOcrType(type, contentType)) throw processingError('This document type has no OCR processing path.', 'OCR_UNSUPPORTED_TYPE', 400);
  if (!configuration.available) throw processingError(configuration.reason || 'OCR is unavailable.', 'OCR_UNAVAILABLE');
  const normalizedType = String(type || '').toLowerCase(); const normalizedContentType = normalizedType === 'pdf' ? 'application/pdf' : contentType;
  if (normalizedType === 'pdf' && !configuration.supportsPdf) throw processingError(configuration.pdfReason || 'PDF OCR rendering is unavailable.', 'OCR_PDF_RENDERER_UNAVAILABLE');
  const result = await runOcr({ bytes, contentType: normalizedContentType, filename, checksum: createHash('sha256').update(bytes).digest('hex'), configuration, signal });
  return extractionFromOcr(result, { filename, maximumCharacters });
}
module.exports = { supportedOcrType, processOcrDocument, extractionFromOcr, redactDocumentPages, pageHash, boundedDocumentText, processingError };
