import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { analysisJobDiagnostic } = require('../server/files/router.cjs') as { analysisJobDiagnostic: (job: any) => Record<string, unknown> };

describe('durable file-analysis upstream diagnostics', () => {
  it('returns only validated upstream metadata persisted with a failed job', () => {
    expect(analysisJobDiagnostic({
      error_code: 'UPSTREAM_RATE_LIMIT',
      progress: {
        diagnosticStage: 'model_analysis',
        upstreamDiagnostic: {
          upstreamCode: 'UPSTREAM_RATE_LIMIT',
          upstreamMessage: 'ZeroGPU scheduler rejected the request.',
          upstreamStatus: 429,
          upstreamRequestId: 'hf-request-123',
          upstreamRetryAfter: '12',
          privateCredential: 'must-not-be-returned'
        }
      }
    })).toEqual({
      code: 'UPSTREAM_RATE_LIMIT',
      stage: 'model_analysis',
      upstream_code: 'UPSTREAM_RATE_LIMIT',
      upstream_message: 'ZeroGPU scheduler rejected the request.',
      upstream_status: 429,
      upstream_request_id: 'hf-request-123',
      upstream_retry_after: '12'
    });
  });

  it('omits malformed upstream values and bounds the message length', () => {
    const result = analysisJobDiagnostic({
      error_code: 'bad code',
      progress: {
        diagnosticStage: 'INVALID STAGE!',
        upstreamDiagnostic: {
          upstreamCode: 'bad code',
          upstreamMessage: 'x'.repeat(700),
          upstreamStatus: 700,
          upstreamRequestId: 'bad request id',
          upstreamRetryAfter: '12 seconds'
        }
      }
    });
    expect(result).toEqual({ upstream_message: 'x'.repeat(500) });
  });
});
