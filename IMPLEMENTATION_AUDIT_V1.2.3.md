# v1.2.3 Implementation Audit and Repair Plan

## Baseline inspected

- Archive: `VoiceChatGLM_Frontend_v1.2.2.zip`
- SHA-256: `57f16a39089f433aaa0455623a233dc916546dca74c38d0989de05e121a7eb57`
- Integrity: `unzip -t` passed before extraction.
- Baseline source: Node/Render API, Netlify React frontend, PostgreSQL migration/repository layer, Redis limiter, private S3-compatible storage, ClamAV client, protected-model proxy, test suite and Render/Netlify manifests.

## Actual baseline findings and v1.2.3 repairs

| Area | Baseline finding | v1.2.3 action | Evidence state |
| --- | --- | --- | --- |
| Feature gates | All nine flags were already `true` in the Render activation profile; availability was fail-closed | Preserved all nine true values and config validation | SOURCE VERIFIED ONLY / local config tests |
| SSRF/retrieval | IPv6/DNS/redirect handling and bounded extraction existed from v1.2.2 | Kept the repaired address-pinning policy; added structured product ratings/reviews/FAQ output to conventional HTML extraction | PASS — independently executed deterministic tests |
| File analysis | PDF/DOCX/TXT/Markdown/CSV/XLSX and ZIP paths existed; PPTX/JSON were not accepted as standalone analyzable uploads | Added PPTX slide-text and JSON extraction, Office-container validation, correct private upload content types, UI acceptance, and tests | PASS — independently executed parser tests; live scanner/storage/model is BLOCKED |
| Writing/artifacts | Owner-scoped writing and private artifact lifecycle existed | Kept shared artifact lifecycle; no false claim of live bucket downloads | SOURCE VERIFIED ONLY / local memory-store tests |
| Memory | Explicit owner-controlled PostgreSQL memory existed | Retained user-controlled create/update/disable/delete/clear and relevance retrieval | PASS — independently executed pg-mem tests; live PostgreSQL is BLOCKED |
| Knowledge base | Scanner-gated lexical chunks/citations existed; no OCR or embeddings/vector service | Added section/page-aware ordered chunk provenance. Did not fabricate OCR, embeddings or hybrid ranking without an OCR engine, embedding endpoint or verified vector extension. | PASS — independently executed lexical/provenance tests; OCR/vector/hybrid is BLOCKED |
| Data analysis | Summary/clean/group-sum source operations existed while the UI exposed summary only | Added exact literal filtering and deterministic numeric/text sorting, API validation, UI controls, and regression tests. Arbitrary execution remains unavailable. | PASS — independently executed tests |
| Sharing | Empty selected-ID lists implicitly exposed a whole conversation, without a durable explicit scope | Added migration `004_explicit_share_scope.sql`, explicit `selected`/`full` scope, mandatory selected IDs, preview/confirmation flow, role allowlist, legacy-safe empty-share behavior, and full/selected regression tests | PASS — independently executed pg-mem route tests; live browser/PostgreSQL is NOT TESTED |
| Browser rendering | No isolated worker, egress policy, browser binary, or service configuration | Not implemented. Conventional HTML only remains truthful. | BLOCKED |
| Streaming | No inspected protected-upstream streaming contract or endpoint credentials | Non-streaming completion path retained. | BLOCKED |
| Secure code sandbox | No isolated worker/container service or hosting isolation guarantee | Deterministic analysis remains active; no API-process code execution added. | BLOCKED |

## Repair plan performed

1. Establish immutable baseline and run clean local installation/tests.
2. Implement explicit safe sharing scopes with an additive PostgreSQL migration and client flow.
3. Extend actual document extraction and deterministic data operations without adding arbitrary execution.
4. Improve extraction provenance/structured readable web data and add regression tests.
5. Preserve strict dependency gates, execute source validation, build, audit and package verification.

## Infrastructure truth

No Render/Netlify credentials, PostgreSQL/Redis/S3/ClamAV endpoints, Brave key, browser-worker service, OCR runtime/language data, embedding/vector service, secure execution worker, or protected-model endpoint were provided in this workspace. They were not configured, contacted or represented as live.
