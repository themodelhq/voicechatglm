// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { ocrConfig, runOcr } = require('../server/advanced-services.cjs') as typeof import('../server/advanced-services.cjs');
const { ocrEligible, enqueueSource } = require('../server/knowledge-routes.cjs') as typeof import('../server/knowledge-routes.cjs');
const { processKnowledgeJob } = require('../server/knowledge-worker.cjs') as typeof import('../server/knowledge-worker.cjs');
const { buildReadinessReport } = require('../server/readiness.cjs') as typeof import('../server/readiness.cjs');

const userId = '00000000-0000-4000-8000-000000000127';
const sourceId = '00000000-0000-4000-8000-000000000128';
const env = { NODE_ENV: 'test', KNOWLEDGE_BASE_ENABLED: 'true', KNOWLEDGE_OCR_ENABLED: 'true', FILE_STORAGE_S3_BUCKET: 'private-bucket', FILE_STORAGE_S3_REGION: 'test-region', FILE_STORAGE_S3_ENDPOINT: 'http://storage.test', FILE_STORAGE_S3_ACCESS_KEY_ID: 'key', FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'secret' };

function repositoryFor({ status = 'inspection_completed', persisted }: { status?: string; persisted?: (value: any) => void } = {}) {
  const source = { id: sourceId, fileId: sourceId, filename: 'known-text.png', contentType: 'image/png', type: 'image', extractionStorageKey: 'private/extraction' };
  return {
    knowledgeSourceForWorker: async () => source,
    fileForOwner: async () => ({ id: sourceId, storageKey: 'private/source', status }),
    knowledgeVectorIdsForSource: async () => [],
    replaceKnowledgePagesAndChunks: async (value: any) => { persisted?.(value); return { source, chunks: value.chunks.map((chunk: any, index: number) => ({ id: `00000000-0000-4000-8000-00000000013${index}`, ...chunk })) }; },
    updateKnowledgeSourceStatus: async () => source,
  };
}

describe('v1.2.8 package-managed local OCR regression coverage', () => {
  it('uses the pinned local Tesseract engine for genuine PNG, JPEG and WebP extraction', async () => {
    const configuration = ocrConfig(env);
    expect(configuration).toMatchObject({ provider: 'tesseract_js', available: true, supportsPdf: true });
    for (const [filename, contentType] of [['known-text.png', 'image/png'], ['known-text.jpg', 'image/jpeg'], ['known-text.webp', 'image/webp']] as const) {
      const result = await runOcr({ bytes: readFileSync(`tests/fixtures/ocr/${filename}`), contentType, filename, configuration });
      expect(result).toMatchObject({ engine: 'tesseract.js', engineVersion: '5.1.1', status: 'completed' });
      expect(result.pages[0]).toMatchObject({ pageNumber: 1, text: 'VOICECHAT OCR 2026', status: 'completed' });
      expect(result.pages[0].confidence).toBeGreaterThan(0.8);
    }
  }, 20_000);

  it('reports local engine readiness only after a real package-managed smoke recognition', async () => {
    const report = await buildReadinessReport({ NODE_ENV: 'test', KNOWLEDGE_OCR_ENABLED: 'true', FILE_ANALYSIS_ENABLED: 'false' });
    expect(report.ocr).toMatchObject({ enabled: true, configured: true, provider: 'tesseract_js', readiness: 'reachable' });
  }, 20_000);

  it('recognises the canonical image type and fails scanner-gated job creation closed', async () => {
    expect(ocrEligible({ type: 'image', contentType: 'image/png' })).toBe(true);
    await expect(enqueueSource({ repository: {}, userId, file: { id: sourceId, type: 'image', contentType: 'image/png', status: 'uploaded' }, source: { id: sourceId }, store: {}, env })).rejects.toMatchObject({ code: 'FILE_NOT_CLEAN' });
  });

  it('rechecks scanner success in the worker and persists a truthful no-readable-text outcome', async () => {
    await expect(processKnowledgeJob({ job: { source_id: sourceId, user_id: userId, job_type: 'ocr_index' }, repository: repositoryFor({ status: 'uploaded' }), store: {}, env })).rejects.toMatchObject({ code: 'FILE_NOT_CLEAN' });
    let persisted: any;
    const result = await processKnowledgeJob({ job: { source_id: sourceId, user_id: userId, job_type: 'ocr_index' }, repository: repositoryFor({ persisted: value => { persisted = value; } }), store: { getJson: async () => undefined, getBuffer: async () => readFileSync('tests/fixtures/ocr/no-text.png') }, env });
    expect(result).toMatchObject({ status: 'partially_completed', result: { noReadableText: true, chunkCount: 0 } });
    expect(persisted).toMatchObject({ status: 'partial', chunks: [], metadata: { processing: { state: 'completed_no_text' } } });
    expect(persisted.pages[0]).toMatchObject({ extractionMethod: 'ocr', content: '', status: 'partial' });
  }, 20_000);
});
