# v1.1.0 File-by-File Implementation Plan

**Baseline:** `VoiceChatGLM_Frontend_v1.0.9.zip` SHA-256 `6a1891327d7fa32f07646bcd318e91ce2bfaff08756d1cd0bda9115ea44bfab0`; integrity test passed (138 entries). A read-only extracted copy is retained at `/home/user/VoiceChatGLM_Frontend_v1.0.9_immutable_baseline`.

## Baseline execution

- `npm ci`: passed (296 packages; peer-resolution/deprecation warnings only; 0 audit advisories).
- `npm test -- --run`: passed (26 test files, 97 tests).
- `npm run typecheck`: passed.
- `npm run build`: passed (47 Vite modules).
- No baseline implementation failure was observed locally. The v1.0.9 implementation gap is functional: chat only proxies model requests; the frontend capability directory is hardcoded and reports search as coming soon; no persistent writing/research workflow exists.

## Planned changes

| File / area | Change | Reason |
| --- | --- | --- |
| `package.json`, `package-lock.json` | Release version 1.1.0; add a maintained HTML parser only if needed | Accurate release metadata and bounded conventional-HTML extraction. |
| `server/intent-router.cjs` | New deterministic, allowlisted intent classification and input validation | Route ordinary chat, research, scraping, writing, files, planning, clarifications and unsupported requests safely. |
| `server/capabilities.cjs` | New server capability registry/readiness snapshot | Backend is authoritative for enabled/configured/available/tested states. |
| `server/web-search.cjs` | New Brave Search API adapter | Server-only documented provider, validation, dedupe, timeout, bounded structured evidence. |
| `server/web-retrieval.cjs` | New SSRF-hardened HTTP/HTML retrieval and product/metadata extraction | Separate real scraping from search; pin validated DNS address for each request/redirect. |
| `server/orchestrator.cjs` | New bounded allowlisted research/mixed-task executor | Explicit plans, step limits, cancellation, partial results and no arbitrary model actions. |
| `server/writing.cjs` | New persistent project/outlining/chapter/revision/export service | Dedicated resumable long-form writing workflow using existing model proxy. |
| `server/db/migrations/002_writing_and_workflows.sql` | New persistent writing projects, chapters, revisions, workflow jobs, research records | Owner-scoped durable state and idempotency. |
| `server/db/repository.cjs` | Add owner-scoped project/workflow methods and cleanup/recovery support | Enforce server-side ownership and atomic persistence. |
| `server/proxy-core.cjs` | Dispatch capability, writing, and routed-chat endpoints while preserving auth/CSRF/rate limits | Integrate execution through existing Render API boundary. |
| `server/index.cjs`, `server/maintenance.cjs`, `server/readiness.cjs` | Startup/readiness and stale-work recovery for enabled integrations | Honest operational gating. |
| `server/rate-limit.cjs` | Add bounded search/scrape/writing action limits | Abuse/resource controls, not paid quotas. |
| `src/services/api/client.ts` | Capability, routed-chat, writing project and export APIs | Keep browser calls authenticated/CSRF-protected. |
| `src/services/agents/capabilityRegistry.ts`, `src/features/tools/ToolsWorkspace.tsx` | Fetch backend capability state instead of hardcoded availability | UI reflects real backend status. |
| `src/features/chat/ChatWorkspace.tsx`, types/styles | Render tool progress/errors/citations and send all normal chat through router | Preserve existing interface while making routing visible only when appropriate. |
| `src/features/writing/*`, `src/app/*`, sidebar/types | Add a small writing-project workspace and route | Structured management without replacing normal chat. |
| `.env.example`, deployment/security/testing docs, changelog, validation report | Document exact configuration and disabled-by-default gates | Reproducible safe deployment and truthful readiness claims. |
| `tests/*` | Deterministic unit/integration/frontend coverage for all new paths and regressions | Evidence of dispatch, SSRF safety, persistence, ownership, cancellation and UI behavior. |
