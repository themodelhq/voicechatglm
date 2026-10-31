# Render API, PostgreSQL, Readiness, and Rollback

`render.yaml` declares the Node application. It runs `npm ci --omit=dev`, then `npm run proxy`. In production the process validates configuration, acquires the PostgreSQL migration advisory lock, applies pending migrations, starts maintenance, then listens.

- `/api/live` is process liveness only.
- `/api/ready` checks PostgreSQL, Redis, and the fixed upstream `/ready` endpoint without model generation.
- `/api/readiness` is a safe, cached (30-second) diagnostic report. It returns no secrets and distinguishes database reachability/migration status, Redis reachability, file feature state, storage canary/scanner-signature verification, and protected-model `/ready` reachability. It does **not** generate model output. The storage/scanner/model probes run only when production file analysis is enabled.

A `503` readiness result is diagnostic evidence of an unavailable or incomplete dependency, not a reason to bypass security gates.

## Required Render settings

| Group | Required settings |
| --- | --- |
| Model | `VOICECHATGLM_API_URL`, `VOICECHATGLM_API_KEY`, pinned Blueprint model ID/revision |
| Browser boundary | exact HTTPS `ALLOWED_ORIGINS` |
| PostgreSQL/auth | `DATABASE_URL`, 32+ character `SESSION_TOKEN_HASH_SECRET`, expiry/activity/cookie settings |
| Session topology | `SESSION_DEPLOYMENT_MODE=same-site`, `SESSION_COOKIE_SECURE=true`, `SESSION_COOKIE_SAMESITE=lax` for sibling HTTPS owner domains |
| Shared protection | authenticated `RATE_LIMIT_REDIS_URL` and bounded Redis/lease settings |
| Reset delivery | both reset webhook and reset URL base, or neither |
| Files when enabled | every `FILE_STORAGE_S3_*` value plus `FILE_SCAN_CLAMAV_HOST`, port, and timeout |
| Web search when enabled | `WEB_SEARCH_ENABLED=true`, `WEB_SEARCH_PROVIDER=tavily`, server-only `WEB_SEARCH_TAVILY_API_KEY`, bounded search limits |
| Website retrieval when enabled | `WEB_SCRAPING_ENABLED=true`, SSRF/response/redirect limits and explicit `WEB_SCRAPING_ROBOTS_POLICY` |
| Writing when enabled | `WRITING_WORKFLOW_ENABLED=true`, applied `002_writing_and_workflows.sql` migration, PostgreSQL and protected-model acceptance evidence |
| v1.2 durable features when enabled | applied migrations through `008_v129_mixed_pdf_page_provenance.sql`; each of `ARTIFACT_DELIVERY_ENABLED`, `PERSISTENT_MEMORY_ENABLED`, `KNOWLEDGE_BASE_ENABLED`, `DATA_ANALYSIS_ENABLED`, and `CONVERSATION_SHARING_ENABLED` must have its own accepted dependency evidence |
| v1.2.9 local document OCR/PDF when enabled | identical bounded `KNOWLEDGE_OCR_*` variables and `KNOWLEDGE_OCR_PROFILE=production` on API and worker, locked `npm ci --omit=dev` dependencies, private storage/scanner, and staged image/scanned/mixed-PDF acceptance. No system renderer/Tesseract binary is required or permitted as a workaround. |
| Artifact storage when enabled | private `FILE_STORAGE_S3_*` configuration and `ARTIFACT_RETENTION_HOURS`; storage must pass real authorized write/read/delete and retention-cleanup acceptance |

Use Render PostgreSQL’s private connection string where available. Keep every secret in Render’s environment UI—never Netlify, browser code, source control, or logs. Rotating `SESSION_TOKEN_HASH_SECRET` intentionally invalidates all current sessions.

## Production session setting choices

`same-site` is the supported mode: the owner configures sibling HTTPS frontend/API hosts and uses host-only `SameSite=Lax` cookies. `netlify-proxy` is allowed only after a deployed same-origin Netlify proxy is verified. `cross-site` requires explicit `SESSION_ALLOW_CROSS_SITE_COOKIES=true` and `SameSite=None`, but browser privacy policies can still fail; it is not a default fallback.

Render accepts credentialed browser requests only from exact `ALLOWED_ORIGINS`; do not use `*`, path values, temporary broad entries, or an unverified preview wildcard. Clearing cookies uses the same name/path/SameSite/Secure attributes used when setting them.

## File-analysis gate and readiness procedure

The Blueprint is an activation profile and sets `FILE_ANALYSIS_ENABLED=true`; deployment still refuses to start unless the following real prerequisites succeed:

1. Configure Render PostgreSQL and verify migrations/backup/restore.
2. Configure authenticated shared Redis and verify multi-instance/failure behavior.
3. Configure a private S3-compatible bucket, TLS endpoint, and least-privilege service credentials permitted to `HeadBucket` and to put/get/delete a fresh canary below `FILE_STORAGE_S3_PREFIX`; do not grant public ACL/list access.
4. Configure private ClamAV and verify `PING`, `VERSION` with a current reportable signature database, plus actual clean/infected scans.
5. Configure exact frontend origin, protected model endpoint/key, and session tests.
6. Deploy only after entering real operator-supplied settings; inspect `/api/readiness` without recording secrets.
7. Treat successful startup and `/api/readiness` verified PostgreSQL/migrations, Redis, storage read/write/delete, scanner signatures, and protected model readiness as necessary—but not sufficient—evidence.
8. Treat the capability as operational only after real authenticated file/ZIP upload, cross-user denial, cancellation, cleanup, and model-analysis acceptance tests pass.
9. For v1.2.9 OCR, verify `/api/readiness` reports both package-managed image OCR and scanned-PDF renderer/OCR smoke reachable, then execute the scanner-gated image/scanned-PDF/mixed-PDF, redaction, limit, worker restart, delete, and capacity checks in `V1.2.9_OCR_DOCUMENT_PROCESSING.md`.

