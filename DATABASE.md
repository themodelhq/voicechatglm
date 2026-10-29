# PostgreSQL Schema, Migrations, Backup and Recovery

## Connection and migration policy

The Render API reads the server-only `DATABASE_URL`. It uses `pg` pooling with bounded connection/idle settings and parameterized queries only. `DATABASE_SSL_MODE=auto` leaves TLS behavior to the supplied URL; `require` and `verify-full` request certificate validation. The application never disables certificate verification as a workaround.

Production start performs `npm run proxy`, which runs `server/db/migrate.cjs` **before listening**. The migration runner takes a PostgreSQL advisory lock, creates `schema_migrations` if needed, applies lexically versioned `server/db/migrations/*.sql` files in individual transactions, and records each filename. A failed migration aborts startup; it never drops/recreates user data or resets accounts. `npm run migrate` is available for a controlled one-off migration job.

Provision Render PostgreSQL in the same region as the API and place its private/internal connection string in Render’s `DATABASE_URL` service secret. Do not add it to Netlify, `VITE_*`, source control, browser storage, or logs.

## Schema

`001_initial.sql` creates:

| Table | Purpose / key protections |
| --- | --- |
| `users` | UUID, unique normalized email, optional display name, Argon2id password hash, active/disabled status, verification/login/password timestamps. Passwords are never plaintext or reversible. |
| `sessions` | UUID, user FK, **HMAC hash** of random opaque cookie token, CSRF-token hash, expiry/activity/revocation times, limited hashed security metadata. Indexes support active token, expiry, and user revocation lookups. |
| `password_reset_tokens` | User FK plus hash of high-entropy single-use reset token, expiry and consumption timestamps. No raw reset token is stored. |
| `files` | Owner FK, original display filename, validated type/size/status, opaque private storage keys, extraction-artifact key, bounded metadata, expiry/deletion timestamps. File bytes are not in PostgreSQL. |
| `analysis_jobs` | Owner FK, durable job status/attempt/error metadata and private result-artifact key. |
| `analysis_job_files` | FK join table linking an analysis job to its owner-authorized files. |
| `schema_migrations` | Applied migration version names/times. |

`002_writing_and_workflows.sql` adds owner-scoped `writing_projects`, ordered/idempotent `writing_chapters`, `writing_chapter_revisions`, `writing_notes`, and bounded `workflow_jobs`. It does not alter or delete existing account/session/file records. Chapter ordering and per-project idempotency keys are unique; revision rows retain the prior chapter artifact rather than hidden model reasoning.

Foreign keys, unique constraints, status checks and indexes are defined in the migrations. Queries bind parameters; request data is never interpolated into SQL.

## Reset and session transaction policy

Password reset does not consume a token in a separate transaction. `resetPasswordWithToken()` begins a transaction, locks the eligible reset/user rows with `SELECT … FOR UPDATE`, validates active-account and email-aware password policy, updates the Argon2id hash, conditionally consumes the token, revokes existing sessions, inserts the replacement session, and commits. Any failure sends `ROLLBACK`; this prevents partially changed password/reset/session state and serializes token use. The replacement session is the only active session created by that reset operation.

Normal session restore does not update the stored CSRF hash. The anti-CSRF raw value exists only in its scoped cookie/response and the database retains its HMAC hash. Activity touches may update `last_activity_at` but never `expires_at`, preserving absolute expiry.

## Backup and recovery

1. Enable/retain the Render PostgreSQL backup offering appropriate for the service plan before taking user data live.
2. Test restore to a separate non-production database periodically; point a temporary environment at the restored database only after changing all service secrets.
3. Record migration version and application release before every deploy. Never restore a backup over production without a documented incident decision.
4. Private object storage must have its own versioning/backup/retention policy. Database metadata and object backup retention must be coordinated.
5. To recover service availability, restore database first, validate `schema_migrations`, configure storage/Redis/scanner secrets, run readiness checks, then enable browser traffic.

No production database was supplied for this release; migrations through `006_share_preview_integrity.sql` use an isolated in-memory PostgreSQL-compatible test adapter for fresh-schema and representative v1.2.4 upgrade coverage. That adapter does not prove Render backup, connection, PostgreSQL lock contention, or full transactional rollback behavior under injected late-write failure.


## v1.3.0 API-key migration

`009_api_key_management.sql` is additive and creates `api_keys` plus `api_key_audit_events`. `api_keys` stores an owner foreign key, opaque public identifier, HMAC digest, allowed scopes, created/last-used/expiry/revocation metadata and no plaintext bearer column. It has owner/list, active lookup and expiry indexes. Audit events record created/revoked action/outcome and safe nonsecret metadata only. Keys are created/revoked through repository transactions; active-key counting is serialized per owner with a PostgreSQL transaction advisory lock. Do not hand-edit key state or attempt to recover a secret from the digest.

The normal migration runner serializes schema application. This archive's migration test uses an isolated pg-mem database only; it is not evidence that migration 009 was applied to a hosted PostgreSQL database. Before an approved rollout, create and test a database backup/restore point, use the normal migration runner, inspect migration status, and retain the additive tables during code rollback.
