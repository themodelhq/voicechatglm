# v1.2.5 Durable Data, Artifact, and Sharing Boundaries

## Core data model and ownership

Migrations `003_collaboration_artifacts_knowledge.sql`, `004_explicit_share_scope.sql`, `005_share_expiration_snapshots.sql` and `006_share_preview_integrity.sql` add owner-scoped durable records for conversations/messages, generated artifacts, explicit memories, knowledge sources/chunks, durable operations, explicit-scope public shares, private share snapshots and non-bearer preview proofs. Existing v1.1.0 tables and APIs remain additive; no user data table is dropped or reinterpreted.

The API derives the owner from the first-party opaque session, never from a browser-provided owner ID. Conversation, message, artifact, memory, source, job and share queries enforce that owner relationship. A missing or foreign resource is not returned as a successful record. PostgreSQL is the signed-in source of truth; local workspace state is only a cache/optimistic layer and is hydrated after authentication.

## Generated artifact lifecycle

The one artifact service is used for implemented artifact-producing workflows: direct requested chat documents, deterministic analysis output, and writing-project exports. It supports only the formats it actually serializes:

| Format | Generation boundary |
| --- | --- |
| TXT / Markdown / JSON / HTML / source | UTF-8 serialized content, with safe filename/type handling |
| PDF | Server-generated PDF bytes |
| DOCX | Server-generated OOXML package |
| CSV / XLSX | Server-generated delimited/OOXML data; spreadsheet strings beginning with formula-significant characters are emitted as text |
| PPTX | Server-generated OOXML presentation package |
| ZIP | Server-generated ZIP of validated in-memory entries |

The sequence is deliberately fail-safe:

1. Validate requested format, bounded title/content/rows/files and optional owned conversation/message references.
2. Create the actual bytes and validate their format, content type, filename, size and checksum.
3. Store those bytes under a server-generated private object key.
4. Create owner/conversation/message/job-associated metadata only after the storage write succeeds.
5. If metadata creation fails, make a best-effort deletion of the just-written private object and return failure rather than an attachment success.

The browser receives a safe artifact reference, not the storage key, credential, permanent URL, or arbitrary client-selected key. `GET /api/artifacts/:id`, `GET /api/artifacts/:id/download`, and deletion are owner-authorized server operations. A deletion reports success only after private-object removal succeeds; on a storage outage it restores the metadata row to available/private state where possible and returns a retryable failure. HTML is a download artifact, not an untrusted active document rendered on the application origin. Expiry maintenance marks old records expired/deleted and removes their storage objects.

## Chat and recovery semantics

Authenticated `/api/chat` assigns or validates a durable conversation, writes user messages with a browser-provided UUID/idempotency key, invokes the protected completion endpoint, then updates or creates the assistant result. Returned durable IDs allow reload/relogin continuity. Cancellation/interruption leaves a truthful partial/failed state rather than manufacturing completed output. Artifact references are attached only after their artifact storage lifecycle succeeds.

A chat message does not become persistent memory. Internal provider responses, hidden reasoning, session tokens and secrets are not stored as conversation content.

## Explicit memory

`/api/memories` accepts only explicit owner action. A memory has a bounded label/content, type and enabled state; owners can list, replace/edit, enable/disable, delete and clear records. Retrieval is concise owner-scoped lexical matching and must be treated as user-editable context, not privileged instruction. Temporary chat instructions, writing notes and project text are distinct data. Avoid saving sensitive personal information unless the user consciously chooses to do so; disable/delete/clear take effect at the next retrieval.

## Knowledge sources

Knowledge indexing is available only after guarded file handling has produced an owned, scanner-approved extraction record. The source is retained privately, normalized into bounded chunks, and queried by PostgreSQL lexical/full-text search. Citations name the stored source and location. Source list, re-index and delete actions are owner-scoped.

The scope does **not** include OCR, image understanding, embeddings/vector similarity, JavaScript page rendering, CAPTCHA/paywall/login bypass, or claims that an answer was document-derived when no matching passage was retrieved. Uploaded content is untrusted data and cannot authorize a tool, change security policy, or access another owner’s data.

## Deterministic data analysis

The implemented server operations are bounded CSV/XLSX summary, clean, and group-sum workflows. Input and output sizes, rows and columns are capped; any formula-looking input cell is preserved as literal text in generated spreadsheet output. Output is a standard private XLSX artifact.

There is no arbitrary Node/Python/JavaScript/shell/notebook execution. General filters, joins, charts and transforms beyond the implemented deterministic operations are unavailable and are not presented as complete.

## Public conversation sharing

Sharing is opt-in. The server generates a cryptographically strong bearer token, stores only its hash, requires exactly one finite expiry choice (1 hour, 24 hours, 7 days or 30 days), and supports immediate owner revocation. Preview locks the conversation and produces a server-computed ordered candidate proof plus revision; creation locks it again, rechecks both values, copies only eligible user/assistant text, roles and timestamps into a private immutable snapshot, and verifies the copied snapshot proof before commit. Public reads paginate that snapshot and re-check expiry/revocation, rather than reading live history. It does not expose artifacts, uploads, attachments, storage locations, message metadata, memory, knowledge sources, account data, system/tool/internal content, private conversation history, or write actions. Possession of an active link grants read-only access to that limited text; owners should revoke a link if it is shared unintentionally.

## Activation and retention

All v1.2 gates are disabled in committed deployment examples. Before enabling a gate, provision and live-verify the relevant PostgreSQL migration, authenticated API/CORS flow, private storage write/read/delete behavior, scanner dependency for knowledge, retention cleanup, owner-isolation/IDOR checks, and rollback procedure. Configure retention as an operational policy; current artifact cleanup is best-effort maintenance and must be monitored in the deployment.
