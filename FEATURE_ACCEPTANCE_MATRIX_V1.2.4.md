# v1.2.4 Feature Acceptance Matrix

`Implemented and independently tested` refers to source/local automated evidence only. It is not a claim of a live Render or Netlify deployment.

| Area | Implementation status | Test/live status | Evidence / blocker |
| --- | --- | --- | --- |
| Selected-content sharing | Implemented and independently tested | PASS — local pg-mem/UI/HTTP tests | Explicit selection, server expiry, hash token, versioned preview, snapshot and owner revoke. |
| Full-conversation sharing | Implemented and independently tested | PASS — local pg-mem tests | 999, 1,000, 1,001 and 2,001 message cases; deterministic paginated snapshot, no silent truncation. |
| Share expiry/revocation | Implemented and independently tested | PASS — local tests | Fixed finite choices, backend check and cleanup; generic public unavailable response. |
| Public share privacy/attachments | Implemented and independently tested | PASS — local tests | No artifacts/attachments/internal roles/metadata returned; no public attachment route exists. |
| Share live browser/PostgreSQL acceptance | Implemented but not live-verified | BLOCKED | No deployed frontend, Render PostgreSQL or browser test account access was provided. |
| First-party auth/session/CSRF/reset | Implemented and independently tested | PASS — existing local regression suite | PostgreSQL/Argon2/cookie and reset tests run locally. |
| Private artifacts | Implemented and independently tested with controlled store | SOURCE VERIFIED ONLY for live object storage | No S3-compatible staging credentials or bucket access provided. |
| File/ZIP/PPTX/JSON processing | Implemented and independently tested | SOURCE VERIFIED ONLY for scanner/storage/model integration | Existing format, malformed input, ZIP safety and parser tests pass; no live ClamAV/storage/model. |
| Writing workflow/persistent memory | Implemented and independently tested | SOURCE VERIFIED ONLY | Owner-scoped pg-mem/local tests; no live database/model acceptance. |
| Knowledge lexical retrieval/citations | Implemented and independently tested | SOURCE VERIFIED ONLY | Owner isolation and provenance tests; no live DB/storage/scanner. |
| OCR | Not implemented | BLOCKED | No approved OCR worker/runtime/language data/acceptance environment. |
| Vector/hybrid retrieval | Not implemented | BLOCKED | No embedding endpoint or verified vector store/extension. Current retrieval is lexical. |
| Deterministic CSV/XLSX analysis | Implemented and independently tested | PASS — bounded local operation tests | Summary/clean/group/filter/sort only. |
| General-purpose analysis sandbox | Not implemented | BLOCKED | No separate strongly isolated, network-denied worker/microVM/container service. |
| Web search | Implemented but not live-verified | BLOCKED | Brave credential/provider acceptance was not supplied. |
| Conventional HTML retrieval | Implemented and independently tested | SOURCE VERIFIED ONLY | Existing SSRF/IPv4/IPv6/DNS/redirect fixtures pass; no live public-site acceptance. |
| JavaScript browser rendering | Not implemented | BLOCKED | No isolated browser worker/egress policy/lifecycle evidence. |
| Genuine upstream streaming | Not implemented | BLOCKED | Protected upstream streaming contract was not available for inspection/testing. |
| Render/Netlify deployment | Deployment manifest/source verified | NOT TESTED | No control-plane credentials, build/deployment logs or staging URLs supplied. |

## Production-configuration conclusion

All nine required Render activation-profile flags remain `true`. This enables guarded code paths, not fictitious dependency health. Readiness/capability state must remain unavailable/fail-closed until actual PostgreSQL, Redis, storage, scanner, model, provider and origin checks succeed.
