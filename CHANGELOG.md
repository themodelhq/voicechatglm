# Changelog


## 1.3.0 — 2026-10-27

- Added migration `009_api_key_management.sql`, owner-scoped API-key/audit persistence, random one-time-reveal `vcg_` credentials, HMAC-only storage, expiration/revocation/last-used handling, lifecycle audit, and a transaction-serialized active-key technical safety limit.
- Added session/CSRF-protected Settings API-key lifecycle UI and browser client. Secrets are not persisted in browser/application storage and are absent from list/detail/revoke responses.
- Added actual no-CORS `GET /v1/health` and header-bearer `POST /v1/chat`, limited to `chat:write`, bounded fixed-model text requests, shared per-key/per-owner Redis-compatible protection, safe JSON errors, and fresh conditional database revocation checks before upstream work.
- Added `API_INTEGRATION.md`, cURL/JavaScript/Python examples, `docs/openapi.yaml`, and `validate:api-contract`; expanded Render/environment validation and API-key/persistence/HTTP/limiter/browser-client test coverage.
- Retained the pinned protected model, first-party auth, private document/security/OCR controls, free access and v1.2.9 mixed-PDF behavior. No deployment, live migration, provider contact, model operation or staging acceptance is claimed.

**Status:** local source/package validation only; deployed-platform acceptance remains pending.

## 1.2.9 — 2026-10-11

- Repaired the verified same-page native-plus-raster PDF defect: PDF.js image-paint evidence now selects bounded local rendering/OCR before a native-only branch can omit embedded scan text. Mixed pages retain native plus unique OCR text, ordered provenance/status, and only real engine confidence.
- Added conservative overlap reconciliation, partial-page truthfulness, migration `008_v129_mixed_pdf_page_provenance.sql` for `mixed`/`excluded` page records, and Knowledge metadata for mixed/failed/excluded outcomes.
- Added strict OCR deployment profiles and validation for booleans, provider, language, profile and numeric bounds; safe development defaults, explicit test/staging/production rules, readiness/workflow proof and Render API/worker configuration parity checks.
- Added safe real fixtures/tests for same-page unique receipt/table/stamp, overlap, genuine native repeats, malformed/blank and retained multipage coverage. Focused real-engine tests and the final clean-install full Vitest run pass (50 files / 183 tests).

**Status:** local source/package evidence only. No Netlify/Render deployment, production migration, secrets, model operation, real user document, or platform acceptance is claimed.


## 1.2.8 — 2026-10-10

- Added genuinely rendered local scanned-PDF and mixed-PDF extraction using locked `pdfjs-dist@5.4.149` plus `@napi-rs/canvas@0.1.100`, with locked English Tesseract OCR only for pages without meaningful native text.
- Added one scanner-gated `document-processing` façade used by both protected chat attachments and the PostgreSQL-leased Knowledge worker. It keeps ordered per-page native/OCR provenance and private bounded artifacts.
- Added bounded PDF page, geometry, per-page/total pixel, source/render-output, timeout, cancellation, and process-wide Tesseract-worker-slot controls. No undeclared native executables, user URLs, shell interpolation, or runtime language downloads are used.
- Applied existing secret redaction/exclusion semantics to each OCR/PDF page before page hashes, artifacts, Knowledge chunks, or model evidence; retained prompt-injection delimiting and owner/scanner rechecks.
- Added real scanned/mixed PDF fixtures and tests; chat clean-scan/cache/refusal and Knowledge mixed-PDF tests; worker-slot/cancellation/engine-init/timeout tests; and v1.2.8 docs/Render configuration.
- Corrected image MIME recording so valid PNG/JPEG/WebP can pass the strict downstream OCR allowlist. Updated UI/status wording to describe OCR text extraction rather than visual understanding.

**Status:** local source evidence only. All actual Netlify/Render, PostgreSQL, Redis, storage, scanner, protected model, user-flow, capacity, and staging/production acceptance remains **PENDING DEPLOYED-PLATFORM TESTING**.

## 1.2.7 — 2026-10-10

- Added genuine package-managed local OCR with exact `tesseract.js@5.1.1` and pinned `@tesseract.js-data/eng@1.0.0` production dependencies. It performs real English PNG/JPEG/WebP recognition without a system binary, browser request or runtime language download.
- Added bounded image/pixel/text/timeout/cancellation controls, engine/version/confidence provenance, a harmless static engine smoke fixture, real PNG/JPEG known-text tests and truthful no-readable-text handling.
- Corrected canonical upload-type handling (`type: image`) so eligible images no longer skip OCR. Added scanner-success checks before queueing and again in the worker; scanner-uncertain files fail closed.
- Added owner-scoped page-text retrieval, active-job de-duplication and expired knowledge-job lease recovery.
- Local OCR deliberately does not claim scanned-PDF support. Text PDFs retain native extraction; scanned PDFs require a separately provisioned and verified renderer.
- Added OCR readiness/capability reporting and a Render activation profile. Production startup refuses enabled file/OCR service when dependencies or local engine smoke recognition do not pass.
- Added v1.2.7 deployment guidance, local controlled validation and blocker/defect registers. No model assets or model configuration were changed.

