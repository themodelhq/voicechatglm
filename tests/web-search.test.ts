import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { webSearchConfig, validateSearchQuery, searchWeb } = require('../server/web-search.cjs') as typeof import('../server/web-search.cjs');

describe('documented server-side Tavily web search', () => {
  const env = { WEB_SEARCH_ENABLED: 'true', WEB_SEARCH_PROVIDER: 'tavily', WEB_SEARCH_TAVILY_API_KEY: 'test-server-only-key-value', WEB_SEARCH_MAX_RESULTS: '3', WEB_SEARCH_TIMEOUT_MS: '1000' } as NodeJS.ProcessEnv;
  it('validates a bounded query, sends basic-search settings, and normalizes/deduplicates provider URLs', async () => {
    expect(validateSearchQuery(' x ')).toHaveProperty('error'); const calls: any[] = [];
    const output = await searchWeb({ query: 'latest open models', configuration: webSearchConfig(env), fetchImpl: async (url: URL | string, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ results: [
      { title: 'First', url: 'https://example.test/article?utm_source=mail', content: 'Evidence one', published_date: '2026-10-10', score: 0.91 },
      { title: 'Duplicate', url: 'https://example.test/article', content: 'Duplicate evidence' },
      { title: 'Second', url: 'https://other.test/', content: 'Evidence two' },
    ], usage: { credits: 1 } }), { status: 200 }); } });
    expect(output.provider).toBe('tavily'); expect(output.results).toHaveLength(2); expect(output.results[0].url).toBe('https://example.test/article?utm_source=mail'); expect(output.results[0].publicationDate).toBe('2026-10-10T00:00:00.000Z'); expect(output.usage).toEqual({ credits: 1 }); expect(calls[0].url).toBe('https://api.tavily.com/search'); expect(calls[0].init.headers.Authorization).toBe('Bearer test-server-only-key-value'); expect(JSON.parse(calls[0].init.body)).toMatchObject({ search_depth: 'basic', max_results: 3, include_answer: false, include_raw_content: false });
  });
  it('fails honestly for disabled, malformed, exhausted-credit, and provider-limit paths', async () => {
    await expect(searchWeb({ query: 'topic', configuration: webSearchConfig({ WEB_SEARCH_ENABLED: 'false' } as NodeJS.ProcessEnv) })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    await expect(searchWeb({ query: 'topic', configuration: webSearchConfig(env), fetchImpl: async () => new Response('{not-json', { status: 200 }) })).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
    await expect(searchWeb({ query: 'topic', configuration: webSearchConfig(env), fetchImpl: async () => new Response('{}', { status: 402 }) })).rejects.toMatchObject({ code: 'PROVIDER_CREDITS_EXHAUSTED', status: 402 });
    await expect(searchWeb({ query: 'topic', configuration: webSearchConfig(env), fetchImpl: async () => new Response('{}', { status: 429 }) })).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMIT', status: 429 });
  });
});
