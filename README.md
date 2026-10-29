# VoiceChatGLM Frontend v1.3.0

A free, incremental v1.3.0 upgrade for the existing deployment boundary:

```text
Browser → Netlify static React frontend → Render Node API
                                      ↘ PostgreSQL · Redis-compatible coordination
                                        private object storage · ClamAV · protected Qwen3
```

The protected model integration is intentionally retained: `themodelhq/voicechatglm-qwen3-8b`, revision `9f25d05035bfda0de9b36dfc5911ddcdb378f3c8`. The browser never receives model, database, storage, search, or scanner credentials. There are no subscriptions, credits, paywalls, artificial product quotas, image generation, microphone/voice input, or general code/notebook/shell execution.

## v1.3.0: owner-managed API keys and narrow external integration

Migration `009_api_key_management.sql` adds owner-bound, revocable, expiring API-key metadata and lifecycle audit records without storing bearer values. A signed-in user can manage keys in **Settings → API keys & integrations**. A newly generated `vcg_…` key is revealed once, held only in transient UI state, and must be saved outside the browser.

The deliberately small external surface is `GET /v1/health` and `POST /v1/chat`, with header-only `Authorization: Bearer <key>` and the sole `chat:write` scope. It reuses the fixed protected text-model proxy, accepts no external user ID/model/upstream/document controls, enforces shared per-key/per-owner technical protections, and provides no browser CORS flow. It remains free to end users: the safeguards are capacity/abuse controls, not billing or product quotas. See [API integration](API_INTEGRATION.md), [OpenAPI](docs/openapi.yaml), [implementation audit](V1.3.0_IMPLEMENTATION_AUDIT.md), and [blocker register](V1.3.0_DEFECT_BLOCKER_REGISTER.md).

## v1.2.x: durable collaboration and repair features

This release retains prior additive migrations, including v1.2.9 `008_v129_mixed_pdf_page_provenance.sql`, and v1.3.0 `009_api_key_management.sql`, with capability-gated source paths for:

- **Unified generated artifacts.** Real TXT, Markdown, PDF, DOCX, CSV, XLSX, PPTX, JSON, HTML, source-code and ZIP bytes are generated, validated, privately stored, then recorded with owner/conversation/message/job metadata. Artifact cards use owner-authorized metadata, download and deletion routes—not raw object keys or public storage URLs. Chat PDF delivery, deterministic spreadsheet output, and writing-project DOCX/PDF/Markdown export use this lifecycle.
- **Durable conversations.** Signed-in conversations and messages are owner-scoped PostgreSQL records with idempotent message creation, list/search/pagination, rename, favourite, pin, archive/restore, delete and export APIs. Browser workspace data remains a cache/optimistic UX layer, not the signed-in authority.
- **Explicit persistent memory.** Only facts the owner deliberately saves are eligible for bounded retrieval. Owners can list, edit, disable, delete, or clear them. Chat text is not silently converted to memory.
- **Private Knowledge and attachment processing.** Scanner-approved uploads are owner-scoped and run through one server-only document processor for chat analysis and the separately hosted PostgreSQL-leased Knowledge worker. Locked package-managed Tesseract English OCR handles PNG/JPEG/WebP; PDF.js detects raster image paint operations before selecting native extraction, so image-bearing pages receive bounded OCR even when the same page has native text. Native plus unique OCR text, page method/status and genuine engine confidence are retained after secret redaction. Scanner state is rechecked immediately before protected processing; unscanned, deleted, or unauthorized material fails closed. This is OCR **text extraction**, not visual understanding. See [v1.2.9 OCR repair, profiles, and activation](V1.2.9_OCR_DOCUMENT_PROCESSING.md).
- **Deterministic and isolated data analysis.** Supported CSV/XLSX input can be summarized, cleaned, grouped/summed, exact-filtered and sorted, with formula-safe XLSX output stored as an artifact. Custom Python/JavaScript is never evaluated by the Node API: when provisioned, it is sent to a separately hosted isolation service that must enforce no network, ephemeral filesystem and no process spawn. Without that service, arbitrary execution stays unavailable.
- **Optional public text shares.** An owner may make a high-entropy, revocable, expiring, read-only `selected`-message or explicit `full`-conversation share. Shares intentionally contain eligible user/assistant text and policy wording only; private artifacts, memory, attachments, system/tool state and knowledge sources are not included.

