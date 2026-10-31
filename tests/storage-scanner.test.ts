import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url); const { objectStorageConfig } = require('../server/files/object-storage.cjs'); const { scannerConfig, scanBuffer, probeScanner } = require('../server/files/scanner.cjs');
describe('private object storage and malware scanner configuration', () => {
  it('requires private S3-compatible credentials and refuses insecure production endpoints', () => { expect(objectStorageConfig({ NODE_ENV: 'production' }).error).toBeTruthy(); expect(objectStorageConfig({ NODE_ENV: 'production', FILE_STORAGE_S3_BUCKET: 'private-bucket', FILE_STORAGE_S3_REGION: 'region', FILE_STORAGE_S3_ENDPOINT: 'http://storage.example', FILE_STORAGE_S3_ACCESS_KEY_ID: 'key', FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'secret' }).error).toBeTruthy(); expect(objectStorageConfig({ NODE_ENV: 'production', FILE_STORAGE_S3_BUCKET: 'private-bucket', FILE_STORAGE_S3_REGION: 'region', FILE_STORAGE_S3_ENDPOINT: 'https://storage.example', FILE_STORAGE_S3_ACCESS_KEY_ID: 'key', FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'secret' }).error).toBeUndefined(); });
  it('uses the real ClamAV INSTREAM protocol response shape and rejects infected content', async () => { let infected = false; const server = createServer(socket => { const chunks: Buffer[] = []; let replied = false; socket.on('data', value => { chunks.push(Buffer.from(value)); const combined = Buffer.concat(chunks); if (!replied && combined.subarray(-4).equals(Buffer.alloc(4))) { replied = true; socket.end(infected ? 'stream: test-signature FOUND\0' : 'stream: OK\0'); } }); }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); const configuration = scannerConfig({ NODE_ENV: 'test', FILE_SCAN_CLAMAV_HOST: '127.0.0.1', FILE_SCAN_CLAMAV_PORT: String(typeof address === 'object' && address ? address.port : 0), FILE_SCAN_TIMEOUT_MS: '1000' }); try { expect(await scanBuffer(Buffer.from('clean'), configuration)).toEqual({ clean: true }); infected = true; expect(await scanBuffer(Buffer.from('infected'), configuration)).toEqual({ clean: false }); } finally { await new Promise<void>(resolve => server.close(() => resolve())); } });
  it('requires a PING response and a reported ClamAV signature database before readiness succeeds', async () => { const server = createServer(socket => { socket.once('data', value => { const command = value.toString('utf8'); socket.end(command.includes('PING') ? 'PONG\0' : 'ClamAV 1.4.1/27123/Fri Oct 10 00:00:00 2026\0'); }); }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); const configuration = scannerConfig({ NODE_ENV: 'test', FILE_SCAN_CLAMAV_HOST: '127.0.0.1', FILE_SCAN_CLAMAV_PORT: String(typeof address === 'object' && address ? address.port : 0), FILE_SCAN_TIMEOUT_MS: '1000' }); try { await expect(probeScanner(configuration)).resolves.toEqual({ signatures: 'available' }); } finally { await new Promise<void>(resolve => server.close(() => resolve())); } });
});


describe('Hugging Face Gradio ClamAV scanner', () => {
  it('validates HTTPS endpoint and independent scanner credentials', () => {
    expect(scannerConfig({ NODE_ENV: 'production', FILE_SCAN_PROVIDER: 'huggingface_space', FILE_SCAN_API_URL: 'https://example.hf.space', FILE_SCAN_API_KEY: 'a'.repeat(32) })).toMatchObject({ provider: 'huggingface_space', url: 'https://example.hf.space', maxFileBytes: 8 * 1024 * 1024 });
    expect(scannerConfig({ NODE_ENV: 'production', FILE_SCAN_PROVIDER: 'huggingface_space', FILE_SCAN_API_URL: 'http://example.hf.space', FILE_SCAN_API_KEY: 'a'.repeat(32) }).error).toBeTruthy();
    expect(scannerConfig({ NODE_ENV: 'production', FILE_SCAN_PROVIDER: 'huggingface_space', FILE_SCAN_API_URL: 'https://example.hf.space', FILE_SCAN_API_KEY: 'short' }).error).toBeTruthy();
  });

  it('submits health and file scans through authenticated Gradio queue calls and accepts only explicit clean/infected results', async () => {
    const seen: Array<{ path: string; key: string; body?: any }> = [];
    let infected = false;
    const server = createHttpServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf8');
      const key = String(req.headers['x-api-key'] || '');
      seen.push({ path: req.url || '', key, body: raw ? JSON.parse(raw) : undefined });
      if (req.method === 'POST' && req.url === '/gradio_api/call/scanner_health') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ event_id: 'health-event-123' })); return;
      }
      if (req.method === 'POST' && req.url === '/gradio_api/call/scan_file') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ event_id: 'scan-event-123' })); return;
      }
      if (req.method === 'GET' && req.url === '/gradio_api/call/scanner_health/health-event-123') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('event: complete\\ndata: [{"status":"ready","engine":"clamav","max_file_bytes":8388608}]\\n\\n'); return;
      }
      if (req.method === 'GET' && req.url === '/gradio_api/call/scan_file/scan-event-123') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(`event: complete\\ndata: [${JSON.stringify({ status: infected ? 'infected' : 'clean', infected, engine: 'clamav' })}]\\n\\n`); return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address();
    const configuration = scannerConfig({
      NODE_ENV: 'test',
      FILE_SCAN_PROVIDER: 'huggingface_space',
      FILE_SCAN_API_URL: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
      FILE_SCAN_API_KEY: 'test-scanner-key-'.padEnd(32, 'x'),
      FILE_SCAN_TIMEOUT_MS: '3000',
    });
    try {
      expect(await probeScanner(configuration)).toMatchObject({ signatures: 'available', maxFileBytes: 8388608 });
      expect(await scanBuffer(Buffer.from('ordinary clean file'), configuration)).toEqual({ clean: true });
      infected = true;
      expect(await scanBuffer(Buffer.from('EICAR test bytes'), configuration)).toEqual({ clean: false });
      expect(seen.every(item => item.key === configuration.apiKey)).toBe(true);
      const submission = seen.find(item => item.path === '/gradio_api/call/scan_file');
      expect(submission.body.data[0]).toBe(Buffer.from('EICAR test bytes').toString('base64'));
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('fails closed when the Gradio scanner returns an error event', async () => {
    const server = createHttpServer(async (req, res) => {
      for await (const _chunk of req) { /* consume request */ }
      if (req.method === 'POST') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ event_id: 'scan-event-123' })); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('event: error\\ndata: null\\n\\n');
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address();
    const configuration = scannerConfig({ NODE_ENV: 'test', FILE_SCAN_PROVIDER: 'huggingface_space', FILE_SCAN_API_URL: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`, FILE_SCAN_API_KEY: 'test-scanner-key-'.padEnd(32, 'x'), FILE_SCAN_TIMEOUT_MS: '3000' });
    try { await expect(scanBuffer(Buffer.from('file'), configuration)).rejects.toThrow(/scanner reported an error/i); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