**Status:** package-managed local OCR and source-level tests passed in this workspace. No live Netlify/Render, PostgreSQL, Redis, object storage, scanner, protected model, deployment, user-flow or staging/production acceptance is claimed.

## 1.2.5 — 2026-10-10

- Repaired `resubmitConversationUserMessage()` so its edited content, trailing soft deletion, retitle and `share_version` increment are one transaction.
- Audited and covered application-controlled share-relevant conversation mutation paths: message creation/content/role/metadata updates, soft delete/restore, resubmit, title updates and conversation deletion.
- Added `006_share_preview_integrity.sql` and a server-side exact candidate SHA-256 proof. Preview and creation take a conversation row lock; creation rechecks revision and digest and verifies the copied immutable snapshot before commit.
- Added owner-authorized message soft-delete/restore REST paths and regression coverage for stale previews, resubmit, role eligibility, title, add/delete/restore, races, retry and rollback control flow.
- Added explicit persisted-share confirmation and Copy link UI state; publication no longer falsely says the link was copied.
- Hardened artifact deletion: object-storage deletion must succeed before a successful response; failed deletion restores metadata availability for a private retry.
- Added v1.2.4-to-v1.2.5 schema-upgrade, artifact lifecycle compensation and share-integrity tests.
- Bumped application/lock/service-worker metadata to `1.2.5`. No dependency package was added, removed or upgraded.

**Status:** source integration and local automated validation only. No live Render/Netlify, PostgreSQL, Redis, object storage, scanner, protected model, Brave provider, browser worker, OCR/vector service, sandbox or streaming acceptance is claimed.

## 1.2.4 — 2026-10-10

- Added migration `005_share_expiration_snapshots.sql`, finite server-enforced share expiration and conservative expiration of legacy links that lacked an expiry.
- Replaced live/truncated full-conversation shares with immutable privacy-filtered snapshot rows and stable public pagination. Full shares no longer silently omit messages after 1,000.
- Added an explicit share review dialog: scope, content selection, 1h/24h/7d/30d expiry selection, paginated exact-content preview, attachment exclusion, bearer-link warning, cancellation and confirmation.
- Hardened public share transport with generic unavailable responses, burst protection, `no-store`, no-referrer and no-index headers. Public shares never include private attachments/artifacts, metadata, memory, knowledge, system messages or tool state.
- Added conversation-version conflict detection for stale previews and share-row locking for expiry/revocation access serialization.
- Corrected existing upload, analysis and routed-tool user-action limiter invocation arguments so the configured burst protection is actually applied.
- Added pg-mem migration-upgrade, expiry, privacy, large-conversation, pagination, race, UI and HTTP-header/rate-limit regression coverage.
- Bumped app/lock/cache/test metadata to v1.2.4. No dependency package was added, removed or upgraded.

**Status:** source integration and local automated validation only. No live Render/Netlify, PostgreSQL, Redis, object storage, scanner, protected model, Brave provider, browser worker, OCR/vector, sandbox or streaming acceptance is claimed.

## 1.2.3 — 2026-10-10

- Established a clean immutable v1.2.2 archive baseline and added the v1.2.3 activation audit/provenance records.
- Added an additive PostgreSQL migration for explicit selected-content versus full-conversation share scope. New shares require explicit consent/scope; public output excludes system/tool state and private resources.
- Added safe standalone PPTX slide-text and JSON extraction to the private file-analysis path, including upload acceptance, content types and parser coverage.
- Added section/page-aware knowledge chunk provenance and truthful OCR/vector/hybrid blockers where real infrastructure is absent.
- Added bounded deterministic data filtering and sorting with UI controls and formula-literal correctness coverage. General code execution remains unavailable.
- Extended conventional HTML structured output for product ratings/review counts/availability, bounded public review text and FAQ entries, while retaining the v1.2.2 SSRF/IPv6/DNS safeguards.
- Bumped app/lock/cache/test metadata to v1.2.3. All nine Render activation-profile gates remain true, while external capability availability remains fail-closed without real dependencies.

