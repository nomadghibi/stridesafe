# StrideSafe MVP - Local Dev Setup

## Prereqs
- Node 18+
- Postgres 14+

## Database
1. Create a database:
```bash
createdb stridesafe_mvp
```

2. Apply migrations:
```bash
psql stridesafe_mvp -f "db/migrations/0001_init.sql"
psql stridesafe_mvp -f "db/migrations/0002_add_user_password.sql"
psql stridesafe_mvp -f "db/migrations/0003_refine_assessment_constraints.sql"
psql stridesafe_mvp -f "db/migrations/0004_add_facility_settings.sql"
psql stridesafe_mvp -f "db/migrations/0005_add_assessment_scheduling.sql"
psql stridesafe_mvp -f "db/migrations/0006_add_export_tokens.sql"
psql stridesafe_mvp -f "db/migrations/0007_add_notifications_and_task_queue.sql"
psql stridesafe_mvp -f "db/migrations/0008_add_assessment_assignments.sql"
psql stridesafe_mvp -f "db/migrations/0009_add_export_schedules.sql"
psql stridesafe_mvp -f "db/migrations/0010_add_facility_pilot_settings.sql"
psql stridesafe_mvp -f "db/migrations/0011_add_export_token_security.sql"
psql stridesafe_mvp -f "db/migrations/0012_add_report_contract_metadata.sql"
```

3. Seed data:
```bash
psql stridesafe_mvp -f "db/seed/seed.sql"
```

## API Server (Express)
```bash
cd server
npm install
cp .env.example .env
npm run dev
```

- OpenAPI docs: `http://localhost:4000/docs`
- OpenAPI spec: `http://localhost:4000/openapi.yaml`
- If you see auth errors, set `DATABASE_URL` in `server/.env` to your local Postgres user (example: `postgres://<your-user>@localhost:5432/stridesafe_mvp`).

### Seeded logins
- clinician@stridesafe.com / password123
- admin@stridesafe.com / password123

## Frontend
```bash
cd ".."
cd "New project"
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

## Notes
- The API server is wired to Postgres with real CRUD and auth.
- Video upload (local) endpoint: `POST /assessments/:id/videos/upload` (multipart form field `file`).
- Video download endpoint: `GET /videos/:id/download`.
- Uploads auto-extract duration/width/height using `ffprobe` (from `ffmpeg`) and enforce validation.
- If `ffprobe` is not available, you must pass `duration_seconds`, `width`, and `height` fields.
- Basic validation checks duration (10-120s) and resolution (>= 640x360).
- Orphaned uploads are cleaned every 60 minutes (files not referenced in DB older than 24 hours).
- Report generation writes PDFs to `server/storage/reports/`.
- CSV exports: `GET /exports/residents`, `GET /exports/assessments`, `GET /exports/audit`.
- Export bundles: `GET /exports/bundle` (optionally `include=residents,assessments,audit`).
- Export tokens: `POST /exports/tokens` then `GET /exports/download?token=...`.
- Notifications: `GET /notifications`, `PATCH /notifications/:id/read`, and `PATCH /notifications/read-all`.
- Workflow queue: `GET /workflow/queue` and `PATCH /assessments/:id/assign`.
- Export schedules: `GET /export-schedules`, `POST /export-schedules`, and `POST /export-schedules/:id/run`.
- Facility rollup: `GET /analytics/facility-rollup` (admin).
- Task queue runs in-process; set `TASK_POLL_INTERVAL_SECONDS`, `NOTIFICATION_SCAN_HOUR`, `NOTIFICATION_SCAN_MINUTE` in `server/.env` if needed.
- To lock CORS in production, set `CORS_ORIGIN` in `server/.env` (comma-separated origins).
- To change upload size limits, set `MAX_VIDEO_SIZE_MB` in `server/.env` and `VITE_MAX_VIDEO_MB` in the frontend env.
