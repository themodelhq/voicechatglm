import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { routeChat } = require('../server/intent-router.cjs') as typeof import('../server/intent-router.cjs'); const { runScrape } = require('../server/orchestrator.cjs') as typeof import('../server/orchestrator.cjs');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function requestFor(body: string) { return (_options: any, callback: (response: any) => void) => { const request = new EventEmitter() as any; request.destroy = (error?: Error) => { if (error) request.emit('error', error); }; request.end = () => { const response = new EventEmitter() as any; response.statusCode = 200; response.headers = { 'content-type': 'text/html' }; callback(response); queueMicrotask(() => { response.emit('data', Buffer.from(body)); response.emit('end'); }); }; return request; }; }
describe('routed tool execution to grounded model synthesis', () => {
  it('executes the configured provider search before sending labelled source evidence to the model', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ web: { results: [{ title: 'Real returned title', url: 'https://source.example/report', description: 'Provider evidence' }] } }), { status: 200 })) as any; const calls: any[] = [];
    const output = await routeChat({ message: 'Search the web for open model developments.', request: { message: 'Search the web for open model developments.', max_new_tokens: 256 }, userId: 'owner', repository: {}, callModel: async (payload: any) => { calls.push(payload); return { status: 200, body: { response: 'Grounded synthesis.' } }; }, env: { WEB_SEARCH_ENABLED: 'true', WEB_SEARCH_PROVIDER: 'brave', WEB_SEARCH_BRAVE_API_KEY: 'test-server-only-key-value', WEB_SCRAPING_ENABLED: 'false' }, consumeAction: async () => ({ allowed: true }) });
    expect(output).toMatchObject({ type: 'tool', route: 'web_search', response: 'Grounded synthesis.' }); expect((output as any).citations[0]).toMatchObject({ url: 'https://source.example/report' }); expect(calls[0].message).toContain('https://source.example/report'); expect(calls[0].system_prompt).toContain('untrusted');
  });
  it('retrieves conventional HTML through the guarded retrieval path before synthesis', async () => {
    const calls: any[] = []; const output = await routeChat({ message: 'Extract product details from https://shop.example/products', request: { message: 'Extract product details from https://shop.example/products', max_new_tokens: 256 }, userId: 'owner', repository: {}, callModel: async (payload: any) => { calls.push(payload); return { status: 200, body: { response: 'Comparison based on retrieved page.' } }; }, env: { WEB_SCRAPING_ENABLED: 'true', WEB_SCRAPING_ROBOTS_POLICY: 'ignore', WEB_SEARCH_ENABLED: 'false' }, consumeAction: async () => ({ allowed: true }), retrievalOptions: { lookup: async () => [{ address: '93.184.216.34', family: 4 }] as any, request: requestFor('<html><head><title>Catalog</title></head><body><h1>Widget</h1><script type="application/ld+json">{"@type":"Product","name":"Widget","offers":{"price":"9.99","priceCurrency":"USD"}}</script><p>Useful product.</p></body></html>') } });
    expect(output).toMatchObject({ type: 'tool', route: 'website_scraping', response: 'Comparison based on retrieved page.' }); expect(calls[0].message).toContain('Widget'); expect(calls[0].message).toContain('9.99'); expect((output as any).citations[0].url).toBe('https://shop.example/products');
  });
  it('propagates cancellation instead of claiming a partially completed retrieval workflow', async () => {
    const controller = new AbortController(); controller.abort(); await expect(runScrape({ urls: ['https://shop.example/products'], retrievalConfiguration: { enabled: true, configured: true, maxPages: 1, concurrency: 1, timeoutMs: 1000, maxResponseBytes: 1000, maxRedirects: 1, maxLinks: 1, maxText: 1000, robotsPolicy: 'ignore' }, signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
