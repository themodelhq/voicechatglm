# VoiceChatGLM v1.2.5 Acceptance Matrix

Status labels are evidence labels, not marketing labels. **PASS** means independently executed local evidence only unless the row explicitly says live/staging. No live credential or deployment access was provided for this release.

| Capability | Implementation status | Required/local evidence | Execution status | Remaining blocker |
| --- | --- | --- | --- | --- |
| Conversation sharing | Implemented | Finite expiry, hash token, immutable snapshots, complete 999/1000/1001/2001 coverage, owner isolation, revoke/expiry/rate/cache headers | **PASS — independently tested** | Live PostgreSQL/Redis/browser/CDN acceptance unavailable |
| Share stale-preview rejection | Implemented in v1.2.5 | Edit, resubmit/trailing delete, add, title, role eligibility, soft delete/restore, forged proof, race, retry and rollback-control-flow tests | **PASS — independently tested** | Real PostgreSQL contention/rollback acceptance unavailable |
| Share management UI | Implemented | Selected/full scope, exact paginated preview, 1h/24h/7d/30d expiry, count, attachment exclusion, confirmation, post-save Copy link, active list/revoke source/UI tests | **PASS — independently tested** for component flow | Real deployed browser/clipboard acceptance unavailable |
| Private artifact delivery | Implemented | Owner download denial, successful delete, storage-delete compensation, metadata-write compensation and generated-format tests | **PASS — independently tested** with controlled private store | **BLOCKED** — staging private storage/IAM/ClamAV acceptance unavailable |
| Malware scanner | Integration implemented | Local real ClamAV INSTREAM protocol fixture and clean/infected/unavailable source paths | **PASS — independently tested** for protocol fixture | **BLOCKED** — no deployed scanner endpoint/signature evidence |
| Web search | Integration implemented | Brave request construction, credentials/config, malformed/error/empty/duplicate/source parsing tests | **PASS — independently tested** for controlled responses | **BLOCKED** — no authorized Brave credential/live request |
| Conventional web retrieval | Implemented | SSRF IPv4/IPv6/mapped-address/DNS/redirect, response/content bounds, challenge and HTML extraction fixtures | **PASS — independently tested** | Live permitted public-site acceptance unavailable |
| JavaScript-rendered retrieval | Not implemented | Capability reports unavailable; no browser runtime added | **NOT IMPLEMENTED** | Requires separate isolated browser worker, egress policy and adversarial acceptance |
| Persistent memory | Implemented | Owner persistence/retrieval/disable/delete tests | **PASS — independently tested** | **BLOCKED** — live PostgreSQL/browser persistence acceptance unavailable |
| Writing workflow | Implemented | Existing create/revision/export/error local tests | **PASS — independently tested** | **BLOCKED** — live model/storage/download acceptance unavailable |
| Knowledge lexical retrieval | Implemented | Owner isolation, chunk/page/section provenance, deletion tests | **PASS — independently tested** | **BLOCKED** — live scanner/storage/PostgreSQL acceptance unavailable |
| OCR | Not implemented | Explicit capability boundary | **NOT IMPLEMENTED** | Approved isolated OCR worker, size/time policy and real document acceptance required |
| Semantic/vector/hybrid retrieval | Not implemented | Lexical fallback is accurately described as lexical | **NOT IMPLEMENTED** | Embedding provider/version and permission-aware vector store required |
| Deterministic data analysis | Implemented | Existing bounded CSV/XLSX operation tests | **PASS — independently tested** | **BLOCKED** — live file/scanner/storage acceptance unavailable |
| General code sandbox | Not implemented | Capability explicitly unavailable; no Node in-process execution added | **NOT IMPLEMENTED** | Hardened external sandbox with network/filesystem/resource isolation required |
| Genuine model streaming | Not implemented | Capability explicitly unavailable; non-streaming response retained | **BLOCKED** | Owner-verified protected upstream streaming contract/authorized test needed |
| Authentication/session security | Implemented | Registration/login/logout/reset/session/CSRF/rate/access tests | **PASS — independently tested** | Deployed secure-cookie/CORS/browser acceptance unavailable |
| File analysis | Implemented | Format, ZIP/path/bomb, scanner/storage route and malformed input tests | **PASS — independently tested** | **BLOCKED** — live scanner/storage/model acceptance unavailable |
| Migrations | Implemented | Fresh schema (migrations 001–006) and v1.2.4-to-006 upgrade preservation test | **PASS — independently tested** using pg-mem | **BLOCKED** — actual Render PostgreSQL migration/backup/rollback acceptance |
| Redis/queue behavior | Source integration present | Existing limiter failure/fail-closed tests | **PASS — independently tested** for controlled failure | **BLOCKED** — multi-instance Redis/queue load acceptance unavailable |
| Render/Netlify deployment | Manifests/source validated | Config and Render schema validators | **PASS — independently tested** for static manifests | **NOT TESTED** live; no control-plane/staging URL/build logs |

## Decision

The codebase may be packaged as a **release candidate**. It must not be called production-ready until the blocked staging/deployment acceptance items are executed and recorded with non-sensitive evidence.
