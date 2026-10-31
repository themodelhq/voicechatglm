# Netlify Frontend Deployment and Browser Session Topology

Netlify hosts the static React build and a narrowly scoped same-origin reverse proxy for `/api/*`. The proxy forwards only to the fixed Render API hostname; it does not accept a browser-selected destination. Render remains the only application API and the authority for authentication, authorization, CSRF, database access, and model calls.

## Required Netlify configuration

Set this public build variable in Netlify:

```text
VITE_PROXY_BASE_URL=/api
```

`netlify.toml` proxies `/api/*` to `https://voicechatglm.onrender.com/api/:splat` before the SPA fallback. This keeps the browser's API calls on the frontend origin, so the HttpOnly session cookie is first-party instead of being sent cross-site from a Netlify hostname to an `onrender.com` hostname. The frontend accepts the relative `/api` base only; absolute HTTPS API URLs remain supported for a separately verified custom-domain deployment. As a safety guard, the default `voicechatglm.onrender.com` hostname is normalized to `/api` in production so a stale or incorrect Netlify build variable cannot silently bypass the first-party proxy.

## Required Render session settings

Configure the Render API service with:

- `SESSION_DEPLOYMENT_MODE=netlify-proxy`
- `SESSION_COOKIE_SECURE=true`
- `SESSION_COOKIE_SAMESITE=lax`
- `ALLOWED_ORIGINS` equal to the exact Netlify site origin (for example `https://your-site.netlify.app`), with no path, trailing slash, or wildcard.

Keep the existing PostgreSQL, Redis, model, private storage, and scanner secrets in Render only. Do not put credentials in Netlify build variables.

## Proxy acceptance checks

The proxy rule is deliberately limited to `/api/*`. Before treating the deployment as production-ready, verify in the deployed Netlify site:

1. Login and registration responses preserve both session and CSRF `Set-Cookie` headers.
2. The browser stores the session cookie as HttpOnly, Secure, SameSite=Lax, with the API path.
3. A refresh restores the signed-in session through `GET /api/auth/me`.
4. Chat, file upload, file analysis, logout, and CSRF rejection work through the same-origin `/api` path.
5. Uploads at the application's configured maximum size and long-running requests survive the Netlify proxy's request/response limits and timeout behavior.
6. Two separate browser contexts can log in independently and a CSRF failure does not incorrectly clear an otherwise valid session.

If Netlify's proxy limits or behavior do not pass these checks, use owner-controlled sibling HTTPS domains instead: frontend on `app.<owner-domain>`, API on `api.<owner-domain>`, and set `VITE_PROXY_BASE_URL=https://api.<owner-domain>/api` with `SESSION_DEPLOYMENT_MODE=same-site`.

## Deployment order

1. Set the Netlify build variable to `VITE_PROXY_BASE_URL=/api`.
2. Deploy the Render API with the session settings above and the exact Netlify origin in `ALLOWED_ORIGINS`.
3. Deploy Netlify so the `/api/*` proxy rule and relative API base are active.
4. Run all proxy acceptance checks above, including file uploads and analysis, before enabling production file analysis for users.

The static build succeeding is not live acceptance evidence. Verify cookies, session restoration, CSRF, uploads, and analysis in the deployed browser.
