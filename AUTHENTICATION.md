# First-Party Authentication, Password Reset, and Browser Sessions

## API contract

Render owns first-party authentication. Browser requests are credentialed; no browser bearer token, client secret, external identity account, shared password, or frontend-supplied user ID is authoritative.

| Route | Operation | Result |
| --- | --- | --- |
| `POST /api/auth/register` | Normalize email, validate password, create user/session | `201`, safe user, CSRF value, session + CSRF cookies |
| `POST /api/auth/login` | Generic failure, Argon2id verify, active-user check | `200`, safe user, CSRF value, session + CSRF cookies |
| `GET /api/auth/me` | Restore current session without CSRF rotation | `200`, safe user and the existing session CSRF value |
| `POST /api/auth/logout` | Revoke current session | `204`, clears both cookies; repeat-safe |
| `POST /api/auth/logout-all` | Revoke every current-user session | `204`, clears this browser’s cookies |
| `POST /api/auth/forgot-password` | Create hashed expiring reset record and request delivery | Generic `202`; never reveals account existence |
| `POST /api/auth/reset-password` | Atomically validate, consume, change, revoke and issue replacement session | `200`, safe user, CSRF value, replacement cookies |

## Password reset transaction

A reset request validates its JSON shape, token format (base64url 32–128 characters) and structural password policy before deriving the token hash or opening reset state. Password policy is 12–128 characters, no control characters, and no email local part.

`Repository.resetPasswordWithToken()` then uses one PostgreSQL transaction:

1. lock the matching unconsumed, unexpired reset/user rows with `SELECT … FOR UPDATE`;
2. reject absent, expired, consumed, disabled, or account-policy-invalid rows without mutation;
3. derive an Argon2id hash in memory;
4. update password hash and password-change timestamp;
5. conditionally mark the reset token consumed;
6. revoke every pre-existing active user session;
7. insert the replacement session; and
8. commit.

Any error rolls back the transaction. This row lock serializes concurrent attempts: one request can consume a token; the other observes it as unavailable. No reset token, password, password hash input, session secret, or reset URL is written to application logs. A password-policy failure leaves a valid token usable for a corrected retry.

## CSRF lifecycle and multi-tab behavior

At registration, login, or successful reset, Render generates a separate 256-bit random CSRF value. PostgreSQL stores only its HMAC-SHA-256 hash bound to the opaque session. The raw CSRF value is delivered in the JSON response and a scoped non-HttpOnly anti-CSRF cookie named `voicechatglm_csrf`; it is **not** a session credential.

`GET /api/auth/me` does not rotate CSRF state. It verifies that the scoped anti-CSRF cookie hashes to the active session’s stored CSRF hash, then returns that same value. This makes simultaneous restoration in two tabs stable. State-changing authenticated routes require `X-CSRF-Token`; validation is bound to the server session and uses constant-time hash comparison. Missing or mismatched values fail with `403`.

The React provider keeps the value only in memory for request headers. It never reads the HttpOnly session cookie or stores a session secret in local/session storage. An epoch guards asynchronous restore/login results. Logout increments that epoch, clears local state first, and still submits server logout using an already-held CSRF value; a restore response started before logout cannot restore authenticated UI afterward.

The v1.0.8 paired-cookie change causes an existing v1.0.7 session that lacks the anti-CSRF cookie to be cleared on its next restore; v1.0.9 preserves that contract. Users sign in again; this deliberate one-time migration avoids accepting an unpaired session/CSRF state.

## Session policy

- Passwords use Argon2id: `memoryCost=65536`, `timeCost=3`, `parallelism=1`.
- The session secret is random 256-bit base64url data. PostgreSQL stores only its HMAC-SHA-256 hash with expiry, activity, revocation, and limited hashed metadata.
- Default absolute expiry is seven days. `last_activity_at` updates at most once per configured interval, but never extends the absolute expiry.
- Expired, revoked, and disabled-account sessions are rejected. Logout revokes the current session; logout-all and a successful reset revoke prior sessions. Maintenance deletes expired records and aged revocations.

## Cookie, origin, and deployment architecture

The selected production architecture is **same-site sibling HTTPS domains** supplied by the owner, such as `app.<owner-domain>` and `api.<owner-domain>`. Cookies remain host-only (no `Domain` attribute) and are scoped to `Path=/api`:

```text
voicechatglm_session=<opaque>; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=<session lifetime>
voicechatglm_csrf=<anti-CSRF>; Path=/api; Secure; SameSite=Lax; Max-Age=<session lifetime>
```

The API origin differs from the frontend origin, so the browser uses `credentials: "include"`; Render permits only explicitly configured `ALLOWED_ORIGINS`, returns that exact origin plus `Access-Control-Allow-Credentials: true`, permits only required methods/headers, and never emits wildcard credentialed CORS. State-changing production requests also require a permitted `Origin`; CORS is not treated as CSRF protection.

`SESSION_DEPLOYMENT_MODE=same-site` with `SESSION_COOKIE_SAMESITE=lax` is the safe default. `netlify-proxy` is reserved for an owner-verified same-origin Netlify proxy. `cross-site` is exceptional and requires `SESSION_COOKIE_SAMESITE=none` plus explicit `SESSION_ALLOW_CROSS_SITE_COOKIES=true`; modern browser third-party-cookie policies may still break it. Unrelated default Netlify/Render hostnames are therefore not an accepted production session topology without real browser validation.

## Reset delivery

Delivery requires both server-only values:

- `PASSWORD_RESET_EMAIL_WEBHOOK_URL` — trusted HTTPS mail webhook;
- `PASSWORD_RESET_URL_BASE` — HTTPS frontend reset page base.

The webhook receives `{ to, resetUrl }` and must not log the reset URL. Without both values, forgot-password returns the same generic `202` but cannot deliver mail. There is no development route that exposes a reset token.
