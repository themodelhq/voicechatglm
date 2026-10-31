import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url); const { buildReadinessReport, verifyProductionFileAnalysisDependencies, resetReadinessForTests } = require('../server/readiness.cjs') as typeof import('../server/readiness.cjs'); const { execute } = require('../server/proxy-core.cjs') as typeof import('../server/proxy-core.cjs');
afterEach(() => resetReadinessForTests());
describe('safe dependency readiness report', () => {
  it('distinguishes unconfigured required dependencies without exposing secrets or probing disabled file analysis', async () => {
    const env = { NODE_ENV: 'production', VOICECHATGLM_API_URL: 'https://model.example', FILE_ANALYSIS_ENABLED: 'false' } as NodeJS.ProcessEnv; const report = await buildReadinessReport(env); expect(report).toMatchObject({ ready: false, database: { configured: false, reachability: 'unreachable', migrations: 'not_checked' }, rateLimiter: { configured: false, reachability: 'unreachable' }, fileAnalysis: { enabled: false, mode: 'disabled', storage: { configured: false, reachability: 'not_configured' }, scanner: { configured: false, reachability: 'not_configured' } }, model: { endpointConfigured: true, credentialsConfigured: false, readinessProbe: 'not_configured' } }); expect(JSON.stringify(report)).not.toContain('DATABASE_URL'); expect(JSON.stringify(report)).not.toContain('password');
  });
  it('exposes only the safe report from the diagnostic route and never makes a model generation request', async () => {
    const env = { NODE_ENV: 'production', VOICECHATGLM_API_URL: 'https://model.example', FILE_ANALYSIS_ENABLED: 'false' } as NodeJS.ProcessEnv; const output = await execute('readiness', 'GET', undefined, { origin: 'https://app.example' }, { ...env, ALLOWED_ORIGINS: 'https://app.example' }); expect(output.statusCode).toBe(503); expect(output.headers['Access-Control-Allow-Origin']).toBe('https://app.example'); const body = JSON.parse(output.body); expect(body.model.readinessProbe).toBe('not_configured'); expect(body).not.toHaveProperty('key');
  });
  it('reports every missing mandatory dependency instead of treating an enabled flag as production readiness', async () => {
    const result = await verifyProductionFileAnalysisDependencies({ NODE_ENV: 'production', FILE_ANALYSIS_ENABLED: 'true' } as NodeJS.ProcessEnv); expect(result.ready).toBe(false); expect(result.missing).toEqual(expect.arrayContaining(['PostgreSQL migrations', 'shared Redis limiter', 'production file-analysis configuration', 'private object storage read/write/delete', 'malware scanner signatures', 'protected model readiness']));
  });
});

describe('Hugging Face Space readiness credentials', () => {
  it('does not consider the Space configured without both independent credentials', async () => {
    const report = await buildReadinessReport({ NODE_ENV: 'production', VOICECHATGLM_PROVIDER: 'huggingface_space', VOICECHATGLM_API_URL: 'https://example.hf.space', VOICECHATGLM_API_KEY: 'space-key', FILE_ANALYSIS_ENABLED: 'false' } as NodeJS.ProcessEnv);
    expect(report.model).toMatchObject({ endpointConfigured: false, credentialsConfigured: false, readinessProbe: 'not_configured' });
  });
});
