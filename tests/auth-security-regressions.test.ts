import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { handleAuthRoute } = require('../server/auth-routes.cjs') as typeof import('../server/auth-routes.cjs');
const { COOKIE_NAME, CSRF_COOKIE_NAME, authConfig, currentSession, csrfCookie, hashOpaque, hashPassword, sessionCookie, verifyPassword } = require('../server/auth.cjs') as typeof import('../server/auth.cjs');
const { execute } = require('../server/proxy-core.cjs') as typeof import('../server/proxy-core.cjs');

const secret = 'r'.repeat(48);
function env(overrides: NodeJS.ProcessEnv = {}) { return { NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:password@database.test:5432/voicechatglm', SESSION_TOKEN_HASH_SECRET: secret, VOICECHATGLM_API_URL: 'http://model.test', VOICECHATGLM_API_KEY: 'model-key', ...overrides } as NodeJS.ProcessEnv; }
function meta(repository: unknown, headers: Record<string, string> = {}) { return { repository, headers, rateLimitKey: 'peer:127.0.0.1' }; }

class ResetRepository {
  users = new Map<string, any>(); sessions = new Map<string, any>(); resets = new Map<string, any>(); failBeforeCommit = false; private tail = Promise.resolve();
  async userById(id: string) { return [...this.users.values()].find(user => user.id === id); }
  async createSession(input: any) { this.sessions.set(input.tokenHash, { userId: input.userId, csrfTokenHash: input.csrfTokenHash, expiresAt: input.expiresAt, revoked: false, id: `s-${this.sessions.size + 1}`, lastActivityAt: new Date() }); }
  async resetPasswordWithToken(input: any) {
    // Serializes this double like PostgreSQL's SELECT ... FOR UPDATE so the route test
    // exercises two simultaneous callers against a one-time token.
    let release!: () => void; const previous = this.tail; this.tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    try {
      const reset = this.resets.get(input.tokenHash); if (!reset || reset.consumed || reset.expiresAt <= new Date()) return { outcome: 'invalid' };
      const user = await this.userById(reset.userId); if (!user || user.status !== 'active') return { outcome: 'invalid' };
      if (!input.validatePassword(input.password, user.email)) return { outcome: 'password_invalid' };
      const passwordHash = await input.hashPassword(input.password);
      if (this.failBeforeCommit) throw new Error('simulated database write failure');
      user.passwordHash = passwordHash; reset.consumed = true;
      for (const session of this.sessions.values()) if (session.userId === user.id) session.revoked = true;
      await this.createSession({ userId: user.id, tokenHash: input.replacementSession.tokenHash, csrfTokenHash: input.replacementSession.csrfTokenHash, expiresAt: input.replacementSession.expiresAt });
      return { outcome: 'success', user };
    } finally { release(); }
  }
}
function resetFixture() {
  const repository = new ResetRepository(); const user = { id: 'u-1', email: 'person@example.test', status: 'active', passwordHash: '' }; repository.users.set(user.email, user); return { repository, user };
}
async function issueReset(repository: ResetRepository, user: any, token = 't'.repeat(43), expiresAt = new Date(Date.now() + 60_000)) { repository.resets.set(hashOpaque(token, secret), { userId: user.id, expiresAt, consumed: false }); return token; }

describe('v1.0.8 password reset transaction regression', () => {
  it('does not consume a valid token for an invalid password and permits a corrected retry', async () => {
    const { repository, user } = resetFixture(); user.passwordHash = await hashPassword('old secure password 123'); const oldHash = user.passwordHash; const token = await issueReset(repository, user);
    const invalid = await handleAuthRoute({ route: 'reset-password', method: 'POST', body: { token, password: 'short' }, meta: meta(repository), env: env(), consumeAuthAttempt: async () => ({ allowed: true }) });
    expect(invalid.status).toBe(400); expect(repository.resets.get(hashOpaque(token, secret)).consumed).toBe(false); expect(user.passwordHash).toBe(oldHash);
    const previousSessionHash = hashOpaque('s'.repeat(43), secret); await repository.createSession({ userId: user.id, tokenHash: previousSessionHash, csrfTokenHash: hashOpaque('c'.repeat(43), secret), expiresAt: new Date(Date.now() + 60_000) });
    const successful = await handleAuthRoute({ route: 'reset-password', method: 'POST', body: { token, password: 'new secure password 456' }, meta: meta(repository), env: env(), consumeAuthAttempt: async () => ({ allowed: true }) });
    expect(successful.status).toBe(200); expect(repository.resets.get(hashOpaque(token, secret)).consumed).toBe(true); expect(await verifyPassword(user.passwordHash, 'new secure password 456')).toBe(true); expect(await verifyPassword(user.passwordHash, 'old secure password 123')).toBe(false); expect(repository.sessions.get(previousSessionHash).revoked).toBe(true);
    const reused = await handleAuthRoute({ route: 'reset-password', method: 'POST', body: { token, password: 'another secure password 456' }, meta: meta(repository), env: env(), consumeAuthAttempt: async () => ({ allowed: true }) });
    expect(reused.status).toBe(400);
  });
  it('rejects expired tokens and lets only one simultaneous reset succeed', async () => {
    const expired = resetFixture(); expired.user.passwordHash = await hashPassword('old secure password 123'); const expiredToken = await issueReset(expired.repository, expired.user, 'e'.repeat(43), new Date(Date.now() - 1));
    const expiredResult = await handleAuthRoute({ route: 'reset-password', method: 'POST', body: { token: expiredToken, password: 'new secure password 456' }, meta: meta(expired.repository), env: env(), consumeAuthAttempt: async () => ({ allowed: true }) }); expect(expiredResult.status).toBe(400);
    const concurrent = resetFixture(); concurrent.user.passwordHash = await hashPassword('old secure password 123'); const token = await issueReset(concurrent.repository, concurrent.user, 'q'.repeat(43));
    const results = await Promise.all(['first secure password 456', 'second secure password 456'].map(password => handleAuthRoute({ route: 'reset-password', method: 'POST', body: { token, password }, meta: meta(concurrent.repository), env: env(), consumeAuthAttempt: async () => ({ allowed: true }) })));
    expect(results.filter(result => result.status === 200)).toHaveLength(1); expect(results.filter(result => result.status === 400)).toHaveLength(1);
  });
  it('fails safely without consuming state if the transactional database work fails and never logs secrets', async () => {
    const { repository, user } = resetFixture(); user.passwordHash = await hashPassword('old secure password 123'); const oldHash = user.passwordHash; const token = await issueReset(repository, user); repository.failBeforeCommit = true;
    const log = vi.spyOn(console, 'log'); const warn = vi.spyOn(console, 'warn'); const error = vi.spyOn(console, 'error');
    const result = await handleAuthRoute({ route: 'reset-password', method: 'POST', body: { token, password: 'new secure password 456' }, meta: meta(repository), env: env(), consumeAuthAttempt: async () => ({ allowed: true }) });
    expect(result.status).toBe(503); expect(repository.resets.get(hashOpaque(token, secret)).consumed).toBe(false); expect(user.passwordHash).toBe(oldHash); expect([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].join(' ')).not.toContain(token); expect([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].join(' ')).not.toContain('new secure password 456'); log.mockRestore(); warn.mockRestore(); error.mockRestore();
  });
});

class SessionRepository {
  constructor(public session: any) {}
  async sessionByTokenHash() { return this.session; }
  async touchSession() {}
  async revokeSessionByTokenHash() { this.session = undefined; }
}
describe('v1.0.8 stable session-bound CSRF lifecycle', () => {
  it('returns one stable token to concurrent session-restoration tabs and validates both protected requests', async () => {
    const cfg = authConfig(env()); const sessionToken = 's'.repeat(43); const csrfToken = 'c'.repeat(43); const repository = new SessionRepository({ id: 'session-1', csrfTokenHash: hashOpaque(csrfToken, secret), expiresAt: new Date(Date.now() + 60_000), lastActivityAt: new Date(), user: { id: 'u-1', email: 'person@example.test', status: 'active' } }); const cookie = `${COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`;
    const [first, second] = await Promise.all([handleAuthRoute({ route: 'me', method: 'GET', meta: meta(repository, { cookie }), env: env() }), handleAuthRoute({ route: 'me', method: 'GET', meta: meta(repository, { cookie }), env: env() })]);
    expect(first).toMatchObject({ status: 200, body: { csrfToken } }); expect(second).toMatchObject({ status: 200, body: { csrfToken } }); expect(repository.session.csrfTokenHash).toBe(hashOpaque(csrfToken, secret));
    await expect(currentSession({ cookie: `${COOKIE_NAME}=${sessionToken}`, 'x-csrf-token': csrfToken }, cfg, repository, { requireCsrf: true })).resolves.toMatchObject({ session: { id: 'session-1' } });
    await expect(currentSession({ cookie: `${COOKIE_NAME}=${sessionToken}`, 'x-csrf-token': csrfToken }, cfg, repository, { requireCsrf: true })).resolves.toMatchObject({ session: { id: 'session-1' } });
  });
  it('rejects missing/mismatched CSRF values, cross-origin state changes, and database lookup errors safely', async () => {
    const cfg = authConfig(env()); const sessionToken = 's'.repeat(43); const csrfToken = 'c'.repeat(43); const repository = new SessionRepository({ id: 'session-1', csrfTokenHash: hashOpaque(csrfToken, secret), expiresAt: new Date(Date.now() + 60_000), lastActivityAt: new Date(), user: { id: 'u-1', email: 'person@example.test', status: 'active' } });
    await expect(currentSession({ cookie: `${COOKIE_NAME}=${sessionToken}` }, cfg, repository, { requireCsrf: true })).resolves.toMatchObject({ error: 'CSRF_INVALID', status: 403 });
    await expect(currentSession({ cookie: `${COOKIE_NAME}=${sessionToken}`, 'x-csrf-token': 'x'.repeat(43) }, cfg, repository, { requireCsrf: true })).resolves.toMatchObject({ error: 'CSRF_INVALID', status: 403 });
    const crossOrigin = await execute('auth/logout', 'POST', {}, { repository, origin: 'https://untrusted.example', headers: { cookie: `${COOKIE_NAME}=${sessionToken}`, 'x-csrf-token': csrfToken } }, env({ ALLOWED_ORIGINS: 'https://app.example' })); expect(crossOrigin.statusCode).toBe(403); expect(crossOrigin.headers['Access-Control-Allow-Origin']).toBeUndefined();
    const allowed = await execute('auth/me', 'GET', undefined, { repository, origin: 'https://app.example', headers: { cookie: `${COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}` } }, env({ ALLOWED_ORIGINS: 'https://app.example' })); expect(allowed.statusCode).toBe(200); expect(allowed.headers['Access-Control-Allow-Origin']).toBe('https://app.example'); expect(allowed.headers['Access-Control-Allow-Credentials']).toBe('true');
    const unavailable = await execute('chat', 'POST', { message: 'test', max_new_tokens: 64 }, { repository: { async sessionByTokenHash() { throw new Error('database down'); } }, headers: { cookie: `${COOKIE_NAME}=${sessionToken}`, 'x-csrf-token': csrfToken } }, env()); expect(unavailable.statusCode).toBe(503);
  });
  it('sets separate session and anti-CSRF cookies with consistent scoped clearing attributes', () => {
    const cfg = authConfig(env()); const session = sessionCookie('s'.repeat(43), cfg); const csrf = csrfCookie('c'.repeat(43), cfg); expect(session).toContain('HttpOnly'); expect(session).toContain('Path=/api'); expect(csrf).not.toContain('HttpOnly'); expect(csrf).toContain('Path=/api'); expect(csrf).toContain('SameSite=Lax');
  });
  it('rejects unsafe production cookie/topology combinations rather than weakening cookie policy', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:password@database.test:5432/voicechatglm', SESSION_TOKEN_HASH_SECRET: secret, SESSION_COOKIE_SECURE: 'true' } as NodeJS.ProcessEnv;
    expect(authConfig({ ...base, SESSION_DEPLOYMENT_MODE: 'same-site', SESSION_COOKIE_SAMESITE: 'none' }).enabled).toBe(false);
    expect(authConfig({ ...base, SESSION_DEPLOYMENT_MODE: 'cross-site', SESSION_COOKIE_SAMESITE: 'none' }).enabled).toBe(false);
    expect(authConfig({ ...base, SESSION_DEPLOYMENT_MODE: 'cross-site', SESSION_COOKIE_SAMESITE: 'none', SESSION_ALLOW_CROSS_SITE_COOKIES: 'true' }).enabled).toBe(true);
  });
});
