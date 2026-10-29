# Capabilities, Intent Routing, and Workflow Boundaries

## Authoritative capability status

The browser fetches `GET /api/capabilities` after authentication. The endpoint returns only safe status metadata; it never returns provider keys, database URLs, internal hosts, object keys, raw exceptions, or private content.

Each capability has independent fields:

| Field | Meaning |
| --- | --- |
| `implemented` | Server handler/source path exists. |
| `configured` | Required non-secret configuration validates. |
| `enabled` | Deployment policy permits attempts. |
| `disabledByPolicy` | Present for OCR when an exact valid `false` policy intentionally disabled it; a malformed configuration is not reported as disabled. |
| `profile` | Present for OCR: `development`, `test`, `staging`, or `production`. |
| `available` | The dependency has actually responded successfully in this process, or its verified dependency readiness is currently true. |
| `tested` | Live acceptance recorded by a deployment process. This release reports `false` unless an owner adds such evidence. |

A configured key is not an available service. Search and retrieval are not shown as available merely because a flag or credential exists. Runtime availability is advisory UI state only; every actual request still validates configuration, authentication, limits, ownership and network policy.

## v1.2.9 document OCR/PDF capability gates

| Capability | Requested flag | Implemented behavior | Local evidence / deployment boundary |
| --- | --- | --- | --- |
| `document_ocr` | `KNOWLEDGE_OCR_ENABLED` | Server-only English text extraction for clean PNG/JPEG/WebP and scanned/mixed PDFs. PDF.js detects image paint operations before selecting native extraction; same-page mixed results retain native plus unique OCR text. Chat attachment analysis and Knowledge indexing use the same processor. | Real same-page/table/stamp/overlap/repeat plus scanned/multipage/blank/malformed fixture coverage and strict profile validation pass locally; a final clean-install full Vitest run passes 50 files / 183 tests. **PENDING DEPLOYED-PLATFORM TESTING** for Render, scanner, storage, worker, model, browser and capacity. |
| `document_pdf_renderer` | same, plus bounded PDF variables | Locked `pdfjs-dist@5.4.149` + `@napi-rs/canvas@0.1.100`; no system renderer or user-URL fetch. Encrypted/malformed/excessive PDFs fail truthfully. | Package-managed smoke fixture is part of readiness. Invalid/missing dependencies make capability unavailable; do not claim live readiness without authorized staging proof. |

OCR is text extraction only, English-only, and is never allowed to bypass owner checks, scanner clean state, redaction, output/context bounds, or prompt-injection delimiting. See `V1.2.9_OCR_DOCUMENT_PROCESSING.md` for limits and the mandatory acceptance checklist.

## Historical v1.2.7 capability gates and evidence boundaries

The committed Render activation profile requests all supported feature gates, while `.env.example` remains a disabled local template. The following table describes source scope and the live-evidence boundary:

| Capability ID | Gate | Source scope | Default / evidence boundary |
| --- | --- | --- | --- |
| `artifact_delivery` | `ARTIFACT_DELIVERY_ENABLED` | private generated-file persistence, authorized metadata/download/delete | Render gate requested; source/local tests only |
| `persistent_memory` | `PERSISTENT_MEMORY_ENABLED` | explicit owner-controlled PostgreSQL memory | Render gate requested; no silent chat retention |
| `knowledge_retrieval` | `KNOWLEDGE_BASE_ENABLED` | scanner-gated source queue, page-aware chunks/citations and lexical retrieval | Render gate requested; requires live file/database/worker acceptance |
| `knowledge_ocr` | `KNOWLEDGE_OCR_ENABLED` | scanner-gated package-managed English Tesseract OCR for PNG/JPEG/WebP, owner-scoped page provenance and retry/failure jobs | Local engine/PNG/JPEG/WebP tests passed; availability additionally requires real engine smoke, scanner/storage/database readiness. Scanned PDFs remain unavailable without a separate renderer. |
| `semantic_retrieval` | `KNOWLEDGE_SEMANTIC_ENABLED` | external embedding/vector lifecycle and reciprocal-rank hybrid retrieval | Implemented/controlled-tested; **externally blocked** until owner-namespaced embedding/vector services are provisioned and accepted; fallback is explicitly lexical |
| `data_analysis` | `DATA_ANALYSIS_ENABLED` | bounded CSV/XLSX summary, clean, exact filter, sort and group-sum with XLSX artifact output | Render gate requested; deterministic path source-tested |
| `isolated_custom_analysis` | `ISOLATED_ANALYSIS_ENABLED` | external separately hosted sandbox contract for custom Python/JavaScript | Implemented/controlled-tested; **externally blocked** without an enforceable isolation deployment |
| `conversation_sharing` | `CONVERSATION_SHARING_ENABLED` | finite (1h/24h/7d/30d), revision-and-proof-bound, revocable immutable selected-text or full-conversation snapshots | Render gate requested; no system/tool/artifact/attachment/memory/source inclusion; live PostgreSQL acceptance required |
| `javascript_page_rendering` | `BROWSER_RENDERING_ENABLED` | separately hosted browser renderer with per-hop public-URL validation and egress-policy attestation | Implemented/controlled-tested; **externally blocked** until an enforceably isolated renderer passes controlled SSRF/redirect/egress acceptance |
| `streaming` | none | no server stream relay | **Blocked / not implemented** because the protected upstream streaming contract was not verified |
| `arbitrary_code_execution` | none | Python/JS/shell/notebook worker | **Blocked / not implemented**; the Node API never runs model-authored code |

