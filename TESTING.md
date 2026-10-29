# Testing and Required Live Acceptance

## Local commands

```bash
npm ci
npm run typecheck
npm test -- --run
npm run build
npm run validate:config
npm run validate:render
npm run scan:secrets
npm run scan:bundle
npm audit --json
npm audit --omit=dev --json
npx --yes netlify-cli@17.37.2 build --offline
```

## Deterministic coverage

The suite uses generated tokens/passwords, mocked model HTTP, local HTTP lifecycle servers, isolated in-memory PostgreSQL-compatible schema tests, transaction-query doubles, and a local ClamAV-protocol simulator. It covers:

- migration/version/FK/unique constraints, hashed/revocable session lookup, ownership queries, and password-reset success/policy-failure state with the PostgreSQL-compatible adapter;
- reset regression: invalid password preserves token/password/session state; corrected retry works; valid reset changes password; token reuse/expiry fail; one concurrent caller succeeds; a later database operation triggers transaction rollback; old sessions are revoked; test spies observe no secret logging;
- stable concurrent `/api/auth/me` restoration, multiple valid CSRF-protected requests, missing/mismatched CSRF rejection, exact-origin CORS, cross-origin state-change rejection, cookie scope/attributes, database-error fail-safe handling, and stale restore after logout;
- password/register/login/logout/logout-all/disabled-user/rate-limit behavior;
- readiness report safety and disabled-file-analysis configuration reporting without a model-generation request;
- private S3/scanner configuration and local protocol behavior, document/ZIP extraction/resource limits/redaction/prompt-injection resistance, owner-scoped local router coverage, cancellation, cleanup, and static Netlify/Render boundaries;
- deterministic intent dispatch with absence of unnecessary tools for ordinary chat; explicit search/scrape/research/book/clarification/unsupported routes; mocked documented-search result/error/deduplication/citation handling; and routed search/retrieval-to-model evidence handoff;
- conventional HTML extraction, JSON-LD products, robots parsing, URL/protocol/port/IPv4/IPv6 private-address blocking, mixed unsafe DNS answer blocking, pinned DNS request behavior and prohibited redirects;
- writing-project migration, owner isolation, outline/chapter incremental model calls, ordered/idempotent chapters, revision preservation and Markdown export.

The in-memory PostgreSQL-compatible adapter supports the reset lock query and normal success/policy state tests. Its rollback semantics are not treated as evidence for a real PostgreSQL failure path; that path is covered by deterministic transaction-query tests, while the actual production PostgreSQL transaction remains pending live validation.

## Owner live acceptance before production approval

No live browser, domain, Netlify, Render, PostgreSQL, Redis, storage, scanner, email, or protected-model service was available. Run and record all of the following after configuration:

1. In at least two independent browser contexts: register, login, page refresh, simultaneous two-tab restoration, authenticated chat, missing/mismatched CSRF, logout during a pending restoration, logout-all, reset request/delivery/completion, and browser restart at the configured expiry boundary.
2. Test the chosen owner-controlled sibling domains. If considering unrelated default domains or a Netlify proxy, test third-party-cookie restrictions, `Set-Cookie`, uploads, timeouts, cancellation, and proxy cache behavior before calling it supported.
3. On Render PostgreSQL: migration lock, reset concurrency, transaction rollback, disabled account, session revocation, backup, and restore.
4. Across multiple Render instances: Redis limiter behavior, session consistency, outage fail-safe behavior, and readiness reporting.
5. For files: bucket policy/privacy, scanner signature freshness plus clean/infected samples, supported/mixed ZIP content counts, model analysis, owner/cross-user denial, cancellation, download/delete, expiry cleanup, and restart recovery.
6. For the model: protected `/health`, `/ready`, `/v1/chat`, response behavior, and the asserted model/revision.
7. For web search: a real configured Brave query, returned original URLs/snippets, source-grounded synthesis/citations, empty result, invalid credential, rate-limit, timeout and outage handling. Do not call search operational before recording this.
8. For retrieval: permitted public HTML and JSON-LD product extraction, robots policy, redirect/timeout/oversize behavior, and loopback/private/link-local/metadata/IPv4/IPv6/mixed-DNS/DNS-rebinding/redirect-to-private SSRF-negative tests. Confirm the actual outbound connection policy in Render.
9. For writing: owner project/create/read/delete, outline/chapter generation, chapter revision history, duplicate idempotency key, cancellation/interruption/resume, cross-user denial and Markdown/text export using real PostgreSQL and protected model.
10. Through the actual chat UI: normal model chat, search with citations, permitted retrieval, research-and-writing ordering, file-analysis routing with an owned uploaded file, unavailable capability messaging, retry/cancel, and two-user/session isolation.

Do not mark any live item passed until executed against the actual deployment.
