# Application and Model API Integration

## Browser application API

All browser routes are under the configured Render `/api` base. Browser requests use `credentials: "include"`; protected state-changing requests also use `X-CSRF-Token`. They do not send a bearer credential.

| Route | Auth / authorization | Function |
| --- | --- | --- |
| `GET /live` | public | process liveness only; no model/database call |
| `GET /health` | public | fixed upstream model health proxy |
| `GET /ready` | public | database/Redis dependency readiness then fixed upstream readiness |
| `GET /readiness` | public safe diagnostic | cached no-secret database/migration, Redis, file-dependency and model-configuration report; no model generation |
| `POST /auth/*` / `GET /auth/me` | exact origin; session/CSRF where applicable | first-party account/session lifecycle; see [AUTHENTICATION.md](AUTHENTICATION.md) |
| `POST /chat` | valid session + CSRF | deterministic intent router; normal fixed-model chat or an enabled allowlisted search/retrieval/research/writing path; durable client/assistant message IDs make retry/regenerate update the same owner record |
| `GET /api-keys`, `POST /api-keys` | owner session; CSRF for POST | list owner metadata or create a one-time-reveal external integration key |
| `GET /api-keys/:id`, `DELETE /api-keys/:id` | owner session; CSRF for DELETE | inspect metadata or irrevocably revoke an owned key |
| `GET /capabilities` | valid session | safe backend capability implementation/configuration/enabled/availability/test-state report |
| `POST /files` | valid session + CSRF + private scanner/storage | upload, inspect/extract and persist an owner-bound private file |
| `GET /files/:id/status` | owner session | owner-only metadata/status |
| `POST /files/:id/analyze` | owner session + CSRF | genuine bounded content analysis through the existing model backend; with durable conversation/client/assistant IDs, persists the source-grounded exchange and job association |
| `GET /files/:id/download` | owner session | authorized direct private-object download |
| `DELETE /files/:id` | owner session + CSRF | owner deletion and private-object cleanup |

Browser API-key management is session- and CSRF-protected. It never accepts an owner ID from the browser, never displays hashes, and only returns a new bearer credential in the single successful creation response. The settings UI keeps that value in transient component memory only—not browser, URL, or app persistence—and tells the user to save it in an external server-side secret manager.

## v1 external server-to-server API

The public integration origin is deployment-specific. **This release does not invent or publish a production URL.** Set a server-side `VOICECHATGLM_API_BASE` (or equivalent deployment variable) in your integration to the operator-approved external origin, then append the exact paths below. This is intentionally not the browser `/api` contract.

| Route | Authentication | Contract |
| --- | --- | --- |
| `GET /v1/health` | none | Minimal route health response only: `{ "status":"ok", "service":"voicechatglm", "apiVersion":"v1" }`. It does not disclose dependency/model details. |
| `POST /v1/chat` | `Authorization: Bearer <vcg_…>` key with `chat:write` | Fixed protected model text completion. Accepts only `message`, optional `max_new_tokens` (32–4096, default 768), and optional `system_prompt`. It never accepts an upstream URL, model credential, file, client-supplied user ID, or arbitrary model selection. |

The formal contract is [`docs/openapi.yaml`](docs/openapi.yaml). `npm run validate:api-contract` validates its implemented routes, request bounds, response identifier, scope, and documentation anchors. It is a drift guard, not proof of a live deployment.

### Create and store a key

A signed-in user opens **Settings → API keys & integrations**, gives a key a name, optional description/expiration, and saves the one-time displayed `vcg_…` value in a server-side secret manager. The key is formatted as `vcg_<public-id>.<random-secret>`; only the identifier and a non-recoverable HMAC-SHA-256 digest are persisted. It is neither the internal model credential nor a browser credential.

Send it only in the Authorization header. Do **not** put it in a query string, request body, browser bundle, source-control file, client-side storage, telemetry, or logs. Revocation, expiration, unsupported scope, malformed credentials, inactive owner state, and unknown keys are rejected before model work. A conditional database touch rechecks revocation/expiration immediately before upstream work, so revocation is not cached per application instance.

### cURL

```bash
# Use an approved deployment origin; no production URL is supplied by this repository.
export VOICECHATGLM_API_BASE='https://your-approved-api-origin.example'
export VOICECHATGLM_API_KEY='vcg_replace-with-one-time-created-key'

curl --fail-with-body "$VOICECHATGLM_API_BASE/v1/health"

curl --fail-with-body \
  -X POST "$VOICECHATGLM_API_BASE/v1/chat" \
  -H "Authorization: Bearer $VOICECHATGLM_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"message":"Summarize this in two sentences.","max_new_tokens":128}'
```

### JavaScript (server environment only)

```js
const response = await fetch(`${process.env.VOICECHATGLM_API_BASE}/v1/chat`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.VOICECHATGLM_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ message: 'Write a concise release note.', max_new_tokens: 160 }),
});
const body = await response.json();
if (!response.ok) throw new Error(`${body.error?.code}: ${body.error?.message}`);
console.log(body.output.text);
```

### Python (server environment only)

```python
import os
import requests

response = requests.post(
    f"{os.environ['VOICECHATGLM_API_BASE']}/v1/chat",
    headers={"Authorization": f"Bearer {os.environ['VOICECHATGLM_API_KEY']}"},
    json={"message": "List three practical next steps.", "max_new_tokens": 128},
    timeout=70,
)
payload = response.json()
response.raise_for_status()
print(payload["output"]["text"])
```

### Limits and errors

The external surface does not create conversations, access documents, artifacts, memory, shares, or files; it runs only the fixed text model path under the verified key owner. It applies shared Redis-compatible per-key and per-owner burst/concurrency protections. These limits are technical abuse/backpressure safeguards, not paid credits, subscriptions, product quotas, or model access tiers. It sends no browser CORS headers and supports no browser bearer flow.

Errors use the safe JSON envelope `{ "error": { "code": "…", "message": "…" } }`. Representative codes include `INVALID_API_KEY` (401), `INSUFFICIENT_SCOPE` (403), `INVALID_REQUEST` (400), `RATE_LIMITED` / `CAPACITY_LIMITED` (429 with `Retry-After`), and truthful `MODEL_UNAVAILABLE`, `MODEL_BUSY`, `MODEL_REJECTED`, or `MODEL_TIMEOUT` upstream failures (502–504). SQL, bearer values, hashes, authorization headers, storage details, and internal model credentials are never returned.

## Preserved inference contract

Render alone contacts the protected existing service for:

| Route | Method | Data |
| --- | --- | --- |
| `/health` | GET | none |
| `/ready` | GET | none |
| `/v1/chat` | POST | `message`, optional `conversation_id`, `max_new_tokens`, optional `system_prompt` |

The proxy owns the configured upstream URL and `X-API-Key`, permits no browser- or external-key-selected endpoint, and never forwards browser cookies/headers to the model. File bytes/base64 are never sent to `/v1/chat`; only bounded, labelled, redacted extracted text reaches the same text contract.

No live protected endpoint was available to independently verify health, readiness, response schema, or asserted model revision in this release. No deployment, production migration, live model/OCR call, object-storage use, or platform acceptance is claimed by this source archive.
