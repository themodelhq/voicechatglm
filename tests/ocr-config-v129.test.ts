// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { ocrConfig } = require('../server/advanced-services.cjs') as typeof import('../server/advanced-services.cjs');

describe('v1.2.9 strict OCR configuration profiles', () => {
  it('distinguishes an intentional disabled development profile from enabled-but-unavailable or invalid settings', () => {
    const disabled = ocrConfig({ NODE_ENV: 'development', KNOWLEDGE_OCR_PROFILE: 'development', KNOWLEDGE_OCR_ENABLED: 'false', KNOWLEDGE_OCR_PROVIDER: 'tesseract_js' });
    expect(disabled).toMatchObject({ profile: 'development', enabled: false, available: false, disabledByPolicy: true, reason: 'OCR is disabled by deployment policy.' });

    const invalidBoolean = ocrConfig({ NODE_ENV: 'test', KNOWLEDGE_OCR_PROFILE: 'test', KNOWLEDGE_OCR_ENABLED: 'yes' });
    expect(invalidBoolean).toMatchObject({ enabled: false, configured: false, available: false, disabledByPolicy: false, reason: 'KNOWLEDGE_OCR_ENABLED must be exactly true or false.' });

    const unavailable = ocrConfig({ NODE_ENV: 'test', KNOWLEDGE_OCR_PROFILE: 'test', KNOWLEDGE_OCR_ENABLED: 'true', KNOWLEDGE_OCR_LANGUAGE: 'fra' });
    expect(unavailable).toMatchObject({ enabled: true, configured: false, available: false, disabledByPolicy: false });
    expect(unavailable.reason).toMatch(/English language only/);
  });

  it('rejects unsupported providers, invalid profiles, remote languages, and out-of-range numeric limits', () => {
    expect(ocrConfig({ NODE_ENV: 'test', KNOWLEDGE_OCR_ENABLED: 'true', KNOWLEDGE_OCR_PROVIDER: 'binary_tesseract' })).toMatchObject({ available: false, reason: 'KNOWLEDGE_OCR_PROVIDER must be tesseract_js or remote.' });
    expect(ocrConfig({ NODE_ENV: 'test', KNOWLEDGE_OCR_ENABLED: 'true', KNOWLEDGE_OCR_PROFILE: 'preview' })).toMatchObject({ available: false, reason: 'KNOWLEDGE_OCR_PROFILE must be development, test, staging, or production.' });
    expect(ocrConfig({ NODE_ENV: 'test', KNOWLEDGE_OCR_ENABLED: 'true', KNOWLEDGE_OCR_PROVIDER: 'remote', KNOWLEDGE_OCR_SERVICE_URL: 'https://ocr.example', KNOWLEDGE_OCR_SERVICE_TOKEN: 'private-token', KNOWLEDGE_OCR_LANGUAGE: 'deu' })).toMatchObject({ available: false, reason: 'KNOWLEDGE_OCR_LANGUAGE must be eng for the supported OCR contract.' });
    expect(ocrConfig({ NODE_ENV: 'test', KNOWLEDGE_OCR_ENABLED: 'true', KNOWLEDGE_OCR_MAX_IMAGE_BYTES: '15' })).toMatchObject({ available: false, reason: 'OCR image-byte limit is invalid.' });
  });

  it('ships the v1.2.9 page-provenance migration for mixed and excluded results', () => {
    const migration = readFileSync('server/db/migrations/008_v129_mixed_pdf_page_provenance.sql', 'utf8');
    expect(migration).toContain("'native_text', 'ocr', 'mixed'");
    expect(migration).toContain("'completed', 'partial', 'failed', 'excluded'");
  });
});
