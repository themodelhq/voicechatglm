# Deployment Architecture — v1.2.5

## Supported session arrangement

The owner configures HTTPS sibling domains:

```text
app.<owner-domain> → Netlify static app
api.<owner-domain> → Render API
```

Set Netlify `VITE_PROXY_BASE_URL` to the exact API `/api` base and Render `ALLOWED_ORIGINS` to the exact app origin. Configure `SESSION_DEPLOYMENT_MODE=same-site`, `SESSION_COOKIE_SECURE=true`, and `SESSION_COOKIE_SAMESITE=lax`. Cookies are host-only and `Path=/api`; no broad `Domain` setting is used.

Browser requests use `credentials: include`; Render performs exact credentialed CORS, state-changing Origin validation, and session-bound CSRF validation. The CSRF cookie/header is not the HttpOnly session secret.

## Unsupported-by-default alternatives

Default unrelated Netlify/Render domains can invoke third-party-cookie blocking. A `SameSite=None` cookie does not solve all browsers. A Netlify proxy must not be enabled until actual cookie forwarding, `Set-Cookie`, request-body size, timeout/cancellation, non-caching, and restricted-route behavior are accepted live. Render remains the authoritative backend in every arrangement.

## Dependency reporting

- `/api/live`: Node process liveness.
- `/api/readiness`: no-secret cached report for database/migrations, Redis, file dependency state, and—when production file analysis is enabled—storage write/read/delete canary, scanner signature, and authenticated protected-model `/ready` verification.
- `/api/ready`: PostgreSQL/Redis plus upstream readiness endpoint; it does not generate model output.

No live owner domain, service, or browser test has been supplied. This document is a deployment design, not evidence of a deployed configuration.
