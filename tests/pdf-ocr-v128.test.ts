// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { ocrConfig, runOcr } = require('../server/advanced-services.cjs') as typeof import('../server/advanced-services.cjs');
const { probeLocalPdfOcr, pageText } = require('../server/pdf-ocr.cjs') as typeof import('../server/pdf-ocr.cjs');

const env = { NODE_ENV: 'test', KNOWLEDGE_OCR_ENABLED: 'true', KNOWLEDGE_OCR_PROVIDER: 'tesseract_js' };
function pdf(name: string) { return readFileSync(`tests/fixtures/pdf/${name}`); }
describe('v1.2.8 real scanned-PDF OCR', () => {
  it('renders and OCRs a scanner-safe scanned PDF with the package-managed renderer and engine', async () => {
    const configuration = ocrConfig(env);
    expect(configuration).toMatchObject({ available: true, supportsPdf: true, pdf: { configured: true } });
    const result = await runOcr({ bytes: pdf('scanned-known-text.pdf'), contentType: 'application/pdf', filename: 'scanned-known-text.pdf', configuration });
    expect(result).toMatchObject({ status: 'completed', engine: 'tesseract.js', renderer: 'pdfjs-dist' });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({ pageNumber: 1, extractionMethod: 'ocr', text: 'VOICECHAT OCR 2026', status: 'completed' });
    expect(result.pages[0].confidence).toBeGreaterThan(0.8);
  }, 30_000);

  it('uses native text where present and OCR only the scanned page of a mixed PDF in page order', async () => {
    const result = await runOcr({ bytes: pdf('mixed-known-text.pdf'), contentType: 'application/pdf', filename: 'mixed-known-text.pdf', configuration: ocrConfig(env) });
    expect(result.pages.map((page: any) => [page.pageNumber, page.extractionMethod, page.text])).toEqual([[1, 'native_text', 'NATIVE MIXED PAGE 2028'], [2, 'ocr', 'VOICECHAT OCR 2026']]);
  }, 30_000);

  it('bounds a native PDF content item before it is accumulated into a page result', () => {
    expect(pageText({ items: [{ str: 'A'.repeat(1_200), hasEOL: false }] }, 1_000)).toHaveLength(1_000);
  });

  it('preserves truthful no-readable-text, page-limit, malformed and cancelled-PDF outcomes', async () => {
    const blank = await runOcr({ bytes: pdf('blank-scanned.pdf'), contentType: 'application/pdf', filename: 'blank-scanned.pdf', configuration: ocrConfig(env) });
    expect(blank).toMatchObject({ status: 'partial', pages: [{ pageNumber: 1, extractionMethod: 'ocr', text: '', status: 'partial' }] });
    await expect(runOcr({ bytes: pdf('multi-page-scanned.pdf'), contentType: 'application/pdf', filename: 'many.pdf', configuration: ocrConfig({ ...env, KNOWLEDGE_OCR_MAX_PDF_PAGES: '2' }) })).rejects.toMatchObject({ code: 'OCR_PDF_PAGE_LIMIT' });
    await expect(runOcr({ bytes: Buffer.from('%PDF-not-valid'), contentType: 'application/pdf', filename: 'broken.pdf', configuration: ocrConfig(env) })).rejects.toMatchObject({ code: 'OCR_PDF_INVALID' });
    const controller = new AbortController(); controller.abort(); await expect(runOcr({ bytes: pdf('scanned-known-text.pdf'), contentType: 'application/pdf', filename: 'cancel.pdf', configuration: ocrConfig(env), signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  }, 30_000);

  it('makes renderer readiness depend on an actual scanned-PDF smoke recognition', async () => {
    const configuration = ocrConfig(env);
    await expect(probeLocalPdfOcr({ configuration: { local: configuration, pdf: configuration.pdf } })).resolves.toMatchObject({ ready: true, engine: 'tesseract.js', renderer: 'pdfjs-dist' });
  }, 30_000);
});
