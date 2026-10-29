# Rollback runbook

## v1.3.0 API-key addition

Migration `009_api_key_management.sql` is additive: it creates owner-scoped API-key and lifecycle-audit tables without changing model credentials, sessions, private files, OCR data, or existing application records. A code rollback **must not** drop these tables or attempt to reverse HMAC digests into credentials.

### Before a v1.3.0 rollback

1. Record the approved release identifiers, a category-only readiness result, and a verified database backup/restore point. Do not record browser sessions, external API keys, model credentials, database URLs, object keys or internal headers.
2. Disable public external API traffic by setting `PUBLIC_API_ENABLED=false` in the target environment, or revoke affected owner keys through the authenticated management route where that is safer. Do not “disable” protection by removing CSRF/session/auth/Redis checks.
3. Allow in-flight bounded model work to complete or fail safely. Preserve audit rows and use safe logs to assess exposure; do not export bearer values for incident investigation.
4. Keep private object storage private and retain existing scanner/OCR/worker protections. v1.3.0 does not change their operation.

### Rollback procedure

1. Deploy the matched prior Render API and Netlify static release together when a browser/API contract changed. Do not deploy from this source archive automatically.
2. Leave migration 009 and its data in place. If the prior code does not know the tables, it safely ignores additive rows. Restore a database only from an approved, tested backup when incident recovery requires it—not merely to remove keys.
3. Confirm the prior release’s first-party auth, session cookie, CSRF, allowed-origin, model ID/revision and shared limiter settings. Do not substitute model endpoints or expose the model credential.
4. Keep public API disabled until the rolled-forward/repaired release has passed an approved migration/key/revocation/model validation process.

### Required post-rollback evidence

Before reopening traffic, verify the deployed `/api/live`, `/api/ready` and `/api/readiness` behavior; run a real first-party login/logout and protected request; and, before re-enabling v1 integration, execute a controlled owner create/store/use/revoke test plus safe log/header inspection. If file/OCR paths are enabled, repeat the retained scanner, storage, worker, mixed-document and ownership acceptance checks separately.

## Historical v1.2 rollback context

v1.2.x introduced first-party PostgreSQL authentication/session, durable artifacts/conversations/memory/knowledge/shares and additive migrations. Rollback remains deliberate because browser cookies, private artifacts, durable conversations, writing data and bounded work may exist. Retain migrations 003–008; do not expose storage or weaken controls to make an old release operate.
