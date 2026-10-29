# Netlify Frontend Deployment and Browser Session Topology

Netlify hosts the static React build only. It has no database connection, private storage credentials, model key, scanner, or alternate application backend. `netlify.toml` runs `npm run build`, publishes `dist`, and uses an SPA fallback.

## Selected production topology

Use owner-controlled sibling HTTPS domains so browser and API are same-site:

```text
https://app.<owner-domain>  → Netlify static frontend
https://api.<owner-domain>/api → Render API
```

The owner supplies, validates, and certificates the actual domain; this release does not invent one. Set the Netlify public build value to the exact API base:

```text
VITE_PROXY_BASE_URL=https://api.<owner-domain>/api
```

Set Render `ALLOWED_ORIGINS` to the exact frontend origin, for example `https://app.<owner-domain>`, with no trailing path or wildcard. Configure Render `SESSION_DEPLOYMENT_MODE=same-site`, `SESSION_COOKIE_SECURE=true`, and `SESSION_COOKIE_SAMESITE=lax`.

This keeps cookies host-only at the API host while making sibling HTTPS hosts same-site for `SameSite=Lax`. Browser fetch still uses `credentials: "include"`, so exact credentialed CORS and session-bound CSRF remain required.

## Default unrelated hosting domains

A default Netlify hostname and a default `onrender.com` hostname are unrelated sites. `SameSite=None; Secure` does **not** guarantee support: privacy settings and browsers that block third-party cookies can prevent session restoration. This release does not certify that arrangement. Do not call it production-ready without live tests in at least two independent browser contexts, including a stricter third-party-cookie setting where available.

## Netlify proxy option

No Netlify proxy/function is enabled in this release. A same-origin proxy can be evaluated only after the owner supplies the actual Render target and validates all of the following in the deployed Netlify product version:

- route allowlist restricted to intended `/api/*` paths; no user-controlled upstream URL;
- request method/body forwarding, credential cookie forwarding, `Set-Cookie` preservation, status preservation, and no public caching of authentication, reset, file, or session responses;
- authenticated upload body-size limits, analysis timeouts, disconnect/cancellation propagation, and response buffering behavior;
- backend remains the sole authentication/authorization authority.

Do not add a generic proxy redirect or proxy an arbitrary destination merely to work around third-party-cookie restrictions. If an owner verifies such a proxy, use `SESSION_DEPLOYMENT_MODE=netlify-proxy` and retain host-only secure cookies, exact origin validation, CSRF headers, and Render authorization.

## Deployment order

1. Provision operator-owned frontend/API domains and TLS, or document why the deployment remains staging-only.
2. Provision Render PostgreSQL, Redis, model credentials, and a strong session hash secret.
3. Deploy Render and record `/api/live`, `/api/readiness`, and `/api/ready` results.
4. Set Netlify `VITE_PROXY_BASE_URL` to the API base; set exact Render `ALLOWED_ORIGINS`; deploy frontend.
5. In two separate browser contexts test registration, login, refresh/session restoration, protected requests, CSRF mismatch, logout, logout-all, reset delivery/completion, and browser restart according to the seven-day absolute-expiry policy.
6. Only after private storage/scanner/model integration tests pass, enable production file analysis.

`npx --yes netlify-cli@17.37.2 build --offline` validates static packaging only. It does not deploy Netlify, test browser cookies, preserve proxy cookies, or reach Render.
