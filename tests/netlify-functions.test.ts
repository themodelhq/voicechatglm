import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Netlify static frontend boundary', () => {
  it('does not package an alternative Netlify application API or a conflicting file-service bridge', () => {
    const config = readFileSync('netlify.toml', 'utf8');
    expect(config).not.toContain('functions =');
    expect(config).not.toContain('[[redirects]]\n  from = "/api');
    expect(existsSync('netlify/functions')).toBe(false);
  });
  it('keeps an SPA fallback while requiring an externally configured HTTPS Render API base', () => {
    const config = readFileSync('netlify.toml', 'utf8');
    expect(config).toContain('VITE_PROXY_BASE_URL');
    expect(config).toContain('from = "/*"');
    expect(config).toContain('to = "/index.html"');
  });
});
