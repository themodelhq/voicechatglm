import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { nodeHandler } = require('../server/proxy-core.cjs') as { nodeHandler: (request: any, response: any) => Promise<void> };
const original = { NODE_ENV: process.env.NODE_ENV, VOICECHATGLM_API_URL: process.env.VOICECHATGLM_API_URL, VOICECHATGLM_API_KEY: process.env.VOICECHATGLM_API_KEY, UPSTREAM_TIMEOUT_MS: process.env.UPSTREAM_TIMEOUT_MS };
afterEach(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
function close(server: ReturnType<typeof createServer>) { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); }

describe('actual HTTP request lifecycle', () => {
  it('aborts a slow upstream health request after the browser connection closes', async () => {
    let started!: () => void; const startedPromise = new Promise<void>(resolve => { started = resolve; }); let closed!: () => void; const closedPromise = new Promise<void>(resolve => { closed = resolve; });
    const upstream = createServer((req, res) => { started(); req.once('aborted', closed); res.once('close', () => { if (!res.writableEnded) closed(); }); setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify({ status: 'late' })); }, 5_000); }); upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); const upstreamAddress = upstream.address(); const port = typeof upstreamAddress === 'object' && upstreamAddress ? upstreamAddress.port : 0;
    process.env.NODE_ENV = 'development'; process.env.VOICECHATGLM_API_URL = `http://127.0.0.1:${port}`; process.env.VOICECHATGLM_API_KEY = 'test-server-key'; process.env.UPSTREAM_TIMEOUT_MS = '10000';
    const proxy = createServer((req, res) => { void nodeHandler(req, res); }); proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening'); const proxyAddress = proxy.address(); const proxyPort = typeof proxyAddress === 'object' && proxyAddress ? proxyAddress.port : 0;
    try { const browser = httpRequest({ host: '127.0.0.1', port: proxyPort, path: '/api/health', method: 'GET' }); browser.on('error', () => undefined); browser.end(); await startedPromise; browser.destroy(); await expect(Promise.race([closedPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream was not aborted after client disconnect')), 2_000))])).resolves.toBeUndefined(); }
    finally { await close(proxy); await close(upstream); }
  });
});
