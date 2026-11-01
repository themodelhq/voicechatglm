/* Render application boundary: first-party sessions, shared protection, and fixed model proxy. */
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { authConfig, repositoryFor, currentSession } = require('./auth.cjs');
const { handleAuthRoute } = require('./auth-routes.cjs');
const { handleApiKeyRoute } = require('./api-key-routes.cjs');
const { apiKeyConfig } = require('./api-keys.cjs');
const { handlePublicApi } = require('./public-api.cjs');
const { rateLimitConfig, limiterFor, limiterAvailable, reserveChat, consumeAuthAttempt, consumeUserAction, resetRateLimitForTests: resetLimiter } = require('./rate-limit.cjs');
const { invalidPolicyConfiguration, fileAnalysisConfig } = require('./files/policy.cjs');
const { nodeFileHandler } = require('./files/router.cjs');
const { databaseReady, databaseConfig } = require('./db/pool.cjs');
const { readinessReport } = require('./readiness.cjs');
const { routeChat } = require('./intent-router.cjs');
const { capabilitySnapshot } = require('./capabilities.cjs');
const { handleWritingRoute } = require('./writing-routes.cjs');
const { webSearchConfig } = require('./web-search.cjs');
const { webRetrievalConfig } = require('./web-retrieval.cjs');
const { writingConfig, textFromModel } = require('./writing.cjs');
const { handleConversationRoute } = require('./conversation-routes.cjs');
const { handleArtifactRoute } = require('./artifact-routes.cjs');
const { handleMemoryRoute } = require('./memory-routes.cjs');
const { handleKnowledgeRoute } = require('./knowledge-routes.cjs');
const { handleDataAnalysisRoute } = require('./data-analysis-routes.cjs');
const { handleScrapeJobRoute } = require('./scrape-job-routes.cjs');
const { handleShareRoute, handlePublicShare, shareConfig } = require('./share-routes.cjs');
const { artifactConfig, persistGeneratedArtifact } = require('./artifacts.cjs');
const { knowledgeConfig } = require('./knowledge.cjs');
const { dataAnalysisConfig } = require('./data-analysis.cjs');
const { memoryConfig, memoryPrompt } = require('./memory.cjs');
const { ocrConfig, semanticConfig, sandboxConfig, browserRendererConfig } = require('./advanced-services.cjs');
const { createObjectStore } = require('./files/object-storage.cjs');
const MAX_BODY_BYTES = 64 * 1024; const MAX_MESSAGE = 12_000; const MAX_SYSTEM_PROMPT = 16_000; const MODEL_ID = 'themodelhq/voicechatglm-qwen3-8b'; const MODEL_REVISION = '9f25d05035bfda0de9b36dfc5911ddcdb378f3c8';
function modelAssertionError(env, production) { return !production || env.VOICECHATGLM_MODEL_ID === MODEL_ID && env.VOICECHATGLM_MODEL_REVISION === MODEL_REVISION ? undefined : 'model assertion'; }
function bounded(env, name, fallback, minimum, maximum) { const value = Number(env[name]); return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback; }
function configuredOrigins(env, production) { const values = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean); if (!production) return { values }; if (!values.length) return { values, error: 'allowed origins' }; for (const origin of values) { try { const parsed = new URL(origin); if (parsed.protocol !== 'https:' || parsed.origin !== origin || /\*/.test(origin)) throw new Error(); } catch { return { values, error: 'allowed origins' }; } } return { values }; }
function modelEndpoint(env, production) { const raw = typeof env.VOICECHATGLM_API_URL === 'string' ? env.VOICECHATGLM_API_URL.trim() : ''; if (!raw) return { error: 'model endpoint' }; try { const url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol) || production && url.protocol !== 'https:' || url.username || url.password) throw new Error(); return { url: url.toString().replace(/\/$/, '') }; } catch { return { error: 'model endpoint' }; } }
function trustedProxyConfigurationError(env) { if (env.TRUST_PROXY_CLIENT_IP !== 'true') return undefined; const header = String(env.TRUSTED_PROXY_CLIENT_IP_HEADER || '').toLowerCase(); const rawPeers = String(env.TRUSTED_PROXY_PEERS || '').split(',').map(value => value.trim()).filter(Boolean); const peers = rawPeers.map(validIp); return rawPeers.length && peers.every(Boolean) && ['x-forwarded-for', 'x-nf-client-connection-ip'].includes(header) ? undefined : 'trusted-proxy settings'; }
function config(env = process.env) {
  const production = env.NODE_ENV === 'production'; const provider = String(env.VOICECHATGLM_PROVIDER || 'legacy').trim().toLowerCase(); const hf = provider === 'huggingface_space' ? huggingFaceConfig(env) : undefined; const runpod = runPodConfig(env); const endpoint = modelEndpoint(env, production);
  const assertion = modelAssertionError(env, production); const key = typeof env.VOICECHATGLM_API_KEY === 'string' && env.VOICECHATGLM_API_KEY.trim() ? env.VOICECHATGLM_API_KEY : undefined;
  const origins = configuredOrigins(env, production); const auth = authConfig(env); const rateLimit = rateLimitConfig(env); const files = fileAnalysisConfig(env);
  const timeoutRaw = env.UPSTREAM_TIMEOUT_MS; const maxTimeout = runpod.enabled ? 360000 : 120000;
  const timeoutValid = timeoutRaw === undefined || Number.isInteger(Number(timeoutRaw)) && Number(timeoutRaw) >= 1000 && Number(timeoutRaw) <= maxTimeout;
  const proxyError = trustedProxyConfigurationError(env);
  const providerInvalid = provider === 'huggingface_space' ? Boolean(hf?.error || production && assertion) : provider === 'runpod' ? Boolean(runpod.error) : provider !== 'legacy' || !endpoint.url || !key || Boolean(production && assertion);
  const runpodCredentialInvalid = runpod.enabled && Boolean(key && key === runpod.apiKey);
  if (providerInvalid || runpodCredentialInvalid || production && (origins.error || !auth.enabled || rateLimit.error || !timeoutValid || proxyError || files.enabled === false && env.FILE_ANALYSIS_ENABLED === 'true')) return { error: 'The application API is not configured.', origins: origins.values, production, auth, rateLimit, files };
  return { url: provider === 'huggingface_space' ? hf.base : runpod.enabled ? runpod.url : endpoint.url, key: runpod.enabled ? runpod.apiKey : key, timeout: bounded(env, 'UPSTREAM_TIMEOUT_MS', runpod.enabled ? 240000 : 60000, 1000, maxTimeout), origins: origins.values, production, auth, rateLimit, files, provider: provider === 'huggingface_space' ? 'huggingface_space' : runpod.enabled ? 'runpod' : 'legacy' };
}
function startupConfigurationErrors(env = process.env) { if (env.NODE_ENV !== 'production') return []; const errors = []; const provider = String(env.VOICECHATGLM_PROVIDER || 'legacy').trim().toLowerCase(); const runpod = runPodConfig(env); if (provider === 'huggingface_space') { const hf = huggingFaceConfig(env); if (hf.error) errors.push(hf.error); if (modelAssertionError(env, true)) errors.push('model assertion'); } else if (provider === 'runpod') { if (runpod.error) errors.push('RunPod provider configuration'); } else { if (provider !== 'legacy') errors.push('model provider'); if (!modelEndpoint(env, true).url) errors.push('model endpoint'); if (modelAssertionError(env, true)) errors.push('model assertion'); if (!(typeof env.VOICECHATGLM_API_KEY === 'string' && env.VOICECHATGLM_API_KEY.trim())) errors.push('model credentials'); } if (configuredOrigins(env, true).error) errors.push('allowed origins'); if (!authConfig(env).enabled) { errors.push('first-party authentication'); if (databaseConfig(env).error) errors.push('database configuration'); } const rate = rateLimitConfig(env); if (rate.error) errors.push('shared rate limiter'); const timeout = env.UPSTREAM_TIMEOUT_MS; if (runpod.enabled && env.VOICECHATGLM_API_KEY && env.RUNPOD_API_KEY && env.VOICECHATGLM_API_KEY === env.RUNPOD_API_KEY) errors.push('separate RunPod credentials'); const maxTimeout = runpod.enabled ? 360000 : 120000; if (timeout !== undefined && (!Number.isInteger(Number(timeout)) || Number(timeout) < 1000 || Number(timeout) > maxTimeout)) errors.push('upstream timeout'); const trusted = trustedProxyConfigurationError(env); if (trusted) errors.push(trusted); if (invalidPolicyConfiguration(env)) errors.push('file-analysis limits'); if (env.FILE_ANALYSIS_ENABLED === 'true' && !fileAnalysisConfig(env).enabled) errors.push('production file analysis'); const search = webSearchConfig(env); if (search.enabled && !search.configured) errors.push('web-search configuration'); const scraping = webRetrievalConfig(env); if (scraping.enabled && !scraping.configured) errors.push('website-retrieval configuration'); const writing = writingConfig(env); if (writing.enabled && !writing.configured) errors.push('writing-workflow configuration'); const artifacts = artifactConfig(env); if (artifacts.enabled && !artifacts.configured) errors.push('artifact-delivery configuration'); const knowledge = knowledgeConfig(env); if (knowledge.enabled && !knowledge.configured) errors.push('knowledge-base configuration'); const memory = memoryConfig(env); if (memory.enabled && !memory.configured) errors.push('persistent-memory configuration'); const dataAnalysis = dataAnalysisConfig(env); if (dataAnalysis.enabled && !dataAnalysis.configured) errors.push('data-analysis configuration'); const shares = shareConfig(env); if (shares.enabled && !shares.configured) errors.push('conversation-sharing configuration'); const ocr = ocrConfig(env); if (!ocr.disabledByPolicy && (!ocr.enabled || !ocr.configured)) errors.push('knowledge-ocr configuration'); const semantic = semanticConfig(env); if (semantic.enabled && !semantic.configured) errors.push('semantic-retrieval configuration'); const sandbox = sandboxConfig(env); if (sandbox.enabled && !sandbox.configured) errors.push('isolated-analysis configuration'); const browser = browserRendererConfig(env); if (browser.enabled && !browser.configured) errors.push('browser-rendering configuration'); const publicApi = apiKeyConfig(env); if (!publicApi.enabledValid || publicApi.enabled && !publicApi.configured) errors.push('public API-key configuration'); return [...new Set(errors)]; }
function allowedOrigin(origin, cfg) { return !origin || cfg.origins.includes(origin) || !cfg.production && cfg.origins.length === 0; }
function securityHeaders(origin, cfg) { const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' }; if (origin && allowedOrigin(origin, cfg)) { headers['Access-Control-Allow-Origin'] = origin; headers['Access-Control-Allow-Credentials'] = 'true'; headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS'; headers['Access-Control-Allow-Headers'] = 'Content-Type, X-CSRF-Token'; headers['Access-Control-Max-Age'] = '600'; } return headers; }
function response(status, payload, origin, cfg, extraHeaders = {}) { return { statusCode: status, headers: { ...securityHeaders(origin, cfg), ...extraHeaders }, body: status === 204 ? '' : JSON.stringify(payload) }; }
function error(status, message, origin, cfg, extraHeaders) { return response(status, { error: message }, origin, cfg, extraHeaders); }
function publicApiResponse(status, payload, extraHeaders = {}) { return { statusCode: status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extraHeaders }, body: JSON.stringify(payload) }; }
function binaryResponse(status, bytes, origin, cfg, contentType, filename) { const safe = String(filename || 'download').replace(/[\r\n\"]/g, '-'); return { statusCode: status, headers: { ...securityHeaders(origin, cfg), 'Content-Type': contentType || 'application/octet-stream', 'Content-Length': String(bytes.length), 'Content-Disposition': `attachment; filename="${safe}"`, 'X-Content-Type-Options': 'nosniff' }, body: bytes }; }
function sessionFailure(result, origin, cfg) { return error(result.status || 401, result.error === 'CSRF_INVALID' ? 'CSRF validation failed.' : result.error === 'AUTH_UNAVAILABLE' ? 'Authentication is temporarily unavailable.' : 'Authentication is required.', origin, cfg); }
function validateChat(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Send a JSON object.' }; const allowed = new Set(['message', 'conversation_id', 'max_new_tokens', 'system_prompt', 'client_message_id', 'assistant_message_id', 'idempotency_key']); const unexpected = Object.keys(value).find(key => !allowed.has(key)); if (unexpected) return { error: 'Request contains an unsupported field.' }; const { message, conversation_id, max_new_tokens, system_prompt, client_message_id, assistant_message_id, idempotency_key } = value; if (typeof message !== 'string' || !message.trim()) return { error: 'A non-empty message is required.' }; if (message.length > MAX_MESSAGE) return { error: `Message must be at most ${MAX_MESSAGE} characters.` }; if (conversation_id !== undefined && (typeof conversation_id !== 'string' || !/^[0-9a-f-]{20,80}$/i.test(conversation_id))) return { error: 'conversation_id is invalid.' }; if (client_message_id !== undefined && (typeof client_message_id !== 'string' || !/^[0-9a-f-]{20,80}$/i.test(client_message_id))) return { error: 'client_message_id is invalid.' }; if (assistant_message_id !== undefined && (typeof assistant_message_id !== 'string' || !/^[0-9a-f-]{20,80}$/i.test(assistant_message_id))) return { error: 'assistant_message_id is invalid.' }; if (idempotency_key !== undefined && (typeof idempotency_key !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(idempotency_key))) return { error: 'idempotency_key is invalid.' }; if (!Number.isInteger(max_new_tokens) || max_new_tokens < 32 || max_new_tokens > 4096) return { error: 'max_new_tokens must be an integer from 32 to 4096.' }; if (system_prompt !== undefined && (typeof system_prompt !== 'string' || system_prompt.length > MAX_SYSTEM_PROMPT)) return { error: 'system_prompt is invalid.' }; return { value: { message: message.trim(), ...(conversation_id ? { conversation_id: conversation_id.trim() } : {}), ...(client_message_id ? { client_message_id } : {}), ...(assistant_message_id ? { assistant_message_id } : {}), ...(idempotency_key ? { idempotency_key } : {}), max_new_tokens, ...(system_prompt?.trim() ? { system_prompt: system_prompt.trim() } : {}) } }; }
function safeConversationTitle(message) { const clean = String(message || '').replace(/\s+/g, ' ').trim(); return (clean.length > 80 ? `${clean.slice(0, 77)}…` : clean || 'New conversation').slice(0, 240); }
function requestedArtifactFormat(message) { const value = String(message || '').toLowerCase(); const explicit = /(give|provide|export|download|deliver|create|make)\b[\s\S]{0,100}\b(pdf|docx|word document|xlsx|excel(?: workbook| sheet)?|powerpoint|pptx|zip|markdown|\.md|csv|json)\b/.test(value); if (!explicit) return undefined; if (/\b(pdf)\b/.test(value)) return 'pdf'; if (/\b(docx|word document)\b/.test(value)) return 'docx'; if (/\b(xlsx|excel(?: workbook| sheet)?)\b/.test(value)) return 'xlsx'; if (/\b(powerpoint|pptx)\b/.test(value)) return 'pptx'; if (/\b(zip)\b/.test(value)) return 'zip'; if (/\b(csv)\b/.test(value)) return 'csv'; if (/\b(json)\b/.test(value)) return 'json'; if (/\b(markdown|\.md)\b/.test(value)) return 'md'; return undefined; }
function publicArtifactFromRecord(artifact) { return artifact && { id: artifact.id, filename: artifact.displayFilename || artifact.filename, contentType: artifact.contentType, format: artifact.format, size: artifact.size, checksum: artifact.checksum, status: artifact.status, preview: artifact.preview, createdAt: artifact.createdAt, expiresAt: artifact.expiresAt, messageId: artifact.messageId }; }
function safeUpstreamMessage(status) { if (status === 401 || status === 403) return 'The model service rejected the request.'; if (status === 429) return 'The model service is temporarily busy. Try again shortly.'; if (status >= 500) return 'The model service is unavailable.'; return 'The model request could not be completed.'; }
async function upstream(url, key, path, init, timeout, signal) { const controller = new AbortController(); const relayAbort = () => controller.abort(); signal?.addEventListener('abort', relayAbort, { once: true }); const timer = setTimeout(() => controller.abort(), timeout); try { const result = await fetch(`${url}${path}`, { ...init, signal: controller.signal, headers: { 'X-API-Key': key, Accept: 'application/json', ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) } }); const raw = await result.text(); let body; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; } return { status: result.status, body }; } finally { clearTimeout(timer); signal?.removeEventListener('abort', relayAbort); } }
function runPodConfig(env = process.env) {
  const enabled = String(env.VOICECHATGLM_PROVIDER || '').trim().toLowerCase() === 'runpod';
  if (!enabled) return { enabled: false };
  const endpointId = String(env.RUNPOD_ENDPOINT_ID || '').trim();
  const apiKey = typeof env.RUNPOD_API_KEY === 'string' ? env.RUNPOD_API_KEY.trim() : '';
  const serviceKey = typeof env.RUNPOD_SERVICE_KEY === 'string' ? env.RUNPOD_SERVICE_KEY : '';
  const base = String(env.RUNPOD_API_BASE || 'https://api.runpod.ai/v2').trim().replace(/\/$/, '');
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(endpointId) || !apiKey) return { enabled: true, error: 'RunPod provider configuration' };
  try { const parsed = new URL(base); if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(); } catch { return { enabled: true, error: 'RunPod API base' }; }
  return { enabled: true, endpointId, apiKey, serviceKey, url: `${base}/${endpointId}` };
}
async function runPodRequest(cfg, path, init = {}, signal, timeout = 240000) {
  const controller = new AbortController(); const relayAbort = () => controller.abort(); signal?.addEventListener('abort', relayAbort, { once: true }); const timer = setTimeout(() => controller.abort(), timeout);
  try { const response = await fetch(`${cfg.url}${path}`, { ...init, signal: controller.signal, headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json', ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) } }); const raw = await response.text(); let body; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; } return { status: response.status, body }; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', relayAbort); }
}
async function fetchWithTimeout(url, init, timeout, signal) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  signal?.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', relayAbort); }
}
async function huggingFaceConfig(env) {
  const raw = typeof env.VOICECHATGLM_API_URL === 'string' ? env.VOICECHATGLM_API_URL.trim() : '';
  const apiKey = typeof env.VOICECHATGLM_API_KEY === 'string' ? env.VOICECHATGLM_API_KEY.trim() : '';
  const hfToken = typeof env.HF_TOKEN === 'string' ? env.HF_TOKEN.trim() : '';
  let base;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    base = parsed.toString().replace(/\/$/, '');
  } catch { return { error: 'Hugging Face Space URL configuration' }; }
  if (!apiKey || !hfToken) return { error: 'Hugging Face Space credentials configuration' };
  return { base, apiKey, hfToken };
}
function parseGradioCompletion(sse) {
  const events = String(sse || '').split(/\r?\n\r?\n/);
  for (const event of events) {
    const lines = event.split(/\r?\n/);
    if (!lines.some(line => line.trim() === 'event: complete')) {
      if (lines.some(line => line.trim() === 'event: error')) throw Object.assign(new Error('Hugging Face inference returned an error event.'), { code: 'MODEL_UPSTREAM_ERROR' });
      continue;
    }
    const dataLine = lines.find(line => line.startsWith('data:'));
    if (!dataLine) throw Object.assign(new Error('Hugging Face inference returned an empty completion event.'), { code: 'MODEL_INVALID_RESPONSE' });
    let data;
    try { data = JSON.parse(dataLine.slice(5).trim()); } catch { throw Object.assign(new Error('Hugging Face inference returned invalid completion data.'), { code: 'MODEL_INVALID_RESPONSE' }); }
    const answer = Array.isArray(data) ? data[0] : undefined;
    if (typeof answer !== 'string' || !answer.trim()) throw Object.assign(new Error('Hugging Face inference returned an empty model response.'), { code: 'MODEL_INVALID_RESPONSE' });
    return { status: 200, body: { response: answer.trim(), model: MODEL_ID, revision: MODEL_REVISION } };
  }
  throw Object.assign(new Error('Hugging Face inference did not complete its queued event.'), { code: 'MODEL_INCOMPLETE' });
}
async function callHuggingFaceModel(env, path, init, timeout, signal) {
  const startedAt = Date.now();
  const remaining = () => Math.max(1, timeout - (Date.now() - startedAt));
  const cfg = await huggingFaceConfig(env);
  if (cfg.error) throw Object.assign(new Error('Hugging Face Space configuration is unavailable.'), { code: 'MODEL_CONFIGURATION' });
  const headers = { 'X-API-Key': cfg.apiKey, Authorization: `Bearer ${cfg.hfToken}`, Accept: 'application/json' };
  if (path === '/health' || path === '/ready') {
    const response = await fetchWithTimeout(`${cfg.base}/`, { method: 'GET', headers }, Math.min(timeout, 8000), signal);
    return response.ok ? { status: 200, body: { status: 'ok', provider: 'huggingface_space' } } : { status: response.status, body: {} };
  }
  if (path !== '/v1/chat' || init.method !== 'POST') throw Object.assign(new Error('Unsupported Hugging Face model route.'), { code: 'MODEL_ROUTE' });
  let source; try { source = JSON.parse(init.body || '{}'); } catch { source = {}; }
  const maxTokens = Number.isInteger(source.max_new_tokens) ? Math.min(512, Math.max(1, source.max_new_tokens)) : 256;
  const systemPrompt = typeof source.system_prompt === 'string' && source.system_prompt.trim() ? source.system_prompt : 'You are VoiceChatGLM, a helpful AI assistant. Answer clearly and concisely.';
  const submitted = await fetchWithTimeout(`${cfg.base}/gradio_api/call/generate`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [source.message, systemPrompt, maxTokens] })
  }, remaining(), signal);
  const submitText = await submitted.text();
  let submitBody; try { submitBody = submitText ? JSON.parse(submitText) : {}; } catch { submitBody = {}; }
  if (!submitted.ok) return { status: submitted.status, body: { error: 'Hugging Face inference submission was rejected.' } };
  const eventId = submitBody?.event_id;
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{8,160}$/.test(eventId)) throw Object.assign(new Error('Hugging Face inference did not return a valid event identifier.'), { code: 'MODEL_INVALID_RESPONSE' });
  const result = await fetchWithTimeout(`${cfg.base}/gradio_api/call/generate/${encodeURIComponent(eventId)}`, {
    method: 'GET', headers: { ...headers, Accept: 'text/event-stream' }
  }, remaining(), signal);
  const sse = await result.text();
  if (!result.ok) return { status: result.status, body: { error: 'Hugging Face inference result retrieval failed.' } };
  return parseGradioCompletion(sse);
}
async function callConfiguredModel(env, path, init, timeout, signal) {
  const provider = String(env.VOICECHATGLM_PROVIDER || 'legacy').trim().toLowerCase();
  if (provider === 'huggingface_space') return callHuggingFaceModel(env, path, init, timeout, signal);
  const cfg = runPodConfig(env);
  if (!cfg.enabled) { const legacy = modelEndpoint(env, env.NODE_ENV === 'production'); const key = typeof env.VOICECHATGLM_API_KEY === 'string' ? env.VOICECHATGLM_API_KEY.trim() : ''; if (!legacy.url || !key) throw Object.assign(new Error('Model service configuration is unavailable.'), { code: 'MODEL_CONFIGURATION' }); return upstream(legacy.url, key, path, init, timeout, signal); }
  if (cfg.error) throw Object.assign(new Error('RunPod provider configuration is invalid.'), { code: 'MODEL_CONFIGURATION' });
  if (path === '/health' || path === '/ready') { const h = await runPodRequest(cfg, '/health', { method: 'GET' }, signal, Math.min(timeout, 15000)); return h.status >= 200 && h.status < 300 ? { status: 200, body: { status: 'ok', provider: 'runpod' } } : h; }
  if (path !== '/v1/chat' || init.method !== 'POST') throw Object.assign(new Error('Unsupported RunPod model route.'), { code: 'MODEL_ROUTE' });
  let source; try { source = JSON.parse(init.body || '{}'); } catch { source = {}; }
  const input = { message: source.message, ...(source.system_prompt ? { system_prompt: source.system_prompt } : {}), ...(Number.isInteger(source.max_new_tokens) ? { max_new_tokens: source.max_new_tokens } : {}), ...(source.conversation_id ? { conversation_id: source.conversation_id } : {}), ...(cfg.serviceKey ? { service_key: cfg.serviceKey } : {}) };
  const response = await runPodRequest(cfg, '/runsync', { method: 'POST', body: JSON.stringify({ input }) }, signal, timeout);
  if (response.status < 200 || response.status >= 300) return response;
  const job = response.body && typeof response.body === 'object' ? response.body : {};
  if (job.status && job.status !== 'COMPLETED') return { status: job.status === 'IN_QUEUE' || job.status === 'IN_PROGRESS' ? 503 : 502, body: { error: 'RunPod job did not complete successfully.' } };
  const output = job.output && typeof job.output === 'object' ? job.output : {};
  if (output.ok !== true || typeof output.message !== 'string' || !output.message.trim()) return { status: 502, body: { error: 'RunPod returned an empty or unsuccessful model output.' } };
  return { status: 200, body: { response: output.message, model: output.model, conversation_id: output.conversation_id || source.conversation_id || null, usage: output.usage } };
}
function stateChanging(method) { return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method); }
async function execute(route, method, body, meta = {}, env = process.env) { const origin = typeof meta.origin === 'string' ? meta.origin : ''; const production = env.NODE_ENV === 'production';
  if (route === 'live') { const origins = configuredOrigins(env, production); const liveCfg = { origins: origins.values, production }; if (origin && !allowedOrigin(origin, liveCfg)) return error(403, 'Origin is not allowed.', origin, liveCfg); if (method === 'OPTIONS') return origin && allowedOrigin(origin, liveCfg) ? response(204, {}, origin, liveCfg) : error(403, 'Origin is not allowed.', origin, liveCfg); return method === 'GET' ? response(200, { status: 'ok' }, origin, liveCfg) : error(405, 'Method not allowed.', origin, liveCfg); }
  const cfg = config(env); if (route === 'readiness') { if (origin && !allowedOrigin(origin, cfg)) return error(403, 'Origin is not allowed.', origin, cfg); if (method === 'OPTIONS') return origin && allowedOrigin(origin, cfg) ? response(204, {}, origin, cfg) : error(403, 'Origin is not allowed.', origin, cfg); if (method !== 'GET') return error(405, 'Method not allowed.', origin, cfg); try { const report = await readinessReport(env); return response(report.ready ? 200 : 503, report, origin, cfg); } catch { return error(503, 'Application dependencies are temporarily unavailable.', origin, cfg); } }
  if (cfg.error) return error(503, 'The application API is not configured.', origin, cfg); if (origin && !allowedOrigin(origin, cfg)) return error(403, 'Origin is not allowed.', origin, cfg); if (stateChanging(method) && cfg.production && !origin) return error(403, 'Origin is required.', origin, cfg); if (method === 'OPTIONS') return origin && allowedOrigin(origin, cfg) ? response(204, {}, origin, cfg) : error(403, 'Origin is not allowed.', origin, cfg);
  const authRoute = /^auth\/(register|login|logout|me|logout-all|forgot-password|reset-password)$/.exec(route || ''); if (authRoute) { const result = await handleAuthRoute({ route: authRoute[1], method, body, meta, env, consumeAuthAttempt: (category, key) => consumeAuthAttempt(limiterFor(cfg.rateLimit), cfg.rateLimit, category, key) }); const cookies = [result.setCookie, result.setCsrfCookie, result.clearCookie, result.clearCsrfCookie].filter(Boolean); const extra = { ...(cookies.length ? { 'Set-Cookie': cookies } : {}), ...(result.retryAfter ? { 'Retry-After': String(Math.max(1, result.retryAfter)) } : {}) }; return response(result.status, result.body, origin, cfg, extra); }
  if (route === 'capabilities') {
    if (method !== 'GET') return error(405, 'Method not allowed.', origin, cfg);
    let repository; try { repository = meta.repository || repositoryFor(env); } catch { return error(503, 'Authentication is temporarily unavailable.', origin, cfg); }
    let authentication; try { authentication = await currentSession(meta.headers || {}, cfg.auth, repository, { requireCsrf: false }); } catch { return error(503, 'Authentication is temporarily unavailable.', origin, cfg); }
    if (authentication.error) return sessionFailure(authentication, origin, cfg);
    try { return response(200, await capabilitySnapshot(env), origin, cfg); } catch { return error(503, 'Capability status is temporarily unavailable.', origin, cfg); }
  }
  const publicShare = /^share\/([A-Za-z0-9_-]{1,160})$/.exec(route || '');
  if (publicShare) { if (method !== 'GET') return error(405, 'Method not allowed.', origin, cfg); const shareCfg = shareConfig(env); const publicLimit = await consumeUserAction(limiterFor(cfg.rateLimit), 'share-public', meta.rateLimitKey || 'anonymous', shareCfg.publicBurstPerMinute); if (publicLimit.unavailable) return error(503, 'Shared conversation is temporarily unavailable.', origin, cfg); if (!publicLimit.allowed) return error(429, 'Shared conversation is temporarily unavailable.', origin, cfg, { 'Retry-After': String(Math.max(1, publicLimit.retryAfter || 1)) }); try { const repository = meta.repository || repositoryFor(env); const output = await handlePublicShare({ token: publicShare[1], repository, env, after: meta.query?.after, limit: meta.query?.limit }); return response(output.status, output.body, origin, cfg, { 'X-Robots-Tag': 'noindex, noarchive, nosnippet' }); } catch { return error(503, 'Shared conversation is temporarily unavailable.', origin, cfg); } }
  if (route?.startsWith('api-keys')) {
    let repository; try { repository = meta.repository || repositoryFor(env); } catch { return error(503, 'Authentication is temporarily unavailable.', origin, cfg); }
    const requireCsrf = stateChanging(method); let authentication; try { authentication = await currentSession(meta.headers || {}, cfg.auth, repository, { requireCsrf }); } catch { return error(503, 'Authentication is temporarily unavailable.', origin, cfg); }
    if (authentication.error) return sessionFailure(authentication, origin, cfg);
    try { const output = await handleApiKeyRoute({ route, method, body, userId: authentication.session.user.id, repository, env }); return response(output.status, output.body, origin, cfg); } catch { return error(503, 'API-key management is temporarily unavailable.', origin, cfg); }
  }
  if (route?.startsWith('conversations') || route?.startsWith('artifacts') || route?.startsWith('memories') || route?.startsWith('knowledge/') || route === 'data-analysis' || route?.startsWith('shares') || route?.startsWith('scrape-jobs/')) {
    let repository; try { repository = meta.repository || repositoryFor(env); } catch { return error(503, 'Authentication is temporarily unavailable.', origin, cfg); }
    const requireCsrf = stateChanging(method); let authentication; try { authentication = await currentSession(meta.headers || {}, cfg.auth, repository, { requireCsrf }); } catch { return error(503, 'Authentication is temporarily unavailable.', origin, cfg); }
    if (authentication.error) return sessionFailure(authentication, origin, cfg); const userId = authentication.session.user.id;
    if (route.startsWith('shares') && stateChanging(method)) { const shareCfg = shareConfig(env); const shareLimit = await consumeUserAction(limiterFor(cfg.rateLimit), 'share-create', userId, shareCfg.createBurstPerMinute); if (shareLimit.unavailable) return error(503, 'Conversation sharing is temporarily unavailable.', origin, cfg); if (!shareLimit.allowed) return error(429, 'Conversation share protection is active. Please retry shortly.', origin, cfg, { 'Retry-After': String(Math.max(1, shareLimit.retryAfter || 1)) }); }
    try {
      let output; const shared = { route, method, body, userId, repository, env, signal: meta.signal, query: meta.query || {}, store: meta.objectStore };
      if (route.startsWith('conversations')) output = await handleConversationRoute(shared);
      else if (route.startsWith('artifacts')) output = await handleArtifactRoute(shared);
      else if (route.startsWith('memories')) output = await handleMemoryRoute(shared);
      else if (route.startsWith('knowledge/')) output = await handleKnowledgeRoute(shared);
      else if (route === 'data-analysis') output = await handleDataAnalysisRoute(shared);
      else if (route.startsWith('scrape-jobs/')) output = await handleScrapeJobRoute(shared);
      else output = await handleShareRoute(shared);
      if (output.binary) return binaryResponse(output.status, output.binary, origin, cfg, output.contentType, output.filename);
      return response(output.status, output.body, origin, cfg);
    } catch { return error(503, 'The requested persistent resource is temporarily unavailable.', origin, cfg); }
  }
  if (route?.startsWith('writing/')) {
    let repository; try { repository = meta.repository || repositoryFor(env); } catch { return error(503, 'Authentication is temporarily unavailable.', origin, cfg); }
    const requireCsrf = stateChanging(method); let authentication; try { authentication = await currentSession(meta.headers || {}, cfg.auth, repository, { requireCsrf }); } catch { return error(503, 'Authentication is temporarily unavailable.', origin, cfg); }
    if (authentication.error) return sessionFailure(authentication, origin, cfg);
    const callModel = (payload, signal) => callConfiguredModel(env, '/v1/chat', { method: 'POST', body: JSON.stringify(payload) }, cfg.timeout, signal);
    const output = await handleWritingRoute({ route, method, body, userId: authentication.session.user.id, repository, callModel, signal: meta.signal, env, store: meta.objectStore });
    return response(output.status, output.body, origin, cfg);
  }
  if (route === 'chat') {
    if (method !== 'POST') return error(405, 'Method not allowed.', origin, cfg);
    let repository; try { repository = meta.repository || repositoryFor(env); } catch { return error(503, 'Authentication is temporarily unavailable.', origin, cfg); }
    let authentication; try { authentication = await currentSession(meta.headers || {}, cfg.auth, repository, { requireCsrf: true }); } catch { return error(503, 'Authentication is temporarily unavailable.', origin, cfg); }
    if (authentication.error) return sessionFailure(authentication, origin, cfg); const check = validateChat(body); if (check.error) return error(400, check.error, origin, cfg);
    const userId = authentication.session.user.id; const reservation = await reserveChat(limiterFor(cfg.rateLimit), cfg.rateLimit, userId); if (reservation.unavailable) return error(503, 'Capacity protection is temporarily unavailable.', origin, cfg); if (!reservation.allowed) return error(429, reservation.reason === 'capacity' ? 'Service capacity is temporarily full. Please retry shortly.' : 'Request burst protection is active. Please retry shortly.', origin, cfg, { 'Retry-After': String(Math.max(1, reservation.retryAfter || 1)) });
    let conversation; let userMessage; let assistantMessage; const persistent = typeof repository.conversationForOwner === 'function' && typeof repository.createConversationMessage === 'function';
    const complete = async (payload, content, metadata = {}) => {
      let artifacts = []; const notices = [...(Array.isArray(payload.notices) ? payload.notices : [])];
      const artifactData = payload.artifactData && typeof payload.artifactData === 'object' ? payload.artifactData : undefined;
      const requestedFormat = payload.scrapeJobId ? undefined : artifactData?.format || requestedArtifactFormat(check.value.message);
      if (requestedFormat) { const artifactCapability = artifactConfig(env); if (!artifactCapability.enabled || !artifactCapability.configured) notices.push('A generated file was requested, but private artifact delivery is disabled or not configured for this deployment.'); else try { const artifactStore = meta.objectStore || createObjectStore(artifactCapability.storage); const artifact = await persistGeneratedArtifact({ repository, store: artifactStore, userId, conversationId: conversation?.id, messageId: assistantMessage?.id, title: artifactData?.title || safeConversationTitle(check.value.message), content, format: requestedFormat, ...(Array.isArray(artifactData?.rows) ? { rows: artifactData.rows } : {}), expiresAt: new Date(Date.now() + artifactCapability.retentionMs), signal: meta.signal }); artifacts = [publicArtifactFromRecord(artifact)]; } catch { notices.push('The response was completed, but its requested file could not be stored safely; no attachment was created.'); } }
      if (assistantMessage) await repository.updateConversationMessage({ userId, conversationId: conversation.id, id: assistantMessage.id, content, status: payload.partial ? 'partial' : 'complete', metadata: { route: payload.route, citations: payload.citations || [], toolEvents: payload.toolEvents || [], notices, artifacts, ...(payload.scrapeJobId ? { scrapeJobId: payload.scrapeJobId } : {}) } }).catch(() => undefined);
      return response(200, { response: content, route: payload.route, ...(payload.citations?.length ? { citations: payload.citations } : {}), ...(payload.toolEvents?.length ? { toolEvents: payload.toolEvents } : {}), ...(payload.partial ? { partial: true } : {}), ...(notices.length ? { notices } : {}), ...(payload.writingProject ? { writingProject: payload.writingProject } : {}), ...(payload.scrapeJobId ? { scrape_job_id: payload.scrapeJobId } : {}), ...(artifacts.length ? { artifacts } : {}), ...(conversation ? { conversation_id: conversation.id } : {}), ...(userMessage ? { user_message_id: userMessage.id } : {}), ...(assistantMessage ? { assistant_message_id: assistantMessage.id } : {}) }, origin, cfg);
    };
    try {
      if (persistent) { const conversationId = check.value.conversation_id || randomUUID(); conversation = await repository.conversationForOwner(userId, conversationId); if (!conversation) conversation = await repository.createConversation({ userId, id: conversationId, title: safeConversationTitle(check.value.message), modelId: MODEL_ID }); userMessage = await repository.createConversationMessage({ id: check.value.client_message_id, userId, conversationId: conversation.id, role: 'user', content: check.value.message, status: 'complete', metadata: {}, idempotencyKey: check.value.idempotency_key || check.value.client_message_id }); if (!userMessage) throw Object.assign(new Error('Conversation message could not be saved.'), { code: 'CONVERSATION_STORAGE', status: 503 }); if (check.value.assistant_message_id) { const existing = typeof repository.conversationMessageForOwner === 'function' ? await repository.conversationMessageForOwner(userId, conversation.id, check.value.assistant_message_id) : undefined; if (existing && existing.role !== 'assistant') throw Object.assign(new Error('Assistant message cannot be resumed.'), { code: 'INVALID_ASSISTANT_MESSAGE', status: 404 }); if (existing) { assistantMessage = await repository.updateConversationMessage({ userId, conversationId: conversation.id, id: existing.id, content: '', status: 'sending', metadata: {} }); } else { try { assistantMessage = await repository.createConversationMessage({ id: check.value.assistant_message_id, userId, conversationId: conversation.id, role: 'assistant', content: '', status: 'sending', metadata: {} }); } catch (createError) { const raced = typeof repository.conversationMessageForOwner === 'function' ? await repository.conversationMessageForOwner(userId, conversation.id, check.value.assistant_message_id).catch(() => undefined) : undefined; if (!raced || raced.role !== 'assistant') throw createError; assistantMessage = await repository.updateConversationMessage({ userId, conversationId: conversation.id, id: raced.id, content: '', status: 'sending', metadata: {} }); } } } else assistantMessage = await repository.createConversationMessage({ userId, conversationId: conversation.id, role: 'assistant', content: '', status: 'sending', metadata: {} }); if (!assistantMessage) throw Object.assign(new Error('Assistant message could not be saved.'), { code: 'CONVERSATION_STORAGE', status: 503 }); }
      const memory = memoryConfig(env); const memories = memory.enabled && memory.configured && persistent ? await repository.relevantMemories(userId, check.value.message).catch(() => []) : []; const remembered = memoryPrompt(memories); const systemPrompt = [check.value.system_prompt, remembered].filter(Boolean).join('\n\n').slice(0, MAX_SYSTEM_PROMPT); const request = { ...check.value, ...(systemPrompt ? { system_prompt: systemPrompt } : {}) };
      const callModel = (payload, signal) => callConfiguredModel(env, '/v1/chat', { method: 'POST', body: JSON.stringify(payload) }, cfg.timeout, signal);
      const routed = await routeChat({ message: request.message, request, userId, repository, callModel, signal: meta.signal, conversationId: conversation?.id, assistantMessageId: assistantMessage?.id, env, consumeAction: async (category, maximum) => consumeUserAction(limiterFor(cfg.rateLimit), category, userId, maximum) });
      if (routed.type === 'model') { const result = await callModel(routed.request, meta.signal); if (result.status < 200 || result.status >= 300) { if (assistantMessage) await repository.updateConversationMessage({ userId, conversationId: conversation.id, id: assistantMessage.id, content: '', status: 'error', metadata: { error: safeUpstreamMessage(result.status) } }).catch(() => undefined); return error(result.status, safeUpstreamMessage(result.status), origin, cfg); } const upstreamBody = result.body && typeof result.body === 'object' && !Array.isArray(result.body) ? result.body : { response: typeof result.body === 'string' ? result.body : '' }; const content = textFromModel(upstreamBody); if (!content) { if (assistantMessage) await repository.updateConversationMessage({ userId, conversationId: conversation.id, id: assistantMessage.id, content: '', status: 'error', metadata: { error: 'The model returned an empty response.' } }).catch(() => undefined); return error(502, 'The model returned an empty or unsupported response.', origin, cfg); } return await complete({ route: routed.route }, content); }
      if (routed.type === 'message') return await complete({ route: routed.route, toolEvents: routed.toolEvents || [] }, routed.response);
      return await complete({ route: routed.route, citations: routed.citations || [], toolEvents: routed.toolEvents || [], partial: routed.partial, notices: routed.notices, writingProject: routed.project, artifactData: routed.artifactData, scrapeJobId: routed.scrapeJobId }, routed.response);
    } catch (caught) {
      const status = Number(caught?.status); const code = caught?.code || (caught?.name === 'AbortError' ? meta.signal?.aborted ? 'CANCELLED' : 'TIMEOUT' : undefined); const message = code === 'CAPABILITY_UNAVAILABLE' ? 'That capability is not enabled or configured for this deployment.' : code === 'CLARIFICATION_REQUIRED' ? caught.message : code === 'RATE_LIMIT' ? caught.message : code === 'CANCELLED' ? 'The requested operation was cancelled.' : code === 'TIMEOUT' ? 'The requested operation timed out.' : code === 'INVALID_URL' || code === 'SSRF_BLOCKED' ? 'One or more supplied URLs are not permitted.' : code === 'ROBOTS_DISALLOWED' ? 'A requested page is disallowed by the configured robots policy.' : code === 'ACCESS_CHALLENGE' ? 'The requested website requires a human verification or denies automated access. No bypass was attempted.' : code === 'AUTH_REQUIRED' ? 'The requested website requires authorized sign-in access.' : code === 'TARGET_RATE_LIMIT' ? 'The requested website is rate-limiting automated retrieval.' : code === 'UNSUPPORTED_CONTENT_TYPE' ? 'A requested page is not a supported conventional HTML page.' : code === 'MODEL_ERROR' ? 'The model could not complete the requested work.' : code === 'PROVIDER_RATE_LIMIT' ? 'The search provider is temporarily rate-limiting requests.' : 'The requested capability could not be completed.';
      if (assistantMessage && conversation) await repository.updateConversationMessage({ userId, conversationId: conversation.id, id: assistantMessage.id, content: '', status: code === 'CANCELLED' ? 'cancelled' : 'error', metadata: { error: message } }).catch(() => undefined);
      const failedSources = Array.isArray(caught?.failures) ? caught.failures.slice(0, 5).map(item => { let host; try { host = new URL(item.url).hostname; } catch {} return { host, code: String(item.code || 'RETRIEVAL_FAILED').slice(0, 80) }; }) : undefined;
      const errorName = typeof caught?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(caught.name) ? caught.name : undefined;
      const causeCode = typeof caught?.cause?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(caught.cause.code) ? caught.cause.code : undefined;
      const rawErrorMessage = typeof caught?.message === 'string' ? caught.message : '';
      const safeErrorMessage = rawErrorMessage.replace(/https?:\/\/[^\s]+/gi, '[URL]').replace(/(authorization|token|secret|api[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[REDACTED]').replace(/[\r\n\t]+/g, ' ').slice(0, 240);
      const stackFrames = typeof caught?.stack === 'string' ? caught.stack.split('\n').slice(1, 5).map(line => line.trim().slice(0, 240)) : undefined;
      const diagnostic = { code: String(code || 'REQUEST_FAILED').slice(0, 80), ...(errorName ? { error_name: errorName } : {}), ...(causeCode ? { cause_code: causeCode } : {}), ...(safeErrorMessage ? { error_message: safeErrorMessage } : {}), ...(failedSources?.length ? { failed_sources: failedSources } : {}) };
      if (!code) console.error('[VoiceChatGLM] Unclassified chat failure', { errorName: errorName || 'Error', causeCode: causeCode || undefined, errorMessage: safeErrorMessage || undefined, stackFrames, status: Number.isInteger(status) ? status : undefined });
      return response(Number.isInteger(status) && status >= 400 && status < 600 ? status : code === 'CANCELLED' ? 499 : 502, { error: message, diagnostic }, origin, cfg, caught?.retryAfter ? { 'Retry-After': String(Math.max(1, caught.retryAfter)) } : undefined);
    } finally { await reservation.release?.(); }
  }
  if (route === 'health' || route === 'ready') { if (method !== 'GET') return error(405, 'Method not allowed.', origin, cfg); if (route === 'ready' && (!(await databaseReady(env)) || !(await limiterAvailable(limiterFor(cfg.rateLimit))))) return error(503, 'Application dependencies are temporarily unavailable.', origin, cfg); try { const result = await callConfiguredModel(env, `/${route}`, { method: 'GET' }, cfg.timeout, meta.signal); return result.status >= 200 && result.status < 300 ? response(200, result.body, origin, cfg) : error(result.status, safeUpstreamMessage(result.status), origin, cfg); } catch (caught) { return error(caught?.name === 'AbortError' ? 504 : 502, caught?.name === 'AbortError' ? 'The health request timed out.' : 'The model service could not be reached.', origin, cfg); } }
  return error(404, 'Route not found.', origin, cfg); }
async function executePublicApi(route, method, body, meta = {}, env = process.env) {
  // Public health is deliberately minimal and does not probe model/database internals.
  if (route === 'v1/health') { const output = await handlePublicApi({ route, method, body, headers: meta.headers || {}, env }); return publicApiResponse(output.status, output.body, output.retryAfter ? { 'Retry-After': String(Math.max(1, output.retryAfter)) } : {}); }
  const cfg = config(env); if (cfg.error) return publicApiResponse(503, { error: { code: 'API_UNAVAILABLE', message: 'External API access is not configured for this deployment.' } });
  let repository; try { repository = meta.repository || repositoryFor(env); } catch { return publicApiResponse(503, { error: { code: 'AUTH_UNAVAILABLE', message: 'API authentication is temporarily unavailable.' } }); }
  const output = await handlePublicApi({ route, method, body, headers: meta.headers || {}, repository, limiter: limiterFor(cfg.rateLimit), rateLimit: cfg.rateLimit, callModel: (payload, signal) => callConfiguredModel(env, '/v1/chat', { method: 'POST', body: JSON.stringify(payload) }, cfg.timeout, signal), signal: meta.signal, env });
  return publicApiResponse(output.status, output.body, output.retryAfter ? { 'Retry-After': String(Math.max(1, output.retryAfter)) } : {});
}
function readBody(req) { return new Promise((resolve, reject) => { let size = 0; let tooLarge = false; const chunks = []; req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY_BYTES) { tooLarge = true; return; } chunks.push(chunk); }); req.on('end', () => { if (tooLarge) return reject(new Error('BODY_TOO_LARGE')); if (!chunks.length) return resolve(undefined); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('INVALID_JSON')); } }); req.on('error', reject); }); }
function validIp(value) { if (typeof value !== 'string') return undefined; const trimmed = value.trim().replace(/^\[|\]$/g, ''); return net.isIP(trimmed) ? trimmed : undefined; }
function trustedProxyPeer(req, env = process.env) { if (env.TRUST_PROXY_CLIENT_IP !== 'true') return false; const peer = validIp(req.socket?.remoteAddress); const peers = String(env.TRUSTED_PROXY_PEERS || '').split(',').map(validIp).filter(Boolean); return Boolean(peer && peers.includes(peer)); }
function nodeRateLimitKey(req, env = process.env) { const peer = validIp(req.socket?.remoteAddress) || 'anonymous'; if (!trustedProxyPeer(req, env)) return `peer:${peer}`; const header = String(env.TRUSTED_PROXY_CLIENT_IP_HEADER || 'x-forwarded-for').toLowerCase(); if (!['x-forwarded-for', 'x-nf-client-connection-ip'].includes(header)) return `peer:${peer}`; const raw = req.headers?.[header]; if (Array.isArray(raw) || typeof raw !== 'string' || raw.includes(',')) return `peer:${peer}`; const forwarded = validIp(raw); return forwarded ? `trusted-proxy:${forwarded}` : `peer:${peer}`; }
async function nodeHandler(req, res, context = {}) {
  const env = context.env || process.env; const parsed = new URL(req.url, 'http://proxy.local'); const pathname = parsed.pathname;
  if (pathname === '/api/files' || pathname.startsWith('/api/files/') || pathname.startsWith('/api/analysis/')) return nodeFileHandler(req, res, config(env), (path, init, timeout, signal) => callConfiguredModel(env, path, init, timeout, signal));
  const publicRoute = pathname === '/v1' || pathname.startsWith('/v1/') ? pathname.replace(/^\//, '') : undefined;
  const route = pathname === '/api/chat' ? 'chat' : pathname === '/api/live' ? 'live' : pathname === '/api/readiness' ? 'readiness' : pathname === '/api/capabilities' ? 'capabilities' : pathname === '/api/health' ? 'health' : pathname === '/api/ready' ? 'ready' : pathname === '/api/data-analysis' ? 'data-analysis' : pathname === '/api/api-keys' || pathname.startsWith('/api/api-keys/') ? pathname.slice('/api/'.length) : pathname === '/api/conversations' || pathname.startsWith('/api/conversations/') ? pathname.slice('/api/'.length) : pathname === '/api/artifacts' || pathname.startsWith('/api/artifacts/') ? pathname.slice('/api/'.length) : pathname === '/api/memories' || pathname.startsWith('/api/memories/') ? pathname.slice('/api/'.length) : pathname === '/api/knowledge/sources' || pathname.startsWith('/api/knowledge/sources/') ? pathname.slice('/api/'.length) : pathname === '/api/shares' || pathname.startsWith('/api/shares/') || pathname.startsWith('/api/share/') ? pathname.slice('/api/'.length) : pathname.startsWith('/api/scrape-jobs/') ? pathname.slice('/api/'.length) : pathname.startsWith('/api/writing/') ? pathname.slice('/api/'.length) : pathname.startsWith('/api/auth/') ? `auth/${pathname.slice('/api/auth/'.length)}` : undefined;
  const origin = req.headers.origin; const controller = new AbortController(); const abort = () => controller.abort(); const responseClosed = () => { if (!res.writableEnded) controller.abort(); }; req.once('aborted', abort); res.once('close', responseClosed); let output;
  try { const method = req.method || 'GET'; const needsBody = ['POST', 'PUT', 'PATCH'].includes(method); const body = needsBody ? await readBody(req) : pathname.includes('/export') ? { format: parsed.searchParams.get('format') || undefined } : undefined; const meta = { origin, headers: req.headers, rateLimitKey: nodeRateLimitKey(req, env), signal: controller.signal, query: Object.fromEntries(parsed.searchParams.entries()), ...(context.repository ? { repository: context.repository } : {}) }; output = publicRoute ? await executePublicApi(publicRoute, method, body, meta, env) : await execute(route, method, body, meta, env); }
  catch (caught) { const cfg = config(env); output = publicRoute ? publicApiResponse(caught?.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: { code: caught?.message === 'BODY_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON', message: caught?.message === 'BODY_TOO_LARGE' ? 'Request body is too large.' : 'Invalid JSON body.' } }) : error(caught?.message === 'BODY_TOO_LARGE' ? 413 : 400, caught?.message === 'BODY_TOO_LARGE' ? 'Request body is too large.' : 'Invalid JSON body.', origin, cfg); }
  finally { req.removeListener('aborted', abort); res.removeListener('close', responseClosed); }
  if (res.destroyed || res.writableEnded) return; res.writeHead(output.statusCode, output.headers); res.end(output.body);
}
module.exports = { MAX_BODY_BYTES, validateChat, execute, executePublicApi, nodeHandler, config, startupConfigurationErrors, nodeRateLimitKey, trustedProxyPeer, validIp, resetRateLimitForTests: resetLimiter, securityHeaders, publicApiResponse, runPodConfig, callConfiguredModel, parseGradioCompletion };