### v1.2.5 sharing consistency and artifact-delivery repair

- Every application-controlled conversation mutation that changes content, title, message role/eligibility, soft-delete state or message set updates `conversations.share_version` in the same database transaction. This includes the repaired edit-and-resubmit path, which updates the edited user message, soft-deletes trailing messages, retitles the conversation and increments the version atomically.
- Share review is now a coherent locked read that returns a server-computed SHA-256 candidate proof. Publication must provide the reviewed revision **and** exact content proof; the backend re-computes both while holding the conversation lock before writing the immutable snapshot. A stale or altered proof is rejected with a refresh-required response.
- Owner-authorized soft delete/restore message API paths were added and are revision-aware. Full and selected snapshots remain deterministic/paginated with no silent 1,000-message cut-off.
- The share dialog provides an explicit post-persistence success state and user-invoked **Copy link** action. It does not claim clipboard success merely because publication succeeded.
- Artifact deletion now reports success only after the private-object deletion succeeds. If storage deletion fails, metadata is restored to available/private state and the user receives a retryable failure instead of a false success.
- Migration `006_share_preview_integrity.sql` adds non-bearer preview-proof audit storage without destructive schema changes. Conventional HTML retrieval, file extraction and deterministic analysis remain available source paths.

### v1.2.9 same-page mixed OCR/PDF repair

- `server/document-processing.cjs` is the common server-only façade for clean, private image/PDF bytes. It applies the existing secret-redaction policy to every page before protected artifacts, Knowledge chunks, page hashes, or model evidence exist.
- `pdfjs-dist@5.4.149` plus `@napi-rs/canvas@0.1.100` genuinely renders scanned pages locally on Node 20; `tesseract.js@5.1.1` with packaged English data recognizes text. No user URL fetch, shell interpolation, native-system PDF executable, browser renderer, or runtime language download is used.
- PNG/JPEG/WebP and scanned/mixed PDFs are supported only after scanner approval, under bounded bytes/pages/dimensions/pixels/output/time/concurrency. PDF.js classifies native, scanned, same-page mixed, and ambiguous pages; image-bearing pages retain native plus unique OCR supplement text in page order. Encrypted, malformed, oversized, unsupported-language, and unavailable-engine cases fail truthfully.
- The checked-in local fixtures prove actual engine OCR for scanned, multipage mixed, same-page mixed/table/stamp/overlap/repeat, blank and malformed cases, plus bounded configuration and shared-processing coverage. The v1.2.9 controlled local OCR evidence is retained; current release validation is recorded separately and all real deployment verification remains **PENDING DEPLOYED-PLATFORM TESTING**.

### v1.2.7 OCR and advanced service boundaries

- Migration `007_advanced_capabilities.sql` adds leased, bounded PostgreSQL knowledge jobs; source-page provenance; and embedding/vector provenance without storing vectors or provider credentials in PostgreSQL.
- A Render `worker` service consumes private knowledge jobs. The API returns `202 queued`; it does not report indexing success before worker completion. Re-index and delete preserve vector lifecycle work rather than silently leaving a semantic index behind.
- A real local OCR engine and controlled PNG/JPEG/no-text tests exist alongside retained HTTP adapters for optional remote OCR, embeddings/vector storage, a separately hosted execution sandbox, and a separately hosted JavaScript renderer. Every path fails closed when configuration, scanner state, response validation, network-policy attestation, or owner authorization is absent.
- Browser rendering requests require public URL validation before dispatch and validate every final/redirect URL plus renderer attestation of private-network denial, per-hop resolution/pinning and no credential forwarding. It never falls back to static HTML extraction while claiming a browser result.
- No endpoint credentials, hosted service, staging database, object-store/scanner, model endpoint or production deployment is supplied with this release; therefore the adapters are implemented and controlled-tested, but external live acceptance remains blocked.

