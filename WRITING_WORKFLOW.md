# Persistent Long-Form Writing Workflow

## Availability

Set `WRITING_WORKFLOW_ENABLED=true` only after PostgreSQL migrations and protected model readiness are live-tested. The committed blueprint/sample environment leave it false. The browser Writing view presents an honest capability error while disabled; it does not create simulated projects.

## Data model and ownership

Migration `002_writing_and_workflows.sql` adds:

- `writing_projects`: owner, project brief, outline, status and concise continuity summary;
- `writing_chapters`: ordered chapter plan/content/status and idempotency key;
- `writing_chapter_revisions`: prior chapter artifacts and change note;
- `writing_notes`: character, setting, plot, continuity, source and general notes;
- `workflow_jobs`: durable record shape for future bounded workflow recovery; no unconfigured background worker is claimed.

All repository reads/writes scope the project to the authenticated PostgreSQL session owner. Project IDs, chapter IDs and user IDs supplied by a browser are never authorization proof. Deleting a project is owner-scoped soft deletion; child content remains inaccessible through normal owner checks.

## Incremental behavior

1. Create a brief with title/premise and optional genre/audience/tone/style/chapter count.
2. Generate a concise reviewable outline using the existing protected model.
3. Save individual ordered chapter plans. The database prevents duplicate ordinal and idempotency-key chapter inserts.
4. Generate or revise one chapter at a time. Prior content is written to revision history before replacement.
5. Keep approved notes and concise earlier-chapter continuity in bounded prompts.
6. Resume the project after browser refresh/server restart by loading saved project/chapter state.
7. Export the persisted manuscript via the unified private artifact lifecycle. The Writing view requests real server-generated DOCX, PDF or Markdown artifacts; the owner downloads them through an authorized artifact route. The legacy Markdown/text content endpoint remains a compatibility read endpoint, not the UI’s authoritative delivery path.

The implementation does not promise word counts or quality level. It does not store hidden reasoning. If generation fails or is cancelled, existing saved outline/chapter content remains intact and the user can retry a chapter.

## API surface

All endpoints use the existing session/CSRF policy and return owner-authorized data only:

- `GET`, `POST /api/writing/projects`
- `GET`, `DELETE /api/writing/projects/:projectId`
- `POST /api/writing/projects/:projectId/outline`
- `POST /api/writing/projects/:projectId/chapters`
- `POST /api/writing/projects/:projectId/chapters/:chapterId/generate`
- `GET /api/writing/projects/:projectId/chapters/:chapterId/revisions`
- `POST /api/writing/projects/:projectId/notes`
- `POST /api/writing/projects/:projectId/export` with an implemented artifact format (`txt`, `md`, `pdf`, `docx`, `csv`, `xlsx`, `pptx`, `json`, `html`, `code`, or `zip`) returns a private durable artifact reference; an optional conversation ID must belong to the owner.
- `GET /api/writing/projects/:projectId/export?format=md|txt` remains a compatibility content export route.

`POST` writes require the existing CSRF token. Chapter and model requests are bounded by API body/model limits and client abort signals.

## Live acceptance before operational status

Record a real protected deployment showing project/outline save, ownership denial, outline/chapter generation, revision preservation, duplicate-idempotency behavior, cancellation/interruption, browser/server resume and Markdown/text export. Until then source tests are implementation evidence only, not production readiness.