**Status:** local source integration and regression validation only. No live inference, PostgreSQL, Redis, object storage, scanner, Brave Search, public-site, OCR/vector, browser-worker, streaming, Netlify or Render acceptance is claimed.

## 1.2.2 — 2026-10-10

- Created a clean release tree from the immutable `VoiceChatGLM_Frontend_v1.2.1.zip` activation baseline and recorded its SHA-256 provenance.
- Repaired IPv6 SSRF classification for loopback, unspecified, ULA, link-local, multicast, documentation, IPv4-compatible and IPv4-mapped unsafe forms; DNS all-answer checks, checked-address pinning and redirect revalidation remain enforced.
- Extended conventional HTML extraction to preserve multiple primary content regions, semantic article headers, nested link/heading text, image alternate text, bounded tables and explicit text/table/link/structured-data truncation state.
- Added deterministic IPv4/IPv6, mixed-DNS, redirect-to-metadata, extraction completeness and activation fail-closed regression coverage.
- Set all nine requested feature flags to `true` in the Render activation profile while retaining runtime dependency and capability availability gates. The source archive does not claim any live external feature acceptance.
- Bumped app/lock/cache metadata to `1.2.2` and refreshed release/deployment evidence documentation.

**Status:** locally source-integrated and regression-tested. Live model, PostgreSQL, Redis, object storage, scanner, Brave Search, public web, browser deployment, Render and Netlify evidence remains unclaimed.

## 1.2.1 — 2026-10-10

- Repaired durable chat message identity: browser-created assistant UUIDs are now accepted by the protected chat endpoint, so retry/regenerate updates the same owner-scoped assistant record rather than leaving stale records after a refresh.
- Added owner-authorized server-side message resubmission. Editing a user message updates it and soft-deletes the trailing superseded conversation branch before a new response is generated. Assistant helpful/unhelpful feedback is persisted in message metadata.
- Repaired file-analysis/chat integration. File analysis now validates optional durable IDs and, when present, creates/updates the originating conversation user/assistant records with grounded sources, partial/truncation state and analysis-job association.
- Added browser controls to list and immediately revoke active conversation share links. Public share content remains selected text only.
- Upgraded conventional HTML extraction to produce bounded readable blocks and table relationships while excluding common/hidden boilerplate. It now retains requested/final URL and retrieval metadata, declares truncation, and accurately classifies auth, rate-limit and human-verification/access-challenge outcomes without bypassing them.
- Added an explicit blocked `javascript_page_rendering` capability. No Playwright/browser worker was added because required egress/resource isolation and live acceptance infrastructure is unavailable.
- Added/expanded regression tests for durable feedback/resubmit branch truncation, file-analysis durable IDs, boilerplate/table/truncation extraction, and blocked browser rendering status. Bumped app/lock/cache metadata to 1.2.1.

**Status:** locally source-integrated and fully regression-tested. Live model, PostgreSQL, Redis, object storage, scanner, public web, Netlify and Render evidence remains unclaimed.

## 1.2.0 — 2026-10-10

- Added migration `003_collaboration_artifacts_knowledge.sql` and owner-scoped PostgreSQL records/repository methods for durable conversations/messages, generated artifacts, explicit memories, knowledge sources/chunks, operation recovery and hashed public-share tokens.
- Added a unified private artifact service with actual TXT/Markdown/PDF/DOCX/CSV/XLSX/PPTX/JSON/HTML/source/ZIP serializers, checksum/type/size validation, private-object-first persistence, authenticated metadata/download/delete, cleanup of expired storage objects, and no raw object keys/public storage URLs in browser responses.
- Integrated durable, idempotent conversation/message creation and artifact attachment in protected chat; signed-in workspace cache now hydrates from PostgreSQL and sidebar metadata actions persist through owner-authorized APIs.
- Added explicit, editable, disableable and clearable PostgreSQL memory. Chat text is not silently saved as memory.
- Replaced the knowledge placeholder with scanner-gated private source indexing, bounded lexical retrieval and source citations; no OCR/vector-search claim was added.
- Added capability-gated deterministic CSV/XLSX summary, clean and group-sum analysis with formula-safe XLSX artifact output. Arbitrary Python/JS/shell/notebook execution remains unavailable.
- Added disabled-by-default cryptographically strong, expiring/revocable text-only conversation sharing and a read-only public share route. Shares do not expose artifacts, sources or memory.
- Added server-persisted writing-project artifact export and updated the Writing UI to request owner-authorized DOCX/PDF/Markdown downloads instead of creating browser-only export blobs.
- Kept completion responses: upstream token streaming was not verified and is accurately reported blocked. Removed legacy microphone/voice and image-analysis/generation UI claims.
- Added v1.2 deployment gates, config validation, targeted owner/isolation/failure/recovery/capability tests, and durable-data documentation. All new gates remain false by default pending live acceptance.

