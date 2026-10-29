/* Reproducible in-process PDF page extraction and raster OCR.
 * pdfjs-dist parses untrusted private bytes and @napi-rs/canvas rasterises pages in memory.
 * There is no shell, user-controlled executable/path, browser request, URL fetch, or system PDF tool. */
const fs = require('node:fs');
const path = require('node:path');
const { imageSize } = require('image-size');
const { recognizeLocalImage } = require('./local-ocr.cjs');

const PDF_SMOKE_FIXTURE = path.join(__dirname, 'fixtures', 'ocr-pdf-smoke.pdf');
function boundedInteger(env, name, fallback, minimum, maximum) { const raw = env?.[name]; if (raw === undefined || raw === '') return fallback; const value = Number(raw); return Number.isInteger(value) && value >= minimum && value <= maximum ? value : undefined; }
function boundedNumber(env, name, fallback, minimum, maximum) { const raw = env?.[name]; if (raw === undefined || raw === '') return fallback; const value = Number(raw); return Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined; }
function failure(message, code, status = 503) { return Object.assign(new Error(message), { code, status }); }
function rendererInstalled() {
  try {
    const pdfModule = require.resolve('pdfjs-dist/legacy/build/pdf.mjs'); const packageFile = require.resolve('pdfjs-dist/package.json'); const canvas = require('@napi-rs/canvas');
    if (typeof canvas?.createCanvas !== 'function') return undefined;
    return { pdfModule, packageDirectory: path.dirname(packageFile), createCanvas: canvas.createCanvas, version: require('pdfjs-dist/package.json').version };
  } catch { return undefined; }
}
function pdfOcrConfig(env = process.env) {
  const renderer = rendererInstalled(); const maxPdfPages = boundedInteger(env, 'KNOWLEDGE_OCR_MAX_PDF_PAGES', 20, 1, 40); const timeoutMs = boundedInteger(env, 'KNOWLEDGE_OCR_PDF_TIMEOUT_MS', 90_000, 5_000, 180_000); const renderScale = boundedNumber(env, 'KNOWLEDGE_OCR_PDF_RENDER_SCALE', 1.5, 0.75, 2.5); const maxPagePixels = boundedInteger(env, 'KNOWLEDGE_OCR_MAX_RENDERED_PAGE_PIXELS', 10_000_000, 100_000, 20_000_000); const maxTotalPixels = boundedInteger(env, 'KNOWLEDGE_OCR_MAX_TOTAL_RENDERED_PIXELS', 40_000_000, 100_000, 60_000_000); const maxPagePoints = boundedInteger(env, 'KNOWLEDGE_OCR_MAX_PDF_PAGE_POINTS', 14_400, 1_000, 28_800); const minNativeCharacters = boundedInteger(env, 'KNOWLEDGE_OCR_MIN_NATIVE_PAGE_CHARACTERS', 12, 1, 2_000); const maxOutputCharacters = boundedInteger(env, 'KNOWLEDGE_OCR_MAX_PDF_OUTPUT_CHARACTERS', 500_000, 1_000, 1_000_000); const configured = Boolean(renderer && maxPdfPages && timeoutMs && renderScale && maxPagePixels && maxTotalPixels && maxPagePoints && minNativeCharacters && maxOutputCharacters && maxTotalPixels >= maxPagePixels);
  return { renderer, rendererVersion: renderer?.version, configured, timeoutMs: timeoutMs || 90_000, maxPdfPages: maxPdfPages || 20, renderScale: renderScale || 1.5, maxPagePixels: maxPagePixels || 10_000_000, maxTotalPixels: maxTotalPixels || 40_000_000, maxPagePoints: maxPagePoints || 14_400, minNativeCharacters: minNativeCharacters || 12, maxOutputCharacters: maxOutputCharacters || 500_000, reason: !renderer ? 'The package-managed PDF.js renderer or canvas runtime is unavailable.' : !maxPdfPages || !timeoutMs || !renderScale || !maxPagePixels || !maxTotalPixels || !maxPagePoints || !minNativeCharacters || !maxOutputCharacters || maxTotalPixels < maxPagePixels ? 'PDF OCR resource limits are invalid.' : undefined };
}
async function importPdfJs(renderer) { try { return await import(renderer.pdfModule); } catch { throw failure('The package-managed PDF renderer could not be loaded.', 'OCR_PDF_RENDERER_UNAVAILABLE'); } }
function cleanText(value, maximum) { return String(value || '').replace(/\u0000/g, '').replace(/\r/g, '').replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, maximum); }
function pageText(content, maximum) { const parts = Array.isArray(content?.items) ? content.items : []; let text = ''; for (const item of parts) { const value = typeof item?.str === 'string' ? item.str : ''; const suffix = item?.hasEOL ? '\n' : value ? ' ' : ''; const remaining = Math.max(0, maximum + 1 - text.length); if (remaining) text += value.slice(0, remaining); if (text.length < maximum + 1 && suffix) text += suffix; if (text.length >= maximum) break; } return cleanText(text, maximum); }
function normalizedLine(value) { return String(value || '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim(); }
function textLines(value) { return String(value || '').split(/\n+/).map(line => line.trim()).filter(Boolean); }
/* OCR of a rendered mixed page also sees the selectable layer. Remove only exact normalized
 * line duplicates (and a bounded exact phrase match), leaving short/repeated table values intact. */
function reconcileMixedText(nativeText, ocrText, maximum) {
  const native = cleanText(nativeText, maximum); const ocr = cleanText(ocrText, maximum); if (!native) return { text: ocr, ocrSupplement: ocr, duplicateLinesRemoved: 0 };
  const nativeLines = textLines(native); const nativeNormalized = new Set(nativeLines.map(normalizedLine).filter(Boolean)); const nativePhrases = new Set(nativeLines.map(normalizedLine).filter(line => line.length >= 12)); const retained = []; let duplicateLinesRemoved = 0;
  for (const line of textLines(ocr)) {
    const normalized = normalizedLine(line);
    const duplicate = normalized && (nativeNormalized.has(normalized) || normalized.length >= 12 && nativePhrases.has(normalized));
    if (duplicate) { duplicateLinesRemoved += 1; continue; }
    retained.push(line);
  }
  const ocrSupplement = retained.join('\n').slice(0, Math.max(0, maximum - native.length));
  return { text: ocrSupplement ? `${native}\n\n[OCR supplement]\n${ocrSupplement}`.slice(0, maximum) : native, ocrSupplement, duplicateLinesRemoved };
}
function isAbort(signal) { return Boolean(signal?.aborted); }
async function withLifecycle(operation, { signal, timeoutMs, cancel }) {
  if (isAbort(signal)) { cancel?.(); throw failure('Document processing was cancelled.', 'CANCELLED', 499); }
  let timer; let abort; let settled = false;
  const cancellation = new Promise((_, reject) => { abort = () => { if (settled) return; cancel?.(); reject(failure('Document processing was cancelled.', 'CANCELLED', 499)); }; signal?.addEventListener('abort', abort, { once: true }); });
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { if (settled) return; cancel?.(); reject(failure('PDF processing timed out.', 'OCR_PDF_TIMEOUT', 504)); }, timeoutMs); });
  try { return await Promise.race([Promise.resolve().then(operation), cancellation, timeout]); }
  finally { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
function pdfError(error) { if (error?.code) return error; const name = String(error?.name || ''); const message = String(error?.message || ''); if (/password|encrypted/i.test(name + message)) return failure('Encrypted or password-protected PDFs are not supported.', 'OCR_PDF_ENCRYPTED', 400); if (/invalid|format|xref|corrupt|syntax/i.test(name + message)) return failure('The PDF is malformed or unsupported.', 'OCR_PDF_INVALID', 400); return failure('PDF rendering failed.', 'OCR_PDF_RENDER_FAILED'); }
async function openPdf(bytes, configuration, signal) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw failure('PDF input is invalid.', 'OCR_PDF_INVALID', 400);
  if (!configuration?.renderer) throw failure(configuration?.reason || 'PDF rendering is unavailable.', 'OCR_PDF_RENDERER_UNAVAILABLE');
  const pdfjs = await importPdfJs(configuration.renderer); let loadingTask;
  try {
    loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, stopAtErrors: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: `${configuration.renderer.packageDirectory}${path.sep}standard_fonts${path.sep}` }); const loadingPromise = loadingTask.promise; loadingPromise.catch(() => undefined);
    const document = await withLifecycle(() => loadingPromise, { signal, timeoutMs: configuration.timeoutMs, cancel: () => { void loadingTask?.destroy?.(); } });
    const count = Number(document?.numPages || 0); if (!Number.isInteger(count) || count < 1 || count > configuration.maxPdfPages) { await document?.destroy?.().catch(() => undefined); throw failure(`PDF exceeds the ${configuration.maxPdfPages}-page processing limit.`, 'OCR_PDF_PAGE_LIMIT', 400); }
    return { document, count, pdfjs };
  } catch (error) { await loadingTask?.destroy?.().catch(() => undefined); throw pdfError(error); }
}
async function extractNativePdfPages({ bytes, configuration = pdfOcrConfig(), signal }) {
  let opened; try { opened = await openPdf(bytes, configuration, signal); const pages = []; for (let index = 1; index <= opened.count; index += 1) { if (isAbort(signal)) throw failure('Document processing was cancelled.', 'CANCELLED', 499); const page = await withLifecycle(() => opened.document.getPage(index), { signal, timeoutMs: configuration.timeoutMs, cancel: () => { void opened.document?.destroy?.(); } }); try { const content = await withLifecycle(() => page.getTextContent(), { signal, timeoutMs: configuration.timeoutMs, cancel: () => { void opened.document?.destroy?.(); } }); const text = pageText(content, configuration.maxOutputCharacters); pages.push({ pageNumber: index, text, extractionMethod: 'native_text', status: text ? 'completed' : 'partial', nativeTextUsed: Boolean(text), ocrUsed: false, mixedContent: false }); } finally { page.cleanup?.(); } }
    return { pages, pageCount: opened.count, rendererVersion: configuration.rendererVersion };
  } catch (error) { throw pdfError(error); } finally { await opened?.document?.destroy?.().catch(() => undefined); }
}
function renderedViewport(page, configuration) { const base = page.getViewport({ scale: 1 }); const basePixels = Math.ceil(base.width) * Math.ceil(base.height); if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width < 1 || base.height < 1 || base.width > configuration.maxPagePoints || base.height > configuration.maxPagePoints || !Number.isSafeInteger(basePixels)) throw failure('PDF page dimensions exceed safe limits.', 'OCR_PDF_DIMENSION_LIMIT', 400); const scale = Math.min(configuration.renderScale, Math.sqrt(configuration.maxPagePixels / basePixels)); if (!Number.isFinite(scale) || scale <= 0) throw failure('PDF page dimensions exceed safe limits.', 'OCR_PDF_DIMENSION_LIMIT', 400); const viewport = page.getViewport({ scale }); const width = Math.ceil(viewport.width); const height = Math.ceil(viewport.height); const pixels = width * height; if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > configuration.maxPagePixels) throw failure('Rendered PDF page exceeds safe pixel limits.', 'OCR_PDF_PIXEL_LIMIT', 400); return { viewport, width, height, pixels, downscaled: scale < configuration.renderScale };
}
async function classifyPage({ page, pdfjs, nativeText, configuration, signal, document }) {
  const imageOps = new Set(['paintImageMaskXObject', 'paintImageMaskXObjectGroup', 'paintImageXObject', 'paintInlineImageXObject', 'paintInlineImageXObjectGroup', 'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintSolidColorImageMask'].map(name => pdfjs.OPS?.[name]).filter(Number.isInteger));
  try {
    const operators = await withLifecycle(() => page.getOperatorList(), { signal, timeoutMs: configuration.timeoutMs, cancel: () => { void document?.destroy?.(); } });
    const rasterOperations = (operators?.fnArray || []).filter(operator => imageOps.has(operator)).length;
    const nativeBelowThreshold = Boolean(nativeText && nativeText.length < configuration.minNativeCharacters);
    return { rasterDetected: rasterOperations > 0, rasterOperations, nativeBelowThreshold, classification: nativeText ? rasterOperations ? 'mixed' : nativeBelowThreshold ? 'ambiguous' : 'native' : rasterOperations ? 'scanned' : 'blank' };
  } catch (error) {
    return { rasterDetected: true, rasterOperations: 0, classification: nativeText ? 'mixed_ambiguous' : 'scanned_ambiguous', classificationError: pdfError(error).code };
  }
}
async function renderPageOcr({ page, pdf, local, signal, remaining, document }) {
  const geometry = renderedViewport(page, pdf); const canvas = pdf.renderer.createCanvas(geometry.width, geometry.height); let renderTask;
  try {
    const context = canvas.getContext('2d', { alpha: false }); renderTask = page.render({ canvasContext: context, viewport: geometry.viewport, background: 'white' }); await withLifecycle(() => renderTask.promise, { signal, timeoutMs: pdf.timeoutMs, cancel: () => renderTask?.cancel?.() || void document?.destroy?.() });
    const image = canvas.toBuffer('image/png'); if (!Buffer.isBuffer(image) || !image.length || image.length > local.maxImageBytes) throw failure('Rendered PDF page exceeds the image-byte limit.', 'OCR_RENDERED_IMAGE_LIMIT', 400); const measured = imageSize(image); if (Number(measured?.width || 0) * Number(measured?.height || 0) > local.maxImagePixels) throw failure('Rendered PDF page exceeds OCR pixel limits.', 'OCR_PDF_PIXEL_LIMIT', 400);
    if (!remaining) return { text: '', status: 'partial', outputLimited: true, downscaled: geometry.downscaled };
    const ocr = await recognizeLocalImage({ bytes: image, contentType: 'image/png', configuration: { ...local, maxOutputCharacters: Math.min(local.maxOutputCharacters, remaining) }, signal });
    return { text: ocr.pages[0]?.text || '', status: ocr.status, confidence: ocr.pages[0]?.confidence, downscaled: geometry.downscaled };
  } finally { canvas.dispose?.(); }
}
async function recognizePdf({ bytes, configuration, signal }) {
  const pdf = configuration?.pdf || configuration?.pdfConfiguration || pdfOcrConfig(); const local = configuration?.local || configuration;
  if (!local?.available) throw failure(local?.reason || 'OCR is unavailable.', 'OCR_UNAVAILABLE'); if (!pdf?.configured) throw failure(pdf?.reason || 'PDF rendering is unavailable.', 'OCR_PDF_RENDERER_UNAVAILABLE');
  let opened; let renderedPixels = 0; const started = Date.now(); const pages = []; const notices = [];
  try {
    opened = await openPdf(bytes, pdf, signal);
    for (let index = 1; index <= opened.count; index += 1) {
      if (isAbort(signal)) throw failure('Document processing was cancelled.', 'CANCELLED', 499);
      const pageStarted = Date.now(); let page; let native = ''; let classification;
      try {
        page = await withLifecycle(() => opened.document.getPage(index), { signal, timeoutMs: pdf.timeoutMs, cancel: () => { void opened.document?.destroy?.(); } });
        const content = await withLifecycle(() => page.getTextContent(), { signal, timeoutMs: pdf.timeoutMs, cancel: () => { void opened.document?.destroy?.(); } }); const candidate = pageText(content, pdf.maxOutputCharacters + 1); native = candidate.slice(0, pdf.maxOutputCharacters); const nativeTruncated = candidate.length > native.length; const remaining = Math.max(0, pdf.maxOutputCharacters - pages.reduce((sum, item) => sum + item.text.length, 0)); classification = await classifyPage({ page, pdfjs: opened.pdfjs, nativeText: native, configuration: pdf, signal, document: opened.document });
        if (classification.classification === 'native') { const text = native.slice(0, remaining); const status = text === native && !nativeTruncated ? 'completed' : 'partial'; pages.push({ pageNumber: index, text, extractionMethod: 'native_text', status, nativeTextUsed: Boolean(text), ocrUsed: false, mixedContent: false, rasterDetected: false, durationMs: Date.now() - pageStarted }); if (status !== 'completed') notices.push('PDF extraction output reached the configured document limit.'); continue; }
        if (classification.classification === 'blank') { pages.push({ pageNumber: index, text: '', extractionMethod: 'native_text', status: 'partial', nativeTextUsed: false, ocrUsed: false, mixedContent: false, rasterDetected: false, durationMs: Date.now() - pageStarted }); notices.push(`No readable text or raster content was detected on PDF page ${index}.`); continue; }
        const geometry = renderedViewport(page, pdf); renderedPixels += geometry.pixels; if (renderedPixels > pdf.maxTotalPixels) throw failure('PDF exceeds the total rendered-pixel limit.', 'OCR_PDF_TOTAL_PIXEL_LIMIT', 400);
        const ocr = await renderPageOcr({ page, pdf, local, signal, remaining, document: opened.document }); const mixedContent = Boolean(native); const reconciled = mixedContent ? reconcileMixedText(native.slice(0, remaining), ocr.text, remaining) : { text: ocr.text.slice(0, remaining), ocrSupplement: ocr.text.slice(0, remaining), duplicateLinesRemoved: 0 }; const status = !reconciled.text ? 'partial' : ocr.status === 'completed' && !ocr.outputLimited && !nativeTruncated ? 'completed' : 'partial'; const extractionMethod = mixedContent ? 'mixed' : 'ocr';
        pages.push({ pageNumber: index, text: reconciled.text, extractionMethod, status, nativeTextUsed: mixedContent, ocrUsed: true, mixedContent, rasterDetected: Boolean(classification.rasterDetected), pageClassification: classification.classification, rasterOperations: classification.rasterOperations, ...(classification.classificationError ? { classificationError: classification.classificationError } : {}), ...(ocr.confidence === undefined ? {} : { confidence: ocr.confidence }), ocrCharactersAdded: reconciled.ocrSupplement.length, duplicateLinesRemoved: reconciled.duplicateLinesRemoved, durationMs: Date.now() - pageStarted });
        if (ocr.downscaled) notices.push(`Page ${index} was rasterised below the preferred scale to respect pixel limits.`); if (ocr.outputLimited || nativeTruncated) notices.push('PDF OCR output reached the configured document limit.'); if (!reconciled.text) notices.push(`No readable text was detected on PDF page ${index}.`);
      } catch (error) {
        const mapped = pdfError(error); if (mapped.code === 'CANCELLED') throw mapped;
        pages.push({ pageNumber: index, text: native, extractionMethod: native ? classification?.rasterDetected ? 'mixed' : 'native_text' : 'ocr', status: 'failed', nativeTextUsed: Boolean(native), ocrUsed: Boolean(classification?.rasterDetected), mixedContent: Boolean(native && classification?.rasterDetected), rasterDetected: Boolean(classification?.rasterDetected), ...(classification?.classification ? { pageClassification: classification.classification } : {}), errorCode: mapped.code, durationMs: Date.now() - pageStarted }); notices.push(`PDF page ${index} could not be fully processed (${mapped.code}).`);
      } finally { page?.cleanup?.(); }
    }
    const total = pages.reduce((sum, item) => sum + item.text.length, 0); return { status: pages.every(page => page.status === 'completed') ? 'completed' : 'partial', engine: 'tesseract.js', engineVersion: local.engineVersion, renderer: 'pdfjs-dist', rendererVersion: pdf.rendererVersion, durationMs: Date.now() - started, pages, notices: [...new Set(notices)].slice(0, 30), truncated: total >= pdf.maxOutputCharacters };
  } catch (error) { throw pdfError(error); } finally { await opened?.document?.destroy?.().catch(() => undefined); }
}
async function probeLocalPdfOcr({ configuration, signal } = {}) { const local = configuration?.local || configuration; const pdf = configuration?.pdf || configuration?.pdfConfiguration || pdfOcrConfig(); if (!local?.available || !pdf?.configured) return { ready: false, reason: local?.reason || pdf?.reason }; try { const bytes = await fs.promises.readFile(PDF_SMOKE_FIXTURE); const result = await recognizePdf({ bytes, configuration: { local, pdf }, signal }); return { ready: /VOICECHAT\s+OCR/i.test(result.pages?.[0]?.text || ''), engine: result.engine, renderer: result.renderer, rendererVersion: result.rendererVersion }; } catch { return { ready: false, reason: 'Local PDF OCR smoke test did not complete.' }; } }
module.exports = { PDF_SMOKE_FIXTURE, pdfOcrConfig, rendererInstalled, extractNativePdfPages, recognizePdf, probeLocalPdfOcr, cleanText, pageText, normalizedLine, reconcileMixedText, classifyPage };
