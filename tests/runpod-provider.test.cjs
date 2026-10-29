const { describe, it, expect, vi, afterEach } = require('vitest');

describe('RunPod provider adapter', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('requires private provider credentials and keeps legacy as default', () => {
    const { runPodConfig } = require('../server/proxy-core.cjs');
    expect(runPodConfig({ VOICECHATGLM_PROVIDER: 'runpod' }).error).toBe('RunPod provider configuration');
    expect(runPodConfig({}).enabled).toBe(false);
    expect(runPodConfig({ VOICECHATGLM_PROVIDER: 'runpod', RUNPOD_ENDPOINT_ID: 'abcde', RUNPOD_API_KEY: 'test-secret' }).url).toBe('https://api.runpod.ai/v2/abcde');
  });
  it('maps completed RunPod output into the current response contract', async () => {
    const { callConfiguredModel } = require('../server/proxy-core.cjs');
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://api.runpod.ai/v2/abcde/runsync');
      expect(init.headers.Authorization).toBe('Bearer test-secret');
      expect(JSON.parse(init.body).input.message).toBe('hello');
      return { status: 200, text: async () => JSON.stringify({ status: 'COMPLETED', output: { ok: true, message: 'world', model: 'test-model' } }) };
    }));
    const result = await callConfiguredModel({ VOICECHATGLM_PROVIDER: 'runpod', RUNPOD_ENDPOINT_ID: 'abcde', RUNPOD_API_KEY: 'test-secret' }, '/v1/chat', { method: 'POST', body: JSON.stringify({ message: 'hello', max_new_tokens: 64 }) }, 1000);
    expect(result.status).toBe(200); expect(result.body.response).toBe('world'); expect(result.body.model).toBe('test-model');
  });
  it('returns an error instead of accepting unsuccessful model output', async () => {
    const { callConfiguredModel } = require('../server/proxy-core.cjs');
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, text: async () => JSON.stringify({ status: 'COMPLETED', output: { ok: false } }) })));
    const result = await callConfiguredModel({ VOICECHATGLM_PROVIDER: 'runpod', RUNPOD_ENDPOINT_ID: 'abcde', RUNPOD_API_KEY: 'test-secret' }, '/v1/chat', { method: 'POST', body: JSON.stringify({ message: 'hello' }) }, 1000);
    expect(result.status).toBe(502);
  });
});
