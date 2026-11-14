import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { capabilitySnapshot, recordCapabilityAvailability } = require('../server/capabilities.cjs') as typeof import('../server/capabilities.cjs'); const { resetReadinessForTests } = require('../server/readiness.cjs') as typeof import('../server/readiness.cjs');
afterEach(() => resetReadinessForTests());
describe('safe backend capability registry', () => {
  it('separates implemented, configured, enabled, available and tested states without disclosing credentials', async () => {
    const report = await capabilitySnapshot({ NODE_ENV: 'test', WEB_SEARCH_ENABLED: 'false', WEB_SEARCH_BRAVE_API_KEY: 'private-key-value', WEB_SCRAPING_ENABLED: 'false', WRITING_WORKFLOW_ENABLED: 'false' } as NodeJS.ProcessEnv); const search = report.capabilities.find(item => item.id === 'web_search')!; const scrape = report.capabilities.find(item => item.id === 'website_scraping')!; expect(search).toMatchObject({ implemented: true, enabled: false, available: false, tested: false }); expect(scrape).toMatchObject({ implemented: true, enabled: false, available: false }); expect(JSON.stringify(report)).not.toContain('private-key-value');
  });
  it('reports v1.2 durable features and streaming/code-execution limits without portraying disabled paths as ready', async () => { const report = await capabilitySnapshot({ NODE_ENV: 'test', ARTIFACT_DELIVERY_ENABLED: 'false', KNOWLEDGE_BASE_ENABLED: 'false', PERSISTENT_MEMORY_ENABLED: 'false', DATA_ANALYSIS_ENABLED: 'false', CONVERSATION_SHARING_ENABLED: 'false' } as NodeJS.ProcessEnv); expect(report.capabilities.find(item => item.id === 'artifact_delivery')).toMatchObject({ implemented: true, enabled: false, available: false }); expect(report.capabilities.find(item => item.id === 'persistent_memory')).toMatchObject({ implemented: true, enabled: false, available: false }); expect(report.capabilities.find(item => item.id === 'knowledge_retrieval')).toMatchObject({ implemented: true, enabled: false, available: false }); expect(report.capabilities.find(item => item.id === 'streaming')).toMatchObject({ implemented: false, enabled: false, available: false, blocked: true }); expect(report.capabilities.find(item => item.id === 'arbitrary_code_execution')).toMatchObject({ implemented: false, blocked: true }); expect(report.capabilities.find(item => item.id === 'javascript_page_rendering')).toMatchObject({ implemented: true, enabled: false, available: false }); expect(report.capabilities.find(item => item.id === 'knowledge_ocr')).toMatchObject({ implemented: true, enabled: false, available: false }); expect(report.capabilities.find(item => item.id === 'semantic_retrieval')).toMatchObject({ implemented: true, enabled: false, available: false }); expect(report.capabilities.find(item => item.id === 'isolated_custom_analysis')).toMatchObject({ implemented: true, enabled: false, available: false }); });
  it('keeps requested activation fail-closed when external prerequisites are absent', async () => {
    const env = { NODE_ENV: 'production', FILE_ANALYSIS_ENABLED: 'true', WEB_SEARCH_ENABLED: 'true', WEB_SCRAPING_ENABLED: 'true', WRITING_WORKFLOW_ENABLED: 'true', ARTIFACT_DELIVERY_ENABLED: 'true', PERSISTENT_MEMORY_ENABLED: 'true', KNOWLEDGE_BASE_ENABLED: 'true', DATA_ANALYSIS_ENABLED: 'true', CONVERSATION_SHARING_ENABLED: 'true' } as NodeJS.ProcessEnv;
    const report = await capabilitySnapshot(env);
    for (const id of ['file_analysis', 'web_search', 'website_scraping', 'book_writing', 'artifact_delivery', 'persistent_memory', 'knowledge_retrieval', 'data_analysis', 'conversation_sharing']) {
      const capability = report.capabilities.find(item => item.id === id)!;
      expect(capability.enabled).toBe(true);
      expect(capability.available).toBe(false);
      expect(capability.blocked).toBe(true);
    }
  });
  it('only marks runtime tool availability after a successful guarded execution is recorded', async () => {
    recordCapabilityAvailability('web_search', true); const env = { NODE_ENV: 'test', WEB_SEARCH_ENABLED: 'true', WEB_SEARCH_PROVIDER: 'brave', WEB_SEARCH_BRAVE_API_KEY: 'test-server-only-key-value' } as NodeJS.ProcessEnv; const report = await capabilitySnapshot(env); expect(report.capabilities.find(item => item.id === 'web_search')).toMatchObject({ configured: true, enabled: true, available: true });
  });
});
