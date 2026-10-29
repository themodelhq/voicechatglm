// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { ocrConfig, runOcr } = require('../server/advanced-services.cjs') as typeof import('../server/advanced-services.cjs');
const { extractionFromOcr } = require('../server/document-processing.cjs') as typeof import('../server/document-processing.cjs');

const env = { NODE_ENV: 'test', KNOWLEDGE_OCR_PROFILE: 'test', KNOWLEDGE_OCR_ENABLED: 'true', KNOWLEDGE_OCR_PROVIDER: 'tesseract_js' };
const fixture = (name: string) => readFileSync(`tests/fixtures/pdf/${name}`);
async function recognize(name: string) { return runOcr({ bytes: fixture(name), contentType: 'application/pdf', filename: name, configuration: ocrConfig(env) }); }

describe('v1.2.9 real same-page mixed PDF extraction', () => {
  it('keeps selectable text and distinct embedded raster text on one page with genuine OCR provenance', async () => {
    const result = await recognize('same-page-native-and-scanned.pdf');
    expect(result).toMatchObject({ status: 'completed', engine: 'tesseract.js', renderer: 'pdfjs-dist' });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({ pageNumber: 1, extractionMethod: 'mixed', status: 'completed', nativeTextUsed: true, ocrUsed: true, rasterDetected: true, text: expect.stringContaining('NATIVE HEADER 2029') });
    expect(result.pages[0].text).toContain('SCANNED RECEIPT 47');
    expect(result.pages[0].confidence).toBeGreaterThan(0);

    const shared = extractionFromOcr(result, { filename: 'same-page-native-and-scanned.pdf', maximumCharacters: 50_000 });
    expect(shared.pages[0]).toMatchObject({ extractionMethod: 'mixed', status: 'completed', provenance: { nativeTextUsed: true, ocrUsed: true, mixedContent: true, rasterDetected: true } });
    expect(shared.extraction.sources).toEqual([{ filename: 'same-page-native-and-scanned.pdf', location: 'page 1 (mixed)' }]);
  }, 30_000);

  it('retains unique raster table and stamp text rather than skipping an image-bearing native page', async () => {
    const table = await recognize('same-page-scanned-table.pdf');
    const stamp = await recognize('same-page-scanned-stamp.pdf');
    expect(table.pages[0]).toMatchObject({ extractionMethod: 'mixed', status: 'completed' });
    expect(table.pages[0].text).toContain('ITEM QTY TOTAL');
    expect(table.pages[0].text).toContain('BETA 3 21');
    expect(stamp.pages[0]).toMatchObject({ extractionMethod: 'mixed', status: 'completed' });
    expect(stamp.pages[0].text).toContain('PAID STAMP 2029');
  }, 30_000);

  it('removes OCR copies of native lines without dropping intentional native repeats', async () => {
    const overlap = await recognize('same-page-overlap.pdf');
    expect(overlap.pages[0]).toMatchObject({ extractionMethod: 'mixed', duplicateLinesRemoved: expect.any(Number) });
    expect(overlap.pages[0].duplicateLinesRemoved).toBeGreaterThan(0);
    expect((overlap.pages[0].text.match(/OVERLAP LINE 2029/g) || [])).toHaveLength(1);
    expect(overlap.pages[0].text).toContain('NATIVE UNIQUE 2029');
    expect(overlap.pages[0].text).toContain('SCANNED UNIQUE 2029');

    const nativeRepeats = await recognize('native-repeated-lines.pdf');
    expect(nativeRepeats.pages[0]).toMatchObject({ extractionMethod: 'native_text', ocrUsed: false });
    expect((nativeRepeats.pages[0].text.match(/LINE ITEM ALPHA/g) || [])).toHaveLength(2);
  }, 30_000);

  it('reports generated malformed input truthfully and retains the existing real blank/multipage fixture coverage', async () => {
    await expect(recognize('malformed.pdf')).rejects.toMatchObject({ code: 'OCR_PDF_INVALID' });
    const blank = await recognize('blank-scanned.pdf');
    expect(blank).toMatchObject({ status: 'partial', pages: [{ extractionMethod: 'ocr', status: 'partial', text: '' }] });
    const multipage = await recognize('mixed-known-text.pdf');
    expect(multipage.pages.map((page: any) => page.extractionMethod)).toEqual(['native_text', 'ocr']);
  }, 30_000);
});
