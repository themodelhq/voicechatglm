import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { nodeHandler } = require('../server/proxy-core.cjs') as { nodeHandler: (request: any, response: any) => void };
const { resetForTests } = require('../server/files/storage.cjs') as { resetForTests: () => void };

const original = { NODE_ENV: process.env.NODE_ENV, VOICECHATGLM_API_URL: process.env.VOICECHATGLM_API_URL, VOICECHATGLM_API_KEY: process.env.VOICECHATGLM_API_KEY, FILE_ANALYSIS_ENABLED: process.env.FILE_ANALYSIS_ENABLED, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS };
afterEach(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } resetForTests(); });

describe('restricted Node file service', () => {
  it('accepts multipart text and analyzes it only through the protected proxy path', async () => {
    let upstreamPayload: Record<string, unknown> | undefined;
    const server = createServer((request, response) => {
      if (request.url === '/v1/chat') { const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(Buffer.from(chunk))); request.on('end', () => { upstreamPayload = JSON.parse(Buffer.concat(chunks).toString('utf8')); response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ response: 'Grounded response' })); }); return; }
      void nodeHandler(request, response);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    process.env.NODE_ENV = 'development'; process.env.VOICECHATGLM_API_URL = base; process.env.VOICECHATGLM_API_KEY = 'test-only-key'; process.env.FILE_ANALYSIS_ENABLED = 'true'; delete process.env.ALLOWED_ORIGINS; const ownerHeaders = { 'X-VoiceChatGLM-Dev-Session': 'test_development_session_123456' };
    try {
      const boundary = '----VoiceChatGLMTestBoundary'; const body = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="facts.txt"\r\nContent-Type: text/plain\r\n\r\nfirst fact\nsecond fact\r\n--${boundary}--\r\n`;
      const upload = await fetch(`${base}/api/files`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, ...ownerHeaders }, body }); expect(upload.status).toBe(201); const uploaded = await upload.json() as { files: Array<{ id: string; filename: string; type: string; analysisAvailable: boolean }> }; expect(uploaded.files[0]).toEqual(expect.objectContaining({ filename: 'facts.txt', type: 'text', analysisAvailable: true }));
      const fileId = uploaded.files[0].id; const analysis = await fetch(`${base}/api/files/${fileId}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ownerHeaders }, body: JSON.stringify({ file_ids: [fileId], question: 'Summarize the facts.' }) }); expect(analysis.status).toBe(200); expect((await analysis.json() as { response: string }).response).toBe('Grounded response'); expect(upstreamPayload).toEqual(expect.objectContaining({ max_new_tokens: 768, message: expect.stringContaining('[Source 1: facts.txt'), system_prompt: expect.stringContaining('untrusted') }));
      const afterSuccess = await fetch(`${base}/api/files/${fileId}/status`, { headers: ownerHeaders }); expect(afterSuccess.status).toBe(200);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