A configured value is not proof that a provider is private or healthy. This release has no live provider evidence.

## Web search, retrieval, and writing activation gates

The Blueprint requests `WEB_SEARCH_ENABLED=true`, `WEB_SCRAPING_ENABLED=true`, and `WRITING_WORKFLOW_ENABLED=true`. A build or a true flag is not operational acceptance evidence.

1. For search, create an owner-approved Tavily account, enter only the server-side `WEB_SEARCH_TAVILY_API_KEY` in Render, verify a real basic search with returned URLs/snippets, invalid-key/rate-limit/credit-exhaustion handling, and citation survival through synthesis. The current free plan advertises 1,000 monthly credits; basic search costs one credit. HTTP 402 stops search without paid fallback. Confirm current provider pricing and terms before activation.
2. For retrieval, test permitted public conventional HTML, robots policy, response/content limits, redirects/timeouts and every SSRF negative case in [WEB_RESEARCH_SECURITY.md](WEB_RESEARCH_SECURITY.md). Do not enable JavaScript rendering, internal hosts, nonstandard ports, login or paywall bypass through this release.
3. For writing, apply migrations, create/save/reload a project and outline, generate/revise/resume a chapter, verify cross-user denial/idempotency/cancellation, and export Markdown/text using the actual protected model.
4. Record owner acceptance evidence, external provider charges/usage policy, and Render outbound resource impact. Only then treat the relevant capability as operational and re-check `/api/capabilities` using an authenticated browser.

`/api/capabilities` is a safe status API, not a provider credential dump or an approval shortcut. It reports `available` only after a guarded success/verified dependency and reports `tested` false until the deployment process records an actual acceptance result.

## v1.2 durable-feature activation gates

The Blueprint requests every v1.2 durable gate. Treat one capability at a time as operational only after applying migration `003` in a backed-up PostgreSQL environment and preserving a rollback release.

1. **Artifacts:** run real authenticated create/download/delete and cross-owner-denial tests for every enabled generation path; confirm object bytes exist before metadata, no object key is returned, expired-object cleanup works, and a failed storage write creates no successful artifact row.
2. **Conversations:** authenticate on two browser sessions/devices, create/reload/search/rename/archive/delete/export conversations, repeat an idempotent request, and verify interruption/retry leaves truthful message state.
3. **Memory:** verify only an explicit save is retrievable; test owner isolation, edit/disable/delete/clear and that an ordinary chat sentence did not create a memory record.
4. **Knowledge:** retain the scanner/private-storage prerequisite, test permitted extraction/index/re-index/delete and source citation, owner isolation and unavailable/failed extraction behavior. Do not imply OCR or vector service activation.
5. **Data analysis:** use approved CSV/XLSX examples to test row/column limits, literal formula handling and generated artifact download. Do not enable arbitrary code execution.
6. **Sharing:** test high-entropy URL creation, finite 1h/24h/7d/30d server expiry, revision-and-digest bound exact preview/snapshot, edit/resubmit/delete/restore/title/role stale-preview rejection, concurrent create/mutation behavior, 999/1,000/1,001/large pagination completeness, role exclusion, no attachment/artifact/memory/source disclosure, expired/revoked generic denial, and immediate denied access after revocation.

Keep streaming disabled: no protected upstream streaming contract was live-verified for this release.

## Maintenance and rollback

Maintenance deletes expired session/reset/file metadata, expired share metadata/snapshot rows, expires/deletes generated artifact objects, and marks stale analysis/operation work failed. Share authorization independently checks expiry/revocation, so cleanup timing never extends access. It does not use an in-memory session store or claim a distributed worker.

For rollback, retain the prior verified release and database backup. First set `FILE_ANALYSIS_ENABLED=false` in the target Render environment and confirm the candidate is not accepting file-analysis work; do not roll back while a production analysis job is in flight. Roll back the Render image/static frontend together if the browser API contract changed; do not roll back only the frontend while retaining incompatible cookies. v1.0.8 added a paired anti-CSRF cookie, so older v1.0.7 sessions are intentionally reauthenticated on restore. v1.1.0 applies an additive writing/workflow migration; do not roll it back by dropping tables during an application rollback. Released analysis/writing objects remain private and should be removed using owner-authorized delete/expiry processes, not by granting bucket access. If rolling back to v1.0.7, clear both `voicechatglm_session` and `voicechatglm_csrf` cookies through the API path; otherwise preserve the paired cookie contract. Deploy the prior release, then test register/login/logout/CSRF and verify `/api/readiness` before reopening traffic.

No Render service, PostgreSQL, Redis, bucket, scanner, mail webhook, custom domain, or protected model credential was supplied; no live deploy/migration/readiness result is claimed.
