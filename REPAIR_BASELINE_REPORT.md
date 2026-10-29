# v1.2.0 Repair Baseline Inspection — 2026-10-10

## Baseline identity

- **Archive inspected:** `../VoiceChatGLM_Frontend_v1.2.0.zip`
- **SHA-256:** `23427fcb1f65b48bc3f2fbbbb79ae9840a098c8053cecb6a55300d15cf91ce25`
- **Integrity:** `unzip -t` passed before extraction.
- **Immutable predecessor:** `/home/user/VoiceChatGLM_Frontend_v1.2.0/` is retained unchanged. This release was extracted cleanly to `/home/user/VoiceChatGLM_Frontend_v1.2.1/`.

## Inspection scope and baseline results

The frontend routing/workspaces, API client, Node routes/middleware, auth/session implementation, migrations/repository, model proxy, files/ZIP pipeline, retrieval/search/orchestration, artifacts, memory, knowledge, data analysis, shares, capability registry, Netlify/Render configuration, deployment docs and all test files were inspected.

| Capability/workflow | Baseline status | Evidence and finding |
| --- | --- | --- |
| First-party authentication, sessions, reset and CSRF | Implemented and independently verified | Local auth/reset/CORS/rate-limit tests passed. Live database/email/browser acceptance was unavailable. |
| Protected Qwen3 completion proxy | Implemented but not independently verified | Fixed model assertion and server-only key path were source inspected; no live model endpoint was supplied. |
| Normal durable chat | Partially implemented | PostgreSQL messages were written, but retry/regeneration browser IDs did not reliably map to the existing durable assistant message. |
| Edit/resubmit and assistant feedback | Implemented but incorrectly integrated | Controls existed in the UI but changes were cache-only; reloading could restore the superseded branch and discard feedback. |
| File/ZIP analysis chat continuity | Implemented but incorrectly integrated | Scanner/extraction/model-analysis pipeline existed, but file-analysis chat responses were not persisted as conversation messages. |
| Conversation list/search/metadata | Implemented but not independently verified | Owner-scoped routes, cache hydration and sidebar operations existed. Real PostgreSQL/browser acceptance remained unavailable. |
| Generated artifacts | Implemented and independently verified | pg-mem/memory-store tests covered real PDF/DOCX/XLSX bytes, ownership and failed private writes. No live object store. |
| Explicit memory / knowledge retrieval | Implemented but not independently verified | Owner-scoped routes and guarded lexical retrieval existed; default disabled and no live scanner/storage/database evidence. |
| Deterministic data analysis | Partially implemented | Summary, clean and group-sum were implemented; arbitrary execution was correctly unavailable. General filters/joins/charts remained unavailable. |
| Writing projects/artifact export | Implemented but not independently verified | Owner-scoped workflow and server artifact export existed; live model/database/storage acceptance unavailable. |
| Conversation sharing | Partially implemented | Secure API revoke existed, but the browser had no list/revoke controls. |
| Web search | Disabled by configuration | Server-only Brave adapter exists; no credential/provider exercise. |
| Conventional web retrieval | Implemented but partially integrated | SSRF/redirect/robots controls existed, but readable output was flattened with boilerplate and no table relationship/provenance/truncation representation. |
| JavaScript page rendering | Missing implementation / missing infrastructure | No isolated browser worker, egress isolation or browser lifecycle test existed. It must remain blocked rather than simulated. |
| Streaming | Blocked by unavailable external contract | Completion proxy only; no verified upstream streaming specification. |
| Voice/image generation | Excluded | No supported active capability; misleading controls had already been removed. |

## Baseline commands independently executed

`npm ci`, `npm run typecheck`, `npm test -- --run`, `npm run validate:config`, and `npm run validate:render` were run on the extracted baseline. Result: **36 test files / 126 tests passed**, typecheck and both configuration validations passed. These are local source results only, not live infrastructure evidence.

## Repair priority selected from findings

1. Repair durable-chat identity/retry/edit/feedback and persist file-analysis exchanges.
2. Complete browser share revocation controls using the existing owner-authorized API.
3. Upgrade direct HTML extraction to preserve useful reading structure/tables, removal of common boilerplate, truncation/provenance, and transparent access-challenge classification.
4. Add explicit capability reporting for blocked JavaScript rendering, retain its gate disabled, and document the infrastructure blocker.
5. Preserve the model, deployment topology, existing safeguards and disabled-by-default external gates.
