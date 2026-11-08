import { afterEach, describe, expect, it, vi } from 'vitest';
import { callHuggingFaceModel, parseGradioCompletion, safeDiagnosticCode, safeDiagnosticText, safeHuggingFaceHttpDiagnostic, upstreamDiagnosticFields } from '../server/proxy-core.cjs';

describe('chat upstream diagnostics sanitization', () => {
  it('accepts stable upstream error codes and rejects unsafe values', () => {
    expect(safeDiagnosticCode('UPSTREAM_RATE_LIMIT')).toBe('UPSTREAM_RATE_LIMIT');
    expect(safeDiagnosticCode('bad code')).toBeUndefined();
    expect(safeDiagnosticCode({ code: 'UPSTREAM_RATE_LIMIT' })).toBeUndefined();
  });

  it('redacts URLs, bearer credentials, and secret-like values', () => {
    const value = 'scheduler failed at https://example.test/private?token=abc Bearer hf_secret123 Authorization: Bearer auth_secret123 api_key=topsecret';
    const result = safeDiagnosticText(value);
    expect(result).toContain('[URL]');
    expect(result).toContain('Bearer [REDACTED]');
    expect(result).toContain('api_key=[REDACTED]');
    expect(result).not.toContain('hf_secret123');
    expect(result).not.toContain('topsecret');
    expect(result).not.toContain('auth_secret123');
  });

  it('limits diagnostic text and ignores missing or non-string values', () => {
    expect(safeDiagnosticText('x'.repeat(700))).toHaveLength(500);
    expect(safeDiagnosticText('  ')).toBeUndefined();
    expect(safeDiagnosticText({ message: 'private' })).toBeUndefined();
  });
});

describe('chat upstream diagnostic fields', () => {
  it('preserves a validated upstream code and sanitised message', () => {
    const fields = upstreamDiagnosticFields({
      upstreamCode: 'UPSTREAM_RATE_LIMIT',
      upstreamMessage: 'ZeroGPU scheduler rejected request. Bearer hf_secret123',
      upstreamStatus: 429
    });
    expect(fields).toEqual({
      upstream_code: 'UPSTREAM_RATE_LIMIT',
      upstream_message: 'ZeroGPU scheduler rejected request. Bearer [REDACTED]',
      upstream_status: 429
    });
  });

  it('omits absent, invalid, and out-of-range upstream fields', () => {
    expect(upstreamDiagnosticFields({ upstreamCode: 'not safe', upstreamMessage: '', upstreamStatus: 700 })).toEqual({});
  });
});

describe('Hugging Face ZeroGPU rate-limit handling', () => {
  afterEach(() => vi.unstubAllGlobals());

  const env = {
    VOICECHATGLM_API_URL: 'https://voicechatglm-inference.hf.space',
    VOICECHATGLM_API_KEY: 'test-app-key',
    HF_TOKEN: 'hf_test_token'
  };

  it('does not create new generation submissions after a scheduler event:error 429', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ event_id: 'eventid123456' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'event: error\ndata: {"error":"Too Many Requests from device-api.zero/schedule"}\n\n'
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(callHuggingFaceModel(env, '/v1/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'Hello', max_new_tokens: 64 })
    }, 60000)).rejects.toMatchObject({
      code: 'MODEL_UPSTREAM_ERROR',
      upstreamCode: 'UPSTREAM_RATE_LIMIT'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not resubmit when the Gradio submission endpoint itself returns HTTP 429', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: async () => JSON.stringify({ detail: 'Too Many Requests' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callHuggingFaceModel(env, '/v1/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'Hello', max_new_tokens: 64 })
    }, 60000);
    expect(result.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});


describe('upstream diagnostic edge cases', () => {
  it('redacts Authorization bearer values as a single credential', () => {
    const result = safeHuggingFaceHttpDiagnostic(
      { status: 403, headers: { get: () => null } },
      JSON.stringify({ detail: 'Authorization: Bearer secret-value' }),
      'submission'
    );
    expect(result.upstream_message).not.toContain('secret-value');
  });

  it('extracts nested runtime scheduler and worker messages', () => {
    expect(() => parseGradioCompletion(
      'event: error\\ndata: {"type":"runtime_failure","data":{"message_text":"CUDA worker allocation failed"}}\\n\\n'
    )).toThrow(expect.objectContaining({ upstreamMessage: expect.stringContaining('CUDA worker allocation failed') }));
  });
});
