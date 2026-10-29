import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { redactStandaloneExtraction } = require('../server/files/router.cjs') as { redactStandaloneExtraction: (value: any, filename: string) => any };
const { analyzeRecords, MAX_MODEL_WINDOWS, validateAnalysisRequest } = require('../server/files/analysis.cjs') as { analyzeRecords: (options: any) => Promise<any>; MAX_MODEL_WINDOWS: number; validateAnalysisRequest: (input: unknown) => any };

describe('production document-analysis safeguards', () => {
  it('only accepts UUID-shaped durable conversation/message references for persisted analysis', () => { const accepted = validateAnalysisRequest({ file_ids: ['file-1'], question: 'Review this', conversation_id: '00000000-0000-4000-8000-000000000301', client_message_id: '00000000-0000-4000-8000-000000000302', assistant_message_id: '00000000-0000-4000-8000-000000000303' }); expect(accepted.value).toMatchObject({ conversationId: '00000000-0000-4000-8000-000000000301', clientMessageId: '00000000-0000-4000-8000-000000000302', assistantMessageId: '00000000-0000-4000-8000-000000000303' }); expect(validateAnalysisRequest({ file_ids: ['file-1'], question: 'Review this', assistant_message_id: 'not-a-uuid' }).error).toMatch(/assistant_message_id/i); });
  it('redacts standalone document secrets before an extraction artifact or model payload can use them', () => {
    const output = redactStandaloneExtraction({ text: 'deployment token=real-secret-value\nordinary fact', analysisAvailable: true, notices: [], sources: [{ filename: 'notes.txt', location: 'text document' }] }, 'notes.txt');
    expect(output.text).not.toContain('real-secret-value'); expect(output.text).toContain('[REDACTED]'); expect(output.notices).toEqual(expect.arrayContaining([expect.stringMatching(/redacted/i)]));
  });
  it('excludes standalone private-key material instead of sending it to the model', () => {
    const output = redactStandaloneExtraction({ text: '-----BEGIN PRIVATE KEY-----\nvery-secret\n-----END PRIVATE KEY-----', analysisAvailable: true, notices: [], sources: [{ filename: 'key.txt', location: 'text document' }] }, 'key.txt');
    expect(output.analysisAvailable).toBe(false); expect(output.contentAnalysisAvailable).toBe(false); expect(output.text).toBe('');
  });
  it('uses bounded sequential model windows and reports when remaining document content was not processed', async () => {
    const calls: any[] = []; const record = { id: 'f-1', filename: 'large.txt', type: 'text', extraction: { text: 'evidence '.repeat(4_000), analysisAvailable: true, sources: [{ filename: 'large.txt', location: 'text document' }], notices: [] } };
    const output = await analyzeRecords({ ownerId: 'owner', records: [record], request: { question: 'What evidence is present?', maxNewTokens: 64 }, callModel: async (payload: any) => { calls.push(payload); return { status: 200, body: { response: `window-${calls.length}` } }; } });
    expect(calls).toHaveLength(MAX_MODEL_WINDOWS); expect(output.analysisWindows).toBe(MAX_MODEL_WINDOWS); expect(output.partial).toBe(true); expect(output.response).toContain('bounded source windows'); expect(calls.every(call => String(call.message).includes('untrusted evidence'))).toBe(true);
  });
});
