# Release manifest — VoiceChatGLM Frontend v1.3.0

## Release identity and preserved baseline

| Field | Value |
| --- | --- |
| Release version | `1.3.0` |
| Working tree | `/home/user/VoiceChatGLM_Frontend_v1.3.0` |
| Immutable input archive | `/home/user/VoiceChatGLM_Frontend_v1.2.9.zip` |
| Input SHA-256 | `962d4c032f5ddb41c1500dca5154f23666542bf9c691a79cb1a3910f2a5af21a` |
| Input integrity | `unzip -t` passed before extraction; supplied source manifest checked before v1.3 work. |
| Immutable rollback archive | `/home/user/baselines/VoiceChatGLM_Frontend_v1.2.9.source.zip` |
| Rollback equality | Pre-work `cmp` and SHA-256 equality passed against the supplied v1.2.9 archive; rollback copy is read-only. |
| New migration | `009_api_key_management.sql` (additive API-key and lifecycle-audit schema) |
| Protected model assertion | Unchanged: `themodelhq/voicechatglm-qwen3-8b` @ `9f25d05035bfda0de9b36dfc5911ddcdb378f3c8` |
| OCR implementation/profile | v1.2.9 package-managed English OCR/PDF behavior retained; no live OCR operation claimed. |

## Included v1.3.0 changes

- Owner-scoped API-key lifecycle persistence with no plaintext secret field; secure random `vcg_` values, HMAC-only secret storage, scope/expiry/revocation/last-used metadata and nonsecret created/revoked audit records.
- Session/CSRF-managed Settings interface, accessible one-time secret display, inspection and explicit revoke confirmation; browser secret persistence is deliberately absent.
- Actual fixed-model `GET /v1/health` and `POST /v1/chat` routes using header-only bearer keys and `chat:write`; bounded request contract, safe JSON errors, no public CORS and no bearer/cookie forwarding to the protected model.
- Redis-compatible per-key/per-owner technical burst/concurrency safeguards, plus database-backed conditional last-used/revocation checks for cross-instance behavior.
- API/OpenAPI/examples, contract-drift validator, Render/environment template additions, migration/authorization/HTTP/client/limiter tests and release evidence documents.

## Included/excluded archive policy

Included: application source, lock/manifests, migrations, tests and harmless fixtures, static assets, configuration templates, render/netlify settings, release/security/operator documentation, OpenAPI and `RELEASE_SOURCE_CHECKSUMS.sha256`.

Excluded: `node_modules`, `dist`, caches, `.git`, local `.env` secrets, database dumps, credentials, coverage, generated package output, real user documents, generated OCR output, model weights/assets, the delivery archive and its external hash/inventory companions. Exclusion avoids credentials and circular archive checksums.

## Required delivery companions

1. `/home/user/VoiceChatGLM_Frontend_v1.3.0.zip` — clean source delivery archive.
2. `/home/user/VoiceChatGLM_Frontend_v1.3.0.zip.sha256` — SHA-256 for that exact archive.
3. `/home/user/VoiceChatGLM_Frontend_v1.3.0.zip.contents.txt` — sorted deterministic archive inventory.
4. `RELEASE_SOURCE_CHECKSUMS.sha256` inside the archive — SHA-256 manifest for included source files, excluding itself and the external archive companions.

The external companion SHA-256/inventory are authoritative for delivery. Verify the companion hash, `unzip -t`, inventory and internal source manifest before transfer. See `V1.3.0_VALIDATION_REPORT.md` and `V1.3.0_DEFECT_BLOCKER_REGISTER.md` for the evidence boundary; no deployment or live migration occurred.
