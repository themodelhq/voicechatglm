/* Narrow, versioned server-to-server integration API. It cannot choose an upstream, read files,
 * administer users, or bypass the fixed protected model proxy. */
const { randomUUID } = require('node:crypto');
const { apiKeyConfig, API_KEY_SCOPE, authenticateApiKey, publicApiError } = require('./api-keys.cjs');
const { textFromModel } = require('./writing.cjs');
const { reserveApi } = require('./rate-limit.cjs');

const MAX_PUBLIC_MESSAGE = 12_000; const MAX_PUBLIC_SYSTEM_PROMPT = 16_000;
function externalChatRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Send a JSON object.' };
  const allowed = new Set(['message', 'max_new_tokens', 'system_prompt']); if (Object.keys(value).some(key => !allowed.has(key))) return { error: 'Request contains an unsupported field.' };
  const message = value.message; const maximum = value.max_new_tokens === undefined ? 768 : value.max_new_tokens; const system = value.system_prompt;
  if (typeof message !== 'string' || !message.trim()) return { error: 'A non-empty message is required.' };
  if (message.length > MAX_PUBLIC_MESSAGE) return { error: `message must be at most ${MAX_PUBLIC_MESSAGE} characters.` };
  if (!Number.isInteger(maximum) || maximum < 32 || maximum > 4096) return { error: 'max_new_tokens must be an integer from 32 to 4096.' };
  if (system !== undefined && (typeof system !== 'string' || system.length > MAX_PUBLIC_SYSTEM_PROMPT)) return { error: 'system_prompt is invalid.' };
  return { value: { message: message.trim(), max_new_tokens: maximum, ...(system?.trim() ? { system_prompt: system.trim() } : {}) } };
}
function hasScope(scopes, scope) { return Array.isArray(scopes) && scopes.includes(scope); }
function safeUpstreamError(status) { if (status === 429) return publicApiError('MODEL_BUSY', 'The protected model service is temporarily busy. Retry later.', 503, 5); if (status >= 500) return publicApiError('MODEL_UNAVAILABLE', 'The protected model service is temporarily unavailable.', 503, 5); return publicApiError('MODEL_REJECTED', 'The protected model service could not accept this request.', 502); }
async function handlePublicApi({ route, method, body, headers, repository, limiter, rateLimit, callModel, signal, env = process.env }) {
  if (route === 'v1/health') return method === 'GET' ? { status: 200, body: { status: 'ok', service: 'voicechatglm', apiVersion: 'v1' } } : publicApiError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  if (route !== 'v1/chat') return publicApiError('NOT_FOUND', 'Route not found.', 404);
  if (method !== 'POST') return publicApiError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  const configuration = apiKeyConfig(env); let authenticated;
  try { authenticated = await authenticateApiKey({ headers, repository, configuration }); } catch { return publicApiError('AUTH_UNAVAILABLE', 'API authentication is temporarily unavailable.', 503); }
  if (authenticated.error) return authenticated.error;
  if (!hasScope(authenticated.value.scopes, API_KEY_SCOPE)) return publicApiError('INSUFFICIENT_SCOPE', 'This API key does not have the required chat:write scope.', 403);
  const checked = externalChatRequest(body); if (checked.error) return publicApiError('INVALID_REQUEST', checked.error, 400);
  const reservation = await reserveApi(limiter, rateLimit, { userId: authenticated.value.userId, keyId: authenticated.value.id });
  if (reservation.unavailable) return publicApiError('CAPACITY_UNAVAILABLE', 'API capacity protection is temporarily unavailable.', 503);
  if (!reservation.allowed) return publicApiError(reservation.reason === 'capacity' ? 'CAPACITY_LIMITED' : 'RATE_LIMITED', reservation.reason === 'capacity' ? 'Temporary API concurrency capacity is full. Retry shortly.' : 'Temporary API burst protection is active. Retry shortly.', 429, reservation.retryAfter || 1);
  try {
    const upstream = await callModel(checked.value, signal);
    if (upstream.status < 200 || upstream.status >= 300) return safeUpstreamError(upstream.status);
    const response = textFromModel(upstream.body && typeof upstream.body === 'object' ? upstream.body : { response: '' });
    if (!response) return publicApiError('INVALID_MODEL_RESPONSE', 'The protected model returned an empty or unsupported response.', 502);
    return { status: 200, body: { id: randomUUID(), object: 'chat.completion', created: new Date().toISOString(), model: 'themodelhq/voicechatglm-qwen3-8b', output: { text: response }, usage: { generatedBy: 'voicechatglm' } } };
  } catch (caught) { return publicApiError(caught?.name === 'AbortError' ? 'MODEL_TIMEOUT' : 'MODEL_UNAVAILABLE', caught?.name === 'AbortError' ? 'The protected model request timed out.' : 'The protected model service could not be reached.', caught?.name === 'AbortError' ? 504 : 502, caught?.name === 'AbortError' ? undefined : 5); }
  finally { await reservation.release?.(); }
}
module.exports = { MAX_PUBLIC_MESSAGE, MAX_PUBLIC_SYSTEM_PROMPT, externalChatRequest, hasScope, handlePublicApi };
