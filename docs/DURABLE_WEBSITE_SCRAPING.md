# Durable website product crawls

Product-catalogue requests made through chat are queued in PostgreSQL instead of crawling inside the chat HTTP request.

## Runtime behaviour

- The chat endpoint creates a durable job and returns its identifier immediately.
- The production API process starts a single polling worker. PostgreSQL row locking with `SKIP LOCKED` prevents multiple instances from claiming the same queued row at once.
- The worker renews a lease after each retrieved page batch and writes crawl progress to PostgreSQL.
- If Render restarts the process, a running job becomes eligible for reclaim after its lease expires.
- When extraction finishes, the worker creates an XLSX artifact in the configured private object store and attaches its metadata to the original assistant message.
- The browser polls the authenticated job-status endpoint and displays the workbook when ready. Conversation metadata also preserves the job reference so polling resumes after a refresh.

## Deployment requirements

No additional Render service or queue vendor is required. The existing PostgreSQL database and private artifact storage are reused. The deployment must already have:

- `DATABASE_URL` configured and reachable.
- `WEB_SCRAPING_ENABLED=true` with valid website retrieval limits.
- `ARTIFACT_DELIVERY_ENABLED=true` and the existing private object-storage configuration.
- The new migration `010_durable_website_scrape_jobs.sql` applied. Production startup runs migrations automatically.

## Operational notes

The worker runs inside the existing Node web process to avoid requiring a separately billed Render worker. It handles one crawl at a time per process. Crawl page/link limits and website safety checks remain enforced by the existing retrieval configuration. A crawl can still be partial when a site blocks retrieval, robots policy disallows pages, pagination is not discoverable, or the configured limits are reached. The application must report coverage accurately and must not claim that every product was found merely because a job completed.
