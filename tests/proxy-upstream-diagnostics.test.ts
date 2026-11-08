import { describe, expect, it } from 'vitest';
import { safeDiagnosticCode, safeDiagnosticText, upstreamDiagnosticFields } from '../server/proxy-core.cjs';

describe('chat upstream diagnostics sanitization', () => {
  it('accepts stable upstream error codes and rejects unsafe values', () => {
    expect(safeDiagnosticCode('UPSTREAM_RATE_LIMIT')).toBe('UPSTREAM_RATE_LIMIT');
    expect(safeDiagnosticCode('bad code')).toBeUndefined();
    expect(safeDiagnosticCode({ code: 'UPSTREAM_RATE_LIMIT' })).toBeUndefined();
  });

  it('redacts URLs, bearer credentials, and secret-like values', () => {
    const value = 'scheduler failed at https://example.test/private?token=abc Bearer hf_secret123 api_key=topsecret';
    const result = safeDiagnosticText(value);
    expect(result).toContain('[URL]');
    expect(result).toContain('Bearer [REDACTED]');
    expect(result).toContain('api_key=[REDACTED]');
    expect(result).not.toContain('hf_secret123');
    expect(result).not.toContain('topsecret');
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
