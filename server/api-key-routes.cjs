/* Session-authenticated API-key management. The browser sees a secret only in the POST
 * response; all later routes return metadata derived from PostgreSQL, never hashes or secrets. */
const { apiKeyConfig, cleanName, cleanDescription, validatedScopes, validExpiration, generateApiKey, hashApiSecret } = require('./api-keys.cjs');
function failure(status, message) { return { status, body: { error: message } }; }
function validObject(value, allowed) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)) ? value : undefined; }
function identifier(value) { return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined; }
async function handleApiKeyRoute({ route, method, body, userId, repository, env = process.env }) {
  const configuration = apiKeyConfig(env); if (!configuration.available) return failure(503, configuration.reason || 'External API access is unavailable.');
  const suffix = String(route || '').replace(/^api-keys\/?/, '');
  if (!suffix) {
    if (method === 'GET') return { status: 200, body: { keys: await repository.apiKeysForOwner(userId) } };
    if (method !== 'POST') return failure(405, 'Method not allowed.');
    const value = validObject(body, ['name', 'description', 'scopes', 'expiresAt']); const name = cleanName(value?.name); const description = cleanDescription(value?.description); const descriptionInvalid = value?.description !== undefined && value?.description !== null && (typeof value.description !== 'string' || value.description.trim().length > 500 || /[\u0000-\u001f]/.test(value.description)); const scopes = validatedScopes(value?.scopes); const expiration = validExpiration(value?.expiresAt);
    if (!value || !name || descriptionInvalid || !scopes || expiration.error) return failure(400, expiration.error || 'Provide a key name, optional description, and supported scopes.');
    const generated = generateApiKey(); const stored = await repository.createApiKey({ userId, name, description, keyIdentifier: generated.keyIdentifier, secretHash: hashApiSecret(generated.secret, configuration.hashSecret), scopes, expiresAt: expiration.value, maxActiveKeys: configuration.maxActiveKeys });
    if (stored.limitReached) return failure(409, `The configured active API-key safety limit (${configuration.maxActiveKeys}) has been reached. Revoke an unused key before creating another.`);
    return { status: 201, body: { key: stored.key, secret: generated.value, warning: 'Store this key now. The full secret is shown only in this creation response and cannot be recovered later.' } };
  }
  const id = identifier(suffix); if (!id) return failure(404, 'API key not found.');
  if (method === 'GET') { const key = await repository.apiKeyForOwner(userId, id); return key ? { status: 200, body: { key } } : failure(404, 'API key not found.'); }
  if (method === 'DELETE') { const key = await repository.revokeApiKey(userId, id); return key ? { status: 200, body: { key } } : failure(404, 'API key not found or already revoked.'); }
  return failure(405, 'Method not allowed.');
}
module.exports = { handleApiKeyRoute, validObject };
