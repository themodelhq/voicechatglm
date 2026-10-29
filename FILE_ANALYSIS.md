# Private File and ZIP Analysis

## Production pipeline

When `FILE_ANALYSIS_ENABLED=true` and every required production setting is valid, the Render API performs this real flow:

1. Validate authenticated owner session, permitted origin and CSRF token.
2. Stream/parse bounded multipart input, validate file signature plus extension, and generate a random UUID independent of the client filename.
3. Put bytes in a **private quarantine object** in configured S3-compatible storage.
4. Scan the bounded object bytes through the ClamAV INSTREAM protocol. Scanner failure fails closed; infected input is rejected and quarantine cleanup is attempted.
5. Safely inspect/extract supported content. ZIP members are never executed.
6. Persist the original private object, private extraction JSON artifact and owner/file metadata. PostgreSQL stores only keys and structured metadata, not large raw bytes.
7. On analysis, reload only owner-authorized artifacts and independently recheck scanner-success state. Approved image/PDF attachments are processed from private bytes through the shared bounded OCR/PDF path, redacted per page, and cached only in the private extraction artifact before a bounded labelled/redacted prompt reaches the existing server-owned model proxy. The result artifact and durable job status are then stored privately.
8. Permit owner-only status, result retrieval, direct download and deletion. Maintenance removes expired metadata and corresponding artifacts.

If object storage or ClamAV configuration is absent, production startup/configuration refuses file analysis rather than simulating success or reverting to local/in-memory storage.

## Supported content and limitations

| Type | Actual processing |
| --- | --- |
| TXT / Markdown | UTF-8/UTF-16 bounded text extraction |
| CSV | Strict bounded parser with row/column limits |
| PDF | At protected chat analysis or Knowledge indexing, each clean PDF page is inspected for native text and raster image paint operations. Native-only pages use native text; image-bearing same-page mixed/scanned pages use locked local PDF.js/canvas + English OCR and retain bounded native plus unique OCR text. Encrypted/malformed/over-limit pages fail or report partial truthfully. |
| DOCX | Bounded Office ZIP/XML paragraphs/tables extraction |
| PPTX | Bounded Office ZIP/XML slide-text extraction; no speaker notes/media/macros claim |
| XLSX | Bounded workbook/worksheet/shared-string/cell extraction |
| JSON | Bounded parsed/normalized JSON extraction; malformed JSON fails clearly |
| PNG/JPEG/WebP | Signature/dimension validation; scanner-clean chat attachments and Knowledge sources use configured private English OCR text extraction when submitted, never visual understanding |
| ZIP | Manifest plus safe actual extraction/analysis of eligible supported members |

Documents exceeding processing/context limits are truncated or selected with `partially_analyzed` coverage, not described as completely analyzed. Selected evidence is sent in at most three sequential bounded model windows; each answer is labelled by window and remaining evidence produces partial coverage rather than a completeness claim. A manifest-only ZIP reports `inspection_completed`; it does not claim model content analysis.

## ZIP protections and reporting

The maintained `yauzl` reader rejects corrupt/encrypted archives, ZIP Slip/traversal/absolute paths, special files/symlinks, unsupported compression, duplicate/conflicting paths, nested archive extraction, excessive depth/entries/sizes/ratio and processing timeout/cancellation. Limits are server-side environment values:

- upload individual/aggregate sizes, file count, retention and analysis duration;
- ZIP compressed/uncompressed/member bytes, entry count, directory depth, supported-member count and expansion ratio;
- extracted text/context and per-owner concurrent analysis work.

Each ZIP result records discovered/validated/extracted/analyzed/unsupported/rejected/excluded/omitted counts, member reasons, selected paths, context omissions, extraction failures and truncation. Member paths are normalized metadata only—never filesystem destinations.

## Ownership, prompt safety and cancellation

The verified session user ID, never a request `user_id`, governs every upload/status/analyze/result/download/delete/cancel operation. Cross-user records respond as unavailable. Extracted content and agent preferences are untrusted evidence/format guidance; a trusted analysis instruction prohibits content from changing security, tool, permission, execution, privacy or evidence rules. Secret-bearing paths/private keys are excluded and common tokens/passwords/credential URLs are redacted before the private extraction artifact or model input. This applies to standalone documents as well as ZIP members; content that cannot be safely redacted is excluded from content analysis with a notice.

Client disconnect or timeout aborts parser/reader/model work and marks the active synchronous job cancelled/failed safely. The cancel route records an owner cancellation request; this release runs bounded analysis synchronously rather than pretending to provide an unconfigured distributed worker. Restart recovery marks stale processing records failed; cleanup removes expired records/objects.

## Dependency readiness and owner enablement gate

`GET /api/readiness` is a cached, secret-free diagnostic. With production file analysis enabled it verifies all mandatory dependencies rather than treating configuration as success:

- PostgreSQL connection and applied migrations;
- shared Redis limiter connectivity;
- a private storage canary: `HeadBucket`, a fresh unpredictable key written with private/AES256 settings, read back byte-for-byte, then deleted in `finally` (no customer-object listing or customer-object read);
- ClamAV `PING`, `VERSION`, and a reportable signature database version;
- an authenticated server-side `GET /ready` to the configured protected model endpoint. It never sends a generation request for readiness.

Render startup repeats this verification when `NODE_ENV=production` and `FILE_ANALYSIS_ENABLED=true`; it refuses to listen if any category fails. The report exposes only category/status/signature availability, never endpoints' credentials, object keys, bodies, session values, or model keys. A passing probe is necessary but still does not establish bucket policy, malware-detection quality, user-flow correctness, or model-answer quality.

Before changing `FILE_ANALYSIS_ENABLED` to true on Render, provision and test: private bucket policy (no public ACL/list), restricted storage credentials with the minimum `HeadBucket`/put/get/delete permissions for the configured prefix, TLS endpoint, ClamAV private service with current signatures, Render PostgreSQL, Redis, exact Netlify CORS origin, migrations, authenticated owner cross-access tests, scanner rejection, delete/expiry cleanup, cancellation, mixed supported/unsupported ZIP coverage, and real document/ZIP model analysis. Keep the flag false until those owner acceptance tests pass. No live storage/scanner deployment was supplied for v1.2.4, so these live checks remain unrun.
