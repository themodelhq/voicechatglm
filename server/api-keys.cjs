/* Owner-managed external API key lifecycle. Keys are random bearer credentials, never sessions
 * and never upstream model credentials. Only an HMAC of the secret reaches PostgreSQL. */
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const API_KEY_PREFIX = 'vcg_';
const API_KEY_SCOPE = 'chat:write';
const SUPPORTED_SCOPES = new Set([API_KEY_SCOPE]);
const KEY_PATTERN = /^vcg_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;
function exactBoolean(env, name, fallback = false) { const raw = env?.[name]; if (raw === undefined || raw === '') return { value: fallback, valid: true }; if (raw === 'true') return { value: true, valid: true }; if (raw === 'false') return { value: false, valid: true }; return { value: false, valid: false }; }
function boundedInteger(env, name, fallback, minimum, maximum) { const raw = env?.[name]; if (raw === undefined || raw === '') return fallback; const value = Number(raw); return Number.isInteger(value) && value >= minimum && value <= maximum ? value : undefined; }
function apiKeyConfig(env = process.env) {
  const enabled = exactBoolean(env, 'PUBLIC_API_ENABLED'); const hashSecret = typeof env?.API_KEY_HASH_SECRET === 'string' && env.API_KEY_HASH_SECRET.trim().length >= 32 ? env.API_KEY_HASH_SECRET.trim() : undefined; const maxActiveKeys = boundedInteger(env, 'API_KEY_MAX_ACTIVE_KEYS', 50, 1, 500);
  const configured = Boolean(enabled.valid && hashSecret && maxActiveKeys);
  return { enabled: enabled.value, enabledValid: enabled.valid, configured, available: enabled.value && configured, hashSecret, maxActiveKeys: maxActiveKeys || 50, reason: !enabled.valid ? 'PUBLIC_API_ENABLED must be exactly true or false.' : !enabled.value ? 'External API access is disabled by deployment policy.' : !hashSecret ? 'API_KEY_HASH_SECRET must contain at least 32 characters.' : !maxActiveKeys ? 'API_KEY_MAX_ACTIVE_KEYS is outside its safe range.' : undefined };
}
function cleanName(value) { if (typeof value !== 'string') return undefined; const name = value.normalize('NFKC').trim(); return name.length >= 1 && name.length <= 80 && !/[\u0000-\u001f]/.test(name) ? name : undefined; }
function cleanDescription(value) { if (value === undefined || value === null || value === '') return undefined; if (typeof value !== 'string') return undefined; const description = value.normalize('NFKC').trim(); return description.length <= 500 && !/[\u0000-\u001f]/.test(description) ? description || undefined : undefined; }
function validatedScopes(value) { if (value === undefined) return [API_KEY_SCOPE]; if (!Array.isArray(value) || !value.length || value.length > SUPPORTED_SCOPES.size || value.some(scope => typeof scope !== 'string' || !SUPPORTED_SCOPES.has(scope))) return undefined; return [...new Set(value)].sort(); }
function validExpiration(value, now = Date.now()) { if (value === undefined || value === null || value === '') return { value: undefined }; if (typeof value !== 'string' || value.length > 80 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return { error: 'Expiration must be an ISO-8601 timestamp.' }; const parsed = new Date(value); if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= now) return { error: 'Expiration must be in the future.' }; return { value: parsed }; }
function generateApiKey() { const keyIdentifier = `${API_KEY_PREFIX}${randomBytes(12).toString('base64url')}`; const secret = randomBytes(32).toString('base64url'); return { keyIdentifier, secret, value: `${keyIdentifier}.${secret}` }; }
function parseApiKey(value) { if (typeof value !== 'string' || value.length > 200) return undefined; const match = KEY_PATTERN.exec(value.trim()); return match ? { keyIdentifier: `${API_KEY_PREFIX}${match[1]}`, secret: match[2] } : undefined; }
function hashApiSecret(secret, hashSecret) { return createHmac('sha256', hashSecret).update(String(secret), 'utf8').digest('hex'); }
function equalDigest(left, right) { if (typeof left !== 'string' || typeof right !== 'string' || !/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false; return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex')); }
function readBearerAuthorization(headers = {}) { const raw = headers.authorization ?? headers.Authorization; if (Array.isArray(raw) || typeof raw !== 'string' || raw.length > 240) return undefined; const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(raw.trim()); return match?.[1]; }
function publicApiError(code, message, status, retryAfter) { return { status, body: { error: { code, message } }, ...(retryAfter ? { retryAfter } : {}) }; }
async function authenticateApiKey({ headers, repository, configuration = apiKeyConfig() }) {
  if (!configuration.available) return { error: publicApiError('API_UNAVAILABLE', 'External API access is not configured for this deployment.', 503) };
  const parsed = parseApiKey(readBearerAuthorization(headers)); if (!parsed) return { error: publicApiError('INVALID_API_KEY', 'A valid bearer API key is required.', 401) };
  const credential = await repository.apiKeyCredential(parsed.keyIdentifier); if (!credential || !equalDigest(hashApiSecret(parsed.secret, configuration.hashSecret), credential.secretHash)) return { error: publicApiError('INVALID_API_KEY', 'A valid bearer API key is required.', 401) };
  if (credential.revokedAt || credential.expiresAt && new Date(credential.expiresAt).getTime() <= Date.now() || credential.userStatus !== 'active') return { error: publicApiError('INVALID_API_KEY', 'A valid bearer API key is required.', 401) };
  // This conditional write is a second, uncached revocation/expiry check. A concurrent revoke
  // therefore wins before the request reaches the protected model proxy.
  const touched = await repository.touchApiKeyLastUsed(credential.id); if (!touched) return { error: publicApiError('INVALID_API_KEY', 'A valid bearer API key is required.', 401) };
  return { value: { id: credential.id, keyIdentifier: credential.keyIdentifier, userId: credential.userId, scopes: credential.scopes } };
}
module.exports = { API_KEY_PREFIX, API_KEY_SCOPE, SUPPORTED_SCOPES, apiKeyConfig, cleanName, cleanDescription, validatedScopes, validExpiration, generateApiKey, parseApiKey, hashApiSecret, equalDigest, readBearerAuthorization, publicApiError, authenticateApiKey, exactBoolean, boundedInteger };
