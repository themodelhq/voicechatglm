import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { webSearchConfig, validateSearchQuery, searchWeb } = require('../server/web-search.cjs') as typeof import('../server/web-search.cjs');

describe('documented server-side web search', () => {
  const env = { WEB_SEARCH_ENABLED: 'true', WEB_SEARCH_PROVIDER: 'brave', WEB_SEARCH_BRAVE_API_KEY: 'test-server-only-key-value', WEB_SEARCH_MAX_RESULTS: '3', WEB_SEARCH_TIMEOUT_MS: '1000' } as NodeJS.ProcessEnv;
  it('validates a bounded query and retains real provider URLs while deduplicating equivalent results', async () => {
    expect(validateSearchQuery(' x ')).toHaveProperty('error'); const calls: any[] = [];
    const output = await searchWeb({ query: 'latest open models', configuration: webSearchConfig(env), fetchImpl: async (url: URL, init: any) => { calls.push({ url: url.toString(), init }); return new Response(JSON.stringify({ web: { results: [
      { title: 'First', url: 'https://example.test/article?utm_source=mail', description: 'Evidence one', page_age: '2026-10-10T00:00:00Z' },
      { title: 'Duplicate', url: 'https://example.test/article', description: 'Duplicate evidence' },
      { title: 'Second', url: 'https://other.test/', description: 'Evidence two' },
    ] } }), { status: 200 }); } });
    expect(output.results).toHaveLength(2); expect(output.results[0].url).toBe('https://example.test/article?utm_source=mail'); expect(output.results[0].publicationDate).toBe('2026-10-10T00:00:00.000Z'); expect(calls[0].url).toContain('q=latest+open+models'); expect(calls[0].init.headers['X-Subscription-Token']).toBe('test-server-only-key-value');
  });
  it('fails honestly for disabled/malformed/provider-limit paths', async () => {
    await expect(searchWeb({ query: 'topic', configuration: webSearchConfig({ WEB_SEARCH_ENABLED: 'false' } as NodeJS.ProcessEnv) })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    await expect(searchWeb({ query: 'topic', configuration: webSearchConfig(env), fetchImpl: async () => new Response('{not-json', { status: 200 }) })).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
    await expect(searchWeb({ query: 'topic', configuration: webSearchConfig(env), fetchImpl: async () => new Response('{}', { status: 429 }) })).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMIT', status: 429 });
  });
});
