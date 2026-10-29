# Architecture — v1.2.5

```text
Browser
  └─ Netlify static React frontend at owner-controlled app.<owner-domain>
       └─ credentialed HTTPS requests
            └─ Render Node API at api.<owner-domain>/api
                 ├─ Render PostgreSQL: users, password/session/reset hashes, owner-scoped conversations/messages/artifacts/memory/knowledge/shares/jobs
                 ├─ Redis-compatible service: shared temporary protection/concurrency leases
                 ├─ private S3-compatible storage: originals/extractions/generated artifacts
                 ├─ private ClamAV: configured malware scan
                 ├─ optional documented Brave Search API: server-only search credential
                 ├─ optional SSRF-protected public HTML retrieval: no internal-network access
                 ├─ server intent router/orchestrator + owner-scoped writing projects
                 └─ existing protected Hugging Face service: health/ready/text chat only
```

Render remains the authoritative application/authentication backend. Netlify has no application database, auth session truth, private storage credentials, model credential, or arbitrary proxy target.

Sessions are opaque random HttpOnly cookies whose hashes live in PostgreSQL. A separate stable per-session CSRF value is hashed in PostgreSQL, mirrored in a scoped anti-CSRF cookie, and sent in an `X-CSRF-Token` header for state changes. `/api/auth/me` is read-only for CSRF state, allowing concurrent browser tabs to restore safely.

The selected deployment topology uses owner-controlled sibling HTTPS frontend/API domains, host-only `/api` cookies, `Secure`, and `SameSite=Lax`; exact credentialed CORS remains mandatory. Default unrelated Netlify/Render domains are not classified as browser-compatible without live testing. See [AUTHENTICATION.md](AUTHENTICATION.md) and [DEPLOYMENT_NETLIFY.md](DEPLOYMENT_NETLIFY.md).

`POST /api/chat` is a central bounded intent boundary. It preserves ordinary model chat, routes only explicit validated tool requests to registered server handlers, and labels retrieved evidence as untrusted before synthesis. For authenticated use it persists an owner-scoped conversation/user message/assistant result with idempotency/recovery semantics; artifacts are attached only after the private artifact service has successfully stored bytes. File analysis stays on its existing authenticated route; writing state stays owner-scoped in PostgreSQL.

The frontend cache is never a cross-device authority. After session restoration, it hydrates the durable owner-scoped conversation list/history. Artifact download and deletion remain server-authorized; public share endpoints expose only an immutable, privacy-filtered selected/full message snapshot with a server-enforced finite expiry. Explicit memory requires an affirmative owner action, and knowledge indexing uses guarded extraction (including scanner-gated English OCR/PDF page extraction where enabled) plus bounded lexical PostgreSQL retrieval; optional vector retrieval remains separately gated.

The Render activation profile requests all nine supported gates. Production file analysis still refuses startup unless its storage/scanner/database/Redis/model dependencies verify; every other route independently checks configuration, authentication, ownership and bounds. Search/retrieval availability is not reported until a guarded runtime success. `/api/readiness` and authenticated `/api/capabilities` provide safe diagnostics but do not claim live suitability or run model generation for a provider probe.
