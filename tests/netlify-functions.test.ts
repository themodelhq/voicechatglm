import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Netlify same-origin API and static frontend boundary', () => {
  it('uses only the fixed Render API as a same-origin /api proxy', () => {
    const config = readFileSync('netlify.toml', 'utf8');
    expect(config).toContain('from = "/api/*"');
    expect(config).toContain('to = "https://voicechatglm.onrender.com/api/:splat"');
    expect(config).toContain('status = 200');
    expect(config).toContain('VITE_PROXY_BASE_URL=/api');
    expect(config).toContain('from = "/*"');
    expect(config).toContain('to = "/index.html"');
    expect(config.indexOf('from = "/api/*"')).toBeLessThan(config.indexOf('from = "/*"'));
  });
  it('forces Netlify builds to use the same-origin proxy regardless of a stale API URL setting', () => {
    const client = readFileSync('src/services/api/client.ts', 'utf8');
    expect(client).toContain("window.location.hostname.endsWith('.netlify.app')");
    expect(client).toContain("url.hostname.endsWith('.onrender.com')");
    expect(client).toContain("return { base: '/api' }");
  });
  it('registers a cache-busted service worker and disables HTTP cache for worker updates', () => {
    const entry = readFileSync('src/main.tsx', 'utf8');
    expect(entry).toContain("/sw.js?v=1.3.2");
    expect(entry).toContain("updateViaCache: 'none'");
    expect(entry).toContain('registration.update()');
  });
  it('keeps the exact inline-script CSP hash narrowly allowlisted', () => {
    const config = readFileSync('netlify.toml', 'utf8');
    const headers = readFileSync('public/_headers', 'utf8');
    const hash = "'sha256-BkKP2XO6WOEc3kXOiLr2ZoY83hamalKjPY9xBcbXVuw='";
    expect(config).toContain(hash);
    expect(headers).toContain(hash);
    expect(config).not.toContain("'unsafe-inline'");
  });
  it('never caches API responses and always returns a Response on offline fetch failures', () => {
    const worker = readFileSync('public/sw.js', 'utf8');
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("request.mode === 'navigate'");
    expect(worker).toContain("Response.error()");
    expect(worker).toContain("async () => {");
    expect(worker).toContain('voicechatglm-shell-v1.3.2');
    expect(worker).not.toContain(': undefined');
  });
});
