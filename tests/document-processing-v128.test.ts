// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { extractionFromOcr } = require('../server/document-processing.cjs') as typeof import('../server/document-processing.cjs');
const { acquireWorkerSlot, releaseWorkerSlot, recognizeLocalImage } = require('../server/local-ocr.cjs') as typeof import('../server/local-ocr.cjs');

const image = readFileSync('tests/fixtures/ocr/known-text.png');
const testConfiguration = { available: true, language: 'eng', timeoutMs: 20, maxImagePixels: 20_000_000, maxOutputCharacters: 10_000, maxConcurrentJobs: 1 };
const testEngine = (createWorker: () => Promise<any>) => ({ createWorker, language: { langPath: '.', gzip: true }, version: 'test' });

describe('v1.2.8 protected document processing', () => {
  it('redacts or excludes OCR page content before text, page artifacts, hashes, or sources are returned', () => {
    const processed = extractionFromOcr({ status: 'completed', engine: 'tesseract.js', pages: [
      { pageNumber: 1, extractionMethod: 'native_text', status: 'completed', text: 'deployment token=real-secret-value\nordinary fact' },
      { pageNumber: 2, extractionMethod: 'ocr', status: 'completed', text: '-----BEGIN PRIVATE KEY-----\nvery-secret\n-----END PRIVATE KEY-----' },
    ] }, { filename: 'scanned.pdf', maximumCharacters: 50_000 });
    expect(processed.extraction.text).toContain('[REDACTED]');
    expect(processed.extraction.text).not.toContain('real-secret-value');
    expect(processed.extraction.text).not.toContain('very-secret');
    expect(processed.pages[0].text).toContain('[REDACTED]');
    expect(processed.pages[0].contentHash).not.toContain('real-secret-value');
    expect(processed.pages[1]).toMatchObject({ text: '', status: 'excluded', excluded: true });
    expect(processed.extraction.sources).toEqual([{ filename: 'scanned.pdf', location: 'page 1 (native_text)' }]);
  });

  it('queues global OCR-worker slots, supports aborting a queued job, and leaves no slot leak', async () => {
    await acquireWorkerSlot(1);
    let entered = false;
    const queued = acquireWorkerSlot(1).then(() => { entered = true; });
    await Promise.resolve();
    expect(entered).toBe(false);
    releaseWorkerSlot();
    await queued;
    expect(entered).toBe(true);
    releaseWorkerSlot();

    await acquireWorkerSlot(1);
    const controller = new AbortController();
    const cancelled = acquireWorkerSlot(1, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' });
    releaseWorkerSlot();
  });

  it('returns truthful engine-init and timed-out recognition errors while terminating any worker', async () => {
    await expect(recognizeLocalImage({ bytes: image, contentType: 'image/png', configuration: testConfiguration, engineOverride: testEngine(async () => { throw new Error('init failed'); }) })).rejects.toMatchObject({ code: 'OCR_ENGINE_FAILED' });

    let terminated = 0;
    const never = new Promise(() => undefined);
    await expect(recognizeLocalImage({ bytes: image, contentType: 'image/png', configuration: testConfiguration, engineOverride: testEngine(async () => ({ recognize: async () => never, terminate: async () => { terminated += 1; } })) })).rejects.toMatchObject({ code: 'OCR_TIMEOUT' });
    expect(terminated).toBe(1);
  });
});
