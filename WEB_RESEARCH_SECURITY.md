# Web Search and Website Retrieval Security

## Deployment gate

`render.yaml` is a requested activation profile and sets `WEB_SEARCH_ENABLED=true` and `WEB_SCRAPING_ENABLED=true`. The local `.env.example` intentionally remains a disabled, non-deployable template:

```text
WEB_SEARCH_ENABLED=false
WEB_SCRAPING_ENABLED=false
```

A true Render flag requests the guarded code path; it is not live provider/public-web evidence. Capability availability remains false until a guarded success is recorded, and the owner must complete the live acceptance checklist in [TESTING.md](TESTING.md) before treating either service as operational.

## Search provider

The implementation uses the documented Brave Search API only. Required server-side settings are `WEB_SEARCH_ENABLED=true`, `WEB_SEARCH_PROVIDER=brave`, and `WEB_SEARCH_BRAVE_API_KEY`. The subscription token is sent only from Render to `https://api.search.brave.com/res/v1/web/search`; it is never sent to Netlify/browser JavaScript, logged, returned by status APIs, or embedded in citations.

Set bounded `WEB_SEARCH_TIMEOUT_MS`, `WEB_SEARCH_MAX_RESULTS`, `WEB_SEARCH_MAX_RESPONSE_BYTES`, and `WEB_SEARCH_BURST_PER_MINUTE`. Provider 401/403, rate limit, malformed response, timeout, empty result and network failure are distinct non-success outcomes. The user may choose a normal model-only answer after an unavailable search, but the system does not silently say it searched.

## Retrieval support and non-support

The retrieval service fetches only conventional `text/html` and `application/xhtml+xml` pages. It records requested URL, final URL, HTTP status, content type, retrieval method and retrieval timestamp. It extracts bounded readable body structure (headings, paragraphs, lists and table cell relationships), title/description/publication metadata, links, JSON-LD `Product` fields (including availability, SKU, brand, rating and review count), bounded public review text, and FAQ question/answer fields where present. Common navigation/header/footer/aside/form content and hidden nodes are excluded from the primary readable text. If the configured text bound is reached, `truncated` is returned and the synthesis path labels the evidence partial.

It transparently classifies authentication requirements, target rate limits and detected Cloudflare/human-verification/CAPTCHA/access-challenge pages. It never solves challenges, replays clearance cookies, impersonates a user, or bypasses access controls. It does not render JavaScript, execute scripts, authenticate to sites, circumvent paywalls, automatically follow extracted links, or make legal/contractual decisions about site terms. JavaScript rendering is separately reported as blocked because no isolated browser worker/outbound-network policy has been provisioned.

`WEB_SCRAPING_ROBOTS_POLICY=respect` is the default. It performs a bounded robots fetch and honours simple wildcard `Disallow` matches before normal page retrieval. `ignore` is an explicit owner policy choice, not a bypass of a site’s authentication, technical access controls, terms or rate limits. Use permitted public pages and an owner-approved legal/compliance policy.

## SSRF and outbound-network controls

Before every request and every redirect, the service:

1. parses a credential-free absolute URL;
2. allows only HTTP/HTTPS and standard ports 80/443;
3. rejects loopback, localhost/local names, private/internal, link-local, cloud metadata, carrier-grade NAT, multicast, unspecified, documentation and IPv4-mapped unsafe addresses;
4. resolves all DNS answers and rejects the host if any answer is prohibited;
5. selects a checked public DNS answer and pins Node’s request lookup to that answer, so the connection uses the validated address rather than a later DNS-rebinding answer;
6. revalidates redirect locations before following them;
7. limits redirects, timeout, response bytes, retrieved pages and concurrency; and
8. sends `Accept-Encoding: identity` and does not execute downloaded code.

Private Render services, PostgreSQL, Redis, bucket endpoints, scanner services, metadata endpoints, credentials and alternate internal ports are not reachable through this service. The URL validator is defense in depth; deploy outbound network restrictions where the platform supports them.

## Prompt safety and citations

Search snippets and page extraction are labelled untrusted evidence. The synthesis system instruction prohibits page content from changing tools, permissions, security policies, execution behavior, privacy rules or citation rules. Citations preserve provider/page URLs; titles are never transformed into guessed URLs. The model is instructed to identify limitations/conflicts and not attach a citation unsupported by supplied evidence.

## Owner live acceptance checklist

Before setting either flag true, record:

1. real Brave API query, returned URLs/snippets and a synthesis response with the same citations;
2. provider invalid key, rate-limit and outage behavior;
3. permitted public HTML extraction, structured product extraction, robots behavior, empty/malformed/oversize content, timeout and bounded redirect behavior;
4. SSRF negative cases for loopback/private/link-local/metadata/IPv4/IPv6/alternate forms, mixed DNS answers, DNS rebinding and redirect-to-private targets;
5. exact session/CSRF/CORS behavior and server logs with no provider credential or retrieved sensitive content; and
6. provider cost, usage policy, robots/terms policy and outbound-network resource impact approved by the owner.