The protected upstream currently has no inspected/verified streaming contract. v1.2.9 retains the honest completion path and reports streaming as blocked rather than simulating token streaming.

## Deployment defaults are intentionally safe

The Render **activation profile** sets all nine requested feature gates—`FILE_ANALYSIS_ENABLED`, `WEB_SEARCH_ENABLED`, `WEB_SCRAPING_ENABLED`, `WRITING_WORKFLOW_ENABLED`, `ARTIFACT_DELIVERY_ENABLED`, `PERSISTENT_MEMORY_ENABLED`, `KNOWLEDGE_BASE_ENABLED`, `DATA_ANALYSIS_ENABLED`, and `CONVERSATION_SHARING_ENABLED`—to `true`. The non-deployable `.env.example` remains a deliberately disabled local template. A true flag is a request to activate, not evidence that a dependency works: startup validation, per-request authorization, readiness checks, and capability availability remain fail-closed. No live external acceptance is claimed by this archive. The same template also expresses public-API enablement with a generated HMAC secret; it was not applied to Render.

A storage-dependent operation first writes and validates bytes in private object storage; only then is success metadata created. Every durable resource route checks the authenticated owner. Server-side capability status distinguishes `implemented`, `configured`, `enabled`, `available`, `tested`, and (where relevant) `blocked`.

## Documentation

- [API integration and exact external contract](API_INTEGRATION.md), [OpenAPI](docs/openapi.yaml)
- [Capability status, routing, and limitations](CAPABILITIES.md)
- [Durable artifacts, conversations, memory, knowledge, sharing and retention](ARTIFACTS_AND_DURABLE_DATA.md)
- [Architecture](ARCHITECTURE.md), [database/migrations](DATABASE.md), [authentication](AUTHENTICATION.md), [security boundaries](SECURITY.md)
- [File/ZIP processing](FILE_ANALYSIS.md), [web research](WEB_RESEARCH_SECURITY.md), [writing workflow](WRITING_WORKFLOW.md)
- [Render deployment](DEPLOYMENT_RENDER.md), [Netlify deployment](DEPLOYMENT_NETLIFY.md), [rollback](ROLLBACK.md)
- [v1.3.0 API-key implementation audit](V1.3.0_IMPLEMENTATION_AUDIT.md), [v1.3.0 blockers](V1.3.0_DEFECT_BLOCKER_REGISTER.md), [v1.3.0 validation report](V1.3.0_VALIDATION_REPORT.md), [v1.2.9 OCR repair/activation](V1.2.9_OCR_DOCUMENT_PROCESSING.md), and [release manifest](RELEASE_MANIFEST.md)
- [Historical v1.2.5 implementation audit](V1.2.5_IMPLEMENTATION_AUDIT.md), [feature acceptance matrix](FEATURE_ACCEPTANCE_MATRIX_V1.2.5.md), [security findings](V1.2.5_SECURITY_FINDINGS.md), [baseline provenance](BASELINE_V125_PROVENANCE.txt), and [testing](TESTING.md)

## Local verification

```bash
npm ci
npm run typecheck
npm test -- --run
npm run build
npm run validate:api-contract
npm run validate:config
npm run validate:render
npm run scan:secrets
npm run scan:bundle
npm audit --json
npm audit --omit=dev --json
```

`npm test`, static scans, pg-mem tests, builds, and audits are source/local evidence—not live acceptance of PostgreSQL, Redis, S3-compatible storage, ClamAV, the model endpoint, Netlify, Render, or a browser deployment. See the validation report for the exact evidence label on each result.