Enabled is a policy setting, not evidence that a dependency works. Available remains false until valid runtime dependency checks succeed; `tested` remains false without recorded live acceptance. The UI must not replace these states with a “coming soon” or a fabricated operational control.

## Intent router

All ordinary, non-file chat messages use `POST /api/chat`. The server validates the existing request schema, first-party session, Origin/CSRF token, and shared rate-limit reservation before routing. The allowed route names are:

- `general_chat`
- `web_search`
- `website_scraping`
- `javascript_page_rendering` (only for explicit render/JavaScript requests with a URL)
- `knowledge_retrieval` (private owner-authorized retrieval)
- `research_and_synthesis`
- `book_writing`
- `document_writing`
- `file_analysis` / `zip_analysis`
- `task_planning`
- `multi_step_workflow`
- `unsupported_capability`
- `clarification_required`

Classification is deterministic for explicit patterns. A question *about* whether a tool exists remains ordinary chat; an explicit instruction to search or retrieve a supplied URL selects a tool. Search/scraping without needed inputs receives a concise clarification. Arbitrary shell commands, internal-network probing, and unregistered actions are rejected rather than delegated to the model.

The router does not execute a model-produced function name or plan. Tool selection and all input validation are server-owned allowlists. Normal chat preserves the original model path and does not invoke external tools unnecessarily.

## Tool operations

### General chat, document writing and planning

These use the existing protected Qwen3 model request unchanged apart from a returned route label. They do not imply web browsing, file access or persistent writing.

### Web search

The only implemented provider is the documented Brave Search API. The server validates a bounded query, uses a server-only subscription token, bounds timeout/result count/response bytes, deduplicates equivalent URLs while preserving the returned original URL, and carries title/snippet/publication date where provided.

When source synthesis is requested, the provider results are labelled untrusted evidence. The model is told to cite only supplied URLs, distinguish evidence from interpretation, and state gaps/conflicts. An empty result, unavailable provider or rate limit is reported as such; it never becomes a claimed completed search.

### Website retrieval

The supplied URL must pass the retrieval policy in [WEB_RESEARCH_SECURITY.md](WEB_RESEARCH_SECURITY.md). Retrieval only handles conventional server-rendered HTML/XHTML and structured metadata. JavaScript-rendered applications, logged-in pages, CAPTCHAs, paywalls and arbitrary binary files are not supported or bypassed.

### Research and synthesis

The bounded plan is fixed: search, optionally retrieve a small number of permitted returned pages, then synthesize. Page failures produce partial status/limitations. The workflow cannot loop endlessly, follow arbitrary links, execute code, or turn retrieved instructions into actions.

### File and ZIP analysis

The existing authenticated file endpoint remains authoritative. The frontend uses `/api/files/.../analyze` for actual selected uploads, so a chat message cannot falsely claim attachment processing. Plain messages mentioning an absent document/ZIP receive an attachment clarification. Existing malware, ownership, extraction, redaction, coverage and cancellation controls remain unchanged.

### Writing projects

`/api/writing/projects` and its owner-scoped subroutes provide saved project creation, outline generation, chapter plans, chapter generation/revision, continuity notes and Markdown/text export. The Writing view is a structured management interface; normal chat can create a project/outline only when the capability is enabled. Chapter generation is incremental, and a model failure leaves already saved approved/draft content intact.

## Workflow cancellation, retries, and idempotency

A browser request has an abort signal propagated to model/search/retrieval operations. Chat displays a cancellation action for an in-flight request. Existing file cancellation remains separate. Writing chapter creation accepts an idempotency key and the database enforces project/ordinal and project/idempotency-key uniqueness. Revisions preserve the prior chapter text before an update. No hidden model reasoning is stored.

Knowledge processing uses a separately hosted PostgreSQL-leased worker with a bounded retry/failure lifecycle. Other operations remain bounded synchronous API work unless their own durable job route says otherwise. Persisted projects allow the owner to resume outline/chapter work after refresh or restart.
