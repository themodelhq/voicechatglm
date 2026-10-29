/* First-party PostgreSQL-backed opaque-session authentication. */
const crypto = require('node:crypto');
const argon2 = require('argon2');
const { databaseConfig, getPool } = require('./db/pool.cjs');
const { Repository } = require('./db/repository.cjs');

const COOKIE_NAME = 'voicechatglm_session';
const CSRF_COOKIE_NAME = 'voicechatglm_csrf';
const CSRF_HEADER = 'x-csrf-token';
const DEPLOYMENT_MODES = new Set(['same-site', 'netlify-proxy', 'cross-site']);
function stringEnv(env, name) { const value = env[name]; return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function bounded(env, name, fallback, min, max) { if (env[name] === undefined) return fallback; const value = Number(env[name]); return Number.isInteger(value) && value >= min && value <= max ? value : undefined; }
function safeUrl(value, production) { try { const url = new URL(value); return (!production || url.protocol === 'https:') && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash ? url.toString().replace(/\/$/, '') : undefined; } catch { return undefined; } }
function authConfig(env = process.env) {
  const production = env.NODE_ENV === 'production'; const database = databaseConfig(env); const tokenHashSecret = stringEnv(env, 'SESSION_TOKEN_HASH_SECRET');
  const sessionDays = bounded(env, 'SESSION_MAX_AGE_DAYS', 7, 1, 30); const activityMinutes = bounded(env, 'SESSION_ACTIVITY_UPDATE_MINUTES', 15, 1, 24 * 60); const resetMinutes = bounded(env, 'PASSWORD_RESET_TTL_MINUTES', 30, 5, 24 * 60);
  const deploymentMode = String(env.SESSION_DEPLOYMENT_MODE || 'same-site').toLowerCase(); const sameSiteRaw = String(env.SESSION_COOKIE_SAMESITE || (production ? 'lax' : 'lax')).toLowerCase(); const sameSite = ['lax', 'strict', 'none'].includes(sameSiteRaw) ? sameSiteRaw : undefined; const secure = env.SESSION_COOKIE_SECURE === undefined ? production : env.SESSION_COOKIE_SECURE === 'true';
  const webhook = stringEnv(env, 'PASSWORD_RESET_EMAIL_WEBHOOK_URL'); const resetBase = stringEnv(env, 'PASSWORD_RESET_URL_BASE');
  const deliveryConfigured = Boolean(webhook || resetBase); const safeWebhook = webhook && safeUrl(webhook, production); const safeResetBase = resetBase && safeUrl(resetBase, production);
  const incompatibleCookieMode = !DEPLOYMENT_MODES.has(deploymentMode) || production && (!secure || !sameSite || ((deploymentMode === 'same-site' || deploymentMode === 'netlify-proxy') && sameSite === 'none') || (deploymentMode === 'cross-site' && (sameSite !== 'none' || env.SESSION_ALLOW_CROSS_SITE_COOKIES !== 'true')));
  if (database.error || !tokenHashSecret || tokenHashSecret.length < 32 || !sessionDays || !activityMinutes || !resetMinutes || !sameSite || incompatibleCookieMode || deliveryConfigured && (!safeWebhook || !safeResetBase)) return { enabled: false, error: 'First-party authentication is not configured.' };
  return { enabled: true, tokenHashSecret, sessionMs: sessionDays * 86_400_000, activityMs: activityMinutes * 60_000, resetMs: resetMinutes * 60_000, deploymentMode, cookie: { secure, sameSite }, resetDelivery: safeWebhook && safeResetBase ? { webhook: safeWebhook, resetBase: safeResetBase } : undefined };
}
function repositoryFor(env = process.env) { return new Repository(getPool(env)); }
function parseCookies(headers) { const raw = headers?.cookie; if (Array.isArray(raw) || typeof raw !== 'string') return {}; return raw.split(';').reduce((result, part) => { const index = part.indexOf('='); if (index > 0) { try { result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch {} } return result; }, {}); }
function opaqueToken() { return crypto.randomBytes(32).toString('base64url'); }
function hashOpaque(value, secret) { return crypto.createHmac('sha256', secret).update(value).digest('hex'); }
function equalHash(left, right) { if (typeof left !== 'string' || typeof right !== 'string') return false; const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function normalizeEmail(value) { if (typeof value !== 'string') return undefined; const email = value.normalize('NFKC').trim().toLowerCase(); return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined; }
function displayName(value) { if (value === undefined) return undefined; if (typeof value !== 'string') return undefined; const name = value.normalize('NFKC').trim(); return name.length >= 1 && name.length <= 120 && !/[\u0000-\u001f]/.test(name) ? name : undefined; }
function validPassword(value, email) { if (typeof value !== 'string' || value.length < 12 || value.length > 128 || /[\u0000-\u001f]/.test(value)) return false; const local = email?.split('@')[0]; return !local || !value.toLowerCase().includes(local); }
async function hashPassword(password) { return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 }); }
async function verifyPassword(hash, password) { try { return await argon2.verify(hash, password); } catch { return false; } }
function cookieAttributes(name, configuration, maxAgeSeconds, httpOnly) { return [`${name}=${maxAgeSeconds > 0 ? '' : ''}`, 'Path=/api', ...(httpOnly ? ['HttpOnly'] : []), `SameSite=${configuration.cookie.sameSite[0].toUpperCase()}${configuration.cookie.sameSite.slice(1)}`, ...(configuration.cookie.secure ? ['Secure'] : []), `Max-Age=${Math.max(0, maxAgeSeconds)}`]; }
function sessionCookie(token, configuration) { const parts = cookieAttributes(COOKIE_NAME, configuration, Math.floor(configuration.sessionMs / 1_000), true); parts[0] = `${COOKIE_NAME}=${encodeURIComponent(token)}`; return parts.join('; '); }
function csrfCookie(token, configuration) { const parts = cookieAttributes(CSRF_COOKIE_NAME, configuration, Math.floor(configuration.sessionMs / 1_000), false); parts[0] = `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`; return parts.join('; '); }
function clearSessionCookie(configuration) { return cookieAttributes(COOKIE_NAME, configuration, 0, true).join('; '); }
function clearCsrfCookie(configuration) { return cookieAttributes(CSRF_COOKIE_NAME, configuration, 0, false).join('; '); }
function metadataHash(value, secret) { return value ? hashOpaque(value.slice(0, 1_000), secret) : undefined; }
function sessionMaterial(configuration, metadata = {}) { const token = opaqueToken(); const csrfToken = opaqueToken(); const expiresAt = new Date(Date.now() + configuration.sessionMs); return { token, csrfToken, expiresAt, tokenHash: hashOpaque(token, configuration.tokenHashSecret), csrfTokenHash: hashOpaque(csrfToken, configuration.tokenHashSecret), userAgentHash: metadataHash(metadata.userAgent, configuration.tokenHashSecret), ipPrefixHash: metadataHash(metadata.ipPrefix, configuration.tokenHashSecret) }; }
async function createSession(repository, user, configuration, metadata = {}) { const session = sessionMaterial(configuration, metadata); await repository.createSession({ userId: user.id, ...session }); return { token: session.token, csrfToken: session.csrfToken, expiresAt: session.expiresAt }; }
async function currentSession(headers, configuration, repository, { requireCsrf = false } = {}) {
  if (!configuration?.enabled) return { error: 'AUTH_UNAVAILABLE', status: 503 };
  const token = parseCookies(headers)[COOKIE_NAME]; if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return { error: 'AUTH_REQUIRED', status: 401 };
  const session = await repository.sessionByTokenHash(hashOpaque(token, configuration.tokenHashSecret)); if (!session) return { error: 'AUTH_REQUIRED', status: 401 };
  if (requireCsrf) { const csrf = headers?.[CSRF_HEADER] ?? headers?.[CSRF_HEADER.toLowerCase()]; const value = Array.isArray(csrf) ? undefined : csrf; if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value) || !equalHash(hashOpaque(value, configuration.tokenHashSecret), session.csrfTokenHash)) return { error: 'CSRF_INVALID', status: 403 }; }
  if (Date.now() - new Date(session.lastActivityAt).getTime() >= configuration.activityMs) await repository.touchSession(session.id);
  return { session, token };
}
async function sendResetDelivery(delivery, email, token) {
  if (!delivery) return false;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8_000);
  try { const url = new URL(delivery.resetBase); url.searchParams.set('token', token); const result = await fetch(delivery.webhook, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ to: email, resetUrl: url.toString() }) }); return result.ok; } catch { return false; } finally { clearTimeout(timer); }
}
module.exports = { COOKIE_NAME, CSRF_COOKIE_NAME, CSRF_HEADER, authConfig, repositoryFor, parseCookies, opaqueToken, hashOpaque, equalHash, normalizeEmail, displayName, validPassword, hashPassword, verifyPassword, sessionCookie, csrfCookie, clearSessionCookie, clearCsrfCookie, sessionMaterial, createSession, currentSession, sendResetDelivery, publicUser: row => ({ id: row.id, email: row.email, displayName: row.displayName, status: row.status, emailVerified: row.emailVerified, createdAt: row.createdAt }) };