**Status:** source-integrated and locally validated in the recorded scope; live model, PostgreSQL, Redis, storage, scanner, browser, Render and Netlify acceptance remain untested/blocked as labelled in `VALIDATION_REPORT.md`.

## 1.1.0 — 2026-10-10

- Added deterministic server-side intent routing to the preserved chat API for normal chat, search, conventional website retrieval, grounded research, book-writing initiation, document writing, planning, clarification, file/ZIP guidance and safe unsupported-action handling.
- Added a documented Brave Search API adapter with backend-only credentials, bounded/deduplicated structured results, source metadata and grounded synthesis citations. It is disabled by default pending live provider acceptance.
- Added SSRF-hardened conventional HTML retrieval: URL/protocol/port policy, public-DNS validation and pinning, redirect revalidation, response/timeout/concurrency bounds, robots policy, text/metadata/JSON-LD product extraction and explicit non-support for browser rendering/access-control bypass. It is disabled by default.
- Added bounded allowlisted research orchestration and safe capability status endpoint/UI. Runtime state separates implementation, configuration, enablement, availability and test evidence.
- Added PostgreSQL migration `002_writing_and_workflows.sql`, owner-scoped writing projects/chapters/revisions/notes, incremental outline/chapter generation, idempotent chapter plans, Markdown/text export and a Writing workspace. It is disabled by default pending live PostgreSQL/model acceptance.
- Preserved all v1.0.9 authentication, CSRF, CORS, model, private file/ZIP, scanner, storage, cancellation and cleanup safeguards; updated static cache to v1.1.0.

**Status:** staging-ready source integration. New external/search/scrape/writing capabilities are implemented and covered by deterministic tests but not claimed live-operational.

## 1.0.9 — 2026-10-10

- Strengthened production file-analysis enablement. When enabled in production, startup now requires verified PostgreSQL/migrations, shared Redis, private object-storage write/read/delete, ClamAV PING/VERSION with a reportable signature database, and authenticated protected-model `/ready` reachability; no model generation is used for readiness.
- Replaced storage metadata-only readiness with a fresh unpredictable private canary that writes, byte-verifies, and deletes in `finally`, without listing or reading customer objects.
- Applied existing secret redaction/exclusion rules to standalone extraction before private artifact persistence or model submission, matching ZIP handling.
- Added bounded sequential multi-window model analysis with explicit partial coverage, plus PostgreSQL advisory-lock capacity claim to prevent cross-instance per-owner analysis over-allocation.
- Kept `FILE_ANALYSIS_ENABLED=false` in the example environment and expanded deployment/rollback runbooks for the concrete dependency gate.
- Added storage/scanner/readiness/redaction/multi-window/capacity-claim regression coverage; updated static cache to v1.0.9.

**Status:** staging-ready source integration. No live Netlify/Render/custom-domain, PostgreSQL, Redis, storage, scanner, email, or protected-model acceptance test is claimed.

## 1.0.8 — 2026-10-10

- Fixed reset-token consumption order. Invalid password submissions no longer consume a valid reset token; corrected retry works. Password update, conditional token consumption, prior-session revocation, and replacement session creation now occur in one locked PostgreSQL transaction.
- Replaced `/auth/me` CSRF rotation with a stable per-session anti-CSRF lifecycle. Added scoped `voicechatglm_csrf` cookie paired to the stored CSRF hash; concurrent tabs now restore/use the same session token safely.
- Hardened React restoration/logout ordering so stale asynchronous restoration cannot reauthenticate UI after logout, while a known session is still revoked during a pending restoration.
- Added production session-deployment modes and selected same-site sibling owner domains with `Secure`, host-only, `SameSite=Lax`, `/api`-scoped cookies. Documented cross-site/default-domain limitations and future proxy acceptance requirements.
- Added safe cached `/api/readiness` diagnostics, S3 metadata probing, and ClamAV PING probing for enabled production file analysis. The feature remains disabled in the committed Render Blueprint.
- Added password-reset transaction, CSRF multi-tab, frontend stale-restore, safe readiness, cookie/CORS, and browser-session regression tests; updated static cache to v1.0.8.

**Status:** staging-ready source integration. No live Netlify/Render/custom-domain, PostgreSQL, Redis, storage, scanner, email, or protected-model acceptance test is claimed.

## 1.0.7 — 2026-10-10

- Replaced the prior external browser identity implementation with first-party PostgreSQL users, Argon2id passwords, opaque hashed/revocable sessions, secure cookie/CSRF/CORS handling, and private file-analysis infrastructure.
