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
    expect(worker).toContain('voicechatglm-shell-v1.3.1');
    expect(worker).not.toContain(': undefined');
  });
});
