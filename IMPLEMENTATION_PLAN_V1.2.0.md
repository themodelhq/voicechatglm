# VoiceChatGLM v1.2.0 Incremental Implementation Plan

## Baseline and constraints

The authoritative baseline is `VoiceChatGLM_Frontend_v1.1.0.zip` (`bfe99615cc8b2c09c49be6b913ee7f6f5dda58f518de3cfe6bcecd18241a5c3a`). It was integrity-checked, retained as an immutable extracted copy, and verified before changes. The v1.1.0 source baseline passed clean install, typecheck, production build, configuration/render validation, secret/bundle scans, audit, and **33 test files / 115 tests**.

This release preserves the existing protected Qwen3 endpoint/model/revision, first-party PostgreSQL authentication, object-storage/scanner controls, ZIP safety controls, Render/Netlify topology, and disabled-by-default operational gates. It does not add image generation, voice interaction, microphone controls, arbitrary code execution, notebook execution, or fake streaming.

## Component plan

| Phase | Components | Incremental change and acceptance boundary |
| --- | --- | --- |
| 1. Durable schema | `003_collaboration_artifacts_knowledge.sql`, repository mappings | Add owner-scoped conversations/messages, artifacts, memories, knowledge sources/chunks, durable operation jobs, and revocable share links. No existing table is dropped or rewritten. |
| 2. Artifact core | `server/artifacts.cjs`, `server/artifact-routes.cjs`, Office/PDF generators | Generate real bytes before metadata insertion; validate name/type/size/checksum; private storage only; owner-checked metadata/download/delete/list. Artifact delivery stays disabled by deployment default until private storage is live-accepted. |
| 3. Conversation sync | `server/conversation-routes.cjs`, protected chat integration | Make PostgreSQL the signed-in source of truth with idempotent messages, pagination, search, rename/pin/archive/delete/export, message citations/tool summaries/artifact references, and refresh/device recovery. Local workspace remains a responsive cache. |
| 4. Memory | `server/memory-routes.cjs`, compact memory retrieval | Add explicit, user-controlled owner memory with enable/disable, list/edit/delete/clear and relevant bounded exact-keyword retrieval. No silent retention of user statements and no vector-search claim. |
| 5. Knowledge retrieval | `server/knowledge.cjs`, `server/knowledge-routes.cjs`, `KnowledgeWorkspace` | Reuse guarded uploads/extraction concepts, index only reliable extracted text into PostgreSQL chunks/full-text search, source citations, reindex/delete. Keep disabled until file scanner/storage prerequisites and live acceptance are available. |
| 6. Deterministic analysis | `server/data-analysis.cjs` | Support bounded CSV/XLSX summaries, filters/grouping/transforms and formula-safe CSV/XLSX export. Explicitly reject general-purpose model code/shell/Python execution; no sandbox is claimed. |
| 7. Secure sharing | `server/share-routes.cjs`, read-only public handler | Add hashed high-entropy tokens, selected-message preview, expiry/revocation, read-only sanitized content, no automatic artifact inclusion, and access timestamps. Feature remains disabled by default. |
| 8. Chat/frontend | API client, workspace context, chat cards, sidebar, Knowledge/Settings views | Render persisted messages and artifact cards, request backend conversation state, preserve local optimistic UX, expose only safe capability status, and avoid voice/image-generation controls. |
| 9. Capability/config/docs | capabilities, config validator, environment/render docs | Add implemented/configured/enabled/available/tested/blocked statuses and fail-safe gates. Document operational activation, retention, migration, rollback, streaming limitation, and no-code-execution boundary. |
| 10. Validation/package | unit/integration/UI tests, final report, archive | Test ownership, deletion, retries, object-store failure truthfulness, document/file generation, conversations, memory, retrieval, data output, sharing/revocation, and preserved controls. Produce ZIP only after final checks and actual checksum. |

## Streaming decision

The existing protected inference contract is completion JSON and v1.1.0 has no verified upstream streaming evidence. v1.2.0 therefore preserves completion responses and exposes streaming as **implemented: false / blocked** rather than fabricating token events. A future activation needs an owner-verified provider streaming contract, timeout/disconnect test, and a server-side relay implementation.

## Release-gate policy

All new provider/storage-dependent features are implemented in source with explicit capability and startup configuration validation but committed disabled. A mocked or local test proves only source behavior; it does not turn a capability into a deployed, available, or tested service.
