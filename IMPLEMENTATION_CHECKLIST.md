# v1.2.2 Implementation Checklist

## Completed source integration

- [x] v1.0.9 first-party PostgreSQL auth, atomic reset, stable CSRF, CORS/cookie boundaries, protected model contract, private file/ZIP paths and fail-closed file readiness retained.
- [x] Server-owned deterministic intent router validates route inputs and uses an allowlist; ordinary chat avoids external tools.
- [x] Documented server-only Brave Search adapter implements bounded queries/results/response, deduplication, provider error handling, source metadata and grounded synthesis input.
- [x] Conventional HTML retrieval implements URL/DNS/redirect SSRF controls, pinned checked lookup, robots policy, bounded network use and extracted text/metadata/Product JSON-LD.
- [x] Bounded research orchestration only permits search, safe retrieval and synthesis steps; no model-generated arbitrary execution is accepted.
- [x] Capability endpoint/UI reports separate implemented/configured/enabled/available/tested state safely.
- [x] PostgreSQL writing migration and owner-scoped project/outline/chapter/revision/note/export workflow added, with idempotent chapter plans and incremental generation.
- [x] Chat UI renders real tool completion/partial status and source citations, supports request cancellation, and preserves direct authenticated file analysis.
- [x] New deterministic routing/search/retrieval/orchestration/writing/capability tests added; existing authentication/file/ZIP regression tests retained.
- [x] Added migration 003 and owner-scoped PostgreSQL conversations/messages, idempotency/recovery, browser cache hydration and persisted sidebar actions.
- [x] Added one private artifact service with real supported file serializers, storage-before-metadata semantics, owner-authorized routes and expiry object cleanup; chat, analysis and writing export use it.
- [x] Added explicit owner-controlled memory; guarded lexical knowledge chunk retrieval/citations; bounded deterministic CSV/XLSX operations; and text-only revocable/expiring sharing.
- [x] Recorded streaming and general code execution as blocked, removed voice/microphone/image-generation claims, and added source/local regression coverage for artifact success/failure/ownership and disabled v1.2 capabilities.
- [x] Render activation profile requests all nine feature gates; the sample environment stays disabled and runtime availability remains fail-closed without dependencies.

## Owner actions required before operational enablement

- [ ] Supply exact sibling HTTPS frontend/API domains, real PostgreSQL/Redis/model configuration, and run browser/auth regression acceptance.
- [ ] Configure Brave Search provider server credential; perform/record live search, error/rate-limit and citation-synthesis tests before treating web search as operational.
- [ ] Test public-page retrieval plus complete SSRF/redirect/robots/timeout/oversize matrix and provider/site policy before treating website retrieval as operational.
- [ ] Apply migration to real PostgreSQL; prove writing project ownership, outline/chapter/revision/resume/cancel/export behavior against the protected model before treating writing as operational.
- [ ] Provision private bucket/least-privilege credentials and current ClamAV; complete real document/ZIP ownership/cancellation/cleanup/model analysis before treating file analysis as operational.
- [ ] Apply migration 003 to real PostgreSQL and prove cross-device conversation continuity, idempotency/interruption recovery, owner isolation and delete/export behavior.
- [ ] Prove private artifact write/read/delete/no-record-on-failure/expiry cleanup and real PDF/DOCX/XLSX attachment delivery before treating artifact delivery as operational.
- [ ] Test explicit memory privacy controls; scanner-gated knowledge index/re-index/delete/citations; CSV/XLSX formula safety; and share expiry/revocation/no-private-resource disclosure before their individual flags are enabled.
- [ ] Record provider cost/terms, service limits, deployment readiness, backups, rollback steps and all live acceptance evidence before production classification.
