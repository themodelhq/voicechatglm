const { authConfig, repositoryFor, parseCookies, normalizeEmail, displayName, validPassword, hashPassword, verifyPassword, hashOpaque, opaqueToken, equalHash, sessionMaterial, createSession, currentSession, sessionCookie, csrfCookie, clearSessionCookie, clearCsrfCookie, sendResetDelivery, CSRF_COOKIE_NAME } = require('./auth.cjs');

function safeUser(user) { return user ? { id: user.id, email: user.email, displayName: user.displayName, emailVerified: user.emailVerified, createdAt: user.createdAt } : undefined; }
function metadata(meta) { return { userAgent: typeof meta.headers?.['user-agent'] === 'string' ? meta.headers['user-agent'] : undefined, ipPrefix: typeof meta.rateLimitKey === 'string' ? meta.rateLimitKey : undefined }; }
function validObject(value, allowed) { if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined; if (Object.keys(value).some(key => !allowed.includes(key))) return undefined; return value; }
function genericAuthFailure() { return { status: 401, body: { error: 'Email or password is incorrect.' } }; }
function resetAccepted() { return { status: 202, body: { accepted: true } }; }
async function handleAuthRoute({ route, method, body, meta = {}, env = process.env, consumeAuthAttempt }) {
  const configuration = authConfig(env); if (!configuration.enabled) return { status: 503, body: { error: 'Authentication is temporarily unavailable.' } };
  let repository; try { repository = meta.repository || repositoryFor(env); } catch { return { status: 503, body: { error: 'Authentication is temporarily unavailable.' } }; }
  const attempt = async category => { if (!consumeAuthAttempt) return { allowed: true }; try { return await consumeAuthAttempt(category, meta.rateLimitKey || 'anonymous'); } catch { return { unavailable: true }; } };
  try {
    if (route === 'register') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } }; const limited = await attempt('register'); if (limited.unavailable) return { status: 503, body: { error: 'Authentication protection is temporarily unavailable.' } }; if (!limited.allowed) return { status: 429, body: { error: 'Please wait before trying again.' }, retryAfter: limited.retryAfter };
      const value = validObject(body, ['email', 'password', 'display_name']); const email = normalizeEmail(value?.email); const name = value?.display_name === undefined ? undefined : displayName(value.display_name); if (!value || !email || value?.display_name !== undefined && !name || !validPassword(value.password, email)) return { status: 400, body: { error: 'Use a valid email, an optional display name, and a password of 12–128 characters that does not contain your email local part.' } };
      const user = await repository.createUser({ email, displayName: name, passwordHash: await hashPassword(value.password) }); const session = await createSession(repository, user, configuration, metadata(meta)); return { status: 201, body: { user: safeUser(user), csrfToken: session.csrfToken }, setCookie: sessionCookie(session.token, configuration), setCsrfCookie: csrfCookie(session.csrfToken, configuration) };
    }
    if (route === 'login') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } }; const limited = await attempt('login'); if (limited.unavailable) return { status: 503, body: { error: 'Authentication protection is temporarily unavailable.' } }; if (!limited.allowed) return { status: 429, body: { error: 'Please wait before trying again.' }, retryAfter: limited.retryAfter };
      const value = validObject(body, ['email', 'password']); const email = normalizeEmail(value?.email); if (!value || !email || typeof value.password !== 'string') return genericAuthFailure(); const user = await repository.userForLogin(email); if (!user || user.account_status !== 'active' || !await verifyPassword(user.password_hash, value.password)) return genericAuthFailure(); await repository.markLogin(user.id); const safe = await repository.userById(user.id); const session = await createSession(repository, safe, configuration, metadata(meta)); return { status: 200, body: { user: safeUser(safe), csrfToken: session.csrfToken }, setCookie: sessionCookie(session.token, configuration), setCsrfCookie: csrfCookie(session.csrfToken, configuration) };
    }
    if (route === 'me') {
      if (method !== 'GET') return { status: 405, body: { error: 'Method not allowed.' } }; const current = await currentSession(meta.headers, configuration, repository); if (current.error) return { status: current.status, body: { error: 'Authentication is required.' }, clearCookie: current.status === 401 ? clearSessionCookie(configuration) : undefined, clearCsrfCookie: current.status === 401 ? clearCsrfCookie(configuration) : undefined };
      // Session restoration is intentionally read-only for CSRF state. A per-session
      // CSRF value is created at login/registration/reset, stored only as a server-side
      // hash, and mirrored in a non-HttpOnly anti-CSRF cookie. The raw value is never a
      // session credential. Both concurrent tabs therefore receive the same value.
      const csrfToken = parseCookies(meta.headers)[CSRF_COOKIE_NAME];
      if (typeof csrfToken !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(csrfToken) || !equalHash(hashOpaque(csrfToken, configuration.tokenHashSecret), current.session.csrfTokenHash)) return { status: 401, body: { error: 'Authentication is required.' }, clearCookie: clearSessionCookie(configuration), clearCsrfCookie: clearCsrfCookie(configuration) };
      return { status: 200, body: { user: safeUser(current.session.user), csrfToken } };
    }
    if (route === 'logout' || route === 'logout-all') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } }; const current = await currentSession(meta.headers, configuration, repository, { requireCsrf: true }); if (current.error) return current.status === 401 ? { status: 204, body: {}, clearCookie: clearSessionCookie(configuration), clearCsrfCookie: clearCsrfCookie(configuration) } : { status: current.status, body: { error: 'CSRF validation failed.' } }; if (route === 'logout') await repository.revokeSessionByTokenHash(hashOpaque(current.token, configuration.tokenHashSecret)); else await repository.revokeAllSessions(current.session.user.id); return { status: 204, body: {}, clearCookie: clearSessionCookie(configuration), clearCsrfCookie: clearCsrfCookie(configuration) };
    }
    if (route === 'forgot-password') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } }; const limited = await attempt('reset'); if (limited.unavailable) return { status: 503, body: { error: 'Authentication protection is temporarily unavailable.' } }; if (!limited.allowed) return { status: 429, body: { error: 'Please wait before trying again.' }, retryAfter: limited.retryAfter };
      const value = validObject(body, ['email']); const email = normalizeEmail(value?.email); if (!email) return resetAccepted(); const user = await repository.userForLogin(email); if (!user || user.account_status !== 'active') return resetAccepted(); const token = opaqueToken(); await repository.createResetToken({ userId: user.id, tokenHash: hashOpaque(token, configuration.tokenHashSecret), expiresAt: new Date(Date.now() + configuration.resetMs) }); await sendResetDelivery(configuration.resetDelivery, user.email_normalized, token); return resetAccepted();
    }
    if (route === 'reset-password') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } }; const limited = await attempt('reset'); if (limited.unavailable) return { status: 503, body: { error: 'Authentication protection is temporarily unavailable.' } }; if (!limited.allowed) return { status: 429, body: { error: 'Please wait before trying again.' }, retryAfter: limited.retryAfter };
      const value = validObject(body, ['token', 'password']); if (!value || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value.token) || typeof value.password !== 'string') return { status: 400, body: { error: 'The reset request is invalid or expired.' } };
      // Reject structural password-policy failures before hashing or touching token state.
      if (!validPassword(value.password)) return { status: 400, body: { error: 'Use a password of 12–128 characters that does not contain your email local part.' } };
      const session = sessionMaterial(configuration, metadata(meta));
      const reset = await repository.resetPasswordWithToken({ tokenHash: hashOpaque(value.token, configuration.tokenHashSecret), password: value.password, validatePassword: validPassword, hashPassword, replacementSession: session });
      if (reset.outcome === 'password_invalid') return { status: 400, body: { error: 'Use a password of 12–128 characters that does not contain your email local part.' } };
      if (reset.outcome !== 'success') return { status: 400, body: { error: 'The reset request is invalid or expired.' } };
      return { status: 200, body: { user: safeUser(reset.user), csrfToken: session.csrfToken }, setCookie: sessionCookie(session.token, configuration), setCsrfCookie: csrfCookie(session.csrfToken, configuration) };
    }
    return undefined;
  } catch (error) {
    // Constraint, database and hashing errors are intentionally not exposed to callers.
    if (route === 'register' && String(error?.code || '') === '23505') return { status: 409, body: { error: 'An account with that email already exists.' } };
    return { status: 503, body: { error: 'Authentication is temporarily unavailable.' } };
  }
}
module.exports = { handleAuthRoute, safeUser };
