import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
const spec = parse(readFileSync('docs/openapi.yaml', 'utf8'));
const publicApi = readFileSync('server/public-api.cjs', 'utf8'); const apiKeys = readFileSync('server/api-keys.cjs', 'utf8'); const proxy = readFileSync('server/proxy-core.cjs', 'utf8'); const docs = readFileSync('API_INTEGRATION.md', 'utf8');
function requireValue(value, label) { if (!value) throw new Error(`API contract drift: missing ${label}.`); }
requireValue(spec?.openapi === '3.1.0', 'OpenAPI 3.1 document'); requireValue(spec?.info?.version === '1.3.0', 'v1.3.0 API version');
for (const [path, method] of [['/v1/health', 'get'], ['/v1/chat', 'post']]) requireValue(Boolean(spec?.paths?.[path]?.[method]), `${method.toUpperCase()} ${path} spec operation`);
const requestReference = spec.paths['/v1/chat'].post.requestBody.content['application/json'].schema; const request = requestReference.$ref ? spec.components.schemas[requestReference.$ref.split('/').at(-1)] : requestReference; requireValue(request.additionalProperties === false && request.properties.message.maxLength === 12000 && request.properties.max_new_tokens.maximum === 4096, 'request bounds');
for (const route of ["route === 'v1/health'", "route !== 'v1/chat'", "pathname.startsWith('/v1/')"]) requireValue(publicApi.includes(route) || proxy.includes(route), route);
for (const symbol of ['MAX_PUBLIC_MESSAGE = 12_000', 'MAX_PUBLIC_SYSTEM_PROMPT = 16_000', "object: 'chat.completion'"]) requireValue(publicApi.includes(symbol), symbol); requireValue(apiKeys.includes("API_KEY_SCOPE = 'chat:write'"), 'chat:write scope');
for (const text of ['GET /v1/health', 'POST /v1/chat', 'Authorization: Bearer', 'docs/openapi.yaml']) requireValue(docs.includes(text), `documentation ${text}`);
console.log('Public API implementation/OpenAPI/documentation contract validation passed.');
