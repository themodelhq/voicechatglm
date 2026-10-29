import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('deployment configuration', () => {
  it('keeps Netlify a static SPA without an API/function fallback', () => { const content = readFileSync('netlify.toml', 'utf8'); expect(content).toContain('VITE_PROXY_BASE_URL'); expect(content).toContain('NODE_VERSION = "20.20.2"'); expect(content).toContain('from = "/*"'); expect(content).toContain('publish = "dist"'); expect(content).not.toContain('from = "/api/chat"'); expect(content).not.toContain('functions ='); });
  it('declares Render first-party auth, PostgreSQL, shared protection, private storage and scanner prerequisites', () => { const content = readFileSync('render.yaml', 'utf8'); for (const key of ['healthCheckPath: /api/live', 'key: DATABASE_URL', 'key: SESSION_TOKEN_HASH_SECRET', 'key: SESSION_DEPLOYMENT_MODE', 'key: RATE_LIMIT_REDIS_URL', 'key: FILE_STORAGE_S3_BUCKET', 'key: FILE_SCAN_CLAMAV_HOST', 'key: CONVERSATION_SHARE_PUBLIC_BURST_PER_MINUTE']) expect(content).toContain(key); expect(content).not.toContain('AUTH_' + 'OIDC_'); expect(content).not.toContain('AUTH0'); });
  it('sets every requested feature gate in the activation blueprint while retaining a runtime fail-closed boundary', () => {
    const content = readFileSync('render.yaml', 'utf8');
    for (const key of ['FILE_ANALYSIS_ENABLED', 'WEB_SEARCH_ENABLED', 'WEB_SCRAPING_ENABLED', 'WRITING_WORKFLOW_ENABLED', 'ARTIFACT_DELIVERY_ENABLED', 'PERSISTENT_MEMORY_ENABLED', 'KNOWLEDGE_BASE_ENABLED', 'DATA_ANALYSIS_ENABLED', 'CONVERSATION_SHARING_ENABLED']) {
      expect(content).toMatch(new RegExp(`key: ${key}\\n\\s+value: \"true\"`));
    }
    expect(readFileSync('server/capabilities.cjs', 'utf8')).toContain('runtimeAvailability');
  });
  it('does not cache API traffic and bumps the static shell', () => { const worker = readFileSync('public/sw.js', 'utf8'); expect(worker).toContain("url.pathname.startsWith('/api/')"); expect(worker).toContain('voicechatglm-shell-v1.3.0'); });
  it('keeps root package and lockfile metadata aligned for this release', () => { const packageManifest = JSON.parse(readFileSync('package.json', 'utf8')); const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')); expect(packageManifest.version).toBe('1.3.0'); expect(lock.version).toBe(packageManifest.version); expect(lock.packages[''].version).toBe(packageManifest.version); });
  it('removes former third-party identity configuration and source dependency manifests', () => { const packageText = readFileSync('package.json', 'utf8'); const env = readFileSync('.env.example', 'utf8'); expect(packageText).not.toContain('@auth0' + '/auth0-react'); expect(env).not.toMatch(new RegExp(['AUTH_' + 'OIDC_', 'VITE_' + 'AUTH0_'].join('|'))); });
});
