# Security Controls and Known Boundaries

## Identity, password reset, and sessions

Render processes first-party credentials. Passwords use Argon2id; PostgreSQL stores unique normalized emails, password hashes, opaque session-token HMAC hashes, CSRF HMAC hashes, expiry/activity/revocation metadata, and hashed reset tokens. Plaintext passwords, raw session secrets, raw reset tokens, database URLs, API keys, and object-storage credentials are not logged.

Password reset uses a PostgreSQL transaction and `SELECT … FOR UPDATE` row locking. Account-specific password validation happens before password/token/session mutation. Password update, token consumption, revocation of prior sessions, and insertion of the replacement session commit together or roll back together. A reset token cannot successfully serve two concurrent transactions.

Session expiry is absolute (seven days by default); activity updates do not extend it forever. Disabled, expired, and revoked sessions fail. Current logout revokes one session, logout-all revokes all, and reset revokes all pre-reset sessions before issuing a replacement session. PostgreSQL—not memory—is the multi-Render-instance source of truth.

## CSRF, cookies, CORS, and concurrency

The HttpOnly `voicechatglm_session` cookie is a bearer credential inaccessible to JavaScript. A distinct random `voicechatglm_csrf` cookie is readable only as a non-secret anti-CSRF value; PostgreSQL stores only its hash bound to the session. Authentication responses also deliver this CSRF value in JSON for the in-memory request provider.

Normal `/api/auth/me` restoration is read-only: it verifies the paired CSRF cookie and returns the same session-bound value instead of rotating it. This prevents concurrent tabs from invalidating each other. All authenticated state-changing routes require `X-CSRF-Token` and perform constant-time hash comparison; missing/mismatched headers fail. Origin validation and CSRF coexist—CORS, SameSite, and Origin are not substitutes for one another.

The approved topology is HTTPS sibling frontend/API domains selected by the owner, with host-only `Path=/api; HttpOnly; Secure; SameSite=Lax` session cookies and matching scoped CSRF cookies. Exact credentialed CORS reflects only an `ALLOWED_ORIGINS` member; wildcard credentialed CORS is never emitted. Unrelated default-host cross-site cookies remain a browser-compatibility risk even with `SameSite=None; Secure` and are not claimed supported without real-browser testing.

The React provider guards stale asynchronous responses with an epoch. Logout clears UI immediately, sends server revocation using the existing CSRF value when present, and prevents an older pending restoration from reinstalling authentication.

## Private files and model boundary

Private originals, extraction artifacts, and results use opaque S3-compatible keys; PostgreSQL stores metadata/ownership only. Quarantine-to-promote storage, ClamAV, bounded parsing, owner checks, cleanup, and private download paths are mandatory when production file analysis is enabled. There are no public object URLs and no client-supplied user IDs used for authorization.

Archive parsing rejects unsafe paths, encrypted/special/nested entries, corruption, and resource abuse. Uploaded content is never executed. It is untrusted evidence and cannot override privileged analysis rules. Image signature/dimension inspection itself is not OCR or image understanding. v1.2.9 accepts only scanner-success-state, signature-validated private PNG/JPEG/WebP/PDF bytes for protected document processing. Locked package-managed PDF.js/canvas detects image-paint operations and renders image-bearing PDF pages even when same-page native text exists; Tesseract uses packaged English data only. No system PDF/OCR binary, shell, user-controlled process path, browser request, or user-URL fetch is available to this path. Byte/page/dimension/pixel/output/time/concurrency bounds apply, and both chat and worker independently recheck clean scan state immediately before private processing. Per-page secret redaction/exclusion happens before hashes, artifacts, Knowledge chunks, or model evidence. Encrypted, malformed, unavailable, and over-limit documents fail or return partial truthfully.

Model endpoint/key and fixed model contract remain Render-only. Browser cookies, CSRF data, and session identifiers are never forwarded to the model.

## Web search, retrieval, workflow and writing boundary

Web search uses only the documented server-side Brave Search API adapter when explicitly enabled; its subscription token is Render-only. Website retrieval is separately gated and limited to conventional HTML/XHTML. It validates every URL and redirect, blocks unsafe protocols/ports and internal/loopback/link-local/metadata/private/DNS-rebinding targets, pins the outbound DNS answer actually used by Node, limits response/redirect/time/concurrency, and never executes page scripts. It does not bypass robots policy, login, CAPTCHA, paywall or access controls. See [WEB_RESEARCH_SECURITY.md](WEB_RESEARCH_SECURITY.md).

Search snippets, retrieved pages, ZIP contents, filenames and writing notes are untrusted data. Tool selection remains an allowlisted server responsibility; model output cannot create an arbitrary function, URL, shell command or backend action. Research synthesis receives labelled evidence and a trusted instruction not to treat evidence as authority. Writing projects, chapters, revisions and export are PostgreSQL owner-scoped and use existing session/CSRF checks; completed content is saved incrementally rather than hidden model reasoning.

## Local OCR, optional remote OCR, semantic, sandbox and browser-service boundaries

v1.2.9 local OCR/PDF extraction is package-managed and server-only; optional v1.2.6 external adapters are also server-only and fail closed. They validate bounded JSON responses and never return service tokens to the browser. Embedding/vector operations use a server-assigned owner namespace; authorization is repeated when mapping vector IDs back to PostgreSQL chunks. Custom analysis is posted only to a separately hosted service with a declared no-network, ephemeral-filesystem, no-process-spawn policy; the Node API never evaluates supplied code. Browser rendering is not static HTTP retrieval: the renderer must attest private-network denial, no credential forwarding and DNS resolution/pinning at every redirect, while this API validates each original/final/redirect URL. These controls are controlled-contract tested, not proof of an unprovisioned provider's deployment; live acceptance remains required. See [V1.2.6 external capability contracts](V1.2.6_EXTERNAL_CAPABILITY_CONTRACTS.md).

## Dependency-readiness boundary

`/api/readiness` provides a no-secret, cached diagnostic for configured/reachable PostgreSQL+migrations, Redis, optional file storage/scanner, and model configuration. It performs no model generation. A positive configuration value or local test does not prove a provider’s bucket privacy, malware signatures, browser policy, availability, or production behavior.

## Operational limitations

No real Netlify/Render/custom-domain browser flow, PostgreSQL/Redis, S3-compatible storage, ClamAV signatures, reset-mail webhook, or protected model service was supplied. Until owner acceptance tests run, this release is staging-ready, not production-ready. See [VALIDATION_REPORT.md](VALIDATION_REPORT.md).


## v1.3.0 external API-key boundary

External integration keys are user-created credentials, not sessions and not `VOICECHATGLM_API_KEY`. A key is random `vcg_<identifier>.<secret>` data; only the identifier and HMAC-SHA-256 secret digest are persisted. The full value is creation-response-only and must never enter a URL, browser storage, source control, request body, logs or telemetry. Owner identity for management actions derives from a verified first-party session; owner identity for bearer chat derives only from the verified database key.

The public v1 routes intentionally have no CORS headers and accept a credential only in `Authorization: Bearer`. They permit a single `chat:write` scope and fixed text-model operation. They reject malformed, unknown, expired, revoked, owner-inactive and underscoped credentials before upstream work, then conditionally recheck credential state while recording last use. Revoke promptly takes effect across application instances because authenticated credentials are not cached. Public errors are safe/no-store JSON and must not reveal bearer values, digests, SQL, internal model credentials or upstream diagnostics.
