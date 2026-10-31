# Hugging Face Space inference provider

This integration is opt-in. Existing deployments remain on the default `legacy` provider unless the Render service environment explicitly changes `VOICECHATGLM_PROVIDER`.

## Render API service variables

Set these on the **voicechatglm-api** web service:

- `VOICECHATGLM_PROVIDER=huggingface_space`
- `VOICECHATGLM_API_URL=https://themodelhq-voicechatglm-inference.hf.space`
- `VOICECHATGLM_API_KEY`: the dedicated shared key configured as the Space secret `VOICECHATGLM_API_KEY`
- `HF_TOKEN`: a Hugging Face access token stored as a Render secret
- `UPSTREAM_TIMEOUT_MS=120000` (the existing upper bound for non-RunPod providers)

The Render Blueprint declares `HF_TOKEN` as a secret environment variable. Do not store either credential in the repository, browser application, or logs. `HF_TOKEN` is distinct from `VOICECHATGLM_API_KEY`.

## Request flow

The Node API submits `POST /gradio_api/call/generate` with `data=[message, system_prompt, max_new_tokens]`, then retrieves `GET /gradio_api/call/generate/{event_id}` as an SSE stream. Both requests include:

- `X-API-Key: <VOICECHATGLM_API_KEY>`
- `Authorization: Bearer <HF_TOKEN>`

Only an `event: complete` frame with a non-empty first string in its JSON data is mapped to the existing model response `{ response, model, revision }`. Error, malformed, empty, and incomplete events fail closed.

## Readiness behavior

The model readiness probe makes an authenticated GET to the Space root. It confirms that the Space responds to both credentials, but it does not execute a model generation request. End-to-end inference must still be tested through the application's `/v1/chat` or browser `/api/chat` path in staging.

## Rollback

Set `VOICECHATGLM_PROVIDER=legacy` and restore the previously validated legacy endpoint credentials. Do not switch the production setting until a staging test confirms chat, readiness and failure handling. The change does not require database migrations or a frontend change.
