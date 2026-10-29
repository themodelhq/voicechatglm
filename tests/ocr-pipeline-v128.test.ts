// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { loadRecords } = require('../server/files/router.cjs') as typeof import('../server/files/router.cjs');
const { processKnowledgeJob } = require('../server/knowledge-worker.cjs') as typeof import('../server/knowledge-worker.cjs');
const { DEFAULTS } = require('../server/files/policy.cjs') as typeof import('../server/files/policy.cjs');

const userId = '00000000-0000-4000-8000-000000000128';
const sourceId = '00000000-0000-4000-8000-000000000129';
const env = { NODE_ENV: 'test', KNOWLEDGE_BASE_ENABLED: 'true', KNOWLEDGE_OCR_ENABLED: 'true', KNOWLEDGE_OCR_PROVIDER: 'tesseract_js', FILE_STORAGE_S3_BUCKET: 'private-bucket', FILE_STORAGE_S3_REGION: 'test-region', FILE_STORAGE_S3_ENDPOINT: 'http://storage.test', FILE_STORAGE_S3_ACCESS_KEY_ID: 'key', FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'secret' };

describe('v1.2.8 scanner-gated chat and Knowledge document pipelines', () => {
  it('rechecks clean scan state and only then caches shared OCR text in the private chat extraction artifact', async () => {
    const file = { id: sourceId, filename: 'known-text.png', type: 'image', contentType: 'image/png', status: 'inspection_completed', storageKey: 'private/source', extractionStorageKey: 'private/extraction' };
    let written: any;
    const store = {
      getJson: async () => ({ extraction: { text: '', analysisAvailable: false, notices: [] } }),
      getBuffer: async () => readFileSync('tests/fixtures/ocr/known-text.png'),
      putJson: async (_key: string, value: any) => { written = value; },
    };
    const records = await loadRecords(store, [file], DEFAULTS, undefined, env);
    expect(records[0].extraction).toMatchObject({ analysisAvailable: true, processing: { engine: 'tesseract.js' } });
    expect(records[0].extraction.text).toContain('VOICECHAT OCR 2026');
    expect(written.extraction.pages[0]).toMatchObject({ pageNumber: 1, extractionMethod: 'ocr', text: 'VOICECHAT OCR 2026' });

    let originalRead = false;
    await expect(loadRecords({ getJson: async () => { originalRead = true; return {}; } }, [{ ...file, status: 'uploaded' }], DEFAULTS, undefined, env)).rejects.toMatchObject({ code: 'FILE_NOT_CLEAN' });
    expect(originalRead).toBe(false);
  }, 30_000);

  it('indexes a scanner-clean mixed PDF through the same ordered native/OCR page processor', async () => {
    const source = { id: sourceId, fileId: sourceId, filename: 'mixed-known-text.pdf', contentType: 'application/pdf', type: 'pdf', extractionStorageKey: 'private/extraction' };
    let persisted: any;
    const repository = {
      knowledgeSourceForWorker: async () => source,
      fileForOwner: async () => ({ id: sourceId, storageKey: 'private/source', status: 'inspection_completed' }),
      knowledgeVectorIdsForSource: async () => [],
      replaceKnowledgePagesAndChunks: async (value: any) => { persisted = value; return { source, chunks: value.chunks.map((chunk: any, index: number) => ({ id: `00000000-0000-4000-8000-00000000013${index}`, ...chunk })) }; },
      updateKnowledgeSourceStatus: async () => source,
    };
    const result = await processKnowledgeJob({ job: { source_id: sourceId, user_id: userId, job_type: 'ocr_index' }, repository, store: { getJson: async () => ({ extraction: { text: '', analysisAvailable: false } }), getBuffer: async () => readFileSync('tests/fixtures/pdf/mixed-known-text.pdf') }, env });
    expect(result).toMatchObject({ status: 'completed', result: { pageCount: 2 } });
    expect(persisted.pages.map((page: any) => [page.pageNumber, page.extractionMethod, page.content])).toEqual([[1, 'native_text', 'NATIVE MIXED PAGE 2028'], [2, 'ocr', 'VOICECHAT OCR 2026']]);
    expect(persisted.chunks.map((chunk: any) => chunk.content).join('\n')).toContain('VOICECHAT OCR 2026');
  }, 30_000);
});
